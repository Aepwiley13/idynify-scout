/**
 * TIMELINE LOGGER
 *
 * Writes structured engagement events to the contact timeline subcollection.
 * Path: users/{userId}/contacts/{contactId}/timeline/{eventId}
 *
 * This is the single entry point for all timeline event creation.
 * It does NOT touch the legacy activity_log array.
 *
 * Event Types:
 *   - message_generated        (Barry returns strategies)
 *   - message_sent             (Gmail confirmed or native handoff)
 *   - mission_assigned         (Contact added to a mission)
 *   - campaign_assigned        (Contact added to a campaign)
 *   - lead_status_changed      (Lead status updated)
 *   - contact_status_changed   (Contact state machine transition)
 *
 * Step 5 — Sequence Event Types:
 *   - sequence_step_proposed   (Barry proposes a sequence step for approval)
 *   - sequence_step_approved   (User approved a sequence step)
 *   - sequence_step_sent       (Approved step was executed/sent)
 *   - sequence_step_skipped    (User skipped a sequence step)
 *   - sequence_completed       (All steps in sequence finished)
 *
 * Operation People First — Next Best Step Events:
 *   - next_step_queued         (Barry proposes a next step; user confirms timing)
 *   - next_step_completed      (User marks the queued next step as done)
 *   - next_step_dismissed      (User dismisses Barry's next step proposal)
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// DUAL-WRITE NOTE (Operation People First):
// All new timeline documents write BOTH createdAt and timestamp.
// This ensures backward-compatible reads (createdAt) and ordered queries (timestamp).
// Historical documents with only createdAt must be backfilled via:
//   src/scripts/backfillTimelineTimestamp.js

// Allowed event types — enforced at write time
const TIMELINE_EVENT_TYPES = [
  'message_generated',
  'message_sent',
  'mission_assigned',
  'campaign_assigned',
  'lead_status_changed',
  'contact_status_changed',
  // Step 5: Sequence events
  'sequence_step_proposed',
  'sequence_step_approved',
  'sequence_step_sent',
  'sequence_step_skipped',
  'sequence_completed',
  // Operation People First: Next Best Step events
  'next_step_queued',
  'next_step_completed',
  'next_step_dismissed',
  // Hunter → Sniper stage transition
  'stage_moved',
  // Operation People First: Brigade System events
  'brigade_changed',
  // Barry Intelligence Upgrade: Relationship guardrail events
  'barry_guardrail_shown',
  'barry_guardrail_response',
  // Scheduled engagement events
  'message_scheduled',
  'message_schedule_cancelled',
  // CSM: Intervention Playbook events
  'playbook_abandoned',
  'playbook_completed',
];

// Actor types
const ACTORS = {
  USER: 'user',
  BARRY: 'barry',
  SYSTEM: 'system'
};

/**
 * Log a structured timeline event to the contact's timeline subcollection.
 *
 * @param {Object} params
 * @param {string} params.userId       - Authenticated user ID
 * @param {string} params.contactId    - Contact document ID
 * @param {string} params.type         - One of TIMELINE_EVENT_TYPES
 * @param {string} params.actor        - 'user' | 'barry' | 'system'
 * @param {string} [params.preview]    - Short preview snippet (message subject, status label, etc.)
 * @param {Object} [params.metadata]   - Type-specific structured metadata
 *
 * @returns {Promise<string|null>} Document ID of the created event, or null on failure
 */
export async function logTimelineEvent({ userId, contactId, type, actor, preview, metadata }) {
  // Validate required fields
  if (!userId || !contactId || !type || !actor) {
    console.error('[Timeline] Missing required fields:', { userId, contactId, type, actor });
    return null;
  }

  // Validate event type
  if (!TIMELINE_EVENT_TYPES.includes(type)) {
    console.error('[Timeline] Invalid event type:', type);
    return null;
  }

  try {
    const timelineRef = collection(db, 'users', userId, 'contacts', contactId, 'timeline');

    // Dual-write: createdAt (legacy reads) + timestamp (ordered queries)
    const now = Timestamp.now();
    const event = {
      type,
      actor,
      // Write both fields during migration period.
      // 'timestamp' is the canonical read field (used by all query orderBy calls).
      // 'createdAt' kept for backward compatibility with pre-sprint documents.
      // Squad Alpha: remove 'createdAt' once all legacy docs are backfilled.
      timestamp: Timestamp.now(),
      createdAt: Timestamp.now(),
      ...(preview ? { preview } : {}),
      ...(metadata ? { metadata } : {})
    };

    const docRef = await addDoc(timelineRef, event);
    return docRef.id;
  } catch (error) {
    console.error('[Timeline] Failed to log event:', error);
    // Non-blocking — never throw
    return null;
  }
}

export { TIMELINE_EVENT_TYPES, ACTORS };
