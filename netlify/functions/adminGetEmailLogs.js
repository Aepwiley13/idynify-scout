/**
 * Admin Get Email Logs
 *
 * Fetches paginated email logs with filtering, search, and statistics.
 * Supports filtering by email type, status, user, recipient, and date range.
 *
 * Endpoint: /.netlify/functions/adminGetEmailLogs
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';
import { EMAIL_STATUS } from './utils/emailLog.js';

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

    // Log admin viewing email logs
    await logAuditEvent({
      action: AUDIT_ACTIONS.VIEW_EMAIL_LOGS,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetResource: 'email_logs',
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
    let query = db.collection('emailLogs');

    // Apply filters
    if (filters) {
      // Filter by email type
      if (filters.emailType && filters.emailType !== 'all') {
        query = query.where('type', '==', filters.emailType);
      }

      // Filter by status
      if (filters.status && filters.status !== 'all') {
        query = query.where('status', '==', filters.status);
      }

      // Filter by user ID
      if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
      }

      // Filter by recipient email
      if (filters.recipientEmail) {
        query = query.where('recipient', '==', filters.recipientEmail.toLowerCase());
      }

      // Date range filtering - use queuedAt
      if (filters.dateRange) {
        if (filters.dateRange.start) {
          const startDate = new Date(filters.dateRange.start);
          query = query.where('queuedAt', '>=', startDate);
        }
        if (filters.dateRange.end) {
          const endDate = new Date(filters.dateRange.end);
          query = query.where('queuedAt', '<=', endDate);
        }
      }
    }

    // Apply sorting
    const sortField = sort?.field || 'queuedAt';
    const sortDirection = sort?.direction || 'desc';
    query = query.orderBy(sortField, sortDirection);

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    // Fetch logs with limit + offset + 1 to check if there are more pages
    const snapshot = await query.limit(pageSize + offset + 1).get();

    let allLogs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      allLogs.push({
        emailId: doc.id,
        ...data,
        // Convert Firestore Timestamps to ISO strings
        queuedAt: data.queuedAt?.toDate ? data.queuedAt.toDate().toISOString() : data.queuedAt,
        sentAt: data.sentAt?.toDate ? data.sentAt.toDate().toISOString() : data.sentAt,
        deliveredAt: data.deliveredAt?.toDate ? data.deliveredAt.toDate().toISOString() : data.deliveredAt,
        openedAt: data.openedAt?.toDate ? data.openedAt.toDate().toISOString() : data.openedAt,
        lastOpenedAt: data.lastOpenedAt?.toDate ? data.lastOpenedAt.toDate().toISOString() : data.lastOpenedAt,
        clickedAt: data.clickedAt?.toDate ? data.clickedAt.toDate().toISOString() : data.clickedAt,
        bouncedAt: data.bouncedAt?.toDate ? data.bouncedAt.toDate().toISOString() : data.bouncedAt,
        failedAt: data.failedAt?.toDate ? data.failedAt.toDate().toISOString() : data.failedAt,
        nextRetryAt: data.nextRetryAt?.toDate ? data.nextRetryAt.toDate().toISOString() : data.nextRetryAt
      });
    });

    // Search filter (search in recipient email or subject)
    if (search) {
      const searchLower = search.toLowerCase();
      allLogs = allLogs.filter(log => {
        return (
          (log.recipient && log.recipient.toLowerCase().includes(searchLower)) ||
          (log.subject && log.subject.toLowerCase().includes(searchLower)) ||
          (log.userId && log.userId.includes(search))
        );
      });
    }

    // Calculate statistics from all logs (before pagination)
    const stats = calculateEmailStats(allLogs);

    // Calculate pagination
    const totalCount = allLogs.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Slice to get current page
    const paginatedLogs = allLogs.slice(offset, offset + pageSize);

    // Remove email content from response (reduce payload size)
    const logsWithoutContent = paginatedLogs.map(log => {
      const { htmlContent, textContent, providerResponse, ...logWithoutContent } = log;
      return logWithoutContent;
    });

    // Return response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          logs: logsWithoutContent,
          stats: stats,
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
    console.error('❌ Error fetching email logs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch email logs',
        details: error.message
      })
    };
  }
};

/**
 * Calculate email statistics from logs
 */
function calculateEmailStats(logs) {
  const totalEmails = logs.length;

  if (totalEmails === 0) {
    return {
      totalEmails: 0,
      totalSent: 0,
      totalDelivered: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalBounced: 0,
      totalFailed: 0,
      totalComplained: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      bounceRate: 0,
      complaintRate: 0
    };
  }

  const totalSent = logs.filter(log =>
    [EMAIL_STATUS.SENT, EMAIL_STATUS.DELIVERED, EMAIL_STATUS.OPENED, EMAIL_STATUS.CLICKED].includes(log.status)
  ).length;

  const totalDelivered = logs.filter(log =>
    [EMAIL_STATUS.DELIVERED, EMAIL_STATUS.OPENED, EMAIL_STATUS.CLICKED].includes(log.status)
  ).length;

  const totalOpened = logs.filter(log =>
    [EMAIL_STATUS.OPENED, EMAIL_STATUS.CLICKED].includes(log.status)
  ).length;

  const totalClicked = logs.filter(log => log.status === EMAIL_STATUS.CLICKED).length;
  const totalBounced = logs.filter(log => log.status === EMAIL_STATUS.BOUNCED).length;
  const totalFailed = logs.filter(log => log.status === EMAIL_STATUS.FAILED).length;
  const totalComplained = logs.filter(log => log.status === EMAIL_STATUS.COMPLAINED).length;

  // Calculate rates (as percentages)
  const deliveryRate = totalSent > 0 ? ((totalDelivered / totalSent) * 100).toFixed(2) : 0;
  const openRate = totalDelivered > 0 ? ((totalOpened / totalDelivered) * 100).toFixed(2) : 0;
  const clickRate = totalDelivered > 0 ? ((totalClicked / totalDelivered) * 100).toFixed(2) : 0;
  const bounceRate = totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(2) : 0;
  const complaintRate = totalDelivered > 0 ? ((totalComplained / totalDelivered) * 100).toFixed(2) : 0;

  return {
    totalEmails,
    totalSent,
    totalDelivered,
    totalOpened,
    totalClicked,
    totalBounced,
    totalFailed,
    totalComplained,
    deliveryRate: parseFloat(deliveryRate),
    openRate: parseFloat(openRate),
    clickRate: parseFloat(clickRate),
    bounceRate: parseFloat(bounceRate),
    complaintRate: parseFloat(complaintRate)
  };
}
