/**
 * Admin Update User ICP
 *
 * Allows an admin to update a specific ICP profile for any user.
 * Uses Firebase Admin SDK to bypass Firestore security rules.
 * All changes are audit-logged with the admin's identity.
 *
 * Endpoint: /.netlify/functions/adminUpdateUserICP
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';

// Allowed ICP fields — guards against arbitrary field injection
const ALLOWED_ICP_FIELDS = [
  'name',
  'industries',
  'companySizes',
  'revenueRanges',
  'skipRevenue',
  'locations',
  'isNationwide',
  'targetTitles',
  'scoringWeights',
  'foundedAgeRange',
  'managedByBarry',
  'lookalikeSeed',
  'notes',
];

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
    const { targetUserId, icpId, icpData, reason } = JSON.parse(event.body || '{}');

    if (!authToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    if (!targetUserId || !icpId || !icpData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'targetUserId, icpId, and icpData are required' })
      };
    }

    if (!reason || reason.trim() === '') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'A reason is required for admin ICP updates' })
      };
    }

    // Verify token
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

    // Check admin access
    const isAdmin = await checkAdminAccess(adminUserId);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Admin access required' })
      };
    }

    // Get admin email for audit log
    const adminUser = await admin.auth().getUser(adminUserId);
    const adminEmail = adminUser.email;

    // Verify target user exists
    let targetUser;
    try {
      targetUser = await admin.auth().getUser(targetUserId);
    } catch (error) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Target user not found' })
      };
    }

    const targetUserEmail = targetUser.email;

    // Verify the ICP profile exists for this user
    const icpRef = db
      .collection('users')
      .doc(targetUserId)
      .collection('icpProfiles')
      .doc(icpId);

    const existingDoc = await icpRef.get();
    if (!existingDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'ICP profile not found for this user' })
      };
    }

    // Sanitize icpData — only allow known fields
    const sanitized = {};
    for (const field of ALLOWED_ICP_FIELDS) {
      if (icpData[field] !== undefined) {
        sanitized[field] = icpData[field];
      }
    }
    sanitized.updatedAt = new Date().toISOString();
    sanitized.adminLastUpdatedBy = adminUserId;
    sanitized.adminLastUpdatedAt = new Date().toISOString();

    // Write to Firestore via Admin SDK (bypasses security rules)
    await icpRef.set(sanitized, { merge: true });

    // If this is the first ICP profile, also sync to legacy companyProfile/current
    const allProfilesSnap = await db
      .collection('users')
      .doc(targetUserId)
      .collection('icpProfiles')
      .get();

    const allProfiles = allProfilesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    if (allProfiles.length > 0 && allProfiles[0].id === icpId) {
      await db
        .collection('users')
        .doc(targetUserId)
        .collection('companyProfile')
        .doc('current')
        .set(sanitized, { merge: true });
    }

    console.log(`✅ Admin ${adminEmail} updated ICP ${icpId} for user ${targetUserEmail}`);

    // Audit log
    await logAuditEvent({
      action: AUDIT_ACTIONS.ADMIN_UPDATE_USER_ICP,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetUserId,
      targetUserEmail,
      targetResource: 'icp_profiles',
      resourceId: icpId,
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        icpId,
        icpName: sanitized.name || existingDoc.data().name,
        reason: reason.trim(),
        fieldsUpdated: Object.keys(sanitized).filter(k => k !== 'updatedAt' && k !== 'adminLastUpdatedBy' && k !== 'adminLastUpdatedAt'),
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'ICP profile updated successfully',
        data: { icpId, targetUserEmail, updatedAt: sanitized.updatedAt }
      })
    };

  } catch (error) {
    console.error('❌ Error in adminUpdateUserICP:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
