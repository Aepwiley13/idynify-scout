/**
 * Sprint 1A — the pure core: vocabulary, identifiers, transitions, replay,
 * criteria versioning and discovery admission.
 *
 * Acceptance criteria T-1 to T-7, T-13, T-14, T-17 to T-20, T-22 from the
 * review package. Everything here is I/O-free by construction, which is the
 * point of the engine/adapter split: these rules must hold identically in a
 * browser and in a Netlify function, so they are tested without either.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
import {
  SUBJECT_TYPE, RELATIONSHIP_STATE, EVENT_TYPE, EVENT_TYPES, TRANSITIONS,
  relationshipId, eventId, eventScopeKey, nextState, isLegalTransition,
  replayRelationship, buildEvent, isMember, isDecision, isStateNeutral,
} from '../utils/icpLineage';
import {
  MATERIAL_CRITERIA, criteriaFingerprint, isMaterialChange, isReEligible,
  materialCriteria, isMaterialField,
} from '../utils/icpCriteria';
import { admitCandidate, ADMISSION } from '../utils/icpAdmission';
import { classifyCompany, summarize, summarizeActivity, stageOneGate, RECONCILE } from '../utils/icpReconcile';

const { PENDING, ACCEPTED, REJECTED, SKIPPED } = RELATIONSHIP_STATE;
const CO = SUBJECT_TYPE.COMPANY;

// ─── T-1, T-2: what counts as material ──────────────────────────────────────

describe('T-1/T-2 — the material criteria set is one list, and it is the right one', () => {
  const base = {
    industries: ['Non-Profit Organization Management'],
    locations: ['Utah'],
    companySizes: ['11-50'],
    targetTitles: ['CEO', 'Founder'],
    name: 'NON PROFITS',
    notes: 'some notes',
    messaging: { tone: 'warm' },
    scoringWeights: { industry: 40 },
  };

  it.each([
    ['a rename', { name: 'Nonprofits (2026)' }],
    ['a notes rewrite', { notes: 'completely different notes' }],
    ['messaging copy', { messaging: { tone: 'direct', body: 'new' } }],
    ['scoring weights', { scoringWeights: { industry: 5, size: 95 } }],
    ['reordering target titles', { targetTitles: ['Founder', 'CEO'] }],
    ['case and whitespace', { industries: ['  non-profit organization management '] }],
  ])('%s is NOT material', (_label, patch) => {
    expect(isMaterialChange(base, { ...base, ...patch })).toBe(false);
  });

  it.each([
    ['industry', { industries: ['Food & Beverages'] }],
    ['geography', { locations: ['Utah', 'Idaho'] }],
    ['company size', { companySizes: ['51-200'] }],
    ['persona titles', { targetTitles: ['CEO', 'Founder', 'CFO'] }],
    ['seniority', { seniority: ['c_suite'] }],
  ])('%s IS material', (_label, patch) => {
    expect(isMaterialChange(base, { ...base, ...patch })).toBe(true);
  });

  it('empty and absent admit the same set, so they fingerprint the same', () => {
    expect(criteriaFingerprint({ ...base, companyKeywords: [] }))
      .toBe(criteriaFingerprint(base));
  });

  it('the materiality check reads the same list the fingerprint does', () => {
    // A second, independently maintained list is how the two drift apart and a
    // real change silently stops minting a version.
    for (const field of MATERIAL_CRITERIA) expect(isMaterialField(field)).toBe(true);
    for (const field of ['name', 'notes', 'messaging', 'scoringWeights', 'status', 'isActive']) {
      expect(isMaterialField(field), `${field} must not be material`).toBe(false);
      expect(Object.keys(materialCriteria({ [field]: 'x' }))).toEqual([]);
    }
  });
});

// ─── T-3: minting ───────────────────────────────────────────────────────────

describe('T-3 — versions mint on save, by fingerprint', () => {
  const A = { industries: ['credit unions'] };
  const B = { industries: ['food production'] };

  it('change-then-revert BEFORE saving mints nothing — one save, unchanged fingerprint', () => {
    expect(isMaterialChange(A, A)).toBe(false);
  });

  it('save, then a later reverting save, legitimately mints two', () => {
    // The ICP genuinely existed in two different eligibility states in between.
    expect(isMaterialChange(A, B)).toBe(true);   // v1 → v2
    expect(isMaterialChange(B, A)).toBe(true);   // v2 → v3
  });
});

// ─── T-7: re-eligibility by fingerprint, not version id ─────────────────────

describe('T-7 — re-eligibility compares fingerprints', () => {
  const A = { industries: ['credit unions'] };
  const B = { industries: ['food production'] };
  const fpA = criteriaFingerprint(A);
  const fpB = criteriaFingerprint(B);

  it('a criteria change reopens the rejection', () => {
    expect(isReEligible({ decidedUnderFingerprint: fpA, currentFingerprint: fpB })).toBe(true);
  });

  it('A → B → A leaves a rejection made under A CLOSED', () => {
    // Three versions exist and the current version id differs from the one the
    // rejection was decided under — but the qualifying criteria are identical,
    // and a company judged under criteria X is not newly judgeable under X.
    const fpA3 = criteriaFingerprint({ industries: ['Credit Unions'] }); // same after canonicalisation
    expect(fpA3).toBe(fpA);
    expect(isReEligible({ decidedUnderFingerprint: fpA, currentFingerprint: fpA3 })).toBe(false);
  });

  it('a missing fingerprint never silently reopens anything', () => {
    expect(isReEligible({ decidedUnderFingerprint: null, currentFingerprint: fpA })).toBe(false);
    expect(isReEligible({ decidedUnderFingerprint: fpA, currentFingerprint: null })).toBe(false);
  });
});

// ─── T-4: identifiers ───────────────────────────────────────────────────────

describe('T-4 — identifiers are ownership-neutral and unambiguous', () => {
  it('a relationship id contains no user or org id', () => {
    const id = relationshipId('icp_1786493824113', CO, '54a116d169702d3ec0b70700');
    expect(id).toBe('icp_1786493824113__company__54a116d169702d3ec0b70700');
    expect(id).not.toMatch(/peqhaq8C|users\//);
  });

  it('refuses a component that would make two triples collide', () => {
    expect(() => relationshipId('icp__evil', CO, 'x')).toThrow(/may not contain/);
    expect(() => relationshipId('icp', CO, 'a__b')).toThrow(/may not contain/);
    expect(() => relationshipId('icp', CO, 'a/b')).toThrow(/may not contain/);
    expect(() => relationshipId(null, CO, 'x')).toThrow(/required/);
  });

  it('is stable — the same triple always produces the same id', () => {
    expect(relationshipId('i', CO, 's')).toBe(relationshipId('i', CO, 's'));
  });
});

// ─── T-20: event ids carry their ICP scope ──────────────────────────────────

describe('T-20 — two ICPs cannot collide on one event id', () => {
  it('the same subject, event and cause under two ICPs yields two ids', () => {
    // The reconsider-sweep case: one criteria change, one originating action,
    // the same causeId derived for both.
    const shared = { subjectType: CO, subjectId: 'co_1', eventType: EVENT_TYPE.RECONSIDERED, causeId: 'sweep_77' };
    const a = eventId({ ...shared, icpId: 'icp_A' });
    const b = eventId({ ...shared, icpId: 'icp_B' });
    expect(a).not.toBe(b);
    expect(new Set([a, b]).size).toBe(2);
  });

  it('a global event declares its scope rather than omitting it', () => {
    expect(eventScopeKey({ subjectType: CO, subjectId: 'co_1' })).toBe('_global__company__co_1');
    expect(eventScopeKey({ icpId: 'icp_A', subjectType: CO, subjectId: 'co_1' }))
      .toBe('icp_A__company__co_1');
  });

  it('the event id is scoped, typed and caused', () => {
    expect(eventId({ icpId: 'icp_A', subjectType: CO, subjectId: 'co_1', eventType: EVENT_TYPE.ACCEPTED, causeId: 'c1' }))
      .toBe('icp_A__company__co_1__accepted__c1');
  });

  it('rejects an unknown event type instead of minting an id for it', () => {
    expect(() => eventId({ icpId: 'i', subjectType: CO, subjectId: 's', eventType: 'decided', causeId: 'c' }))
      .toThrow(/unknown eventType/);
  });
});

// ─── T-19: the outcome is the type ──────────────────────────────────────────

describe('T-19 — no generic decided event', () => {
  it('accepted, rejected and skipped are distinct types', () => {
    expect(EVENT_TYPES).toEqual(expect.arrayContaining(['accepted', 'rejected', 'skipped']));
    expect(EVENT_TYPES).not.toContain('decided');
  });

  it('skip is not a decision, so it never carries decision semantics', () => {
    expect(isDecision(EVENT_TYPE.SKIPPED)).toBe(false);
    expect(isDecision(EVENT_TYPE.ACCEPTED)).toBe(true);
    expect(isDecision(EVENT_TYPE.REJECTED)).toBe(true);
  });

  it('membership is exactly one state', () => {
    expect(isMember(ACCEPTED)).toBe(true);
    for (const s of [PENDING, REJECTED, SKIPPED, null]) expect(isMember(s)).toBe(false);
  });
});

// ─── T-5: transitions ───────────────────────────────────────────────────────

describe('T-5 — every legal transition is permitted, every other is refused', () => {
  it.each(TRANSITIONS.flatMap(t => t.from.map(f => [String(f), t.event, t.to])))(
    'from %s on %s → %s', (from, event, to) => {
      expect(nextState(from === 'null' ? null : from, event)).toBe(to);
    });

  it.each([
    ['accepted → skipped is meaningless once something is a member', ACCEPTED, EVENT_TYPE.SKIPPED],
    ['a second encounter cannot re-create an existing relationship', PENDING, EVENT_TYPE.ENCOUNTERED],
    ['only a rejection can be reconsidered', PENDING, EVENT_TYPE.RECONSIDERED],
    ['only a skip can resurface', REJECTED, EVENT_TYPE.RESURFACED],
    ['a resurface asserts a prior skip, so it cannot open a relationship', null, EVENT_TYPE.RESURFACED],
    ['a reconsideration asserts a prior rejection', null, EVENT_TYPE.RECONSIDERED],
  ])('%s', (_label, from, event) => {
    expect(isLegalTransition(from, event)).toBe(false);
    expect(() => nextState(from, event)).toThrow(/illegal transition/);
  });

  it('a decision may OPEN a relationship, because the encounter was never observed', () => {
    // Sprint 1 goes live against thousands of already-queued companies whose
    // encounter this system never saw. Synthesising an `encountered` event to
    // keep the table tidy would fabricate a moment that never happened; the
    // absence of one is the honest record. See TRANSITIONS in icpLineage.
    expect(nextState(null, EVENT_TYPE.ACCEPTED)).toBe(ACCEPTED);
    expect(nextState(null, EVENT_TYPE.REJECTED)).toBe(REJECTED);
    expect(nextState(null, EVENT_TYPE.SKIPPED)).toBe(SKIPPED);
  });

  it('state-neutral events record a transition without moving state', () => {
    for (const e of [EVENT_TYPE.PROVENANCE_ADDED, EVENT_TYPE.EXCLUDED, EVENT_TYPE.UNEXCLUDED]) {
      expect(isStateNeutral(e)).toBe(true);
      expect(nextState(ACCEPTED, e)).toBe(ACCEPTED);
      expect(nextState(null, e)).toBe(null);
    }
  });
});

// ─── T-6: I-3 ───────────────────────────────────────────────────────────────

describe('T-6 — an event states both endpoints, always', () => {
  it('writes fromState and toState even when nothing changed', () => {
    const { body } = buildEvent({
      subjectType: CO, subjectId: 'co_1', icpId: 'icp_A',
      eventType: EVENT_TYPE.PROVENANCE_ADDED, causeId: 'c1',
      fromState: ACCEPTED, occurredAt: '2026-09-15T00:00:00.000Z',
    });
    expect(body.fromState).toBe(ACCEPTED);
    expect(body.toState).toBe(ACCEPTED);
  });

  it('refuses to build an event for an illegal transition', () => {
    expect(() => buildEvent({
      subjectType: CO, subjectId: 'co_1', icpId: 'icp_A',
      eventType: EVENT_TYPE.SKIPPED, causeId: 'c1',
      fromState: ACCEPTED, occurredAt: 'now',
    })).toThrow(/illegal transition/);
  });
});

// ─── T-17: replay is per relationship ───────────────────────────────────────

describe('T-17 — replaying ONE relationship reproduces ONE relationship', () => {
  const at = n => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`;
  const ev = (icpId, eventType, fromState, toState, n) => ({
    subjectType: CO, subjectId: 'co_1', icpId, eventType, fromState, toState, occurredAt: at(n),
  });

  // The same company, holding DIFFERENT states under two ICPs at once — which
  // is the entire point of the sprint, and what a subject-wide replay destroys.
  const events = [
    ev('icp_A', EVENT_TYPE.ENCOUNTERED, null, PENDING, 1),
    ev('icp_B', EVENT_TYPE.ENCOUNTERED, null, PENDING, 2),
    ev('icp_A', EVENT_TYPE.ACCEPTED, PENDING, ACCEPTED, 3),
    ev('icp_B', EVENT_TYPE.REJECTED, PENDING, REJECTED, 4),
    { subjectType: CO, subjectId: 'co_1', icpId: null, eventType: EVENT_TYPE.EXCLUDED, fromState: null, toState: null, occurredAt: at(5) },
  ];

  it('reproduces each relationship independently', () => {
    expect(replayRelationship(events, { subjectType: CO, subjectId: 'co_1', icpId: 'icp_A' })).toBe(ACCEPTED);
    expect(replayRelationship(events, { subjectType: CO, subjectId: 'co_1', icpId: 'icp_B' })).toBe(REJECTED);
  });

  it('excludes global and null-ICP events from per-relationship replay', () => {
    // The exclusion above must not appear in, or disturb, either history.
    expect(replayRelationship(events.filter(e => e.icpId !== null), { subjectType: CO, subjectId: 'co_1', icpId: 'icp_A' }))
      .toBe(ACCEPTED);
  });

  it('a subject-wide replay would be illegal — proving the scoping matters', () => {
    // Feeding both ICPs' events into one relationship replay contradicts the
    // recorded endpoints and must throw rather than invent a state.
    const mislabelled = events.filter(e => e.icpId !== null).map(e => ({ ...e, icpId: 'icp_A' }));
    expect(() => replayRelationship(mislabelled, { subjectType: CO, subjectId: 'co_1', icpId: 'icp_A' }))
      .toThrow(/contradicts itself|produces/);
  });

  it('orders by occurredAt, not by array order', () => {
    const shuffled = [events[2], events[0]];
    expect(replayRelationship(shuffled, { subjectType: CO, subjectId: 'co_1', icpId: 'icp_A' })).toBe(ACCEPTED);
  });

  it('an empty history is null, not a guess', () => {
    expect(replayRelationship([], { subjectType: CO, subjectId: 'zzz', icpId: 'icp_A' })).toBe(null);
  });
});

// ─── T-13, T-14, T-18, T-22: admission ──────────────────────────────────────

describe('T-13/T-18 — discovery admission is ICP-scoped', () => {
  const fp = 'fp_current';

  it('creates when this ICP has never encountered the subject', () => {
    expect(admitCandidate({ relationship: null, currentFingerprint: fp }).action).toBe(ADMISSION.CREATE);
  });

  it.each([[PENDING], [ACCEPTED]])('suppresses when already %s', (state) => {
    expect(admitCandidate({ relationship: { state }, currentFingerprint: fp }).action).toBe(ADMISSION.SUPPRESS);
  });

  it('suppresses a rejection made under the current criteria', () => {
    const r = admitCandidate({ relationship: { state: REJECTED, decidedUnderFingerprint: fp }, currentFingerprint: fp });
    expect(r.action).toBe(ADMISSION.SUPPRESS);
    expect(r.reason).toBe('rejected-under-current-criteria');
  });

  it('RESURFACES a rejection once the criteria moved — it never creates a second row', () => {
    const r = admitCandidate({ relationship: { state: REJECTED, decidedUnderFingerprint: 'fp_old' }, currentFingerprint: fp });
    expect(r.action).toBe(ADMISSION.RESURFACE);
    expect(r.event).toBe(EVENT_TYPE.RECONSIDERED);
  });

  it('a skip cannot return inside the cycle it was skipped in', () => {
    const r = admitCandidate({
      relationship: { state: SKIPPED, skippedInCycle: 'run_9' },
      currentFingerprint: fp, currentCycleId: 'run_9',
    });
    expect(r.action).toBe(ADMISSION.SUPPRESS);
    expect(r.reason).toBe('skipped-in-this-cycle');
  });

  it('a skip resurfaces on a later cycle', () => {
    const r = admitCandidate({
      relationship: { state: SKIPPED, skippedInCycle: 'run_9' },
      currentFingerprint: fp, currentCycleId: 'run_10',
    });
    expect(r.action).toBe(ADMISSION.RESURFACE);
    expect(r.event).toBe(EVENT_TYPE.RESURFACED);
  });

  it('an unknown state is suppressed, not guessed at', () => {
    expect(admitCandidate({ relationship: { state: 'deferred' }, currentFingerprint: fp }).action)
      .toBe(ADMISSION.SUPPRESS);
  });
});

describe('T-14 — exclusion is orthogonal to relationship state', () => {
  it('suppresses regardless of what the relationship says', () => {
    for (const state of [PENDING, ACCEPTED, REJECTED, SKIPPED]) {
      const r = admitCandidate({ excluded: true, relationship: { state }, currentFingerprint: 'fp' });
      expect(r.action).toBe(ADMISSION.SUPPRESS);
      expect(r.reason).toBe('globally-excluded');
    }
  });

  it('never proposes an event, so it cannot mutate the relationship', () => {
    expect(admitCandidate({ excluded: true, relationship: { state: ACCEPTED } }).event).toBe(null);
  });
});

describe('T-22 — exclusion identity is typed', () => {
  it('a company and a person sharing an id are different subjects', () => {
    const co = eventScopeKey({ subjectType: SUBJECT_TYPE.COMPANY, subjectId: 'shared_id' });
    const pe = eventScopeKey({ subjectType: SUBJECT_TYPE.PERSON, subjectId: 'shared_id' });
    expect(co).not.toBe(pe);
  });
});

// ─── T-15: the reconciler ───────────────────────────────────────────────────

describe('T-15 — the reconciler flags real divergence and nothing else', () => {
  const CUTOVER = Date.parse('2026-10-01T00:00:00.000Z');
  const before = '2026-09-15T00:00:00.000Z';
  const after = '2026-10-05T00:00:00.000Z';
  const rel = (icpId, state) => ({ icpId, state, subjectId: 'co_1', subjectType: CO });

  it('does NOT flag the pre-cutover corpus — 3,195 records are the design, not a fault', () => {
    const r = classifyCompany({
      company: { status: 'accepted', icpId: 'default', swipedAt: before },
      relationships: [], cutoverAt: CUTOVER,
    });
    expect(r.status).toBe(RECONCILE.EXPECTED_GAP);
    expect(r.reason).toBe('predates-shadow-writes');
  });

  it('DOES flag a post-cutover legacy write with no shadow counterpart', () => {
    const r = classifyCompany({
      company: { status: 'accepted', icpId: 'icp_A', swipedAt: after },
      relationships: [], cutoverAt: CUTOVER,
    });
    expect(r.status).toBe(RECONCILE.DIVERGENCE);
  });

  it('agrees when both sides say the same thing', () => {
    const r = classifyCompany({
      company: { status: 'accepted', swipedForICPId: 'icp_A', swipedAt: after },
      relationships: [rel('icp_A', ACCEPTED)], cutoverAt: CUTOVER,
    });
    expect(r.status).toBe(RECONCILE.AGREED);
  });

  it.each([[ACCEPTED], [REJECTED]])(
    'classifies an un-followed undo (legacy pending, shadow %s) as UNDO_GAP, not divergence',
    (shadowState) => {
      // Undo sets the company back to pending and writes no event, so shadow
      // keeps the decision. Counting this as a divergence would fail the
      // "zero divergences" criterion every time a user presses U, which would
      // say nothing about whether the model works.
      const r = classifyCompany({
        company: { status: 'pending', swipedForICPId: 'icp_A', swipedAt: after },
        relationships: [rel('icp_A', shadowState)], cutoverAt: CUTOVER,
      });
      expect(r.status).toBe(RECONCILE.UNDO_GAP);
      expect(r.reason).toMatch(/undo-not-modelled/);
    });

  it('a FORWARD disagreement is still a real divergence', () => {
    // Legacy accepted, shadow still pending — shadow genuinely failed to follow.
    const r = classifyCompany({
      company: { status: 'accepted', swipedForICPId: 'icp_A', swipedAt: after },
      relationships: [rel('icp_A', PENDING)], cutoverAt: CUTOVER,
    });
    expect(r.status).toBe(RECONCILE.DIVERGENCE);
    expect(r.reason).toBe('legacy=accepted shadow=pending');
  });

  it('undo gaps are reported in full but do not break the acceptance signal', () => {
    const s = summarize([
      { status: RECONCILE.AGREED },
      { status: RECONCILE.UNDO_GAP, reason: 'undo-not-modelled: legacy=pending shadow=accepted' },
      { status: RECONCILE.UNDO_GAP, reason: 'undo-not-modelled: legacy=pending shadow=rejected' },
    ]);
    expect(s.clean).toBe(true);                    // no real divergence
    expect(s.counts[RECONCILE.UNDO_GAP]).toBe(2);  // and nothing is hidden
    expect(s.undoGaps).toHaveLength(2);
  });

  it('does not treat extra memberships as divergence — legacy cannot express them', () => {
    const r = classifyCompany({
      company: { status: 'accepted', swipedForICPId: 'icp_A', swipedAt: after },
      relationships: [rel('icp_A', ACCEPTED), rel('icp_B', REJECTED)], cutoverAt: CUTOVER,
    });
    expect(r.status).toBe(RECONCILE.AGREED);
  });

  it('treats statuses the model does not cover as a gap, not a fault', () => {
    for (const status of ['replaced', 'archived', 'deferred']) {
      const r = classifyCompany({
        company: { status, swipedForICPId: 'icp_A', swipedAt: after },
        relationships: [rel('icp_A', ACCEPTED)], cutoverAt: CUTOVER,
      });
      expect(r.status).toBe(RECONCILE.EXPECTED_GAP);
    }
  });

  it('summarises without hiding anything', () => {
    const s = summarize([
      { status: RECONCILE.AGREED }, { status: RECONCILE.EXPECTED_GAP },
      { status: RECONCILE.DIVERGENCE, reason: 'x' },
    ]);
    expect(s.counts[RECONCILE.DIVERGENCE]).toBe(1);
    expect(s.divergences).toHaveLength(1);
    expect(s.clean).toBe(false);
  });
});

// ─── Stage 1: writes seen, and the gate ─────────────────────────────────────

describe('Stage 1 — the reconciler reports writes seen, not only divergences', () => {
  const ev = (eventType, day) => ({ eventType, occurredAt: `2026-10-0${day}T12:00:00.000Z` });

  it('an empty log is reported as empty, not as clean', () => {
    // The whole reason this exists: production held 0 shadow documents, so a
    // divergence-only report would have said "0 divergences" and proven nothing.
    const a = summarizeActivity([]);
    expect(a.events).toBe(0);
    expect(a.varied).toBe(false);
    expect(a.days).toEqual([]);
  });

  it('counts volume, composition and spread', () => {
    const a = summarizeActivity([
      ev('encountered', 1), ev('encountered', 1), ev('accepted', 2), ev('rejected', 3),
    ]);
    expect(a.events).toBe(4);
    expect(a.byType).toEqual({ encountered: 2, accepted: 1, rejected: 1 });
    expect(a.eventTypes).toBe(3);
    expect(a.daysWithActivity).toBe(3);
    expect(a.varied).toBe(true);
  });

  it('one big burst on a single day is NOT varied traffic', () => {
    const a = summarizeActivity(Array.from({ length: 200 }, () => ev('encountered', 1)));
    expect(a.events).toBe(200);
    expect(a.varied).toBe(false);   // volume alone proves nothing
  });

  it('reports the window it saw', () => {
    const a = summarizeActivity([ev('accepted', 2), ev('encountered', 1)]);
    expect(a.earliest).toBe('2026-10-01T12:00:00.000Z');
    expect(a.latest).toBe('2026-10-02T12:00:00.000Z');
  });
});

describe('Stage 1 — the gate cannot be reported more generously than the numbers', () => {
  const varied = summarizeActivity([
    { eventType: 'encountered', occurredAt: '2026-10-01T00:00:00Z' },
    { eventType: 'accepted', occurredAt: '2026-10-02T00:00:00Z' },
    { eventType: 'rejected', occurredAt: '2026-10-03T00:00:00Z' },
  ]);
  const clean = summarize([{ status: RECONCILE.AGREED }]);

  it('passes on varied traffic with no divergence', () => {
    expect(stageOneGate({ activity: varied, reconciliation: clean }).pass).toBe(true);
  });

  it('FAILS on zero writes, however clean the reconciliation looks', () => {
    const g = stageOneGate({ activity: summarizeActivity([]), reconciliation: clean });
    expect(g.pass).toBe(false);
    expect(g.reasons[0]).toMatch(/no shadow writes seen/);
  });

  it('fails on a quiet week that would pass a calendar test', () => {
    const quiet = summarizeActivity([{ eventType: 'encountered', occurredAt: '2026-10-01T00:00:00Z' }]);
    const g = stageOneGate({ activity: quiet, reconciliation: clean });
    expect(g.pass).toBe(false);
    expect(g.reasons[0]).toMatch(/not varied enough/);
  });

  it('fails on any divergence', () => {
    const dirty = summarize([{ status: RECONCILE.DIVERGENCE, reason: 'x' }]);
    const g = stageOneGate({ activity: varied, reconciliation: dirty });
    expect(g.pass).toBe(false);
    expect(g.reasons.join(' ')).toMatch(/1 divergence/);
  });

  it('undo gaps are reported but never block — undo is unmodelled by design', () => {
    const withUndo = summarize([{ status: RECONCILE.AGREED }, { status: RECONCILE.UNDO_GAP, reason: 'u' }]);
    expect(stageOneGate({ activity: varied, reconciliation: withUndo }).pass).toBe(true);
  });
});

describe('Stage 1 — the runner reports, never repairs', () => {
  const runner = readFileSync(resolve(here, '../../scripts/reconcile/run.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Checked against the WRITE APIs specifically, not the substring "set(" —
  // the runner legitimately uses Map.set to index relationships by subject, and
  // a test that cannot tell those apart teaches people to weaken it.
  it.each([
    ['a write on a document ref', /\b(ref|doc|docRef)\w*\.(set|update|delete|create)\s*\(/],
    ['a chained doc write', /\.doc\([^)]*\)\s*\.(set|update|delete|create)\s*\(/],
    ['a batch', /\bdb\.batch\s*\(|\bbatch\(\)\.(set|update|delete)/],
    ['a transaction', /runTransaction\s*\(/],
    ['the web-SDK write verbs', /\b(addDoc|setDoc|updateDoc|deleteDoc)\s*\(/],
    ['a server timestamp or field-value helper', /FieldValue\./],
  ])('never issues %s', (_label, pattern) => {
    expect(runner).not.toMatch(pattern);
  });

  it('only ever reads', () => {
    // Every Firestore call in the runner resolves through .get().
    const calls = [...runner.matchAll(/\.(get|collection|doc)\s*\(/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect([...new Set(calls)].sort()).toEqual(['collection', 'doc', 'get']);
  });

  it('refuses to run without a cutover, rather than defaulting to one', () => {
    // Without it every pre-cutover company reads as a divergence.
    expect(runner).toMatch(/if \(!args\.cutover\)/);
    expect(runner).toMatch(/process\.exit\(2\)/);
  });

  it('derives its verdict from stageOneGate rather than narrating one', () => {
    expect(runner).toMatch(/stageOneGate\(\{ activity, reconciliation \}\)/);
    expect(runner).toMatch(/process\.exit\(gate\.pass \? 0 : 1\)/);
  });
});
