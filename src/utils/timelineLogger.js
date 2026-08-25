/**
 * TIMELINE LOGGER — the single client-side entry point for timeline events.
 *
 * Path: users/{userId}/contacts/{contactId}/timeline/{eventId}
 *
 * Scout Gate 1 (G1-03): this file previously carried its own 26-type allowlist
 * while engagementHistoryLogger.js carried a different 35-type list. Neither was
 * a superset, so four legitimate emitted events were validated, rejected and
 * dropped in silence. Both now validate against ONE list:
 *     src/constants/timelineEvents.js
 * engagementHistoryLogger.js re-exports this implementation; its typed helpers
 * are unchanged and keep working.
 *
 * RETURN CONTRACT (changed in Gate 1):
 *   Returns { ok, id, reason } — never a bare null.
 *   The old signature returned `string | null`, which meant a caller could not
 *   distinguish "written" from "silently rejected". Existing callers ignore the
 *   return value, so this is source-compatible; new callers can check `ok`.
 *
 * FAILURE BEHAVIOUR:
 *   development → throws on an unknown type, so a bad type fails the test run.
 *   production  → logs and returns { ok:false }. A timeline write must never
 *                 break an engagement flow.
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { TIMELINE_EVENT_TYPES, ACTORS } from '../constants/timelineEvents';

export class TimelineContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimelineContractError';
  }
}

// Vite exposes import.meta.env (and vitest sets DEV too), so this is the single
// source of truth. Deliberately does NOT reference `process` — this module runs
// in the browser bundle, where `process` is undefined.
function isDev() {
  try {
    return !!(import.meta && import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
}

/**
 * Log a structured timeline event.
 *
 * @param {Object}  params
 * @param {string}  params.userId
 * @param {string}  params.contactId
 * @param {string}  params.type      - must be in TIMELINE_EVENT_TYPES
 * @param {string}  params.actor     - 'user' | 'barry' | 'system' | 'contact'
 * @param {string}  [params.preview]
 * @param {Object}  [params.metadata]
 * @returns {Promise<{ok: boolean, id: string|null, reason: string|null}>}
 */
export async function logTimelineEvent({ userId, contactId, type, actor, preview, metadata } = {}) {
  if (!userId || !contactId || !type || !actor) {
    // Guards a real historical bug: NextBestStep.jsx called this positionally,
    // so destructuring a string yielded undefined for every field and every
    // event from that surface was discarded.
    const msg = `[Timeline] Missing required fields (type=${type ?? 'undefined'})`;
    console.error(msg, { hasUserId: !!userId, hasContactId: !!contactId, actor });
    if (isDev()) throw new TimelineContractError(msg);
    return { ok: false, id: null, reason: 'missing_fields' };
  }

  if (!TIMELINE_EVENT_TYPES.includes(type)) {
    const msg = `[Timeline] Unknown event type: ${type}`;
    console.error(msg, { contactId, actor });
    if (isDev()) throw new TimelineContractError(msg);
    return { ok: false, id: null, reason: 'invalid_type' };
  }

  try {
    const timelineRef = collection(db, 'users', userId, 'contacts', contactId, 'timeline');

    // Dual-write. `timestamp` is canonical for ordered reads; `createdAt` is kept
    // for pre-migration documents. Both must be real Timestamps — an ISO string
    // in `timestamp` sorts ABOVE every Timestamp in a desc query, which is how
    // calendar events used to pin themselves to the top of every timeline.
    const now = Timestamp.now();
    const event = {
      type,
      actor,
      timestamp: now,
      createdAt: now,
      ...(preview ? { preview } : {}),
      ...(metadata ? { metadata } : {}),
    };

    const docRef = await addDoc(timelineRef, event);
    return { ok: true, id: docRef.id, reason: null };
  } catch (error) {
    console.error('[Timeline] Write failed:', { type, contactId, code: error?.code, message: error?.message });
    return { ok: false, id: null, reason: 'write_failed' };
  }
}

export { TIMELINE_EVENT_TYPES, ACTORS };
