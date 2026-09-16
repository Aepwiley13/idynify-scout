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
 *   divergence    a legacy record written AFTER the cutover with no shadow
 *                 counterpart, or the two disagree. The only thing that should
 *                 ever be non-zero.
 *
 * Divergence is single-directional by construction: the write order is legacy
 * first, shadow second (invariant I-11), so shadow may only ever lag. That is
 * what lets this be one comparison rather than a merge.
 */

import { RELATIONSHIP_STATE } from './icpLineage';

export const RECONCILE = Object.freeze({
  AGREED: 'agreed',
  EXPECTED_GAP: 'expected-gap',
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
    return {
      status: RECONCILE.DIVERGENCE,
      reason: `legacy=${company.status} shadow=${match.state}`,
      icpId,
    };
  }

  return { status: RECONCILE.AGREED, reason: `both=${expected}`, icpId };
}

/** Roll a set of classifications into a report. Divergences are listed, not counted away. */
export function summarize(results = []) {
  const counts = { [RECONCILE.AGREED]: 0, [RECONCILE.EXPECTED_GAP]: 0, [RECONCILE.DIVERGENCE]: 0 };
  const divergences = [];
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === RECONCILE.DIVERGENCE) divergences.push(r);
  }
  return { counts, divergences, clean: counts[RECONCILE.DIVERGENCE] === 0 };
}

export default { RECONCILE, classifyCompany, summarize, legacyWrittenAt, legacyIcpId };
