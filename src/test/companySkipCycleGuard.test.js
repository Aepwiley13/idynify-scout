/**
 * C-4 to C-8 — a real company Skip, and the cycle guard actually wired.
 *
 * ─── WHY THESE ASSERT THE WIRING, NOT THE FUNCTION ─────────────────────────
 * `admitCandidate` has implemented the same-cycle guard since Sprint 1A and has
 * had passing tests the whole time — while being dark. Nothing called it, and
 * nothing read the `skippedInCycle` that `recordSkip` wrote. A correct function
 * with no caller is worth nothing to a user, which is why every test below goes
 * through the path the product actually runs: the legacy queue filter in
 * loadTodayLeads, fed by the cycle id the server returned.
 *
 * The approved shape (option B) is the thing most worth protecting here. A
 * skipped company keeps `status: 'pending'` ON PURPOSE — `pending` already
 * blocks rediscovery, so skip needs no change to DEDUP_BLOCKING_STATUSES and
 * adds nothing to the overwrite exposure that the masked-write fix just closed.
 * A future "tidy-up" that promotes skip to its own status would quietly undo
 * both properties, so C-5 nails them down.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const daily = strip(read('../pages/Scout/DailyLeads.jsx'));

/**
 * The body of handleSkipCompany.
 *
 * Anchored on `const handleUndo = async` rather than `const handleUndo`,
 * because `handleUndoRef` is declared 500 lines earlier and would match first —
 * producing an empty slice and a test that passes against nothing. That exact
 * trap already bit the gesture-origin suite once.
 */
function skipHandler() {
  const start = daily.indexOf('const handleSkipCompany');
  const end = daily.indexOf('const handleUndo = async');
  expect(start, 'handleSkipCompany not found').toBeGreaterThan(-1);
  expect(end, 'anchor not found').toBeGreaterThan(start);
  return daily.slice(start, end);
}
const search = strip(read('../../netlify/functions/search-companies.js'));
const writer = strip(read('../../netlify/functions/utils/icpRelationshipWriter.js'));

/** The queue filter as DailyLeads applies it, extracted and executed. */
function queueFilter(pending, cycleNow) {
  return cycleNow ? pending.filter(c => c.skippedInCycle !== cycleNow) : pending;
}

// ─── C-4 ────────────────────────────────────────────────────────────────────

describe('C-4 — a skip does not resurface within the same discovery cycle', () => {
  const co = (id, skippedInCycle = undefined) => ({ id, status: 'pending', ...(skippedInCycle ? { skippedInCycle } : {}) });

  it('hides a company skipped in the current cycle', () => {
    const queue = [co('a'), co('b', 'search_100'), co('c')];
    expect(queueFilter(queue, 'search_100').map(c => c.id)).toEqual(['a', 'c']);
  });

  it('reveals it again on a later cycle', () => {
    const queue = [co('a'), co('b', 'search_100')];
    expect(queueFilter(queue, 'search_200').map(c => c.id)).toEqual(['a', 'b']);
  });

  it('hides nothing when the cycle is unknown — failing toward showing a card', () => {
    // Showing a card again is recoverable. Hiding one forever is not.
    const queue = [co('a', 'search_100')];
    expect(queueFilter(queue, null).map(c => c.id)).toEqual(['a']);
  });

  it('is WIRED into loadTodayLeads, not merely implemented somewhere', () => {
    expect(daily, 'the queue does not read a cycle id').toMatch(/currentCycleId\s*\?\?\s*null/);
    expect(daily, 'the skip filter is missing from the queue build')
      .toMatch(/forActiveIcp\.filter\(c => c\.skippedInCycle !== cycleNow\)/);
    // and it runs on the pending queue, after the ICP filter
    const icpFilter = daily.indexOf('const forActiveIcp = activeId');
    const skipFilter = daily.indexOf('c.skippedInCycle !== cycleNow');
    expect(icpFilter).toBeGreaterThan(-1);
    expect(skipFilter).toBeGreaterThan(icpFilter);
  });

  it('the cycle id comes from the server, and is persisted', () => {
    expect(search, 'search-companies does not return its cycle id').toMatch(/success: true,[\s\S]{0,400}cycleId,/);
    expect(daily, 'the client never stores the cycle id').toMatch(/currentCycleId: searched\.cycleId/);
    expect(daily).toMatch(/setCurrentCycleId\(searched\.cycleId\)/);
  });

  it('the skip write records the cycle it happened in', () => {
    expect(daily).toMatch(/skippedInCycle: currentCycleId \?\? null/);
  });
});

// ─── C-5 ────────────────────────────────────────────────────────────────────

describe('C-5 — the dedup blocking list and the status vocabulary are untouched', () => {
  it('DEDUP_BLOCKING_STATUSES still holds exactly the three original statuses', () => {
    expect(search).toMatch(/DEDUP_BLOCKING_STATUSES = \['accepted', 'rejected', 'pending'\]/);
    expect(search).not.toMatch(/DEDUP_BLOCKING_STATUSES = \[[^\]]*skipped/);
  });

  it('a skipped company keeps status pending — that is what keeps it blocking', () => {
    const skipWrite = skipHandler();
    expect(skipWrite).toMatch(/skippedInCycle:/);
    expect(skipWrite, 'skip must not write a status').not.toMatch(/status:\s*'/);
  });

  it('no new value enters the company status vocabulary', () => {
    const schema = strip(read('../schemas/companySchema.js'));
    expect(schema).not.toMatch(/skipped|deferred/);
  });

  it('skip writes no decision fields — it is not a decision', () => {
    // A skip leaving swipedAt or swipe_gesture behind would read as a rejection
    // to every consumer of those fields.
    const skipWrite = skipHandler();
    for (const f of ['swipedAt:', 'swipeDirection:', 'swipedForICPId:', 'swipe_gesture:']) {
      expect(skipWrite, `skip writes ${f}`).not.toContain(f);
    }
  });
});

// ─── C-6 ────────────────────────────────────────────────────────────────────

describe('C-6 — nothing in the authoritative-fields list changes meaning', () => {
  it.each([
    ['status', /status:\s*direction === 'right'/],
    ['icpId', /icpId: \{ stringValue: String\(company\.icpId\) \}/],
    ['swipedForICPId', /swipedForICPId: activeICPId/],
  ])('%s still drives what it drove', (_f, pattern) => {
    expect(daily + search).toMatch(pattern);
  });

  it('the skip marker is additive and read by exactly one filter', () => {
    const reads = [...daily.matchAll(/skippedInCycle/g)];
    // one write, one filter comparison, one shadow arg — and nothing else.
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(daily).toMatch(/c\.skippedInCycle !== cycleNow/);
  });

  it('the skip write is field-scoped, never a whole-document replace', () => {
    const skipWrite = skipHandler();
    expect(skipWrite).toMatch(/updateDoc\(/);
    expect(skipWrite, 'setDoc without merge would delete the rest of the document')
      .not.toMatch(/setDoc\([^)]*\)(?!.*merge)/);
  });
});

// ─── C-7 ────────────────────────────────────────────────────────────────────

describe('C-7 — a re-encounter accumulates provenance instead of overwriting', () => {
  it('writes provenance_added when the ICP has met the company before', () => {
    expect(writer).toMatch(/eventType: EVENT_TYPE\.PROVENANCE_ADDED/);
    expect(writer).toMatch(/reEncounter: true/);
  });

  it('leaves the relationship state alone — resurfacing is an admission decision', () => {
    const branch = writer.slice(writer.indexOf('if (existing) {'), writer.indexOf('const occurredAt ='));
    expect(branch).toMatch(/fromState: existing\.state/);
    // one write: the event. No relationship write in this branch.
    expect(branch).not.toMatch(/icpRelationships/);
  });

  it('the event is create-only, so a retried run does not duplicate it', () => {
    const branch = writer.slice(writer.indexOf('if (existing) {'), writer.indexOf('const occurredAt ='));
    expect(branch).toMatch(/createOnly: true/);
  });
});

// ─── C-8 ────────────────────────────────────────────────────────────────────

describe('C-8 — skip works with the shadow switched off', () => {
  it('the legacy write happens first and unconditionally', () => {
    const skipWrite = skipHandler();
    const legacy = skipWrite.indexOf('await updateDoc(');
    const shadow = skipWrite.indexOf('await recordSkip(');
    expect(legacy).toBeGreaterThan(-1);
    expect(shadow).toBeGreaterThan(legacy);
  });

  it('the shadow call is conditional on an ICP, never on its own success', () => {
    const skipWrite = skipHandler();
    expect(skipWrite).toMatch(/if \(activeICPId\) \{\s*await recordSkip\(/);
    // nothing downstream of the shadow call gates the user-visible result
    expect(skipWrite).toMatch(/setCompanies\(prev => prev\.filter/);
  });
});
