/**
 * Admin Get User ICP Profiles
 *
 * Fetches all ICP profiles for a given user via Firebase Admin SDK.
 * Used by the admin ICP editor to load a user's profiles without being
 * blocked by Firestore security rules.
 *
 * Endpoint: /.netlify/functions/adminGetUserICPProfiles
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';

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
    const { targetUserId } = JSON.parse(event.body || '{}');

    if (!authToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication required' })
      };
    }

    if (!targetUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'targetUserId is required' })
      };
    }

    // Verify token
    let decodedToken;
    try {
      const { admin } = await import('./firebase-admin.js');
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

    // Fetch ICP profiles from subcollection
    const profilesSnap = await db
      .collection('users')
      .doc(targetUserId)
      .collection('icpProfiles')
      .get();

    const icpProfiles = profilesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Sort by createdAt
    icpProfiles.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    // Log audit event
    await logAuditEvent({
      action: AUDIT_ACTIONS.ADMIN_VIEW_USER_ICP,
      logType: 'admin_action',
      actorUserId: adminUserId,
      targetUserId,
      targetResource: 'icp_profiles',
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: { profileCount: icpProfiles.length }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, icpProfiles })
    };

  } catch (error) {
    console.error('❌ Error in adminGetUserICPProfiles:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
