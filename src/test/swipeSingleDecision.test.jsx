/**
 * ONE GESTURE, ONE DECISION — swipe double-fire regression.
 *
 * Production, workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2, 2026-09-17: two of three
 * company swipes wrote two lineage events each, 88ms and 33ms apart.
 *
 *   ...54a120f3...__accepted__03:56:31.321Z   fromState=accepted -> accepted
 *   ...54a120f3...__accepted__03:56:31.409Z   fromState=null     -> accepted
 *
 * Both were stamped swipe_gesture='drag', so both came from the card's drag
 * release — not a drag plus a button press. `up()` ran twice for one gesture:
 * the release fires onMouseUp, `setGone` then animates the card 700px out from
 * under the cursor and fires onMouseLeave, which is bound to the same handler.
 * `dx` was never reset, so the second call re-passed the threshold and
 * scheduled a second onAccept. On touch, the browser's compatibility mouse
 * events after touchend do the same thing.
 *
 * The bug predates the ICP work. The legacy write PATCHed identical values
 * twice, so it was a silent no-op; Sprint 1A's append-only lineage log is
 * simply the first thing that recorded each invocation separately.
 *
 * These tests fire the real DOM event sequences and count callbacks. The
 * distinction that must survive: ONE GESTURE FIRING TWICE is suppressed, while
 * a user who genuinely swipes, undoes, and re-swipes still produces two
 * decisions. Those are different facts and both stay expressible — which is why
 * the fix is a per-mount latch on a card keyed by subject id, and not a
 * stabilised causeId (that would erase the difference).
 */

import { render, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

// ── Module mocks — the card is a leaf; nothing here should reach Firebase ────
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('t') } },
  db: {},
}));
// Every Firestore export is an inert stub. The cards under test never call one;
// the mock exists only so importing the page does not open a real connection.
// `then` and symbol keys must stay undefined — a namespace object that answers
// `then` with a function is a thenable, and awaiting the module hangs forever.
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

const COMPANY = {
  id: '54a120f369702d94a4b97502',
  name: 'Acme Robotics',
  industry: 'Industrial Automation',
  fit_score: 82,
  employee_count: 120,
};

const PERSON = { id: 'p1', name: 'Dana Reyes', title: 'VP Engineering', email: 'd@acme.test' };

/** The draggable surface is the card's outer element. */
const surface = (container) => container.firstChild;

/**
 * One drag gesture, released past the accept/reject threshold.
 *
 * Deliberately fires BOTH mouseup and mouseleave: that is what a real release
 * produces, because the card animates out from under the cursor. `up()` is
 * bound to both.
 */
function dragRelease(el, distance) {
  fireEvent.mouseDown(el, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(el, { clientX: distance, clientY: 0 });
  fireEvent.mouseUp(el, { clientX: distance, clientY: 0 });
  fireEvent.mouseLeave(el, { clientX: distance, clientY: 0 });
}

/** Let the card's 280ms exit animation elapse so the callback actually runs. */
const settle = () => act(() => { vi.advanceTimersByTime(600); });

describe('one gesture, one decision', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  // ── The production bug, reproduced as an event sequence ───────────────────
  it('a right drag released past threshold accepts exactly once', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );

    dragRelease(surface(container), 160);
    settle();

    expect(onAccept, 'one drag produced more than one accept').toHaveBeenCalledTimes(1);
    // The third argument is the subject the gesture was made on — added so a
    // callback deferred behind the exit animation cannot be applied to whatever
    // card is current when it finally runs. See swipeSubjectIdentity.test.jsx.
    expect(onAccept).toHaveBeenCalledWith(null, 'drag', COMPANY.id);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('a left drag released past threshold rejects exactly once', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );

    dragRelease(surface(container), -160);
    settle();

    expect(onReject, 'one drag produced more than one reject').toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(null, 'drag', COMPANY.id);
    expect(onAccept).not.toHaveBeenCalled();
  });

  // ── Touch: the compatibility mouse events that follow touchend ────────────
  it('a touch drag does not fire again via the synthesized mouse events', () => {
    const onAccept = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={vi.fn()} />,
    );
    const el = surface(container);

    fireEvent.touchStart(el, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 160, clientY: 0 }] });
    fireEvent.touchEnd(el, {});
    // What the browser dispatches afterwards for an unprevented touch sequence.
    fireEvent.mouseDown(el, { clientX: 160, clientY: 0 });
    fireEvent.mouseUp(el, { clientX: 160, clientY: 0 });
    fireEvent.mouseLeave(el, { clientX: 160, clientY: 0 });
    settle();

    expect(onAccept, 'compat mouse events re-fired the decision').toHaveBeenCalledTimes(1);
  });

  // ── A release needs a press. onMouseLeave alone is not a gesture. ─────────
  it('leaving the card without a press decides nothing', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );
    const el = surface(container);

    fireEvent.mouseMove(el, { clientX: 300, clientY: 0 });
    fireEvent.mouseLeave(el, { clientX: 300, clientY: 0 });
    fireEvent.mouseUp(el, { clientX: 300, clientY: 0 });
    settle();

    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  // ── A spent card stays spent, whichever affordance is tried next ──────────
  it('a second drag on an already-decided card decides nothing more', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );
    const el = surface(container);

    dragRelease(el, 160);
    dragRelease(el, -160);
    settle();

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject, 'a spent card accepted a second, contradictory decision').not.toHaveBeenCalled();
  });

  it('a sub-threshold drag springs back and decides nothing', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );

    dragRelease(surface(container), 40);
    settle();

    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();

    // …and the card is still live: the next real gesture must still land.
    dragRelease(surface(container), 160);
    settle();
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  // ── The fact that must NOT be suppressed ──────────────────────────────────
  it('swipe → undo → re-swipe still produces a second, separate decision', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    // The page renders <CompanySwipeCard key={currentCompany.id}>. Undo moves
    // currentIndex back, so this company's card is mounted fresh — the latch is
    // per mount, never per subject, precisely so a genuine re-decision survives.
    const view = render(
      <CompanySwipeCard key={COMPANY.id} company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );

    dragRelease(surface(view.container), -160);
    settle();
    expect(onReject).toHaveBeenCalledTimes(1);

    view.unmount();
    const again = render(
      <CompanySwipeCard key={COMPANY.id} company={COMPANY} onAccept={onAccept} onReject={onReject} />,
    );

    dragRelease(surface(again.container), 160);
    settle();

    expect(onAccept, 'a genuine re-swipe after undo was swallowed').toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  // ── The person card carries the identical defect and the identical fix ────
  it('a person drag release accepts exactly once', () => {
    const onAccept = vi.fn();
    const { container } = render(
      <PersonSwipeCard
        person={PERSON} company={COMPANY} matchText="match"
        onAccept={onAccept} onReject={vi.fn()} onSkip={vi.fn()}
      />,
    );

    dragRelease(surface(container), 160);
    settle();

    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});

// ── Entry points the card cannot guard ──────────────────────────────────────
// The keyboard path calls handleSwipe directly via handleSwipeRef and never
// touches a card, so the latch above cannot cover it. Asserted against source
// because exercising it means mounting the whole Firestore-backed page; this is
// the same approach swipeGestureOrigin.test.js takes for the same file.
describe('non-card entry points', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

  it('key autorepeat does not machine-gun decisions', () => {
    const handler = src.slice(src.indexOf('const onKey = (e) =>'));
    expect(handler.slice(0, handler.indexOf('window.addEventListener')),
      'a held ArrowRight still fires one decision per repeat')
      .toMatch(/if \(e\.repeat\) return;/);
  });

  it('both swipe handlers refuse to run concurrently with themselves', () => {
    for (const ref of ['swipeInFlightRef', 'personSwipeInFlightRef']) {
      expect(src, `${ref} is missing`).toContain(`const ${ref} = useRef(false)`);
      expect(src, `${ref} never blocks re-entry`).toContain(`if (${ref}.current) return;`);
      expect(src, `${ref} is claimed but never released`).toContain(`${ref}.current = false;`);
    }
  });

  it('the in-flight lock is released in a finally, never only on success', () => {
    // A lock leaked on the error path would wedge the queue for the session.
    for (const ref of ['swipeInFlightRef', 'personSwipeInFlightRef']) {
      const at = src.indexOf(`${ref}.current = false;`);
      const before = src.slice(Math.max(0, at - 400), at);
      expect(before, `${ref} is not released in a finally block`).toMatch(/\}\s*finally\s*\{[^}]*$/);
    }
  });
});
