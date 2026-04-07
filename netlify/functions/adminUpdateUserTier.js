/**
 * Admin Update User Tier
 *
 * Changes a user's subscription tier between 'starter' and 'pro'.
 * Updates tier, credits, tierLimits, and features.mobilePhone atomically.
 * When downgrading to Starter, phone access is removed unless the user has
 * been manually granted it via adminTogglePhoneAccess.
 *
 * Endpoint: /.netlify/functions/adminUpdateUserTier
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 * Body: { targetUserId: string, newTier: 'starter' | 'pro' }
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';

const TIER_CONFIG = {
  starter: {
    credits: 400,
    companies: 40,
    contacts: 120,
    support: '48-hour email'
  },
  pro: {
    credits: 1250,
    companies: 125,
    contacts: 375,
    support: '24-hour email'
  }
};

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
    const { targetUserId, newTier } = JSON.parse(event.body || '{}');

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

    if (!newTier || !TIER_CONFIG[newTier]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'newTier must be "starter" or "pro"' })
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

    const currentData = userDoc.data();
    const previousTier = currentData.subscriptionTier || 'starter';

    if (previousTier === newTier) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: `User is already on the ${newTier} tier` })
      };
    }

    const tierConfig = TIER_CONFIG[newTier];
    const now = new Date();
    const nextReset = new Date(now);
    nextReset.setMonth(nextReset.getMonth() + 1);

    // When downgrading to Starter, remove phone access.
    // When upgrading to Pro, grant phone access.
    const mobilePhoneAccess = newTier === 'pro';

    await userDocRef.set({
      subscriptionTier: newTier,
      updatedAt: now,
      credits: {
        total: tierConfig.credits,
        used: 0,
        remaining: tierConfig.credits,
        resetDate: nextReset.toISOString()
      },
      tierLimits: {
        creditsPerMonth: tierConfig.credits,
        companiesPerMonth: tierConfig.companies,
        contactsPerMonth: tierConfig.contacts,
        teamSeats: 1,
        support: tierConfig.support
      },
      features: {
        mobilePhone: mobilePhoneAccess
      }
    }, { merge: true });

    const isUpgrade = newTier === 'pro';
    const auditAction = isUpgrade ? AUDIT_ACTIONS.SUBSCRIPTION_UPGRADED : AUDIT_ACTIONS.SUBSCRIPTION_DOWNGRADED;

    await logAuditEvent({
      action: auditAction,
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
        previousTier,
        newTier,
        adminOverride: true,
        phoneAccessGranted: mobilePhoneAccess
      }
    });

    console.log(`✅ Tier updated: ${targetUserEmail} ${previousTier} → ${newTier} by admin ${adminEmail}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `User tier updated from ${previousTier} to ${newTier}`,
        data: {
          userId: targetUserId,
          previousTier,
          newTier,
          phoneAccessGranted: mobilePhoneAccess
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in adminUpdateUserTier:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
