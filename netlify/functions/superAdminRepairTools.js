/**
 * Super Admin - Repair Tools
 *
 * Executes repair/maintenance operations on tenant accounts without
 * requiring an engineering deploy.
 *
 * Supported operations:
 *   reindex_companies       - Re-index company records
 *   resync_crm              - Reset and resync CRM connection tokens
 *   reset_permissions       - Clear user permission overrides + force re-auth
 *   flush_cache             - Clear cached data and rebuild search indexes
 *
 * Endpoint: /.netlify/functions/superAdminRepairTools
 * Method: POST
 * Auth: Requires Firebase auth token + super_admin role + system_repair permission
 *
 * Body: { tenantUserId: string, operation: string, reason?: string }
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

const VALID_OPERATIONS = ['reindex_companies', 'resync_crm', 'reset_permissions', 'flush_cache'];

/**
 * Re-index all companies for a tenant
 * Stamps each company document with a reindex_requested_at flag so background
 * workers can pick up and rebuild their derived indexes.
 */
async function reindexCompanies(tenantUserId) {
  const companiesSnap = await db.collection('users').doc(tenantUserId).collection('companies').get();
  if (companiesSnap.empty) return { processed: 0, message: 'No companies found' };

  const batch = db.batch();
  const now = new Date();
  let count = 0;

  companiesSnap.forEach(doc => {
    batch.update(doc.ref, {
      reindex_requested_at: now,
      reindex_status: 'pending'
    });
    count++;
  });

  await batch.commit();
  return { processed: count, message: `Queued ${count} companies for re-indexing` };
}

/**
 * Resync CRM connection
 * Clears existing OAuth tokens so the user is prompted to reconnect their CRM.
 */
async function resyncCrm(tenantUserId) {
  const userRef = db.collection('users').doc(tenantUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error('User not found');

  // Clear CRM OAuth tokens — they will need to re-authenticate
  await userRef.update({
    crmConnected: false,
    hubspot_access_token: admin.firestore.FieldValue.delete(),
    hubspot_refresh_token: admin.firestore.FieldValue.delete(),
    salesforce_access_token: admin.firestore.FieldValue.delete(),
    salesforce_refresh_token: admin.firestore.FieldValue.delete(),
    crm_resync_requested_at: new Date()
  });

  return { message: 'CRM tokens cleared — user will be prompted to reconnect' };
}

/**
 * Reset user permissions and force re-authentication
 * Revokes Firebase refresh tokens so the user must sign in again.
 */
async function resetPermissions(tenantUserId) {
  // Revoke all Firebase refresh tokens — forces user to re-login
  await admin.auth().revokeRefreshTokens(tenantUserId);

  // Clear any permission overrides in Firestore
  const userRef = db.collection('users').doc(tenantUserId);
  await userRef.update({
    permissions: admin.firestore.FieldValue.delete(),
    permissionsOverride: admin.firestore.FieldValue.delete(),
    permissions_reset_at: new Date()
  });

  return { message: 'Permissions reset and refresh tokens revoked — user must sign in again' };
}

/**
 * Flush cache and rebuild search indexes
 * Clears any stale cached/denormalized data fields and marks account for rebuild.
 */
async function flushCache(tenantUserId) {
  const userRef = db.collection('users').doc(tenantUserId);
  await userRef.update({
    cache_flushed_at: new Date(),
    search_index_status: 'rebuild_pending',
    // Clear any denormalized stats that may be stale
    _cachedStats: admin.firestore.FieldValue.delete(),
    _lastIndexed: admin.firestore.FieldValue.delete()
  });

  // Mark all contacts for re-indexing
  const contactsSnap = await db.collection('users').doc(tenantUserId).collection('contacts').limit(500).get();
  if (!contactsSnap.empty) {
    const batch = db.batch();
    contactsSnap.forEach(doc => {
      batch.update(doc.ref, { _searchIndexStatus: 'pending' });
    });
    await batch.commit();
  }

  return {
    message: 'Cache flushed and search indexes queued for rebuild',
    contactsQueued: contactsSnap.size
  };
}

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

    const isSuperAdmin = await checkSuperAdminAccess(actorUserId);
    if (!isSuperAdmin) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Super admin access required' }) };
    }

    const hasRepairPermission = await hasSuperAdminPermission(actorUserId, SUPER_ADMIN_PERMISSIONS.SYSTEM_REPAIR);
    if (!hasRepairPermission) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'system_repair permission required' }) };
    }

    const { tenantUserId, operation, reason = 'Super admin repair operation' } = JSON.parse(event.body || '{}');

    if (!tenantUserId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'tenantUserId is required' }) };
    }

    if (!operation || !VALID_OPERATIONS.includes(operation)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: `Invalid operation. Must be one of: ${VALID_OPERATIONS.join(', ')}` })
      };
    }

    // Get actor info for audit log
    const actorAuthUser = await admin.auth().getUser(actorUserId);

    // Get target user info
    let targetEmail = '';
    try {
      const targetAuth = await admin.auth().getUser(tenantUserId);
      targetEmail = targetAuth.email || '';
    } catch { /* user may not exist in auth */ }

    let result;
    let auditStatus = 'success';
    let auditError = null;

    try {
      switch (operation) {
        case 'reindex_companies':
          result = await reindexCompanies(tenantUserId);
          break;
        case 'resync_crm':
          result = await resyncCrm(tenantUserId);
          break;
        case 'reset_permissions':
          result = await resetPermissions(tenantUserId);
          break;
        case 'flush_cache':
          result = await flushCache(tenantUserId);
          break;
      }
    } catch (opError) {
      auditStatus = 'failed';
      auditError = opError.message;
      throw opError;
    } finally {
      await logAuditEvent({
        action: `super_admin_repair_${operation}`,
        logType: 'admin_action',
        actorUserId,
        actorEmail: actorAuthUser.email,
        targetUserId: tenantUserId,
        targetUserEmail: targetEmail,
        targetResource: 'tenant_account',
        resourceId: tenantUserId,
        status: auditStatus,
        ipAddress,
        userAgent,
        errorMessage: auditError,
        metadata: { operation, reason, result }
      });
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, operation, result })
    };

  } catch (error) {
    console.error('❌ superAdminRepairTools error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: error.message || 'Internal server error' })
    };
  }
};
