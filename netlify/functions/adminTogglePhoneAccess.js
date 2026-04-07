/**
 * Admin Toggle Phone Access
 *
 * Grants or revokes phone number access for a specific user,
 * regardless of their subscription tier. Enforces a hard cap of 25
 * Starter users with manually granted phone access.
 *
 * Pro users always have phone access (set via Stripe webhook / adminUpdateUserTier).
 * This function is intended for granting access to Starter users only.
 *
 * Endpoint: /.netlify/functions/adminTogglePhoneAccess
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 * Body: { targetUserId: string, grant: boolean }
 * Returns: { success, grantedCount, maxGrants }
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent } from './utils/auditLog.js';

const MAX_STARTER_PHONE_GRANTS = 25;

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const authToken = extractAuthToken(event);
    const { targetUserId, grant } = JSON.parse(event.body || '{}');

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
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const adminUserId = decodedToken.uid;

    const isAdmin = await checkAdminAccess(adminUserId);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Admin access required' })
      };
    }

    if (!targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'targetUserId is required' })
      };
    }

    if (typeof grant !== 'boolean') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'grant must be a boolean' })
      };
    }

    const adminUser = await admin.auth().getUser(adminUserId);
    const adminEmail = adminUser.email;

    let targetUserEmail;
    try {
      const targetAuthUser = await admin.auth().getUser(targetUserId);
      targetUserEmail = targetAuthUser.email;
    } catch (error) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    const userDocRef = db.collection('users').doc(targetUserId);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'User document not found' })
      };
    }

    const userData = userDoc.data();
    const userTier = userData.subscriptionTier || 'starter';
    const currentPhoneAccess = userData.features?.mobilePhone === true;

    // If granting, enforce the cap on Starter users only
    if (grant && userTier === 'starter') {
      // Count how many Starter users already have phone access granted
      const snapshot = await db.collection('users')
        .where('subscriptionTier', '==', 'starter')
        .where('features.mobilePhone', '==', true)
        .get();

      const currentCount = snapshot.size;

      // Don't count this user if they already have access (toggling on again)
      const alreadyGranted = currentPhoneAccess;
      const effectiveCount = alreadyGranted ? currentCount : currentCount;

      if (!alreadyGranted && effectiveCount >= MAX_STARTER_PHONE_GRANTS) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Phone access cap reached. Maximum ${MAX_STARTER_PHONE_GRANTS} Starter users can have phone access.`,
            grantedCount: currentCount,
            maxGrants: MAX_STARTER_PHONE_GRANTS
          })
        };
      }
    }

    // Apply the change
    await userDocRef.set({
      features: {
        mobilePhone: grant
      },
      updatedAt: new Date()
    }, { merge: true });

    // Re-count after the update for accurate response
    const updatedSnapshot = await db.collection('users')
      .where('subscriptionTier', '==', 'starter')
      .where('features.mobilePhone', '==', true)
      .get();
    const grantedCount = updatedSnapshot.size;

    await logAuditEvent({
      action: grant ? 'phone_access_granted' : 'phone_access_revoked',
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetUserId,
      targetUserEmail,
      targetResource: 'user_account',
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        grant,
        userTier,
        grantedCount,
        maxGrants: MAX_STARTER_PHONE_GRANTS
      }
    });

    console.log(`✅ Phone access ${grant ? 'granted' : 'revoked'}: ${targetUserEmail} by admin ${adminEmail} (${grantedCount}/${MAX_STARTER_PHONE_GRANTS})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Phone access ${grant ? 'granted' : 'revoked'} for ${targetUserEmail}`,
        data: {
          userId: targetUserId,
          grant,
          grantedCount,
          maxGrants: MAX_STARTER_PHONE_GRANTS
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in adminTogglePhoneAccess:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
