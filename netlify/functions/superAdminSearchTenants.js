/**
 * Super Admin - Search Tenants
 *
 * Searches across all tenant accounts by company name, user email, or account ID.
 *
 * Endpoint: /.netlify/functions/superAdminSearchTenants
 * Method: POST
 * Auth: Requires Firebase auth token + super_admin role + global_read permission
 *
 * Body:
 *   { query: string, searchType: 'email'|'accountId'|'all' }
 */

import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkSuperAdminAccess, hasSuperAdminPermission, SUPER_ADMIN_PERMISSIONS } from './utils/superAdminAuth.js';
import { logAuditEvent, getIpAddress, getUserAgent } from './utils/auditLog.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://idynify.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const ipAddress = getIpAddress(event);
  const userAgent = getUserAgent(event);

  try {
    const authToken = extractAuthToken(event);
    if (!authToken) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Authentication required' }) };
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authToken);
    } catch {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Invalid authentication token' }) };
    }

    const actorUserId = decodedToken.uid;

    // Verify super admin access
    const isSuperAdmin = await checkSuperAdminAccess(actorUserId);
    if (!isSuperAdmin) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Super admin access required' }) };
    }

    const hasReadPermission = await hasSuperAdminPermission(actorUserId, SUPER_ADMIN_PERMISSIONS.GLOBAL_READ);
    if (!hasReadPermission) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'global_read permission required' }) };
    }

    const { query = '', searchType = 'all' } = JSON.parse(event.body || '{}');

    if (!query || query.trim().length < 2) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Query must be at least 2 characters' }) };
    }

    const q = query.trim().toLowerCase();
    const results = [];

    // Fetch all users from Auth and Firestore
    // For production scale, this would use Algolia or a search index
    const listResult = await admin.auth().listUsers(1000);
    const authUsers = listResult.users;

    // Build lookup from Firestore
    const usersSnapshot = await db.collection('users').get();
    const firestoreMap = {};
    usersSnapshot.forEach(doc => {
      firestoreMap[doc.id] = doc.data();
    });

    for (const authUser of authUsers) {
      const uid = authUser.uid;
      const email = (authUser.email || '').toLowerCase();
      const fsData = firestoreMap[uid] || {};

      // Match by account ID (exact)
      const matchById = searchType === 'all' || searchType === 'accountId'
        ? uid.toLowerCase().includes(q)
        : false;

      // Match by email
      const matchByEmail = searchType === 'all' || searchType === 'email'
        ? email.includes(q)
        : false;

      if (matchById || matchByEmail) {
        // Count subcollections for health summary
        const companyCount = await db.collection('users').doc(uid).collection('companies').count().get();
        const contactCount = await db.collection('users').doc(uid).collection('contacts').count().get();

        results.push({
          uid,
          email: authUser.email || '',
          displayName: authUser.displayName || '',
          role: fsData.role || 'user',
          subscription: fsData.subscriptionTier || fsData.selectedTier || null,
          hasCompletedPayment: fsData.hasCompletedPayment || false,
          status: fsData.status || 'unknown',
          credits: fsData.credits ?? null,
          createdAt: authUser.metadata?.creationTime || null,
          lastSignIn: authUser.metadata?.lastSignInTime || null,
          companiesCount: companyCount.data().count,
          contactsCount: contactCount.data().count
        });
      }

      if (results.length >= 50) break; // Cap search results
    }

    // Log the search action
    const actorUser = await admin.auth().getUser(actorUserId);
    await logAuditEvent({
      action: 'super_admin_search_tenants',
      logType: 'admin_action',
      actorUserId,
      actorEmail: actorUser.email,
      targetResource: 'tenant_search',
      status: 'success',
      ipAddress,
      userAgent,
      metadata: { query, searchType, resultsCount: results.length }
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, results, total: results.length })
    };

  } catch (error) {
    console.error('❌ superAdminSearchTenants error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
