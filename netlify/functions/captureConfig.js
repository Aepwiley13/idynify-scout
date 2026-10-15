/**
 * captureConfig — is Relationship Capture enabled for this user?
 *
 *   POST { userId }   Authorization: Bearer <Firebase ID token>
 *   200  { enabled, stage, witnessEnabled, reportEnabled }
 *
 * The app shows "Capture a contact" only when `enabled` is true. This answer
 * is a convenience for the UI, not the gate: every capture endpoint checks the
 * mode itself (architecture section 24).
 *
 * Who may ask: the user themselves, or an admin with an active impersonation
 * session for exactly that user, who then gets that user's answer. No other
 * admin access is honoured, unlike verifyAuthToken, which lets any admin act
 * as any user.
 *
 * This function's own log lines carry the outcome code only. The reused admin
 * checks (checkAdminAccess, checkSuperAdminAccess) log as they always have.
 */
import process from 'node:process';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { checkSuperAdminAccess } from './utils/superAdminAuth.js';
import { validateImpersonationSession } from './utils/impersonation.js';
import { resolveCaptureConfig, isEnrolled } from './utils/captureFlags.js';

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
  console.warn('captureConfig', { outcome: code });
  return respond(FAILURES[code], { error: code });
}

/** Admins and super admins, through the existing checks. */
async function isCaptureAdmin(uid) {
  return (await checkAdminAccess(uid)) || (await checkSuperAdminAccess(uid));
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
    if (tokenUid !== userId) {
      // Only an admin who is impersonating exactly this user right now.
      const impersonating = (await checkAdminAccess(tokenUid))
        && (await validateImpersonationSession(tokenUid)) === userId;
      if (!impersonating) return failure(CODES.FORBIDDEN);
    }

    const config = await resolveCaptureConfig(userId, {
      env: process.env,
      isAdmin: isCaptureAdmin,
      enrolled: uid => isEnrolled(db, uid),
    });
    return respond(200, config);
  } catch (error) {
    console.error('captureConfig', { outcome: CODES.INTERNAL_ERROR, errorName: error?.name ?? 'Error' });
    return respond(500, { error: CODES.INTERNAL_ERROR });
  }
};
