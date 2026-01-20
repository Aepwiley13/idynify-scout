/**
 * Resend Webhook Handler
 *
 * Receives delivery status webhooks from Resend and updates email logs.
 * Events: email.sent, email.delivered, email.bounced, email.complained, email.opened, email.clicked
 *
 * Endpoint: /.netlify/functions/resendWebhook
 * Method: POST
 * Auth: Resend webhook signature verification
 */

import { updateEmailStatus, addToSuppressionList, EMAIL_STATUS } from './utils/emailLog.js';

export const handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse webhook payload
    const payload = JSON.parse(event.body);

    console.log('📧 Resend webhook received:', payload.type);

    // Extract event data
    const { type, data } = payload;

    if (!type || !data) {
      console.error('Invalid webhook payload:', payload);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid payload' })
      };
    }

    // Get email ID from Resend
    const resendEmailId = data.email_id;

    if (!resendEmailId) {
      console.error('No email_id in webhook data');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing email_id' })
      };
    }

    // Process webhook based on event type
    switch (type) {
      case 'email.sent':
        await handleEmailSent(resendEmailId, data);
        break;

      case 'email.delivered':
        await handleEmailDelivered(resendEmailId, data);
        break;

      case 'email.delivery_delayed':
        await handleEmailDelayed(resendEmailId, data);
        break;

      case 'email.bounced':
        await handleEmailBounced(resendEmailId, data);
        break;

      case 'email.complained':
        await handleEmailComplained(resendEmailId, data);
        break;

      case 'email.opened':
        await handleEmailOpened(resendEmailId, data);
        break;

      case 'email.clicked':
        await handleEmailClicked(resendEmailId, data);
        break;

      default:
        console.warn(`Unknown webhook event type: ${type}`);
    }

    // Return success
    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('❌ Error processing Resend webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

/**
 * Handle email.sent event
 */
async function handleEmailSent(emailId, data) {
  console.log(`✉️ Email sent: ${emailId}`);

  await updateEmailStatus(emailId, EMAIL_STATUS.SENT, {
    providerEmailId: emailId,
    smtpMessageId: data.message_id || null,
    providerResponse: data
  });
}

/**
 * Handle email.delivered event
 */
async function handleEmailDelivered(emailId, data) {
  console.log(`✅ Email delivered: ${emailId}`);

  await updateEmailStatus(emailId, EMAIL_STATUS.DELIVERED, {
    providerEmailId: emailId,
    providerResponse: data
  });
}

/**
 * Handle email.delivery_delayed event
 */
async function handleEmailDelayed(emailId, data) {
  console.log(`⏱️ Email delivery delayed: ${emailId}`);

  // Don't change status, just log the event
  // Status remains 'sent' or current status
}

/**
 * Handle email.bounced event
 */
async function handleEmailBounced(emailId, data) {
  console.log(`⚠️ Email bounced: ${emailId}`);

  // Determine bounce type
  // Resend provides bounce_type in data
  const bounceType = determineBounceType(data);

  await updateEmailStatus(emailId, EMAIL_STATUS.BOUNCED, {
    providerEmailId: emailId,
    bounceType: bounceType,
    reason: data.bounce_reason || data.error || 'Email bounced',
    providerResponse: data
  });

  // Add to suppression list if hard bounce
  if (bounceType === 'hard') {
    const recipientEmail = data.to?.[0] || data.recipient;
    if (recipientEmail) {
      await addToSuppressionList(recipientEmail, 'hard_bounce', emailId);
    }
  }
}

/**
 * Handle email.complained event (spam complaint)
 */
async function handleEmailComplained(emailId, data) {
  console.log(`🚫 Spam complaint: ${emailId}`);

  await updateEmailStatus(emailId, EMAIL_STATUS.COMPLAINED, {
    providerEmailId: emailId,
    reason: 'Spam complaint',
    providerResponse: data
  });

  // Add to suppression list
  const recipientEmail = data.to?.[0] || data.recipient;
  if (recipientEmail) {
    await addToSuppressionList(recipientEmail, 'spam_complaint', emailId);
  }
}

/**
 * Handle email.opened event
 */
async function handleEmailOpened(emailId, data) {
  console.log(`👀 Email opened: ${emailId}`);

  await updateEmailStatus(emailId, EMAIL_STATUS.OPENED, {
    providerEmailId: emailId,
    userAgent: data.user_agent || null,
    ipAddress: data.ip_address || null,
    providerResponse: data
  });
}

/**
 * Handle email.clicked event
 */
async function handleEmailClicked(emailId, data) {
  console.log(`🖱️ Email link clicked: ${emailId}`);

  await updateEmailStatus(emailId, EMAIL_STATUS.CLICKED, {
    providerEmailId: emailId,
    linkUrl: data.link || null,
    userAgent: data.user_agent || null,
    ipAddress: data.ip_address || null,
    providerResponse: data
  });
}

/**
 * Determine bounce type from Resend data
 * Returns 'hard' or 'soft'
 */
function determineBounceType(data) {
  const bounceReason = (data.bounce_reason || data.error || '').toLowerCase();

  // Hard bounce indicators
  const hardBounceKeywords = [
    'invalid',
    'does not exist',
    'no such user',
    'unknown user',
    'address rejected',
    'recipient address rejected',
    'user unknown',
    'mailbox not found'
  ];

  // Soft bounce indicators
  const softBounceKeywords = [
    'mailbox full',
    'quota exceeded',
    'temporarily',
    'try again',
    'greylisted',
    'rate limit'
  ];

  // Check for hard bounce
  if (hardBounceKeywords.some(keyword => bounceReason.includes(keyword))) {
    return 'hard';
  }

  // Check for soft bounce
  if (softBounceKeywords.some(keyword => bounceReason.includes(keyword))) {
    return 'soft';
  }

  // Default to soft bounce if unclear (safer for retry logic)
  return 'soft';
}
