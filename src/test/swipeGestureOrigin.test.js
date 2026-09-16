/**
 * A decision records which gesture made it — and nothing calls a rejection a skip.
 *
 * THE BUG THIS CLOSES
 * ───────────────────
 * Four routes reached the Daily Discoveries reject path, and three of them
 * wrote byte-identical documents:
 *
 *   keyboard ← / J          → handleSwipe('left')          feedback null
 *   drag-left               → setTimeout(onReject, 280)    feedback null
 *   button "skip feedback"  → onReject(null)               feedback null
 *   button "send feedback"  → onReject({reasons, note})    writes barryRejectionFeedback
 *
 * No swipe_source is written on this path and no analytics event is logged for
 * swipes anywhere, so a rejection's origin was unrecoverable the instant it was
 * written: a keyboard press moving through the queue and a deliberate
 * "Not a Match" were indistinguishable forever. That mattered because a
 * rejection blocks the organization from EVERY ICP, permanently, under the
 * current global dedup rule — and 648 production rejections can no longer be
 * sorted into the two meanings.
 *
 * This is forward-only. It does not relabel a single historical record, and it
 * does not make rejection ICP-scoped — that is the relationship model, which is
 * still at its hold point. What it does is stop the *irreversible* half of the
 * bleed, so the question stays answerable later.
 *
 * The second half is the label. handleSwipe pushed every rejection into a list
 * the queue panel rendered under "SKIPPED THIS SESSION", and the session
 * summary counted the same rejections under "Skipped". The user was told
 * "skipped"; the database recorded "rejected, workspace-wide, forever".
 *
 * ─── ASSERTED AGAINST THE SOURCE ───────────────────────────────────────────
 * Same precedent as dailyDiscoveriesIcpTargeting.test and
 * icpIdentityInvariants.test: rendering this surface mounts the whole Scout
 * queue. What matters here is a property of the code — every gesture names
 * itself, and no label lies — which a new call site can silently break.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

/** Source with comments removed — a comment may name the thing the code must not do. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The CompanySwipeCard body only — PersonSwipeCard has near-identical lines. */
function companyCard(s) {
  const a = s.indexOf('function CompanySwipeCard(');
  const b = s.indexOf('function PersonSwipeCard(');
  expect(a, 'CompanySwipeCard not found').toBeGreaterThan(-1);
  expect(b, 'PersonSwipeCard not found').toBeGreaterThan(a);
  return s.slice(a, b);
}

describe('every company decision records the gesture that made it', () => {
  it('handleSwipe takes a gesture and persists it as swipe_gesture', () => {
    expect(src, 'handleSwipe no longer accepts a gesture argument')
      .toMatch(/const handleSwipe = async \(direction, feedback = null, gesture[^)]*\) =>/);
    expect(src, 'the gesture is not persisted on the decision write')
      .toMatch(/swipe_gesture:\s*gesture/);
  });

  it('gesture is kept distinct from swipe_source, which names the surface', () => {
    // swipe_source carries 'people_mode' / 'barry_first_value' — a different
    // dimension. Folding the gesture into it would rebuild the same ambiguity
    // one field over.
    expect(src).not.toMatch(/swipe_source:\s*gesture/);
    expect(src).not.toMatch(/swipe_gesture:\s*'(people_mode|barry_first_value)'/);
  });

  it('both keyboard shortcuts name themselves', () => {
    const keys = [...src.matchAll(/handleSwipeRef\.current\?\.\(([^)]*)\)/g)].map(m => m[1]);
    expect(keys.length, 'expected the two keyboard swipe shortcuts').toBe(2);
    for (const args of keys) {
      expect(args, `keyboard shortcut passes no gesture: ${args}`).toMatch(/'keyboard'/);
    }
  });

  it('every company-card decision names its gesture', () => {
    const card = companyCard(src);
    const calls = [...card.matchAll(/\bon(Accept|Reject)\s*\(/g)];
    expect(calls.length, 'expected the drag and button decision paths').toBeGreaterThanOrEqual(4);

    for (const c of calls) {
      // Read to the matching close paren of this call.
      let depth = 0, end = c.index;
      for (let i = c.index + c[0].length - 1; i < card.length; i++) {
        if (card[i] === '(') depth++;
        else if (card[i] === ')' && --depth === 0) { end = i; break; }
      }
      const call = card.slice(c.index, end + 1);
      expect(call, `decision call names no gesture: ${call}`).toMatch(/'(drag|button)'/);
    }
  });

  it('a bare onReject reference is never handed straight to setTimeout', () => {
    // `setTimeout(onReject, 280)` was the drag path, and it passed no gesture
    // AND no feedback — the silent case.
    expect(companyCard(src)).not.toMatch(/setTimeout\(\s*on(Accept|Reject)\s*,/);
  });

  it('the parent forwards the gesture instead of dropping it', () => {
    for (const handler of ['onAccept', 'onReject']) {
      const re = new RegExp(`${handler}=\\{\\(feedback, gesture\\) => handleSwipe\\('(right|left)', feedback, gesture\\)\\}`);
      expect(src, `${handler} drops the gesture on the way to handleSwipe`).toMatch(re);
    }
  });

  it('undo clears the gesture, as it already clears the rest of the decision', () => {
    const undo = src.match(/status: 'pending', swipedAt: null[^}]*\}/);
    expect(undo, 'the undo write changed shape').toBeTruthy();
    expect(undo[0], 'undo leaves a gesture behind for a reversed decision')
      .toMatch(/swipe_gesture:\s*null/);
  });
});

describe('nothing calls a rejection a skip', () => {
  it.each([
    ['SKIPPED THIS SESSION', 'the queue panel heading'],
    ["'Skipped'", 'the session summary stat'],
    ["'SKIPPED'", 'the session stat bar'],
  ])('%s is gone — %s listed permanently rejected companies', (literal) => {
    expect(src, `"${literal}" still labels rejected companies as skipped`)
      .not.toContain(literal);
  });

  it('the state holding rejected ids is not named "skipped"', () => {
    expect(src).not.toMatch(/skippedInSession|skippedIds|sessionSkipped/);
    expect(src, 'the rejected-this-session list is missing').toMatch(/rejectedInSession/);
  });

  it('people-mode skip vocabulary is untouched — that skip is real', () => {
    // handlePersonSwipe('skip') writes people_mode_skipped with a skipped_date.
    // It is a genuine skip and must not be caught by this cleanup.
    expect(src).toMatch(/people_mode_skipped/);
    expect(src).toMatch(/skipped_date/);
  });
});
