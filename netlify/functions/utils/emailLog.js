/**
 * Email Logging Utility
 *
 * Provides centralized logging for all system-generated emails.
 * Tracks delivery status, opens, clicks, bounces, and failures.
 * Integrates with Resend API and webhooks.
 */

import { db } from '../firebase-admin.js';

/**
 * Email types
 */
export const EMAIL_TYPES = {
  WELCOME_EMAIL: 'welcome_email',
  PASSWORD_RESET: 'password_reset',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_REACTIVATED: 'account_reactivated',
  PAYMENT_RECEIPT: 'payment_receipt',
  SUBSCRIPTION_EXPIRING: 'subscription_expiring',
  SUPPORT_REPLY: 'support_reply',
  GENERAL: 'general'
};

/**
 * Email status values
 */
export const EMAIL_STATUS = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  OPENED: 'opened',
  CLICKED: 'clicked',
  BOUNCED: 'bounced',
  FAILED: 'failed',
  COMPLAINED: 'complained' // spam complaint
};

/**
 * Log an email send attempt to Firestore
 *
 * @param {Object} emailData - Email data to log
 * @param {string} emailData.type - Email type (use EMAIL_TYPES constants)
 * @param {string} emailData.recipient - Recipient email address
 * @param {string} [emailData.userId] - User ID if email is user-specific
 * @param {string} emailData.subject - Email subject line
 * @param {string} emailData.from - Sender email
 * @param {string} [emailData.fromName] - Sender name
 * @param {string} [emailData.replyTo] - Reply-to email
 * @param {string} emailData.htmlContent - HTML email body
 * @param {string} [emailData.textContent] - Plain text version
 * @param {Object} [emailData.metadata] - Additional context
 * @param {string} [emailData.providerEmailId] - Resend email ID (if already sent)
 * @returns {Promise<string>} - Document ID of created email log
 */
export async function logEmail(emailData) {
  try {
    // Validate required fields
    if (!emailData.type) {
      console.error('❌ logEmail: type is required');
      return null;
    }

    if (!emailData.recipient) {
      console.error('❌ logEmail: recipient is required');
      return null;
    }

    if (!emailData.subject) {
      console.error('❌ logEmail: subject is required');
      return null;
    }

    // Check suppression list before logging
    const isSuppressed = await isEmailSuppressed(emailData.recipient);
    if (isSuppressed) {
      console.warn(`⚠️ Email ${emailData.recipient} is suppressed, not logging send attempt`);
      return null;
    }

    // Prepare email log entry
    const emailLog = {
      type: emailData.type,
      recipient: emailData.recipient.toLowerCase(), // Normalize email
      userId: emailData.userId || null,
      subject: emailData.subject,
      from: emailData.from || 'support@idynify.com',
      fromName: emailData.fromName || 'iDynify Support',
      replyTo: emailData.replyTo || null,
      status: EMAIL_STATUS.QUEUED,
      queuedAt: new Date(),
      sentAt: null,
      deliveredAt: null,
      openedAt: null,
      lastOpenedAt: null,
      openCount: 0,
      clickedAt: null,
      clickCount: 0,
      bouncedAt: null,
      failedAt: null,
      failureReason: null,
      bounceType: null,
      retryCount: 0,
      retryOf: null,
      nextRetryAt: null,
      providerEmailId: emailData.providerEmailId || null,
      smtpMessageId: null,
      htmlContent: emailData.htmlContent,
      textContent: emailData.textContent || null,
      providerResponse: null,
      events: [
        {
          event: 'queued',
          timestamp: new Date().toISOString(),
          metadata: {}
        }
      ],
      metadata: emailData.metadata || null
    };

    // Write to Firestore
    const docRef = await db.collection('emailLogs').add(emailLog);

    console.log(`✅ Email logged: ${emailData.type} to ${emailData.recipient} (${docRef.id})`);
    return docRef.id;

  } catch (error) {
    console.error('❌ Failed to log email:', error);
    console.error('Email data:', emailData);
    return null;
  }
}

/**
 * Update email log status
 *
 * @param {string} emailLogId - Firestore document ID or providerEmailId
 * @param {string} status - New status
 * @param {Object} [eventData] - Additional event data
 */
export async function updateEmailStatus(emailLogId, status, eventData = {}) {
  try {
    // Try to find by document ID first
    let docRef = db.collection('emailLogs').doc(emailLogId);
    let doc = await docRef.get();

    // If not found, try to find by providerEmailId
    if (!doc.exists) {
      const querySnapshot = await db.collection('emailLogs')
        .where('providerEmailId', '==', emailLogId)
        .limit(1)
        .get();

      if (!querySnapshot.empty) {
        docRef = querySnapshot.docs[0].ref;
        doc = querySnapshot.docs[0];
      } else {
        console.error(`Email log not found: ${emailLogId}`);
        return false;
      }
    }

    const currentData = doc.data();
    const now = new Date();
    const updates = { status };

    // Update timestamp fields based on status
    switch (status) {
      case EMAIL_STATUS.SENT:
        updates.sentAt = now;
        break;
      case EMAIL_STATUS.DELIVERED:
        updates.deliveredAt = now;
        break;
      case EMAIL_STATUS.OPENED:
        updates.openedAt = currentData.openedAt || now;
        updates.lastOpenedAt = now;
        updates.openCount = (currentData.openCount || 0) + 1;
        break;
      case EMAIL_STATUS.CLICKED:
        updates.clickedAt = currentData.clickedAt || now;
        updates.clickCount = (currentData.clickCount || 0) + 1;
        // If clicked, it was also opened
        if (!currentData.openedAt) {
          updates.openedAt = now;
          updates.openCount = 1;
        }
        break;
      case EMAIL_STATUS.BOUNCED:
        updates.bouncedAt = now;
        updates.bounceType = eventData.bounceType || 'unknown';
        updates.failureReason = eventData.reason || null;
        // Schedule retry for soft bounces
        if (eventData.bounceType === 'soft' && currentData.retryCount < 3) {
          updates.nextRetryAt = calculateNextRetry(currentData.retryCount);
        }
        break;
      case EMAIL_STATUS.FAILED:
        updates.failedAt = now;
        updates.failureReason = eventData.reason || null;
        // Schedule retry for transient failures
        if (currentData.retryCount < 3) {
          updates.nextRetryAt = calculateNextRetry(currentData.retryCount);
        }
        break;
      case EMAIL_STATUS.COMPLAINED:
        // Spam complaint - add to suppression list
        await addToSuppressionList(currentData.recipient, 'spam_complaint', doc.id);
        break;
    }

    // Add event to timeline
    const newEvent = {
      event: status,
      timestamp: now.toISOString(),
      metadata: eventData
    };

    updates.events = [...(currentData.events || []), newEvent];

    // Update provider data if provided
    if (eventData.providerEmailId) {
      updates.providerEmailId = eventData.providerEmailId;
    }
    if (eventData.smtpMessageId) {
      updates.smtpMessageId = eventData.smtpMessageId;
    }
    if (eventData.providerResponse) {
      updates.providerResponse = eventData.providerResponse;
    }

    // Perform update
    await docRef.update(updates);

    console.log(`✅ Email status updated: ${emailLogId} → ${status}`);
    return true;

  } catch (error) {
    console.error('❌ Failed to update email status:', error);
    return false;
  }
}

/**
 * Calculate next retry time based on retry count
 * Exponential backoff: 15 min, 1 hour, 4 hours
 */
function calculateNextRetry(retryCount) {
  const now = new Date();
  let delayMinutes;

  switch (retryCount) {
    case 0:
      delayMinutes = 15; // 15 minutes
      break;
    case 1:
      delayMinutes = 60; // 1 hour
      break;
    case 2:
      delayMinutes = 240; // 4 hours
      break;
    default:
      return null; // No more retries
  }

  return new Date(now.getTime() + delayMinutes * 60 * 1000);
}

/**
 * Check if email is in suppression list
 */
export async function isEmailSuppressed(email) {
  try {
    const normalizedEmail = email.toLowerCase();
    const doc = await db.collection('emailSuppressionList').doc(normalizedEmail).get();
    return doc.exists;
  } catch (error) {
    console.error('Error checking suppression list:', error);
    return false; // Fail open - allow sending if check fails
  }
}

/**
 * Add email to suppression list
 */
export async function addToSuppressionList(email, reason, originalEmailId) {
  try {
    const normalizedEmail = email.toLowerCase();

    await db.collection('emailSuppressionList').doc(normalizedEmail).set({
      email: normalizedEmail,
      reason: reason, // hard_bounce, spam_complaint, manual, unsubscribe
      addedAt: new Date(),
      addedBy: 'system',
      originalEmailId: originalEmailId || null,
      notes: null
    });

    console.log(`✅ Email added to suppression list: ${email} (${reason})`);
    return true;

  } catch (error) {
    console.error('❌ Failed to add to suppression list:', error);
    return false;
  }
}

/**
 * Remove email from suppression list (manual admin action)
 */
export async function removeFromSuppressionList(email) {
  try {
    const normalizedEmail = email.toLowerCase();
    await db.collection('emailSuppressionList').doc(normalizedEmail).delete();
    console.log(`✅ Email removed from suppression list: ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to remove from suppression list:', error);
    return false;
  }
}

/**
 * Create a retry email log entry
 */
export async function createRetryEmail(originalEmailId) {
  try {
    // Get original email
    const originalDoc = await db.collection('emailLogs').doc(originalEmailId).get();

    if (!originalDoc.exists) {
      throw new Error('Original email not found');
    }

    const originalData = originalDoc.data();

    // Check retry count
    if (originalData.retryCount >= 3) {
      throw new Error('Maximum retry attempts reached');
    }

    // Check suppression list
    const isSuppressed = await isEmailSuppressed(originalData.recipient);
    if (isSuppressed) {
      throw new Error('Email is in suppression list');
    }

    // Create new email log with incremented retry count
    const retryEmailData = {
      type: originalData.type,
      recipient: originalData.recipient,
      userId: originalData.userId,
      subject: originalData.subject,
      from: originalData.from,
      fromName: originalData.fromName,
      replyTo: originalData.replyTo,
      status: EMAIL_STATUS.QUEUED,
      queuedAt: new Date(),
      sentAt: null,
      deliveredAt: null,
      openedAt: null,
      lastOpenedAt: null,
      openCount: 0,
      clickedAt: null,
      clickCount: 0,
      bouncedAt: null,
      failedAt: null,
      failureReason: null,
      bounceType: null,
      retryCount: originalData.retryCount + 1,
      retryOf: originalEmailId,
      nextRetryAt: null,
      providerEmailId: null,
      smtpMessageId: null,
      htmlContent: originalData.htmlContent,
      textContent: originalData.textContent,
      providerResponse: null,
      events: [
        {
          event: 'queued',
          timestamp: new Date().toISOString(),
          metadata: { retryOf: originalEmailId, retryCount: originalData.retryCount + 1 }
        }
      ],
      metadata: {
        ...originalData.metadata,
        isRetry: true,
        originalEmailId: originalEmailId
      }
    };

    const docRef = await db.collection('emailLogs').add(retryEmailData);

    console.log(`✅ Retry email created: ${docRef.id} (retry of ${originalEmailId})`);
    return docRef.id;

  } catch (error) {
    console.error('❌ Failed to create retry email:', error);
    throw error;
  }
}
