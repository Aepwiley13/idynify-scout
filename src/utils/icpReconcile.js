/**
 * icpReconcile — does the shadow model agree with the legacy record?
 *
 * REPORTS. NEVER REPAIRS. A repair path is a write path that can rewrite
 * history, which is the thing this programme exists to remove. In Sprint 1 the
 * answer to a divergence is to look at it, not to overwrite one side with the
 * other.
 *
 * ─── WHY THE CUTOVER TIMESTAMP IS THE WHOLE DESIGN ─────────────────────────
 * Shadow writes describe events from the cutover forward. Production holds
 * 3,195 companies written long before it. Without a cutover boundary every one
 * of them reads as "legacy has no shadow counterpart" — 3,195 divergences, and
 * a signal worth nothing.
 *
 * So the classifier has three outcomes, not two. The middle one is the entire
 * legacy corpus and is NOT an error:
 *
 *   agreed        legacy and shadow say the same thing
 *   expected-gap  a legacy record last written BEFORE the cutover, with no
 *                 shadow counterpart — the Unattributed / legacy-unverified
 *                 population, exactly as designed
 *   undo-gap      legacy moved BACKWARD to pending while shadow still holds the
 *                 decision. Undo is not modelled in Sprint 1, so this is a known
 *                 consequence rather than a failure — see below
 *   divergence    anything else that disagrees, or a legacy record written AFTER
 *                 the cutover with no shadow counterpart. The only category that
 *                 should ever be non-zero.
 *
 * ─── WHY UNDO GETS ITS OWN CATEGORY ────────────────────────────────────────
 * The legacy undo path sets a company back to `pending` and writes no event, so
 * shadow keeps reading `accepted` or `rejected`. Counting that as a divergence
 * would mean the acceptance criterion "zero divergences over a week of normal
 * use" fails every time a user presses U — which would say nothing about
 * whether the shadow model is working, and would train everyone to ignore the
 * number.
 *
 * It is named rather than hidden: an undo gap is still reported, still listed,
 * and still counted. What it is not is evidence of a fault. It closes when undo
 * gets a vocabulary of its own, which is a product decision — does undo emit an
 * event, or retract the prior one? — that belongs with the vocabulary review
 * before the Sprint 3 cutover, not invented mid-build.
 *
 * Divergence is single-directional by construction: the write order is legacy
 * first, shadow second (invariant I-11), so shadow may only ever lag. That is
 * what lets this be one comparison rather than a merge.
 */

import { RELATIONSHIP_STATE } from './icpLineage.js';

export const RECONCILE = Object.freeze({
  AGREED: 'agreed',
  EXPECTED_GAP: 'expected-gap',
  UNDO_GAP: 'undo-gap',
  DIVERGENCE: 'divergence',
});

/** Legacy company status → the relationship state it should imply. */
const LEGACY_TO_STATE = Object.freeze({
  pending: RELATIONSHIP_STATE.PENDING,
  accepted: RELATIONSHIP_STATE.ACCEPTED,
  rejected: RELATIONSHIP_STATE.REJECTED,
});

const millis = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return null;
};

/** When the legacy record was last written, as far as its own fields can say. */
export function legacyWrittenAt(company = {}) {
  return millis(company.swipedAt) ?? millis(company.found_at) ?? millis(company.saved_at) ?? null;
}

/** Which ICP the legacy record claims — decision first, then discovery. */
export function legacyIcpId(company = {}) {
  return company.swipedForICPId ?? company.icpId ?? null;
}

/**
 * Classify one company against its shadow relationships.
 *
 * @param {object}   input
 * @param {object}   input.company        The legacy company document.
 * @param {object[]} input.relationships  Shadow relationships for this subject.
 * @param {number|string|Date} input.cutoverAt  When shadow writes began.
 * @returns {{status: string, reason: string, icpId: string|null}}
 */
export function classifyCompany({ company = {}, relationships = [], cutoverAt } = {}) {
  const cutover = millis(cutoverAt);
  const writtenAt = legacyWrittenAt(company);
  const icpId = legacyIcpId(company);

  if (relationships.length === 0) {
    // A legacy record that predates the cutover is the designed state, not a
    // fault. `default` is deliberately included: it is a sentinel, not a real
    // association, and it was never going to produce a relationship.
    if (cutover === null || writtenAt === null || writtenAt < cutover) {
      return { status: RECONCILE.EXPECTED_GAP, reason: 'predates-shadow-writes', icpId };
    }
    return { status: RECONCILE.DIVERGENCE, reason: 'legacy-written-after-cutover-with-no-shadow', icpId };
  }

  // The legacy record carries at most one ICP, so only that relationship can
  // agree or disagree with it. Others are additional memberships legacy has no
  // way to express — not divergences.
  if (!icpId) {
    return { status: RECONCILE.DIVERGENCE, reason: 'shadow-exists-but-legacy-names-no-icp', icpId: null };
  }

  const match = relationships.find(r => r.icpId === icpId);
  if (!match) {
    return { status: RECONCILE.DIVERGENCE, reason: `no-shadow-for-legacy-icp:${icpId}`, icpId };
  }

  const expected = LEGACY_TO_STATE[company.status];
  if (!expected) {
    // replaced / archived / deferred have no modelled equivalent in Sprint 1.
    return { status: RECONCILE.EXPECTED_GAP, reason: `unmodelled-legacy-status:${company.status}`, icpId };
  }

  if (match.state !== expected) {
    // Legacy moved backward to pending while shadow still holds the decision:
    // the signature of an undo that shadow could not follow.
    const isUndoGap =
      company.status === 'pending'
      && (match.state === RELATIONSHIP_STATE.ACCEPTED || match.state === RELATIONSHIP_STATE.REJECTED);

    return {
      status: isUndoGap ? RECONCILE.UNDO_GAP : RECONCILE.DIVERGENCE,
      reason: isUndoGap
        ? `undo-not-modelled: legacy=pending shadow=${match.state}`
        : `legacy=${company.status} shadow=${match.state}`,
      icpId,
    };
  }

  return { status: RECONCILE.AGREED, reason: `both=${expected}`, icpId };
}

/**
 * What the shadow model actually RECEIVED over a window — writes seen, not
 * divergences found.
 *
 * ─── WHY THIS IS HALF THE REPORT ───────────────────────────────────────────
 * A reconciler that only counts disagreements reports "0 divergences" over a
 * week of ZERO writes, which is clean, meaningless, and indistinguishable from
 * success. That is the 189-vs-76 failure shape exactly: a number that looks
 * comparable to a good result while silently measuring something else — and it
 * would be a poor way to clear the gate this programme spent three sprints
 * earning.
 *
 * Measured before this was written: production held 0 relationships and 0
 * events, so the distinction is not hypothetical. Two explanations fitted
 * equally — no traffic yet, or shadow writes silently not firing — and from
 * outside they look identical. Volume and composition are what tell them apart.
 *
 * "A clean week" therefore means real, varied traffic: several event types, and
 * activity spread across days rather than one burst.
 *
 * @param {object[]} events   lineage events in the window
 * @param {object} [options]
 * @param {number} [options.minDaysWithActivity=3]
 * @param {number} [options.minEventTypes=2]
 */
export function summarizeActivity(events = [], { minDaysWithActivity = 3, minEventTypes = 2 } = {}) {
  const byType = {};
  const days = new Set();
  let earliest = null, latest = null;

  for (const e of events) {
    const t = String(e?.eventType ?? 'unknown');
    byType[t] = (byType[t] ?? 0) + 1;

    const ms = millis(e?.occurredAt);
    if (ms === null) continue;
    days.add(new Date(ms).toISOString().slice(0, 10));
    if (earliest === null || ms < earliest) earliest = ms;
    if (latest === null || ms > latest) latest = ms;
  }

  const eventTypes = Object.keys(byType).length;
  const daysWithActivity = days.size;

  return {
    events: events.length,
    byType,
    eventTypes,
    daysWithActivity,
    days: [...days].sort(),
    earliest: earliest === null ? null : new Date(earliest).toISOString(),
    latest: latest === null ? null : new Date(latest).toISOString(),
    // Real and varied, not seven calendar days of silence.
    varied: events.length > 0 && daysWithActivity >= minDaysWithActivity && eventTypes >= minEventTypes,
  };
}

/**
 * The Stage 1 gate, stated as one function so the verdict cannot be reported
 * more generously than the numbers support.
 *
 * Undo gaps are reported and deliberately do NOT block: undo is unmodelled by
 * design, and counting it as failure would fail the gate every time a user
 * presses U.
 */
export function stageOneGate({ activity, reconciliation }) {
  const reasons = [];
  if (!activity || activity.events === 0) reasons.push('no shadow writes seen — the week has not started');
  else if (!activity.varied) {
    reasons.push(
      `traffic is not varied enough (${activity.daysWithActivity} active day(s), `
      + `${activity.eventTypes} event type(s))`,
    );
  }
  if (reconciliation && reconciliation.counts[RECONCILE.DIVERGENCE] > 0) {
    reasons.push(`${reconciliation.counts[RECONCILE.DIVERGENCE]} divergence(s)`);
  }
  return { pass: reasons.length === 0, reasons };
}

/** Roll a set of classifications into a report. Divergences are listed, not counted away. */
export function summarize(results = []) {
  const counts = {
    [RECONCILE.AGREED]: 0,
    [RECONCILE.EXPECTED_GAP]: 0,
    [RECONCILE.UNDO_GAP]: 0,
    [RECONCILE.DIVERGENCE]: 0,
  };
  const divergences = [];
  const undoGaps = [];
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === RECONCILE.DIVERGENCE) divergences.push(r);
    if (r.status === RECONCILE.UNDO_GAP) undoGaps.push(r);
  }
  // `clean` is the acceptance signal and counts DIVERGENCE only. Undo gaps are
  // reported in full alongside it so they stay visible rather than swept up.
  return { counts, divergences, undoGaps, clean: counts[RECONCILE.DIVERGENCE] === 0 };
}

export default {
  RECONCILE, classifyCompany, summarize, summarizeActivity, stageOneGate,
  legacyWrittenAt, legacyIcpId,
};
