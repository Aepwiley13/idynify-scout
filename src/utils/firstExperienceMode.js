/**
 * firstExperienceMode.js — what the First Experience is doing this visit.
 *
 * There is no separate "returning onboarding" flow. One route serves the first
 * conversation and every one after it, which is what makes redirecting the
 * existing-user affordances ("Review ICP with Barry") into it correct rather
 * than destructive.
 *
 * Mode is derived, never stored. It is a reading of state that already exists —
 * the conversation document and the canonical ICP resolution — so it cannot
 * drift from reality and cannot become another completion flag.
 */

export const MODE_BEGIN = 'begin';       // nothing yet — first conversation
export const MODE_RESUME = 'resume';     // a conversation was left in progress
export const MODE_REFINE = 'refine';     // an ICP already exists; this is refinement

/**
 * Arrival intent — why the user came to the route on THIS navigation.
 *
 * Carried in React Router location state, which lives in the history entry and
 * is gone on reload. Deliberately transient: it says why someone arrived, not
 * what they are, so it must not outlive the navigation that produced it.
 */
export const ARRIVAL_REVIEW_ICP = 'review-icp';

/**
 * @param {Object|null} conversation - users/{uid}/barryConversations/icp, or null
 * @param {Object} icpResolution - the canonical resolution (Tier 1 contract)
 * @param {string|null} [arrival] - transient arrival intent, if the navigation carried one
 * @returns {{ mode: string, hasIcp: boolean, messageCount: number }}
 */
export function resolveFirstExperienceMode(conversation, icpResolution, arrival = null) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const messageCount = messages.length;
  const hasIcp = icpResolution?.status === 'resolved';

  // Explicit arrival intent outranks everything below it. Someone who clicked
  // "Review ICP with Barry" has said what they came for; dropping them into an
  // unrelated half-finished conversation ignores the thing they just did.
  //
  // It only forces refinement when there is actually an ICP to refine — you
  // cannot review what does not exist, so with no ICP the normal precedence
  // applies and the user gets the conversation that will produce one.
  if (arrival === ARRIVAL_REVIEW_ICP && hasIcp) {
    return { mode: MODE_REFINE, hasIcp, messageCount };
  }

  // An unfinished conversation is the next strongest signal: pick it up where
  // it stopped. Finishing what was started beats starting something new, and
  // beats jumping to refinement of an ICP the user may have been mid-change on.
  if (messageCount > 0 && conversation?.status !== 'completed') {
    return { mode: MODE_RESUME, hasIcp, messageCount };
  }

  // An ICP exists and no conversation is open: this visit is refinement, which
  // is what the existing-user entry points mean by "Review ICP with Barry".
  if (hasIcp) {
    return { mode: MODE_REFINE, hasIcp, messageCount };
  }

  return { mode: MODE_BEGIN, hasIcp, messageCount };
}

/**
 * Whether Barry should introduce itself this visit.
 *
 * Only on a genuine first conversation. Someone resuming or refining has met
 * Barry already, and being introduced to it again is the tell of a flow that
 * does not know you have been here.
 */
export function shouldIntroduce(mode) {
  return mode === MODE_BEGIN;
}
