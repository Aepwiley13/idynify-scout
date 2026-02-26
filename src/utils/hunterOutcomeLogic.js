/**
 * Hunter Outcome Logic — extracted for testability.
 *
 * Relationship_state transitions from recorded outcome.
 * Conservative: only advance the relationship state on clear positive signals.
 * Never penalize the state from a single negative outcome.
 */

/**
 * getStateTransition
 *
 * Returns the new relationship_state to apply given an outcome + current state,
 * or null if no state change should occur.
 *
 * Rules:
 * - 'scheduled'       → minimum 'engaged' (they agreed to meet = relationship is active)
 * - 'positive_reply'  → step up one level for unaware/aware/dormant only
 *                       (if already engaged or warmer, positive reply doesn't advance)
 * - everything else   → null (no change — don't penalize state from one interaction)
 */
export function getStateTransition(outcome, currentState) {
  if (outcome === 'scheduled') {
    const alreadyEngagedOrBetter = ['engaged', 'warm', 'trusted', 'advocate', 'strategic_partner'];
    if (alreadyEngagedOrBetter.includes(currentState)) return null;
    return 'engaged';
  }

  if (outcome === 'positive_reply') {
    if (currentState === 'unaware') return 'aware';    // they responded = they know user now
    if (currentState === 'aware') return 'engaged';    // positive exchange = conversation alive
    if (currentState === 'dormant') return 'aware';    // dormant + positive = reactivating
    return null; // warm/trusted/engaged/etc — already at or above expected level
  }

  // All other outcomes: no automatic state change
  // - no_reply:       they haven't responded — don't change anything
  // - neutral_reply:  ambiguous — don't advance without evidence
  // - negative_reply: one rejection doesn't undo a relationship
  // - not_interested: contact remains at current state for potential future re-engagement
  return null;
}
