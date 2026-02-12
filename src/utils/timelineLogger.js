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
 *   - message_generated       (Barry returns strategies)
 *   - message_sent            (Gmail confirmed or native handoff)
 *   - mission_assigned        (Contact added to a mission)
 *   - campaign_assigned       (Contact added to a campaign)
 *   - lead_status_changed     (Lead status updated)
 *   - contact_status_changed  (Contact state machine transition)
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// Allowed event types — enforced at write time
const TIMELINE_EVENT_TYPES = [
  'message_generated',
  'message_sent',
  'mission_assigned',
  'campaign_assigned',
  'lead_status_changed',
  'contact_status_changed'
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

    const event = {
      type,
      actor,
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
