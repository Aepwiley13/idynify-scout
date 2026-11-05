/**
 * stickersConfig — may this user use stickers? (ADR-007)
 *
 *   POST { userId }   Authorization: Bearer <Firebase ID token>
 *   200  { enabled, mode, readOnly }
 *
 * The app shows sticker controls only when `enabled` is true and `readOnly`
 * is false. This is a convenience for the UI, NOT the gate: every sticker
 * write is a client write to Firestore, and firestore.rules decides it with
 * the same inputs and the same decision (utils/stickersFlags.js). A crafted
 * client that ignores this answer is still refused by the rules.
 *
 * Who may ask: the user themselves, or an admin with an active impersonation
 * session for exactly that user, who gets that user's answer with
 * readOnly: true (an admin's writes are their own, and the rules refuse them
 * on another user's data). The same as captureConfig.
 *
 * Log lines carry the outcome code only.
 */
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { validateImpersonationSession } from './utils/impersonation.js';
import { resolveStickersConfig } from './utils/stickersFlags.js';

export const CODES = Object.freeze({
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  INVALID_REQUEST: 'invalid_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  INTERNAL_ERROR: 'internal_error',
});

const FAILURES = Object.freeze({
  [CODES.METHOD_NOT_ALLOWED]: 405,
  [CODES.INVALID_REQUEST]: 400,
  [CODES.UNAUTHORIZED]: 401,
  [CODES.FORBIDDEN]: 403,
  [CODES.INTERNAL_ERROR]: 500,
});

const HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
});

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function respond(statusCode, payload) {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(payload) };
}

function failure(code) {
  console.warn('stickersConfig', { outcome: code });
  return respond(FAILURES[code], { error: code });
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...HEADERS }, body: '' };
  if (event.httpMethod !== 'POST') return failure(CODES.METHOD_NOT_ALLOWED);

  let userId;
  try {
    userId = JSON.parse(event.body || '')?.userId;
  } catch {
    return failure(CODES.INVALID_REQUEST);
  }
  if (typeof userId !== 'string' || !USER_ID.test(userId)) return failure(CODES.INVALID_REQUEST);

  const authToken = extractAuthToken(event);
  if (!authToken) return failure(CODES.UNAUTHORIZED);

  let tokenUid;
  try {
    tokenUid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return failure(CODES.UNAUTHORIZED);
  }

  try {
    const viewingAs = tokenUid !== userId;
    if (viewingAs) {
      // Only an admin who is impersonating exactly this user right now.
      const impersonating = (await checkAdminAccess(tokenUid))
        && (await validateImpersonationSession(tokenUid)) === userId;
      if (!impersonating) return failure(CODES.FORBIDDEN);
    }
    const config = await resolveStickersConfig(db, userId);
    return respond(200, { ...config, readOnly: viewingAs });
  } catch (error) {
    console.error('stickersConfig', { outcome: CODES.INTERNAL_ERROR, errorName: error?.name ?? 'Error' });
    return respond(500, { error: CODES.INTERNAL_ERROR });
  }
};
