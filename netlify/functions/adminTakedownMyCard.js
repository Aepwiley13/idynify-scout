/**
 * Admin Takedown My Card
 *
 * Takes a user's public My Card down and blocks republishing (users/{uid}.myCardPublishBlocked),
 * for abuse reports and for any other reason. Idempotent. {uid, action:'restore'} lifts the block
 * only; it never republishes anything (the owner must publish again, and may then Reset Link).
 *
 * RELEASE RUNBOOK STEP: IDYNIFY has no account-deletion flow in code. Before ANY manual deletion of
 * an account (Firebase console), run this function for that uid first, so its public card is gone
 * and cannot be republished. The registry publicIds/{id} entry is never deleted: an ID stays bound
 * to its owner forever.
 *
 * Endpoint: /.netlify/functions/adminTakedownMyCard
 * Method: POST   Body: { uid, reason } or { uid, action: 'restore' }
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent } from './utils/auditLog.js';
import { takeDownMyCard } from './utils/myCardTakedown.js';

const respond = (headers, statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return respond(headers, 405, { success: false, error: 'Method not allowed' });

  try {
    const authToken = extractAuthToken(event);
    const { uid, reason, action } = JSON.parse(event.body || '{}');
    if (!authToken) return respond(headers, 401, { success: false, error: 'Authentication required' });

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authToken);
    } catch (error) {
      console.error('Token verification failed:', error);
      return respond(headers, 401, { success: false, error: 'Invalid authentication token' });
    }
    const adminUserId = decodedToken.uid;
    if (!(await checkAdminAccess(adminUserId))) return respond(headers, 403, { success: false, error: 'Admin access required' });

    const adminUser = await admin.auth().getUser(adminUserId);
    const adminEmail = adminUser.email;

    if (!uid || typeof uid !== 'string') return respond(headers, 400, { success: false, error: 'uid is required' });
    const restore = action === 'restore';
    if (!restore && (typeof reason !== 'string' || reason.trim() === '')) {
      return respond(headers, 400, { success: false, error: 'Reason is required for a My Card takedown' });
    }

    const userRef = db.collection('users').doc(uid);
    const audit = (status, extra = {}) => logAuditEvent({
      action: restore ? 'my_card_takedown_restored' : 'my_card_takedown',
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetUserId: uid,
      targetResource: 'my_card',
      status,
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      ...extra
    });

    try {
      const now = new Date();
      if (restore) {
        // Lifts the block only. Nothing is republished.
        await userRef.set({ myCardPublishBlocked: false, myCardPublishBlockedAt: null, myCardPublishBlockedBy: null, myCardPublishBlockedReason: null }, { merge: true });
        await audit('success', { metadata: { restored: true } });
        return respond(headers, 200, { success: true, message: 'My Card publishing restored', data: { blocked: false } });
      }

      await userRef.set({
        myCardPublishBlocked: true,
        myCardPublishBlockedAt: now,
        myCardPublishBlockedBy: adminUserId,
        myCardPublishBlockedReason: reason.trim()
      }, { merge: true });

      // The block is in place first, so a failure here still leaves the user unable to republish.
      const myCard = await takeDownMyCard(uid);
      if (myCard.error) {
        await audit('partial', { errorMessage: myCard.error, metadata: { reason: reason.trim() } });
        return respond(headers, 500, { success: false, error: 'Publishing is blocked, but the public card could not be removed', myCard });
      }
      await audit('success', { metadata: { reason: reason.trim(), takenDown: myCard.takenDown } });
      return respond(headers, 200, { success: true, message: 'My Card taken down', myCard, data: { blocked: true, reason: reason.trim() } });
    } catch (error) {
      console.error('❌ Error in My Card takedown:', error);
      await audit('failed', { errorMessage: error.message });
      return respond(headers, 500, { success: false, error: 'Failed to take down My Card', details: error.message });
    }
  } catch (error) {
    console.error('❌ Error in takedown handler:', error);
    return respond(headers, 500, { success: false, error: 'Internal server error', details: error.message });
  }
};
