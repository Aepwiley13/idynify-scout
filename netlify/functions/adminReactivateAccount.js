/**
 * Admin Reactivate Account
 *
 * Reactivates a suspended user account.
 * Updates account status in Firestore and re-enables authentication.
 *
 * Endpoint: /.netlify/functions/adminReactivateAccount
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
        body: JSON.stringify({ success: false, error: 'Reason is required for account reactivation' })
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
        action: AUDIT_ACTIONS.ACCOUNT_REACTIVATED,
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

    // Check if account is actually suspended
    const userDoc = await db.collection('users').doc(targetUserId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.accountStatus !== 'suspended') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Account is not suspended' })
        };
      }
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Account status not found' })
      };
    }

    // Reactivate the account
    try {
      const now = new Date();

      // Update Firestore user document
      await db.collection('users').doc(targetUserId).set({
        accountStatus: 'active',
        reactivatedAt: now,
        reactivatedBy: adminUserId,
        reactivationReason: reason.trim(),
        updatedAt: now,
        // Clear suspension fields
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null
      }, { merge: true });

      // Re-enable the user account in Firebase Auth
      await admin.auth().updateUser(targetUserId, {
        disabled: false
      });

      console.log(`✅ Account reactivated: ${targetUserEmail} by admin ${adminEmail}`);

      // Log successful audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.ACCOUNT_REACTIVATED,
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
          reactivatedAt: now.toISOString()
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Account reactivated successfully',
          data: {
            userEmail: targetUserEmail,
            reactivatedAt: now.toISOString(),
            reason: reason.trim()
          }
        })
      };

    } catch (error) {
      console.error('❌ Error reactivating account:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.ACCOUNT_REACTIVATED,
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
          error: 'Failed to reactivate account',
          details: error.message
        })
      };
    }

  } catch (error) {
    console.error('❌ Error in reactivate account handler:', error);
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
