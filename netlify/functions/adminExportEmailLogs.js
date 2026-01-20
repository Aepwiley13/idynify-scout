/**
 * Admin Export Email Logs
 *
 * Generates CSV or JSON export of email logs with filtering.
 * Maximum 50,000 records per export.
 *
 * Endpoint: /.netlify/functions/adminExportEmailLogs
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
    const { authToken, format, dateRange, filters } = JSON.parse(event.body);

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

    // Validate format
    const exportFormat = format || 'csv';
    if (!['csv', 'json'].includes(exportFormat)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Format must be csv or json' })
      };
    }

    // Build Firestore query
    let query = db.collection('emailLogs');

    // Apply date range (required for exports)
    if (!dateRange || !dateRange.start || !dateRange.end) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Date range is required for exports' })
      };
    }

    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);

    // Check that date range is not more than 365 days
    const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
    if (daysDiff > 365) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Date range cannot exceed 365 days' })
      };
    }

    query = query.where('queuedAt', '>=', startDate).where('queuedAt', '<=', endDate);

    // Apply filters
    if (filters) {
      if (filters.emailType && filters.emailType !== 'all') {
        query = query.where('type', '==', filters.emailType);
      }
      if (filters.status && filters.status !== 'all') {
        query = query.where('status', '==', filters.status);
      }
      if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
      }
      if (filters.recipientEmail) {
        query = query.where('recipient', '==', filters.recipientEmail.toLowerCase());
      }
    }

    // Order by queuedAt
    query = query.orderBy('queuedAt', 'desc');

    // Limit to 50,000 records
    query = query.limit(50000);

    // Fetch logs
    const snapshot = await query.get();

    let logs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      logs.push({
        emailId: doc.id,
        ...data,
        queuedAt: data.queuedAt?.toDate ? data.queuedAt.toDate().toISOString() : data.queuedAt,
        sentAt: data.sentAt?.toDate ? data.sentAt.toDate().toISOString() : data.sentAt,
        deliveredAt: data.deliveredAt?.toDate ? data.deliveredAt.toDate().toISOString() : data.deliveredAt,
        openedAt: data.openedAt?.toDate ? data.openedAt.toDate().toISOString() : data.openedAt,
        lastOpenedAt: data.lastOpenedAt?.toDate ? data.lastOpenedAt.toDate().toISOString() : data.lastOpenedAt,
        clickedAt: data.clickedAt?.toDate ? data.clickedAt.toDate().toISOString() : data.clickedAt,
        bouncedAt: data.bouncedAt?.toDate ? data.bouncedAt.toDate().toISOString() : data.bouncedAt,
        failedAt: data.failedAt?.toDate ? data.failedAt.toDate().toISOString() : data.failedAt
      });
    });

    // Log export action
    await logAuditEvent({
      action: AUDIT_ACTIONS.EXPORT_USER_DATA,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetResource: 'email_logs',
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        format: exportFormat,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        recordCount: logs.length
      }
    });

    // Generate export data
    let exportData;
    let contentType;
    let filename;

    if (exportFormat === 'csv') {
      // Generate CSV
      const rows = [];

      // CSV headers
      const csvHeaders = [
        'Email ID',
        'Queued At',
        'Type',
        'Recipient',
        'User ID',
        'Subject',
        'From',
        'Status',
        'Sent At',
        'Delivered At',
        'Opened At',
        'Open Count',
        'Clicked At',
        'Click Count',
        'Bounced At',
        'Bounce Type',
        'Failed At',
        'Failure Reason',
        'Retry Count',
        'Provider Email ID'
      ];

      rows.push(csvHeaders.join(','));

      // CSV data rows
      logs.forEach(log => {
        const row = [
          `"${log.emailId || ''}"`,
          `"${log.queuedAt || ''}"`,
          `"${log.type || ''}"`,
          `"${log.recipient || ''}"`,
          `"${log.userId || ''}"`,
          `"${(log.subject || '').replace(/"/g, '""')}"`, // Escape quotes
          `"${log.from || ''}"`,
          `"${log.status || ''}"`,
          `"${log.sentAt || ''}"`,
          `"${log.deliveredAt || ''}"`,
          `"${log.openedAt || ''}"`,
          `"${log.openCount || 0}"`,
          `"${log.clickedAt || ''}"`,
          `"${log.clickCount || 0}"`,
          `"${log.bouncedAt || ''}"`,
          `"${log.bounceType || ''}"`,
          `"${log.failedAt || ''}"`,
          `"${(log.failureReason || '').replace(/"/g, '""')}"`,
          `"${log.retryCount || 0}"`,
          `"${log.providerEmailId || ''}"`
        ];

        rows.push(row.join(','));
      });

      exportData = rows.join('\n');
      contentType = 'text/csv';
      filename = `email_logs_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.csv`;

    } else {
      // Generate JSON (without email content to reduce size)
      const logsWithoutContent = logs.map(log => {
        const { htmlContent, textContent, providerResponse, ...logWithoutContent } = log;
        return logWithoutContent;
      });

      exportData = JSON.stringify({
        exportDate: new Date().toISOString(),
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        recordCount: logsWithoutContent.length,
        logs: logsWithoutContent
      }, null, 2);
      contentType = 'application/json';
      filename = `email_logs_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.json`;
    }

    // Return export data
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`
      },
      body: exportData
    };

  } catch (error) {
    console.error('❌ Error exporting email logs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to export email logs',
        details: error.message
      })
    };
  }
};
