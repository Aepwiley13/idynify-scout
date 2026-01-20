/**
 * Admin Get Email Detail
 *
 * Fetches a single email log with full details including:
 * - Complete email content (HTML, text)
 * - Events timeline
 * - Provider response data
 * - Related retry attempts
 * - Original email (if this is a retry)
 *
 * Endpoint: /.netlify/functions/adminGetEmailDetail
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
    const { authToken, emailId } = JSON.parse(event.body);

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

    // Validate emailId
    if (!emailId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'emailId is required' })
      };
    }

    // Fetch email log
    const emailDoc = await db.collection('emailLogs').doc(emailId).get();

    if (!emailDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Email log not found' })
      };
    }

    const emailData = emailDoc.data();

    // Convert Firestore Timestamps to ISO strings
    const emailLog = {
      emailId: emailDoc.id,
      ...emailData,
      queuedAt: emailData.queuedAt?.toDate ? emailData.queuedAt.toDate().toISOString() : emailData.queuedAt,
      sentAt: emailData.sentAt?.toDate ? emailData.sentAt.toDate().toISOString() : emailData.sentAt,
      deliveredAt: emailData.deliveredAt?.toDate ? emailData.deliveredAt.toDate().toISOString() : emailData.deliveredAt,
      openedAt: emailData.openedAt?.toDate ? emailData.openedAt.toDate().toISOString() : emailData.openedAt,
      lastOpenedAt: emailData.lastOpenedAt?.toDate ? emailData.lastOpenedAt.toDate().toISOString() : emailData.lastOpenedAt,
      clickedAt: emailData.clickedAt?.toDate ? emailData.clickedAt.toDate().toISOString() : emailData.clickedAt,
      bouncedAt: emailData.bouncedAt?.toDate ? emailData.bouncedAt.toDate().toISOString() : emailData.bouncedAt,
      failedAt: emailData.failedAt?.toDate ? emailData.failedAt.toDate().toISOString() : emailData.failedAt,
      nextRetryAt: emailData.nextRetryAt?.toDate ? emailData.nextRetryAt.toDate().toISOString() : emailData.nextRetryAt
    };

    // Fetch related retry attempts (emails that are retries of this one)
    const retryAttemptsSnapshot = await db.collection('emailLogs')
      .where('retryOf', '==', emailId)
      .orderBy('queuedAt', 'asc')
      .get();

    const retryAttempts = [];
    retryAttemptsSnapshot.forEach(doc => {
      const data = doc.data();
      retryAttempts.push({
        emailId: doc.id,
        status: data.status,
        retryCount: data.retryCount,
        queuedAt: data.queuedAt?.toDate ? data.queuedAt.toDate().toISOString() : data.queuedAt,
        sentAt: data.sentAt?.toDate ? data.sentAt.toDate().toISOString() : data.sentAt,
        deliveredAt: data.deliveredAt?.toDate ? data.deliveredAt.toDate().toISOString() : data.deliveredAt,
        failedAt: data.failedAt?.toDate ? data.failedAt.toDate().toISOString() : data.failedAt,
        bouncedAt: data.bouncedAt?.toDate ? data.bouncedAt.toDate().toISOString() : data.bouncedAt,
        failureReason: data.failureReason,
        bounceType: data.bounceType
      });
    });

    // If this is a retry, fetch the original email
    let originalEmail = null;
    if (emailData.retryOf) {
      const originalDoc = await db.collection('emailLogs').doc(emailData.retryOf).get();
      if (originalDoc.exists) {
        const originalData = originalDoc.data();
        originalEmail = {
          emailId: originalDoc.id,
          status: originalData.status,
          recipient: originalData.recipient,
          subject: originalData.subject,
          queuedAt: originalData.queuedAt?.toDate ? originalData.queuedAt.toDate().toISOString() : originalData.queuedAt,
          sentAt: originalData.sentAt?.toDate ? originalData.sentAt.toDate().toISOString() : originalData.sentAt,
          bouncedAt: originalData.bouncedAt?.toDate ? originalData.bouncedAt.toDate().toISOString() : originalData.bouncedAt,
          failedAt: originalData.failedAt?.toDate ? originalData.failedAt.toDate().toISOString() : originalData.failedAt,
          failureReason: originalData.failureReason,
          bounceType: originalData.bounceType
        };
      }
    }

    // Log audit event (viewing email detail)
    await logAuditEvent({
      action: AUDIT_ACTIONS.VIEW_EMAIL_LOGS,
      logType: 'admin_action',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      targetResource: 'email_log',
      resourceId: emailId,
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
      metadata: {
        emailType: emailData.type,
        recipient: emailData.recipient,
        emailStatus: emailData.status
      }
    });

    // Return response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          email: emailLog,
          retryAttempts: retryAttempts,
          originalEmail: originalEmail
        }
      })
    };

  } catch (error) {
    console.error('❌ Error fetching email detail:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch email detail',
        details: error.message
      })
    };
  }
};
