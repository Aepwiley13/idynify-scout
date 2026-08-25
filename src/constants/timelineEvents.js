/**
 * CANONICAL TIMELINE EVENT CONTRACT — Scout Gate 1 (G1-03)
 *
 * ONE allowlist, consumed by BOTH runtimes:
 *   browser  → src/utils/timelineLogger.js  (and engagementHistoryLogger re-exports)
 *   functions→ netlify/functions/utils/timelineWrite.js
 *
 * This file holds PLAIN DATA ONLY. It must never import firebase, firebase-admin,
 * or anything environment-specific — that is what lets one list serve both sides
 * and is the whole reason the two previous allowlists were able to drift apart.
 *
 * HISTORY — why this exists:
 *   timelineLogger.js validated against 26 types; engagementHistoryLogger.js
 *   against 35. Neither was a superset. Four legitimate, emitted event types were
 *   validated, rejected and discarded without throwing:
 *     reply_received, outreach_logged, mission_debrief, referral_ask_sent
 *   Two more were written server-side, bypassing validation entirely and landing
 *   under names no reader knew: message_received, meeting_scheduled.
 *
 * ADDING A TYPE: add it here and nowhere else. src/test/timelineContract.test.js
 * fails the build if any type emitted anywhere in src/ is absent from this list.
 */

export const TIMELINE_EVENT_TYPES = [
  // Core message + assignment
  'message_generated',
  'message_sent',
  'mission_assigned',
  'campaign_assigned',
  'lead_status_changed',
  'contact_status_changed',

  // Sequence
  'sequence_step_proposed',
  'sequence_step_approved',
  'sequence_step_sent',
  'sequence_step_skipped',
  'sequence_completed',

  // Next Best Step (canonical)
  'next_step_queued',
  'next_step_confirmed',
  'next_step_completed',
  'next_step_dismissed',

  // Next Best Step (legacy aliases)
  'next_best_step_proposed',
  'next_best_step_confirmed',
  'next_best_step_completed',
  'next_best_step_dismissed',

  // Stage + brigade
  'stage_moved',
  'brigade_changed',
  'brigade_assigned',
  'brigade_transition_suggested',
  'brigade_transition_confirmed',
  'brigade_transition_dismissed',
  'person_type_changed',

  // Barry guardrails
  'barry_guardrail_shown',
  'barry_guardrail_response',

  // Scheduling
  'message_scheduled',
  'message_schedule_cancelled',

  // Playbooks + reinforcements
  'playbook_abandoned',
  'playbook_completed',
  'referral_thank_you_sent',
  'referral_ask_sent',
  'keep_warm_sent',
  'recognition_sent',

  // Engage session
  'engage_session_started',
  'engage_session_completed',
  'engage_session_abandoned',
  'engage_session_pivoted',
  'message_generated_all_types',
  'channel_blocked',
  'channel_pivot_started',

  // Referral graph
  'referral_received',
  'referral_sent',
  'referral_converted',
  'referral_opportunity_flagged',

  // GATE 1 — restored outcome events (were emitted then discarded)
  'reply_received',
  'outreach_logged',
  'mission_debrief',

  // GATE 1 — server-side writers (previously bypassed all validation)
  'message_received',
  'meeting_scheduled',
  'email_opened',        // track-open.js — correct shape, was simply unlisted
  'reply_sent',          // barry-approve-send.js — was written as `eventType`
];

/** Who caused the event. */
export const ACTORS = {
  USER: 'user',
  BARRY: 'barry',
  SYSTEM: 'system',
  CONTACT: 'contact',   // inbound — used by gmail-poll-replies
};

export const isValidTimelineEvent = (type) => TIMELINE_EVENT_TYPES.includes(type);

export default { TIMELINE_EVENT_TYPES, ACTORS, isValidTimelineEvent };
