/**
 * Super Admin - Start Impersonation (Support Mode)
 *
 * Starts a 15-minute support session allowing a super admin to view the platform
 * exactly as a specific user sees it.
 *
 * Key differences from adminStartImpersonation:
 * - Session timeout: 15 minutes (vs 30 min for standard admin)
 * - Requires super_admin role + tenant_impersonation permission
 * - Enhanced audit log: admin_id, user_id, tenant_id, action, timestamp, ip_address
 * - Blocks super_admin → super_admin impersonation
 *
 * Endpoint: /.netlify/functions/superAdminStartImpersonation
 * Method: POST
 * Auth: Firebase auth token + super_admin role + tenant_impersonation permission
 *
 * Body: { targetUserId: string, reason?: string }
 */

import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkSuperAdminAccess, hasSuperAdminPermission, SUPER_ADMIN_PERMISSIONS } from './utils/superAdminAuth.js';
import { logAuditEvent, getIpAddress, getUserAgent } from './utils/auditLog.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://idynify.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// 15-minute session for super admin support mode
const SUPPORT_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const ipAddress = getIpAddress(event);
  const userAgent = getUserAgent(event);

  try {
    const authToken = extractAuthToken(event);
    if (!authToken) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Authentication required' }) };
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authToken);
    } catch {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Invalid authentication token' }) };
    }

    const actorUserId = decodedToken.uid;

    // Verify super admin access
    const isSuperAdmin = await checkSuperAdminAccess(actorUserId);
    if (!isSuperAdmin) {
      await logAuditEvent({
        action: 'super_admin_start_support_session',
        logType: 'admin_action',
        actorUserId,
        targetResource: 'impersonation_session',
        status: 'failed',
        ipAddress,
        userAgent,
        errorMessage: 'Super admin access required'
      });
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Super admin access required' }) };
    }

    const hasImpersonationPermission = await hasSuperAdminPermission(actorUserId, SUPER_ADMIN_PERMISSIONS.TENANT_IMPERSONATION);
    if (!hasImpersonationPermission) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'tenant_impersonation permission required' }) };
    }

    const { targetUserId, reason = 'Super admin support session' } = JSON.parse(event.body || '{}');

    if (!targetUserId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'targetUserId is required' }) };
    }

    // Fetch actor info
    const actorAuthUser = await admin.auth().getUser(actorUserId);
    const actorEmail = actorAuthUser.email;

    // Fetch target user info
    let targetAuthUser;
    try {
      targetAuthUser = await admin.auth().getUser(targetUserId);
    } catch {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Target user not found' }) };
    }
    const targetEmail = targetAuthUser.email || '';

    // Read target's Firestore doc to check role
    const targetDoc = await db.collection('users').doc(targetUserId).get();
    const targetData = targetDoc.exists ? targetDoc.data() : {};

    // Block impersonating another super admin
    if (targetData.role === 'super_admin') {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Cannot impersonate another super admin' }) };
    }

    // Check if this super admin already has an active support session
    const existingSessionSnap = await db.collection('impersonationSessions')
      .where('adminUserId', '==', actorUserId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (!existingSessionSnap.empty) {
      return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'You already have an active support session. End it before starting a new one.' }) };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUPPORT_SESSION_TIMEOUT_MS);

    const sessionData = {
      adminUserId: actorUserId,
      adminEmail: actorEmail,
      targetUserId,
      targetUserEmail: targetEmail,
      reason,
      status: 'active',
      sessionType: 'super_admin_support', // Distinguishes from standard admin sessions
      startedAt: now,
      expiresAt,
      lastActivityAt: now,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      endedAt: null,
      endReason: null
    };

    const sessionRef = await db.collection('impersonationSessions').add(sessionData);
    const sessionId = sessionRef.id;

    console.log(`🛡️ Support session started: SuperAdmin ${actorEmail} → User ${targetEmail} (Session: ${sessionId})`);

    // Log audit event with full required fields
    await logAuditEvent({
      action: 'super_admin_start_support_session',
      logType: 'admin_action',
      actorUserId,                    // admin_id
      actorEmail,
      targetUserId,                   // user_id / tenant_id
      targetUserEmail: targetEmail,
      targetResource: 'impersonation_session',
      resourceId: sessionId,
      status: 'success',
      ipAddress,                      // ip_address
      userAgent,
      metadata: {
        reason,
        sessionType: 'super_admin_support',
        expiresAt: expiresAt.toISOString(),
        timeoutMinutes: 15
      }
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        message: 'Support session started — 15 minutes',
        session: {
          sessionId,
          adminUserId: actorUserId,
          adminEmail: actorEmail,
          targetUserId,
          targetUserEmail: targetEmail,
          sessionType: 'super_admin_support',
          status: 'active',
          startedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          reason
        }
      })
    };

  } catch (error) {
    console.error('❌ superAdminStartImpersonation error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
