/**
 * Admin End Impersonation
 *
 * Ends an active impersonation session.
 *
 * Endpoint: /.netlify/functions/adminEndImpersonation
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { getActiveImpersonationSession, endImpersonationSession } from './utils/impersonation.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';

export const handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    // Extract auth token from Authorization header (fallback: request body)
    const authToken = extractAuthToken(event);

    // Verify auth token
    if (!authToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authToken);
    } catch (error) {
      console.error('Token verification failed:', error);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const adminUserId = decodedToken.uid;

    // Check admin access
    const isAdmin = await checkAdminAccess(adminUserId);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Admin access required' })
      };
    }

    // Get admin email for audit logging
    const adminUser = await admin.auth().getUser(adminUserId);
    const adminEmail = adminUser.email;

    // Get active impersonation session
    const session = await getActiveImpersonationSession(adminUserId);

    if (!session) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No active impersonation session found'
        })
      };
    }

    // End the session
    try {
      await endImpersonationSession(session.sessionId, 'Manually ended by admin');

      console.log(`✅ Impersonation session ended: Admin ${adminEmail} (Session: ${session.sessionId})`);

      // Log successful audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.END_IMPERSONATION,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: session.targetUserId,
        targetUserEmail: session.targetUserEmail,
        targetResource: 'impersonation_session',
        resourceId: session.sessionId,
        status: 'success',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        metadata: {
          sessionDuration: new Date() - new Date(session.startedAt),
          endReason: 'Manually ended by admin'
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Impersonation session ended'
        })
      };

    } catch (error) {
      console.error('❌ Error ending impersonation session:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.END_IMPERSONATION,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: session.targetUserId,
        targetUserEmail: session.targetUserEmail,
        targetResource: 'impersonation_session',
        resourceId: session.sessionId,
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: error.message
      });

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }

  } catch (error) {
    console.error('❌ Error in end impersonation handler:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
