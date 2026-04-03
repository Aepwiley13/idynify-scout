/**
 * Admin Get Endorsements
 *
 * Returns all endorsements from the endorsements collection for admin review.
 * Supports optional status filter (active | removed | all).
 *
 * Endpoint: /.netlify/functions/adminGetEndorsements
 * Method: GET
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
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
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid authentication token' })
      };
    }

    const isAdmin = await checkAdminAccess(decodedToken.uid);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Admin access required' })
      };
    }

    const statusFilter = event.queryStringParameters?.status || 'all';

    let query = db.collection('endorsements').orderBy('createdAt', 'desc');
    if (statusFilter === 'active' || statusFilter === 'removed') {
      query = query.where('status', '==', statusFilter);
    }

    const snapshot = await query.get();

    const endorsements = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || '',
        tagline: data.tagline || '',
        location: data.location || '',
        photoUrl: data.photoUrl || null,
        campaignId: data.campaignId || null,
        status: data.status || 'active',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        removedAt: data.removedAt?.toDate?.()?.toISOString() || null,
        removedBy: data.removedBy || null,
        removalReason: data.removalReason || null
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        endorsements,
        total: endorsements.length
      })
    };

  } catch (error) {
    console.error('❌ Error fetching endorsements:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
