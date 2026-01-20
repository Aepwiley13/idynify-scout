/**
 * Admin Export Audit Logs
 *
 * Generates CSV or JSON export of audit logs with filtering.
 * Maximum 50,000 records per export.
 *
 * Endpoint: /.netlify/functions/adminExportAuditLogs
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
    const { authToken, format, dateRange, filters, includeMetadata } = JSON.parse(event.body);

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
    let query = db.collection('adminAuditLogs');

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

    query = query.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);

    // Apply filters
    if (filters) {
      if (filters.logType && filters.logType !== 'all') {
        query = query.where('logType', '==', filters.logType);
      }
      if (filters.actorUserId) {
        query = query.where('actorUserId', '==', filters.actorUserId);
      }
      if (filters.targetUserId) {
        query = query.where('targetUserId', '==', filters.targetUserId);
      }
      if (filters.status && filters.status !== 'all') {
        query = query.where('status', '==', filters.status);
      }
    }

    // Order by timestamp
    query = query.orderBy('timestamp', 'desc');

    // Limit to 50,000 records
    query = query.limit(50000);

    // Fetch logs
    const snapshot = await query.get();

    let logs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      logs.push({
        logId: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp
      });
    });

    // Apply in-memory filters
    if (filters?.actionTypes && Array.isArray(filters.actionTypes) && filters.actionTypes.length > 0) {
      logs = logs.filter(log => filters.actionTypes.includes(log.action));
    }

    // Log export action
    await logAuditEvent({
      action: AUDIT_ACTIONS.EXPORT_AUDIT_LOGS,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetResource: 'audit_logs',
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        format: exportFormat,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        recordCount: logs.length,
        includeMetadata: includeMetadata || false
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
        'Timestamp',
        'Action',
        'Log Type',
        'Actor Email',
        'Actor ID',
        'Target Email',
        'Target ID',
        'Resource',
        'Resource ID',
        'Status',
        'IP Address',
        'User Agent'
      ];

      if (includeMetadata) {
        csvHeaders.push('Metadata');
      }

      if (filters?.errorMessage !== false) {
        csvHeaders.push('Error Message');
      }

      rows.push(csvHeaders.join(','));

      // CSV data rows
      logs.forEach(log => {
        const row = [
          `"${log.timestamp || ''}"`,
          `"${log.action || ''}"`,
          `"${log.logType || ''}"`,
          `"${log.actorEmail || ''}"`,
          `"${log.actorUserId || ''}"`,
          `"${log.targetUserEmail || ''}"`,
          `"${log.targetUserId || ''}"`,
          `"${log.targetResource || ''}"`,
          `"${log.resourceId || ''}"`,
          `"${log.status || ''}"`,
          `"${log.ipAddress || ''}"`,
          `"${(log.userAgent || '').replace(/"/g, '""')}"` // Escape quotes
        ];

        if (includeMetadata) {
          row.push(`"${JSON.stringify(log.metadata || {}).replace(/"/g, '""')}"`);
        }

        if (filters?.errorMessage !== false) {
          row.push(`"${(log.errorMessage || '').replace(/"/g, '""')}"`);
        }

        rows.push(row.join(','));
      });

      exportData = rows.join('\n');
      contentType = 'text/csv';
      filename = `audit_logs_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.csv`;

    } else {
      // Generate JSON
      exportData = JSON.stringify({
        exportDate: new Date().toISOString(),
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        recordCount: logs.length,
        logs: logs
      }, null, 2);
      contentType = 'application/json';
      filename = `audit_logs_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.json`;
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
    console.error('❌ Error exporting audit logs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to export audit logs',
        details: error.message
      })
    };
  }
};
