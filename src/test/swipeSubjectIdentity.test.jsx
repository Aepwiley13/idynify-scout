/**
 * A DEFERRED DECISION CANNOT LAND ON SOMEONE ELSE.
 *
 * Scoped out of the double-fire fix (commit "One gesture is one decision, at
 * the card and at the handler") and closed here.
 *
 * THE WINDOW
 * ──────────
 * CompanySwipeCard.up() commits synchronously — it latches `decidedRef` and
 * calls setGone — but defers the callback 280ms behind the card's exit
 * animation:
 *
 *   if (dx > 100) commit(() => { setGone('r'); setTimeout(() => onAccept(...), 280); });
 *
 * For those 280ms handleSwipe has not been called, so `swipeInFlightRef` is
 * unclaimed. A keyboard press inside the window runs a complete decision —
 * Firestore chain included — and if it SETTLES before t=280 it releases the
 * lock. The deferred drag callback then arrives at an open door.
 *
 * WHAT ACTUALLY HAPPENS THEN — measured, not assumed
 * ──────────────────────────────────────────────────
 * It decides the SAME company a second time, not the next one. The deferred
 * callback closes over the `onAccept` prop from the render the gesture happened
 * in, and that prop closes over that render's `handleSwipe`, which closes over
 * that render's `currentIndex`. React prop staleness pins the callback to
 * company N. So the queue skips nobody; instead one gesture-pair writes two
 * lineage events on one company, stamped 'keyboard' and 'drag'.
 *
 * That is the same defect as the production double-fire, one level up: the card
 * latch is per card and cannot see the keyboard, and the in-flight lock has
 * already been released. Neither existing guard covers it.
 *
 * THE FIX, IN TWO PARTS
 * ─────────────────────
 * 1. Subject identity. The card names the company the gesture was made on and
 *    sends it with the callback; handleSwipe decides that company or nothing.
 *    On its own this does NOT close the duplicate above — the stale closure
 *    still resolves to company N, which matches. It closes the wrong-company
 *    case, which is latent today and becomes live the moment anyone makes the
 *    card's path non-stale (routing it through handleSwipeRef the way the
 *    keyboard already does would do it). That is one refactor away, and the
 *    failure is silent: a decision on a company the user never saw.
 *
 * 2. A subject ledger (`decidedSubjectsRef`). A company that has been decided
 *    and not undone cannot be decided again, whichever door the second call
 *    arrives through. This is what actually closes the race.
 *
 * The distinction that must survive, again: swipe → undo → re-swipe is a real
 * second decision. `handleUndo` retracts the ledger claim so it stays possible.
 */

import { render, fireEvent, act } from '@testing-library/react';
import { useState, useRef, useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

// ── Module mocks — the cards are leaves; nothing here should reach Firebase ──
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('t') } },
  db: {},
}));
vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/ContactTitleSetup', () => ({ default: () => null }));
vi.mock('../components/scout/BarryICPPanel', () => ({
  default: () => null,
  BarryAvatar: () => null,
}));

import { CompanySwipeCard, PersonSwipeCard } from '../pages/Scout/DailyLeads.jsx';

const COMPANIES = [
  { id: 'c-N', name: 'Company N', industry: 'Robotics', fit_score: 82 },
  { id: 'c-N1', name: 'Company N+1', industry: 'Logistics', fit_score: 74 },
  { id: 'c-N2', name: 'Company N+2', industry: 'Biotech', fit_score: 61 },
];

/** The draggable surface is the card's outer element, as in swipeSingleDecision. */
const surface = (el) => el.firstChild;

function dragRelease(el, distance) {
  fireEvent.mouseDown(el, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(el, { clientX: distance, clientY: 0 });
  fireEvent.mouseUp(el, { clientX: distance, clientY: 0 });
  fireEvent.mouseLeave(el, { clientX: distance, clientY: 0 });
}

/**
 * The page's swipe machinery, reduced to the parts the race runs through:
 * the same in-flight lock, the same subject ledger, the same keyboard ref, the
 * same `companies[currentIndex]` read, the same keyed card. The Firestore chain
 * is one awaited microtask — the race does not care how long it is, only that
 * it can finish inside 280ms.
 *
 * Rendering the real page is not an option here: it mounts the whole Scout
 * queue behind Firestore. What is reproduced is the wiring, and the wiring is
 * asserted against the real source at the bottom of this file.
 */
function Queue({ decided }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const swipeInFlightRef = useRef(false);
  const decidedSubjectsRef = useRef(new Set());
  const handleSwipeRef = useRef(null);
  const historyRef = useRef([]);

  // Signature mirrored from the page verbatim, unused parameters included:
  // the position of `subjectId` is the contract under test, and renaming or
  // dropping the ones this harness ignores would stop it being the same shape.
  // eslint-disable-next-line no-unused-vars
  const handleSwipe = async (direction, feedback = null, gesture = 'unknown', subjectId = null) => {
    if (swipeInFlightRef.current) return;
    const company = COMPANIES[currentIndex];
    if (!company) return;
    if (subjectId && subjectId !== company.id) return;
    if (decidedSubjectsRef.current.has(company.id)) return;
    swipeInFlightRef.current = true;
    decidedSubjectsRef.current.add(company.id);
    try {
      await Promise.resolve();
      decided.push({ id: company.id, direction, gesture });
      historyRef.current.push({ company, index: currentIndex });
      setCurrentIndex(currentIndex + 1);
    } finally {
      swipeInFlightRef.current = false;
    }
  };
  useEffect(() => { handleSwipeRef.current = handleSwipe; });

  // handleUndo, reduced to the two things that matter here: the index goes back
  // (which remounts the card under its own key, reopening the card latch) and
  // the ledger claim is retracted.
  const handleUndo = () => {
    const entry = historyRef.current.pop();
    if (!entry) return;
    decidedSubjectsRef.current.delete(entry.company.id);
    setCurrentIndex(entry.index);
  };

  const current = COMPANIES[currentIndex];
  return (
    <div>
      <button
        data-testid="kbd-right"
        onClick={() => handleSwipeRef.current?.('right', null, 'keyboard')}
      />
      <button data-testid="undo" onClick={handleUndo} />
      <div data-testid="slot">
        {current && (
          <CompanySwipeCard
            key={current.id}
            company={current}
            onAccept={(feedback, gesture, subjectId) => handleSwipe('right', feedback, gesture, subjectId)}
            onReject={(feedback, gesture, subjectId) => handleSwipe('left', feedback, gesture, subjectId)}
            onSkip={() => {}}
          />
        )}
      </div>
    </div>
  );
}

const slot = (getByTestId) => surface(getByTestId('slot'));

// Each test here mounts a real card, which pulls in the whole DailyLeads module
// — roughly 1.5s on an idle machine, and enough to cross the 5s default when the
// suite runs 20 files in parallel. The headroom is for module load, not for
// anything the assertions wait on: every timer below is faked and advanced
// explicitly, so a genuine failure still fails immediately.
const SUITE_TIMEOUT = 30_000;

describe('a gesture decides the card it was made on, or nothing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  // ── The race, run end to end ──────────────────────────────────────────────
  it('a keyboard press inside the exit-animation window does not double-decide', async () => {
    const decided = [];
    const { getByTestId } = render(<Queue decided={decided} />);

    // t=0 — drag right on company N. Committed at the card; callback deferred.
    const card = slot(getByTestId);
    fireEvent.mouseDown(card, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(card, { clientX: 160, clientY: 0 });
    fireEvent.mouseUp(card, { clientX: 160, clientY: 0 });

    // t≈10 — keyboard press, allowed to run its full chain and SETTLE. This is
    // the half of the race the in-flight lock cannot cover: by t=280 the lock
    // is long since released.
    await act(async () => { getByTestId('kbd-right').click(); });

    // t=280 — the deferred drag callback fires into an open door.
    await act(async () => { vi.advanceTimersByTime(600); });

    expect(decided, 'the deferred callback decided a second time').toHaveLength(1);
    expect(decided[0].id).toBe('c-N');
    // Whichever gesture won the door, exactly one decision exists for company N
    // and no company the user never gestured on was touched.
    expect(decided.map(d => d.id)).not.toContain('c-N1');
  }, SUITE_TIMEOUT);

  // ── The wrong-company case the identity check exists for ──────────────────
  // Today React prop staleness pins the deferred callback to company N, so this
  // is asserted directly against the guard rather than through the card: the
  // point is that handleSwipe refuses a mismatched subject NO MATTER how the
  // callback got hold of a fresh index. That is what stops a future refactor
  // from turning this window into a silent wrong-company write.
  it('a decision naming a company that is no longer current is dropped', async () => {
    const decided = [];
    let call = null;
    function Probe() {
      const [currentIndex, setCurrentIndex] = useState(1); // queue has moved on
      const swipeInFlightRef = useRef(false);
      const decidedSubjectsRef = useRef(new Set());
      // Same verbatim mirror as above.
      // eslint-disable-next-line no-unused-vars
      const handleSwipe = async (direction, feedback = null, gesture = 'unknown', subjectId = null) => {
        if (swipeInFlightRef.current) return;
        const company = COMPANIES[currentIndex];
        if (!company) return;
        if (subjectId && subjectId !== company.id) return;
        if (decidedSubjectsRef.current.has(company.id)) return;
        swipeInFlightRef.current = true;
        decidedSubjectsRef.current.add(company.id);
        try { await Promise.resolve(); decided.push(company.id); setCurrentIndex(currentIndex + 1); }
        finally { swipeInFlightRef.current = false; }
      };
      call = handleSwipe;
      return null;
    }
    render(<Probe />);

    // A gesture made on company N, arriving after the queue advanced to N+1.
    await act(async () => { await call('right', null, 'drag', 'c-N'); });
    expect(decided, 'a stale gesture decided the company that replaced its own')
      .toHaveLength(0);

    // …and the guard is not simply refusing everything: the current card decides.
    await act(async () => { await call('right', null, 'drag', 'c-N1'); });
    expect(decided).toEqual(['c-N1']);
  }, SUITE_TIMEOUT);

  // ── A caller that cannot name a subject still works ───────────────────────
  it('the keyboard, which has no card and names no subject, still decides', async () => {
    const decided = [];
    const { getByTestId } = render(<Queue decided={decided} />);

    await act(async () => { getByTestId('kbd-right').click(); });
    await act(async () => { vi.advanceTimersByTime(600); });

    expect(decided).toEqual([{ id: 'c-N', direction: 'right', gesture: 'keyboard' }]);
  }, SUITE_TIMEOUT);

  // ── The fact that must NOT be suppressed ──────────────────────────────────
  it('swipe → undo → re-swipe still produces a second, separate decision', async () => {
    const decided = [];
    const { getByTestId } = render(<Queue decided={decided} />);

    dragRelease(slot(getByTestId), 160);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(decided).toHaveLength(1);
    // The queue advanced, so the card on screen is now company N+1's.

    // Undo puts currentIndex back on company N and retracts its ledger claim.
    // The card is keyed by company id, so React mounts a fresh one and the card
    // latch reopens too. The re-swipe must land as a second, real decision.
    await act(async () => { getByTestId('undo').click(); });

    dragRelease(slot(getByTestId), -160);
    await act(async () => { vi.advanceTimersByTime(600); });

    expect(decided, 'a genuine re-decision after undo was swallowed by the ledger')
      .toHaveLength(2);
    expect(decided[1]).toMatchObject({ id: 'c-N', direction: 'left' });
  }, SUITE_TIMEOUT);

  // ── The card's half of the contract ───────────────────────────────────────
  it('the company card stamps every callback with the company it is showing', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANIES[0]} onAccept={onAccept} onReject={onReject} />,
    );

    dragRelease(container.firstChild, 160);
    act(() => { vi.advanceTimersByTime(600); });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept, 'the card did not name the company the gesture was made on')
      .toHaveBeenCalledWith(null, 'drag', 'c-N');
  }, SUITE_TIMEOUT);

  it('the person card stamps its callbacks with the contact composite id', () => {
    const person = { id: 'p1', name: 'Dana Reyes', title: 'VP Engineering' };
    const onAccept = vi.fn();
    const { container } = render(
      <PersonSwipeCard
        person={person} company={COMPANIES[0]} matchText="match"
        onAccept={onAccept} onReject={vi.fn()} onSkip={vi.fn()}
      />,
    );

    dragRelease(container.firstChild, 160);
    act(() => { vi.advanceTimersByTime(600); });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(null, 'c-N_p1');
  }, SUITE_TIMEOUT);
});

// ── The real source, asserted where rendering it is not practical ───────────
// Same precedent as swipeGestureOrigin.test.js: the guards above are reproduced
// faithfully in the harness, and these assertions are what tie that harness to
// the page the user actually runs.
describe('the page wires subject identity end to end', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('both swipe handlers accept a subject and refuse a mismatched one', () => {
    expect(src, 'handleSwipe takes no subject')
      .toMatch(/const handleSwipe = async \(direction, feedback = null, gesture = 'unknown', subjectId = null\) =>/);
    expect(src, 'handlePersonSwipe takes no subject')
      .toMatch(/const handlePersonSwipe = async \(direction, feedback = null, subjectId = null\) =>/);
    expect(src, 'handleSwipe applies a gesture to whatever is current')
      .toMatch(/if \(subjectId && subjectId !== company\.id\) return;/);
    expect(src, 'handlePersonSwipe applies a gesture to whatever is current')
      .toMatch(/if \(subjectId && subjectId !== contactId\) return;/);
  });

  it('a decided subject cannot be decided again until something retracts it', () => {
    for (const [ref, key] of [['decidedSubjectsRef', 'company.id'], ['decidedPeopleRef', 'contactId']]) {
      expect(src, `${ref} is missing`).toContain(`const ${ref} = useRef(new Set())`);
      expect(src, `${ref} never blocks a second decision`)
        .toContain(`if (${ref}.current.has(${key})) return;`);
      expect(src, `${ref} is checked but never claimed`)
        .toContain(`${ref}.current.add(${key});`);
    }
  });

  it('the claim is made synchronously, before the first await', () => {
    // If it were claimed after an await, the window it exists to close would
    // still be open — that is the whole bug.
    for (const ref of ['decidedSubjectsRef', 'decidedPeopleRef']) {
      const at = src.indexOf(`${ref}.current.add(`);
      const after = src.slice(at, at + 200);
      expect(after, `${ref} is claimed after work has already started`)
        .toMatch(/^\S[^\n]*\n\s*try \{/);
    }
  });

  it('undo retracts the claim, so a re-swipe is still a real decision', () => {
    expect(src, 'handleUndo leaves the company permanently undecidable')
      .toMatch(/decidedSubjectsRef\.current\.delete\(entry\.company\.id\);/);
  });

  it('a failed decision is retryable — the claim is released on the error path', () => {
    for (const [ref, key] of [['decidedSubjectsRef', 'company.id'], ['decidedPeopleRef', 'contactId']]) {
      const at = src.indexOf(`${ref}.current.delete(${key});`);
      expect(at, `${ref} is never released after a failure`).toBeGreaterThan(-1);
      expect(src.slice(Math.max(0, at - 300), at), `${ref} is not released in a catch block`)
        .toMatch(/\} catch \([^)]*\) \{[^}]*$/);
    }
  });

  it('every card decision callback carries the subject', () => {
    const a = src.indexOf('function CompanySwipeCard(');
    const b = src.indexOf('function PersonSwipeCard(');
    const c = src.indexOf('function QueueListPanel(');
    for (const [label, card] of [['company', src.slice(a, b)], ['person', src.slice(b, c > b ? c : undefined)]]) {
      const calls = [...card.matchAll(/\bon(Accept|Reject)\s*\(/g)];
      expect(calls.length, `expected the ${label} card's decision paths`).toBeGreaterThanOrEqual(4);
      for (const m of calls) {
        let depth = 0, end = m.index;
        for (let i = m.index + m[0].length - 1; i < card.length; i++) {
          if (card[i] === '(') depth++;
          else if (card[i] === ')' && --depth === 0) { end = i; break; }
        }
        const call = card.slice(m.index, end + 1);
        expect(call, `${label} decision call names no subject: ${call}`).toMatch(/subjectId\)/);
      }
    }
  });

  it('the parent forwards the subject to both handlers', () => {
    expect(src).toMatch(/onAccept=\{\(feedback, gesture, subjectId\) => handleSwipe\('right', feedback, gesture, subjectId\)\}/);
    expect(src).toMatch(/onReject=\{\(feedback, gesture, subjectId\) => handleSwipe\('left', feedback, gesture, subjectId\)\}/);
    expect(src).toMatch(/onAccept=\{\(feedback, subjectId\) => handlePersonSwipe\('right', feedback, subjectId\)\}/);
    expect(src).toMatch(/onReject=\{\(feedback, subjectId\) => handlePersonSwipe\('left', feedback, subjectId\)\}/);
  });

  it('skip is guarded by identity but never enters the ledger — it decides nothing', () => {
    expect(src, 'a stale skip can still land on the wrong company')
      .toMatch(/const handleSkipCompany = async \(subjectId = null\) => \{/);
    const at = src.indexOf('const handleSkipCompany = async (');
    const body = src.slice(at, src.indexOf('const handleUndo = async (', at));
    expect(body, 'a skip is claiming the subject ledger — a skip is not a decision')
      .not.toContain('decidedSubjectsRef.current.add');
  });
});
