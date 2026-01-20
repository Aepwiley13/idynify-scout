/**
 * Admin Get Audit Logs
 *
 * Fetches paginated audit logs with filtering, search, and sorting.
 * Supports filtering by log type, action, actor, target user, date range, and status.
 *
 * Endpoint: /.netlify/functions/adminGetAuditLogs
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
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
    const { authToken, pagination, filters, search, sort } = JSON.parse(event.body);

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

    // Log admin viewing audit logs
    await logAuditEvent({
      action: AUDIT_ACTIONS.VIEW_AUDIT_LOGS,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetResource: 'audit_logs',
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        filters: filters || {},
        search: search || null
      }
    });

    // Parse pagination parameters
    const page = pagination?.page || 1;
    const pageSize = Math.min(pagination?.pageSize || 100, 250); // Max 250 per page

    // Build Firestore query
    let query = db.collection('adminAuditLogs');

    // Apply filters
    if (filters) {
      // Filter by log type
      if (filters.logType && filters.logType !== 'all') {
        query = query.where('logType', '==', filters.logType);
      }

      // Filter by action types (array)
      if (filters.actionTypes && Array.isArray(filters.actionTypes) && filters.actionTypes.length > 0) {
        // Firestore doesn't support array-contains-any with other where clauses easily
        // We'll filter in memory after fetching
      }

      // Filter by actor user ID
      if (filters.actorUserId) {
        query = query.where('actorUserId', '==', filters.actorUserId);
      }

      // Filter by target user ID
      if (filters.targetUserId) {
        query = query.where('targetUserId', '==', filters.targetUserId);
      }

      // Filter by status
      if (filters.status && filters.status !== 'all') {
        query = query.where('status', '==', filters.status);
      }

      // Filter by IP address
      if (filters.ipAddress) {
        query = query.where('ipAddress', '==', filters.ipAddress);
      }

      // Date range filtering - use timestamp
      if (filters.dateRange) {
        if (filters.dateRange.start) {
          const startDate = new Date(filters.dateRange.start);
          query = query.where('timestamp', '>=', startDate);
        }
        if (filters.dateRange.end) {
          const endDate = new Date(filters.dateRange.end);
          query = query.where('timestamp', '<=', endDate);
        }
      }
    }

    // Apply sorting
    const sortField = sort?.field || 'timestamp';
    const sortDirection = sort?.direction || 'desc';
    query = query.orderBy(sortField, sortDirection);

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    // Fetch logs with limit + 1 to check if there are more pages
    const snapshot = await query.limit(pageSize + offset + 1).get();

    let allLogs = [];
    snapshot.forEach(doc => {
      allLogs.push({
        logId: doc.id,
        ...doc.data(),
        // Convert Firestore Timestamp to ISO string
        timestamp: doc.data().timestamp?.toDate ? doc.data().timestamp.toDate().toISOString() : doc.data().timestamp
      });
    });

    // Apply in-memory filters
    // Filter by action types (if specified)
    if (filters?.actionTypes && Array.isArray(filters.actionTypes) && filters.actionTypes.length > 0) {
      allLogs = allLogs.filter(log => filters.actionTypes.includes(log.action));
    }

    // Search filter (search in actor email, target email, or user IDs)
    if (search) {
      const searchLower = search.toLowerCase();
      allLogs = allLogs.filter(log => {
        return (
          (log.actorEmail && log.actorEmail.toLowerCase().includes(searchLower)) ||
          (log.targetUserEmail && log.targetUserEmail.toLowerCase().includes(searchLower)) ||
          (log.actorUserId && log.actorUserId.includes(search)) ||
          (log.targetUserId && log.targetUserId.includes(search))
        );
      });
    }

    // Calculate pagination
    const totalCount = allLogs.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Slice to get current page
    const paginatedLogs = allLogs.slice(offset, offset + pageSize);

    // Return response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          logs: paginatedLogs,
          pagination: {
            page,
            pageSize,
            totalCount,
            totalPages,
            hasNextPage,
            hasPreviousPage
          }
        }
      })
    };

  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch audit logs',
        details: error.message
      })
    };
  }
};
