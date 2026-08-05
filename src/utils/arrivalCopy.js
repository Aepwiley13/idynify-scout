/**
 * arrivalCopy — reason and action codes turned into sentences.
 *
 * Separate from ArrivalBanner so the vocabulary can be asserted on directly,
 * and so the same phrasing is available to Barry's prompt assembly without
 * importing a React component to get at a string.
 */

/**
 * Reason codes → sentences.
 *
 * Keys are the recommendation engine's `type` values (src/utils/
 * recommendationEngine.js), because that is what actually flows through
 * Mission Control. `overdue_next_step` is the sprint brief's spelling of
 * `next_step_overdue` and is aliased rather than argued with — both arrive in
 * practice, and an arrival banner is the wrong place to be strict about a
 * synonym.
 */
export const REASON_COPY = Object.freeze({
  next_step_overdue: 'The next step with this contact is overdue.',
  overdue_next_step: 'The next step with this contact is overdue.',
  stalled_awaiting_reply: 'This conversation has been waiting on a reply.',
  stalled_outcome_not_recorded: 'An outreach attempt here has no recorded outcome.',
  high_value_no_mission: 'A high-value contact with no active mission.',
  high_value_no_engagement: 'A high-value contact you have not engaged yet.',
  high_value_dormant: 'A high-value relationship has gone quiet.',
  momentum_channel_switch: 'This channel has stopped working — another may land.',
  momentum_accelerate: 'There is momentum here worth pressing.',
  momentum_compress: 'This conversation is ready to be closed out.',
  search_result: 'Opened from search.',
});

/**
 * Recommended action codes → imperative labels.
 *
 * The engine emits `action.type` alongside a human label; when a caller passes
 * the raw code, this turns it into something readable. Anything unrecognised
 * falls through to humanize() — a hand-written recommendation must never be
 * swallowed because it is not in a map.
 */
export const ACTION_COPY = Object.freeze({
  complete_step: 'Complete the next step',
  approve_next_step: 'Approve the next step',
  re_engage: 'Re-engage this contact',
  start_mission: 'Start a mission',
  switch_channel: 'Try a different channel',
  accelerate_sequence: 'Accelerate the sequence',
  record_outcome: 'Record the outcome',
  follow_up: 'Follow up',
});

/** Turn an unmapped snake_case code into something readable rather than raw. */
export function humanize(code) {
  if (typeof code !== 'string') return null;
  if (/\s/.test(code)) return code; // already prose — leave it alone
  return code.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export function reasonText(reason) {
  if (!reason) return null;
  return REASON_COPY[reason] ?? humanize(reason);
}

export function actionText(action) {
  if (!action) return null;
  return ACTION_COPY[action] ?? humanize(action);
}
