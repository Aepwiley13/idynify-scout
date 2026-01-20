/**
 * Admin Suspend Account
 *
 * Suspends a user account with immediate session revocation.
 * Updates account status in Firestore and revokes all active sessions.
 *
 * Endpoint: /.netlify/functions/adminSuspendAccount
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
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
    // Parse request body
    const { authToken, targetUserId, reason } = JSON.parse(event.body);

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

    // Validate targetUserId
    if (!targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'targetUserId is required' })
      };
    }

    // Validate reason
    if (!reason || reason.trim() === '') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Reason is required for account suspension' })
      };
    }

    // Get target user info
    let targetUser;
    try {
      targetUser = await admin.auth().getUser(targetUserId);
    } catch (error) {
      console.error('Error fetching target user:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.ACCOUNT_SUSPENDED,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: targetUserId,
        targetResource: 'user_account',
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: 'User not found',
        metadata: {
          reason: reason.trim()
        }
      });

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    const targetUserEmail = targetUser.email;

    // Prevent admin from suspending another admin (safety measure)
    const targetUserClaims = targetUser.customClaims || {};
    if (targetUserClaims.admin === true) {
      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.ACCOUNT_SUSPENDED,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: targetUserId,
        targetUserEmail: targetUserEmail,
        targetResource: 'user_account',
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: 'Cannot suspend another admin account',
        metadata: {
          reason: reason.trim()
        }
      });

      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Cannot suspend another admin account' })
      };
    }

    // Check if account is already suspended
    const userDoc = await db.collection('users').doc(targetUserId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.accountStatus === 'suspended') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Account is already suspended' })
        };
      }
    }

    // Suspend the account
    try {
      const now = new Date();

      // Update Firestore user document
      await db.collection('users').doc(targetUserId).set({
        accountStatus: 'suspended',
        suspendedAt: now,
        suspendedBy: adminUserId,
        suspensionReason: reason.trim(),
        updatedAt: now
      }, { merge: true });

      // Revoke all user sessions (refresh tokens)
      await admin.auth().revokeRefreshTokens(targetUserId);

      // Disable the user account in Firebase Auth
      await admin.auth().updateUser(targetUserId, {
        disabled: true
      });

      console.log(`✅ Account suspended: ${targetUserEmail} by admin ${adminEmail}`);

      // Log successful audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.ACCOUNT_SUSPENDED,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: targetUserId,
        targetUserEmail: targetUserEmail,
        targetResource: 'user_account',
        status: 'success',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        metadata: {
          reason: reason.trim(),
          suspendedAt: now.toISOString(),
          sessionsRevoked: true
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Account suspended successfully',
          data: {
            userEmail: targetUserEmail,
            suspendedAt: now.toISOString(),
            reason: reason.trim()
          }
        })
      };

    } catch (error) {
      console.error('❌ Error suspending account:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.ACCOUNT_SUSPENDED,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: targetUserId,
        targetUserEmail: targetUserEmail,
        targetResource: 'user_account',
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: error.message,
        metadata: {
          reason: reason.trim()
        }
      });

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Failed to suspend account',
          details: error.message
        })
      };
    }

  } catch (error) {
    console.error('❌ Error in suspend account handler:', error);
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
