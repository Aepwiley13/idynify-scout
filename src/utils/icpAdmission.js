/**
 * icpAdmission — should discovery put this subject in front of the user, for
 * THIS ICP?
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WRITTEN BUT DARK. Nothing calls this in Sprint 1.                       ║
 * ║  Discovery still uses DEDUP_BLOCKING_STATUSES, which is global and       ║
 * ║  ICP-blind. The cutover is Sprint 3.                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT IT REPLACES
 * ────────────────
 * Today's rule blocks an Apollo organization for the whole workspace if any
 * company document for it is accepted, rejected or pending. Measured against
 * production: for whichever ICP is active, 80–96% of the block list belongs to
 * ICPs that never judged those organizations, and 648 rejections — 60 of them
 * in one workspace — block their organizations from every ICP, permanently.
 *
 * TWO QUESTIONS, NOT ONE
 * ──────────────────────
 * The old rule conflated "have I seen this?" with "should I write a new queue
 * entry?". They differ for a skipped or re-eligible subject: the answer is not
 * a new row, it is the EXISTING relationship moving back to pending. That
 * distinction is the direct fix for the current behaviour, where a
 * non-blocking status lets rediscovery PATCH the company document wholesale and
 * destroy its own provenance.
 */

import { RELATIONSHIP_STATE, EVENT_TYPE } from './icpLineage';
import { isReEligible } from './icpCriteria';

/** What discovery should do with a candidate. */
export const ADMISSION = Object.freeze({
  CREATE: 'create',        // no relationship yet — create one, pending
  RESURFACE: 'resurface',  // relationship exists — move it back to pending
  SUPPRESS: 'suppress',    // do nothing, write nothing
});

/**
 * Decide, for one candidate and one ICP.
 *
 * @param {object}  input
 * @param {boolean} input.excluded            Workspace-wide exclusion is active.
 * @param {object|null} input.relationship    The existing relationship, or null.
 * @param {string}  input.currentFingerprint  The ICP's current material fingerprint.
 * @param {string}  input.currentCycleId      The discovery run now being served.
 * @returns {{action: string, reason: string, event: string|null}}
 */
export function admitCandidate({
  excluded = false,
  relationship = null,
  currentFingerprint = null,
  currentCycleId = null,
} = {}) {
  if (excluded) {
    return { action: ADMISSION.SUPPRESS, reason: 'globally-excluded', event: null };
  }

  if (!relationship) {
    return { action: ADMISSION.CREATE, reason: 'never-encountered-by-this-icp', event: EVENT_TYPE.ENCOUNTERED };
  }

  const { state } = relationship;

  if (state === RELATIONSHIP_STATE.PENDING || state === RELATIONSHIP_STATE.ACCEPTED) {
    return { action: ADMISSION.SUPPRESS, reason: `already-${state}`, event: null };
  }

  if (state === RELATIONSHIP_STATE.REJECTED) {
    const reEligible = isReEligible({
      decidedUnderFingerprint: relationship.decidedUnderFingerprint,
      currentFingerprint,
    });
    return reEligible
      ? { action: ADMISSION.RESURFACE, reason: 'criteria-changed-since-rejection', event: EVENT_TYPE.RECONSIDERED }
      : { action: ADMISSION.SUPPRESS, reason: 'rejected-under-current-criteria', event: null };
  }

  if (state === RELATIONSHIP_STATE.SKIPPED) {
    // A skip must not come straight back in the run it was skipped in. The
    // client also drops `skipped` from the queue render, so the card cannot
    // reappear within the session either — two independent guards, because the
    // failure has two shapes.
    const sameCycle =
      relationship.skippedInCycle != null
      && currentCycleId != null
      && String(relationship.skippedInCycle) === String(currentCycleId);

    return sameCycle
      ? { action: ADMISSION.SUPPRESS, reason: 'skipped-in-this-cycle', event: null }
      : { action: ADMISSION.RESURFACE, reason: 'skipped-in-an-earlier-cycle', event: EVENT_TYPE.RESURFACED };
  }

  // An unknown state is not an invitation to guess.
  return { action: ADMISSION.SUPPRESS, reason: `unknown-state:${state}`, event: null };
}

export default { ADMISSION, admitCandidate };
