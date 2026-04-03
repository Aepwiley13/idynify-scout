/**
 * Admin Remove Endorsement
 *
 * Soft-deletes an endorsement by setting its status to 'removed'.
 * The record is preserved for audit purposes.
 *
 * Endpoint: /.netlify/functions/adminRemoveEndorsement
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent } from './utils/auditLog.js';

const ENDORSEMENT_REMOVED = 'endorsement_removed';

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

    const isAdmin = await checkAdminAccess(adminUserId);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Admin access required' })
      };
    }

    const adminUser = await admin.auth().getUser(adminUserId);
    const adminEmail = adminUser.email;

    const { endorsementId, reason } = JSON.parse(event.body || '{}');

    if (!endorsementId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'endorsementId is required' })
      };
    }

    const endorsementRef = db.collection('endorsements').doc(endorsementId);
    const endorsementDoc = await endorsementRef.get();

    if (!endorsementDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Endorsement not found' })
      };
    }

    const endorsementData = endorsementDoc.data();

    if (endorsementData.status === 'removed') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Endorsement has already been removed' })
      };
    }

    const now = new Date();

    await endorsementRef.update({
      status: 'removed',
      removedAt: now,
      removedBy: adminUserId,
      removalReason: reason?.trim() || null
    });

    console.log(`✅ Endorsement removed: ${endorsementId} (${endorsementData.name}) by admin ${adminEmail}`);

    await logAuditEvent({
      action: ENDORSEMENT_REMOVED,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetResource: 'endorsement',
      resourceId: endorsementId,
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        endorseeName: endorsementData.name,
        removedAt: now.toISOString(),
        reason: reason?.trim() || null
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Endorsement removed successfully',
        data: {
          endorsementId,
          endorseeName: endorsementData.name,
          removedAt: now.toISOString()
        }
      })
    };

  } catch (error) {
    console.error('❌ Error removing endorsement:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
