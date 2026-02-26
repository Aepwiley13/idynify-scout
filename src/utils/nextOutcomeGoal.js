/**
 * nextOutcomeGoal.js — Predict what Barry's next mission goal should be.
 *
 * Called after an outcome is recorded on a mission step.
 * Returns a suggestion — not a command. The user can adopt or dismiss.
 *
 * Returns null for terminal outcomes (not_interested) where there
 * is no meaningful next goal.
 */

const PROGRESSION = {
  unaware:          'enter_conversation',
  aware:            'build_rapport',
  engaged:          'deepen_conversation',
  warm:             'schedule_meeting',
  trusted:          'get_introduction',
  advocate:         'ask_for_referral',
  dormant:          'reconnect',
  strained:         'rebuild_relationship',
  strategic_partner: 'strategic_alignment'
};

const GOAL_LABELS = {
  enter_conversation:  'Enter Conversation',
  build_rapport:       'Build Rapport',
  deepen_conversation: 'Deepen Relationship',
  schedule_meeting:    'Schedule Meeting',
  get_introduction:    'Request Introduction',
  ask_for_referral:    'Ask for Referral',
  reconnect:           'Reconnect',
  rebuild_relationship: 'Rebuild Trust',
  strategic_alignment: 'Strategic Alignment',
  define_next_step:    'Define Next Step',
  close_deal:          'Close Deal'
};

/**
 * Predict the next outcome_goal given the current relationship state,
 * the last recorded outcome, and the current mission goal.
 *
 * @param {string} relationship_state - current contact relationship state
 * @param {string} current_outcome_goal - the mission's current goal
 * @param {string} last_outcome - the outcome just recorded (e.g. 'positive_reply')
 * @returns {{ goal: string, label: string }|null}
 */
export function predictNextOutcomeGoal(relationship_state, current_outcome_goal, last_outcome) {
  // Terminal — no next goal
  if (last_outcome === 'not_interested') return null;

  // Scheduled → prepare for the meeting
  if (last_outcome === 'scheduled') {
    return { goal: 'define_next_step', label: GOAL_LABELS['define_next_step'] };
  }

  const goal = PROGRESSION[relationship_state] || 'define_next_step';

  // Don't suggest the same goal that's already active
  if (goal === current_outcome_goal) return null;

  return { goal, label: GOAL_LABELS[goal] || goal.replace(/_/g, ' ') };
}
