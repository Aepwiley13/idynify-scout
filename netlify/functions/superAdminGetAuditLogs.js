/**
 * Super Admin - Get Audit Logs
 *
 * Returns audit log entries with enhanced filtering for super admin use:
 * by tenant (targetUserId), actor (admin), action type, time range.
 *
 * Endpoint: /.netlify/functions/superAdminGetAuditLogs
 * Method: POST
 * Auth: Firebase auth token + super_admin role + global_read permission
 *
 * Body:
 *   {
 *     tenantUserId?: string,   // Filter to specific tenant
 *     actorUserId?: string,    // Filter to specific admin actor
 *     action?: string,         // Filter by action string
 *     logType?: string,        // 'admin_action' | 'user_action' | 'system_event'
 *     startDate?: string,      // ISO date string
 *     endDate?: string,        // ISO date string
 *     limit?: number           // Max 200, default 100
 *   }
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

    const isSuperAdmin = await checkSuperAdminAccess(actorUserId);
    if (!isSuperAdmin) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Super admin access required' }) };
    }

    const hasReadPermission = await hasSuperAdminPermission(actorUserId, SUPER_ADMIN_PERMISSIONS.GLOBAL_READ);
    if (!hasReadPermission) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'global_read permission required' }) };
    }

    const {
      tenantUserId,
      actorUserId: filterActorId,
      action,
      logType,
      startDate,
      endDate,
      limit: requestedLimit = 100
    } = JSON.parse(event.body || '{}');

    const limit = Math.min(Math.max(1, requestedLimit), 200);

    // Build Firestore query — start with base collection
    let query = db.collection('adminAuditLogs').orderBy('timestamp', 'desc');

    // Apply filters (Firestore requires composite indexes for multi-field queries)
    if (tenantUserId) {
      query = query.where('targetUserId', '==', tenantUserId);
    } else if (filterActorId) {
      query = query.where('actorUserId', '==', filterActorId);
    } else if (logType) {
      query = query.where('logType', '==', logType);
    }

    if (startDate) {
      query = query.where('timestamp', '>=', new Date(startDate));
    }
    if (endDate) {
      query = query.where('timestamp', '<=', new Date(endDate));
    }

    query = query.limit(limit);

    const snapshot = await query.get();

    const logs = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      const entry = {
        id: doc.id,
        action: d.action,
        logType: d.logType,
        actorUserId: d.actorUserId,
        actorEmail: d.actorEmail,
        targetUserId: d.targetUserId,
        targetUserEmail: d.targetUserEmail,
        targetResource: d.targetResource,
        resourceId: d.resourceId,
        status: d.status,
        ipAddress: d.ipAddress,
        userAgent: d.userAgent,
        metadata: d.metadata,
        errorMessage: d.errorMessage,
        timestamp: d.timestamp?.toDate ? d.timestamp.toDate().toISOString() : d.timestamp
      };

      // Post-filter by action string (Firestore doesn't support substring search)
      if (action && !entry.action?.includes(action)) return;

      // Post-filter by actor if we filtered by tenant above
      if (filterActorId && tenantUserId && entry.actorUserId !== filterActorId) return;

      // Post-filter by logType if we filtered by something else above
      if (logType && entry.logType !== logType) return;

      logs.push(entry);
    });

    // Log meta-audit for viewing audit logs
    const actorAuthUser = await admin.auth().getUser(actorUserId);
    await logAuditEvent({
      action: 'super_admin_view_audit_logs',
      logType: 'admin_action',
      actorUserId,
      actorEmail: actorAuthUser.email,
      targetResource: 'audit_logs',
      status: 'success',
      ipAddress,
      userAgent,
      metadata: { filters: { tenantUserId, filterActorId, action, logType, startDate, endDate }, resultsCount: logs.length }
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, logs, total: logs.length })
    };

  } catch (error) {
    console.error('❌ superAdminGetAuditLogs error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: error.message })
    };
  }
};
