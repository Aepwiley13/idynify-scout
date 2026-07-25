/**
 * TRACK OPEN — email open tracking pixel (Phase 2, Workstream A)
 *
 * Serves a 1x1 transparent GIF for a tracking pixel embedded in outgoing
 * cadence emails. When a recipient's mail client loads the pixel, this
 * function records the open against the cadence, the cadence contact entry,
 * the contact doc, and the contact timeline — then always returns the pixel.
 *
 * Request: GET /.netlify/functions/track-open?data=<base64>
 *   where <base64> decodes to JSON: { contactId, cadenceId, userId, messageId }
 *
 * Guarantees:
 *   - ALWAYS returns the 1x1 GIF, even on missing/malformed params or write
 *     failure. The recipient must never see an error.
 *   - Never logs or echoes the tracking params in the response body.
 *   - openedCount / timeline / last_opened_at are written only on the FIRST
 *     open of a given cadence contact entry, so pixel prefetch and repeated
 *     loads (Apple Mail Privacy Protection, etc.) do not inflate the count.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once) — same pattern as the other functions.
if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

const db = getFirestore();

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const PIXEL_RESPONSE = {
  statusCode: 200,
  headers: {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  },
  body: PIXEL.toString('base64'),
  isBase64Encoded: true,
};

/** Decode the base64 `data` param into params. Returns null on any failure. */
function decodeParams(dataParam) {
  if (!dataParam || typeof dataParam !== 'string') return null;
  try {
    const json = Buffer.from(dataParam, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Record the open. Best-effort — any thrown error is swallowed by the caller
 * so the pixel is always returned.
 */
async function recordOpen({ userId, cadenceId, contactId, messageId }) {
  if (!userId || !cadenceId || !contactId) return;

  const cadenceRef = db
    .collection('users').doc(userId)
    .collection('cadences').doc(cadenceId);

  // Read-modify-write the cadence doc in a transaction so openedCount and the
  // per-contact opened flag stay consistent under concurrent pixel loads.
  // serverTimestamp() is not permitted inside an array element, so the entry's
  // openedAt uses a concrete Timestamp.
  const firstOpen = await db.runTransaction(async (tx) => {
    const snap = await tx.get(cadenceRef);
    if (!snap.exists) return false;

    const data = snap.data();
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    let matched = false;
    let isFirstOpen = false;
    const openedAt = Timestamp.now();

    const nextContacts = contacts.map((c) => {
      if (c && c.contactId === contactId) {
        matched = true;
        if (!c.opened) {
          isFirstOpen = true;
          return { ...c, opened: true, openedAt };
        }
      }
      return c;
    });

    if (!matched || !isFirstOpen) return false;

    tx.update(cadenceRef, {
      contacts: nextContacts,
      openedCount: FieldValue.increment(1),
    });
    return true;
  });

  // Timeline event + contact doc update only on the first open, so repeated
  // pixel loads don't spam the timeline.
  if (!firstOpen) return;

  const contactRef = db
    .collection('users').doc(userId)
    .collection('contacts').doc(contactId);

  await Promise.all([
    contactRef.collection('timeline').add({
      type: 'email_opened',
      actor: 'contact',
      preview: 'Email opened',
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      metadata: {
        cadenceId,
        gmailMessageId: messageId || null,
        openedAt: FieldValue.serverTimestamp(),
      },
    }),
    contactRef.update({ last_opened_at: FieldValue.serverTimestamp() }),
  ]);
}

export const handler = async (event) => {
  // Only GET serves the pixel; still return the pixel for anything else so a
  // stray request never surfaces an error to a mail client.
  const params = decodeParams(event.queryStringParameters?.data);

  if (params) {
    try {
      await recordOpen({
        userId: params.userId,
        cadenceId: params.cadenceId,
        contactId: params.contactId,
        messageId: params.messageId,
      });
    } catch {
      // Never error to the recipient — log server-side only, without the params.
      console.warn('[track-open] Failed to record open (non-blocking)');
    }
  }

  return PIXEL_RESPONSE;
};
