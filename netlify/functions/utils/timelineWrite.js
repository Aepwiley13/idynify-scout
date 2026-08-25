/**
 * SERVER-SIDE TIMELINE WRITER — Scout Gate 1 (G1-04)
 *
 * Three Netlify functions wrote directly to
 *   users/{uid}/contacts/{cid}/timeline
 * with raw `.add()`, bypassing every validator the client used:
 *
 *   gmail-poll-replies.js        wrote type 'message_received' — a type in
 *                                NEITHER client allowlist, so replies landed
 *                                under a name no reader or validator knew.
 *   calendar-create-event.js     wrote NO `type` at all (used `activityType`),
 *                                an ISO-STRING `timestamp`, and no `createdAt`.
 *                                Because Firestore orders strings after
 *                                timestamps, in a `desc` query those documents
 *                                sorted ABOVE every real event permanently, and
 *                                were invisible to the reader that ordered by
 *                                `createdAt`.
 *   process-scheduled-engagements.js  shape was correct but unvalidated.
 *
 * All three now go through here, against the same list the browser uses:
 *   src/constants/timelineEvents.js
 *
 * Fails open (never throws) — a timeline write must not break a send or a
 * calendar booking — but always returns a typed result and logs on rejection.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { TIMELINE_EVENT_TYPES, ACTORS } from '../../../src/constants/timelineEvents.js';

/**
 * @returns {Promise<{ok: boolean, id: string|null, reason: string|null}>}
 */
export async function writeTimelineEvent(db, { userId, contactId, type, actor, preview, metadata } = {}) {
  if (!userId || !contactId || !type || !actor) {
    console.error('[timeline] missing required fields', { type, hasUser: !!userId, hasContact: !!contactId, actor });
    return { ok: false, id: null, reason: 'missing_fields' };
  }
  if (!TIMELINE_EVENT_TYPES.includes(type)) {
    console.error('[timeline] unknown event type — REJECTED', { type, contactId, actor });
    return { ok: false, id: null, reason: 'invalid_type' };
  }
  try {
    const now = FieldValue.serverTimestamp();
    const ref = await db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('timeline')
      .add({
        type,
        actor,
        timestamp: now,   // canonical ordering field — always a Timestamp
        createdAt: now,   // legacy read compatibility
        ...(preview ? { preview } : {}),
        ...(metadata ? { metadata } : {}),
      });
    return { ok: true, id: ref.id, reason: null };
  } catch (error) {
    console.error('[timeline] write failed', { type, contactId, code: error?.code, message: error?.message });
    return { ok: false, id: null, reason: 'write_failed' };
  }
}

export { TIMELINE_EVENT_TYPES, ACTORS };
