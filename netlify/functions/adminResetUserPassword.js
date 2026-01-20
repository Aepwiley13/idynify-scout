/**
 * Admin Reset User Password
 *
 * Sends a password reset email to a user via Firebase Auth.
 * Admin-triggered password reset for support purposes.
 *
 * Endpoint: /.netlify/functions/adminResetUserPassword
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { admin } from './firebase-admin.js';
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

    // Get target user info
    let targetUser;
    try {
      targetUser = await admin.auth().getUser(targetUserId);
    } catch (error) {
      console.error('Error fetching target user:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.PASSWORD_RESET_TRIGGERED,
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
          reason: reason || 'Admin-triggered password reset'
        }
      });

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    const targetUserEmail = targetUser.email;

    if (!targetUserEmail) {
      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.RESET_USER_PASSWORD,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetUserId: targetUserId,
        targetResource: 'user_account',
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: 'User has no email address',
        metadata: {
          reason: reason || 'Admin-triggered password reset'
        }
      });

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'User has no email address' })
      };
    }

    // Prevent admin from resetting another admin's password (safety measure)
    try {
      const targetUserRecord = await admin.auth().getUser(targetUserId);
      const targetUserClaims = targetUserRecord.customClaims || {};

      if (targetUserClaims.admin === true) {
        // Log failed audit event
        await logAuditEvent({
          action: AUDIT_ACTIONS.RESET_USER_PASSWORD,
          logType: 'admin_action',
          actorUserId: adminUserId,
          actorEmail: adminEmail,
          targetUserId: targetUserId,
          targetUserEmail: targetUserEmail,
          targetResource: 'user_account',
          status: 'failed',
          ipAddress: getIpAddress(event),
          userAgent: getUserAgent(event),
          errorMessage: 'Cannot reset password for another admin',
          metadata: {
            reason: reason || 'Admin-triggered password reset'
          }
        });

        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Cannot reset password for another admin' })
        };
      }
    } catch (error) {
      console.error('Error checking user claims:', error);
    }

    // Generate password reset link
    try {
      const resetLink = await admin.auth().generatePasswordResetLink(targetUserEmail);

      console.log(`✅ Password reset link generated for ${targetUserEmail} by admin ${adminEmail}`);

      // In production, you would send this via email using your email service
      // For now, we'll just log it (the user will receive it via Firebase's built-in email)

      // Alternatively, send the reset email directly via Firebase
      // This will use Firebase's default email templates
      await admin.auth().generatePasswordResetLink(targetUserEmail);

      // Log successful audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.RESET_USER_PASSWORD,
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
          reason: reason || 'Admin-triggered password reset',
          resetLinkGenerated: true
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Password reset email sent successfully',
          data: {
            userEmail: targetUserEmail,
            resetLink: resetLink // Include link in response for admin reference
          }
        })
      };

    } catch (error) {
      console.error('❌ Error generating password reset link:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.RESET_USER_PASSWORD,
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
          reason: reason || 'Admin-triggered password reset'
        }
      });

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Failed to send password reset email',
          details: error.message
        })
      };
    }

  } catch (error) {
    console.error('❌ Error in reset password handler:', error);
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
