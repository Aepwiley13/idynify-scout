/**
 * missionPhaseGate.js — Pure phase-gate logic for the Go To War wizard.
 *
 * Extracted from GoToWar.jsx so it can be unit-tested independently of
 * React state and Firebase. Each phase has an explicit requirement that
 * must be satisfied before the user can advance.
 *
 * Phase map (0-indexed):
 *   0 — Brief:    goal selected
 *   1 — Roster:   at least one contact selected or added
 *   2 — Approach: all four strategy fields set
 *   3 — Sequence: microSequence generated AND has at least one step
 *   4 — Approve:  every step either approved or skipped
 *   5 — Launch:   mission saved to Firestore
 *   6 — Monitor:  (always advanceable once reached)
 *   7 — Debrief:  (always advanceable — Finish nav handled by caller)
 */

/**
 * @param {number} phase - Current 0-indexed phase
 * @param {object} state
 * @param {string}  state.goalId
 * @param {Set}     state.selected          - Selected contact IDs
 * @param {Array}   state.missionContacts   - Manually added contacts
 * @param {boolean} state.allStrategyFieldsSet
 * @param {object|null} state.microSequence
 * @param {Set}     state.approvedSteps
 * @param {Set}     state.skippedSteps
 * @param {boolean} state.missionLaunched
 * @returns {boolean}
 */
export function canAdvancePhase(phase, {
  goalId,
  selected,
  missionContacts,
  allStrategyFieldsSet,
  microSequence,
  approvedSteps,
  skippedSteps,
  missionLaunched,
}) {
  if (phase === 0) return goalId !== '';
  if (phase === 1) return selected.size > 0 || missionContacts.length > 0;
  if (phase === 2) return !!allStrategyFieldsSet;
  if (phase === 3) return !!(microSequence?.steps?.length > 0);
  if (phase === 4) return approvedSteps.size + skippedSteps.size === (microSequence?.steps?.length || 0);
  if (phase === 5) return !!missionLaunched;
  return true; // phases 6+ (Monitor, Debrief) are always advanceable
}
