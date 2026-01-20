/**
 * Admin Retry Email Send
 *
 * Manually retries a failed or bounced email.
 * Creates a new email log entry and sends via Resend.
 *
 * Endpoint: /.netlify/functions/adminRetryEmailSend
 * Method: POST
 * Auth: Requires valid Firebase auth token + admin role
 */

import { db, admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';
import { createRetryEmail, updateEmailStatus, EMAIL_STATUS } from './utils/emailLog.js';

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

    // Get Resend API key
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Email service not configured' })
      };
    }

    // Create retry email log entry
    let retryEmailId;
    try {
      retryEmailId = await createRetryEmail(emailId);
    } catch (error) {
      console.error('❌ Failed to create retry email log:', error);

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.RETRY_EMAIL_SEND,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetResource: 'email_log',
        resourceId: emailId,
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: error.message
      });

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }

    // Get the retry email log to send
    const retryDoc = await db.collection('emailLogs').doc(retryEmailId).get();
    const retryData = retryDoc.data();

    console.log(`📧 Retrying email send: ${retryEmailId} (retry of ${emailId})`);

    // Send email via Resend
    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: `${retryData.fromName} <${retryData.from}>`,
          to: retryData.recipient,
          subject: retryData.subject,
          html: retryData.htmlContent,
          text: retryData.textContent || undefined,
          reply_to: retryData.replyTo || undefined
        })
      });

      if (!emailResponse.ok) {
        const errorText = await emailResponse.text();
        console.error('❌ Resend API error:', errorText);

        // Update retry email log to failed
        await updateEmailStatus(retryEmailId, EMAIL_STATUS.FAILED, {
          reason: `Resend API error: ${errorText}`
        });

        // Log failed audit event
        await logAuditEvent({
          action: AUDIT_ACTIONS.RETRY_EMAIL_SEND,
          logType: 'admin_action',
          actorUserId: adminUserId,
          actorEmail: adminEmail,
          targetResource: 'email_log',
          resourceId: emailId,
          status: 'failed',
          ipAddress: getIpAddress(event),
          userAgent: getUserAgent(event),
          errorMessage: `Resend API error: ${errorText}`,
          metadata: {
            retryEmailId: retryEmailId,
            recipient: retryData.recipient
          }
        });

        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Failed to send email via Resend',
            details: errorText
          })
        };
      }

      const result = await emailResponse.json();

      console.log(`✅ Email retry sent successfully: ${retryEmailId} (Resend ID: ${result.id})`);

      // Update retry email log to sent
      await updateEmailStatus(retryEmailId, EMAIL_STATUS.SENT, {
        providerEmailId: result.id,
        providerResponse: result
      });

      // Log successful audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.RETRY_EMAIL_SEND,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetResource: 'email_log',
        resourceId: emailId,
        status: 'success',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        metadata: {
          retryEmailId: retryEmailId,
          providerEmailId: result.id,
          recipient: retryData.recipient,
          retryCount: retryData.retryCount
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Email retry sent successfully',
          data: {
            retryEmailId: retryEmailId,
            providerEmailId: result.id,
            recipient: retryData.recipient
          }
        })
      };

    } catch (error) {
      console.error('❌ Error sending retry email:', error);

      // Update retry email log to failed
      await updateEmailStatus(retryEmailId, EMAIL_STATUS.FAILED, {
        reason: error.message
      });

      // Log failed audit event
      await logAuditEvent({
        action: AUDIT_ACTIONS.RETRY_EMAIL_SEND,
        logType: 'admin_action',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        targetResource: 'email_log',
        resourceId: emailId,
        status: 'failed',
        ipAddress: getIpAddress(event),
        userAgent: getUserAgent(event),
        errorMessage: error.message,
        metadata: {
          retryEmailId: retryEmailId,
          recipient: retryData.recipient
        }
      });

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Failed to send retry email',
          details: error.message
        })
      };
    }

  } catch (error) {
    console.error('❌ Error in retry email handler:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};
