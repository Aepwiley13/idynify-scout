/**
 * SEND ACTION RESOLVER
 *
 * Unified communication system that supports:
 * - Option A: Real Send (when integration exists and is connected)
 * - Option B: Native App Handoff (when integration not available)
 *
 * TRUTH PRINCIPLES:
 * - "Sent" = external confirmation received
 * - "Opened" = app handoff occurred
 * - "Prepared" = draft or copy created
 * - No false-positive success states allowed
 */

import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebase/config';

// Result types for clear UX messaging
export const SEND_RESULT = {
  SENT: 'sent',           // Real external send confirmed
  OPENED: 'opened',       // Native app handoff occurred
  PREPARED: 'prepared',   // Draft/copy created
  FAILED: 'failed',       // Action failed
  UNAVAILABLE: 'unavailable' // Channel not available
};

// Channel types
export const CHANNELS = {
  EMAIL: 'email',
  TEXT: 'text',
  CALL: 'call',
  LINKEDIN: 'linkedin',
  CALENDAR: 'calendar'
};

/**
 * Check if Gmail is connected for a user
 */
export async function checkGmailConnection(userId) {
  try {
    const gmailDoc = await getDoc(
      doc(db, 'users', userId, 'integrations', 'gmail')
    );

    if (!gmailDoc.exists()) {
      return { connected: false, reason: 'not_setup' };
    }

    const data = gmailDoc.data();
    if (data.status !== 'connected') {
      return { connected: false, reason: 'expired' };
    }

    // Check if token is likely expired (with 5 min buffer)
    if (data.expiresAt && Date.now() >= data.expiresAt - 300000) {
      return { connected: true, mayNeedRefresh: true };
    }

    return { connected: true, email: data.email };
  } catch (error) {
    console.error('Error checking Gmail connection:', error);
    return { connected: false, reason: 'error' };
  }
}

/**
 * Resolve which send method to use for a channel
 * Returns: { method: 'real' | 'native' | 'disabled', reason?: string }
 */
export async function resolveSendMethod(channel, userId, contact) {
  switch (channel) {
    case CHANNELS.EMAIL:
      if (!contact.email) {
        return { method: 'disabled', reason: 'No email address' };
      }
      const gmailStatus = await checkGmailConnection(userId);
      if (gmailStatus.connected) {
        return { method: 'real', integration: 'gmail' };
      }
      return { method: 'native', fallbackReason: 'Gmail not connected' };

    case CHANNELS.TEXT:
      if (!contact.phone) {
        return { method: 'disabled', reason: 'No phone number' };
      }
      // No real SMS integration yet - always use native
      return { method: 'native' };

    case CHANNELS.CALL:
      if (!contact.phone) {
        return { method: 'disabled', reason: 'No phone number' };
      }
      // Always use native tel: links
      return { method: 'native' };

    case CHANNELS.LINKEDIN:
      if (!contact.linkedin_url) {
        return { method: 'disabled', reason: 'No LinkedIn profile' };
      }
      // No LinkedIn API integration - use native handoff
      return { method: 'native' };

    case CHANNELS.CALENDAR:
      // No calendar integration - use native
      return { method: 'native' };

    default:
      return { method: 'disabled', reason: 'Unknown channel' };
  }
}

/**
 * OPTION A: Send email via Gmail API
 */
export async function sendEmailViaGmail({ userId, contact, subject, body }) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const authToken = await user.getIdToken();

    const response = await fetch('/.netlify/functions/gmail-send-quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        authToken,
        toEmail: contact.email,
        toName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email,
        subject,
        body,
        contactId: contact.id
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send email');
    }

    return {
      result: SEND_RESULT.SENT,
      gmailMessageId: data.gmailMessageId,
      sentAt: data.sentAt,
      message: 'Email sent via Gmail'
    };

  } catch (error) {
    console.error('Gmail send error:', error);
    return {
      result: SEND_RESULT.FAILED,
      error: error.message
    };
  }
}

/**
 * OPTION B: Open native email app with mailto:
 */
export function openNativeEmail({ contact, subject, body }) {
  const to = contact.email;
  const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;

  window.location.href = mailtoUrl;

  return {
    result: SEND_RESULT.OPENED,
    message: 'Email draft opened in your email app'
  };
}

/**
 * OPTION B: Open native SMS app
 */
export function openNativeSMS({ contact, body }) {
  const phone = contact.phone || contact.phone_mobile;
  // Use body parameter (works on iOS). On Android, may need to adjust
  const smsUrl = `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(body || '')}`;

  window.location.href = smsUrl;

  return {
    result: SEND_RESULT.OPENED,
    message: 'Text message opened in your SMS app'
  };
}

/**
 * OPTION B: Open native phone dialer
 */
export function openNativeCall({ contact }) {
  const phone = contact.phone || contact.phone_mobile;
  window.location.href = `tel:${encodeURIComponent(phone)}`;

  return {
    result: SEND_RESULT.OPENED,
    message: 'Phone dialer opened'
  };
}

/**
 * OPTION B: Open LinkedIn messaging (profile page or compose)
 */
export function openLinkedInMessage({ contact, body }) {
  const linkedinUrl = contact.linkedin_url;

  if (!linkedinUrl) {
    return {
      result: SEND_RESULT.FAILED,
      error: 'No LinkedIn profile URL'
    };
  }

  // Open LinkedIn profile - user can message from there
  // Note: LinkedIn doesn't support deep linking to compose with prefilled body
  window.open(linkedinUrl, '_blank');

  // Copy message to clipboard for convenience
  if (body) {
    navigator.clipboard.writeText(body).catch(() => {
      // Silently fail if clipboard not available
    });
  }

  return {
    result: SEND_RESULT.OPENED,
    message: body
      ? 'LinkedIn profile opened. Message copied to clipboard.'
      : 'LinkedIn profile opened'
  };
}

/**
 * OPTION B: Open native calendar
 */
export function openNativeCalendar({ title, description, contact }) {
  // Google Calendar URL format
  const startDate = new Date();
  startDate.setHours(startDate.getHours() + 24); // Default to tomorrow
  startDate.setMinutes(0);
  startDate.setSeconds(0);

  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + 1);

  const formatDate = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title || `Meeting with ${contact.firstName}`)}&details=${encodeURIComponent(description || '')}&dates=${formatDate(startDate)}/${formatDate(endDate)}`;

  window.open(calendarUrl, '_blank');

  return {
    result: SEND_RESULT.OPENED,
    message: 'Calendar event opened in Google Calendar'
  };
}

/**
 * Log activity to contact record
 */
export async function logActivity({ userId, contactId, type, details }) {
  try {
    const contactRef = doc(db, 'users', userId, 'contacts', contactId);

    await updateDoc(contactRef, {
      activity_log: arrayUnion({
        type,
        timestamp: new Date().toISOString(),
        ...details
      }),
      last_contacted: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error logging activity:', error);
    // Non-blocking - don't throw
  }
}

/**
 * MAIN EXECUTOR: Execute a send action with the best available method
 *
 * This is the single entry point for all communication actions.
 * It automatically chooses Option A (real send) or Option B (native handoff).
 */
export async function executeSendAction({
  channel,
  userId,
  contact,
  subject,
  body,
  userIntent,
  engagementIntent,
  strategy
}) {
  // Resolve which method to use
  const resolution = await resolveSendMethod(channel, userId, contact);

  if (resolution.method === 'disabled') {
    return {
      result: SEND_RESULT.UNAVAILABLE,
      reason: resolution.reason
    };
  }

  let sendResult;
  let activityType;

  switch (channel) {
    case CHANNELS.EMAIL:
      if (resolution.method === 'real') {
        // Option A: Real Gmail send
        sendResult = await sendEmailViaGmail({ userId, contact, subject, body });
        activityType = sendResult.result === SEND_RESULT.SENT ? 'email_sent' : 'email_failed';
      } else {
        // Option B: Native mailto
        sendResult = openNativeEmail({ contact, subject, body });
        activityType = 'email_opened';
      }
      break;

    case CHANNELS.TEXT:
      // Always Option B for now
      sendResult = openNativeSMS({ contact, body });
      activityType = 'text_opened';
      break;

    case CHANNELS.CALL:
      // Always Option B
      sendResult = openNativeCall({ contact });
      activityType = 'call_initiated';
      break;

    case CHANNELS.LINKEDIN:
      // Always Option B
      sendResult = openLinkedInMessage({ contact, body });
      activityType = 'linkedin_opened';
      break;

    case CHANNELS.CALENDAR:
      // Always Option B
      sendResult = openNativeCalendar({
        title: subject,
        description: body,
        contact
      });
      activityType = 'calendar_opened';
      break;

    default:
      return {
        result: SEND_RESULT.UNAVAILABLE,
        reason: 'Unknown channel'
      };
  }

  // Log the activity
  await logActivity({
    userId,
    contactId: contact.id,
    type: activityType,
    details: {
      channel,
      method: resolution.method,
      subject: subject || null,
      message: body,
      userIntent,
      engagementIntent,
      strategy,
      ...(sendResult.gmailMessageId && { gmailMessageId: sendResult.gmailMessageId })
    }
  });

  return {
    ...sendResult,
    channel,
    method: resolution.method,
    fallbackReason: resolution.fallbackReason
  };
}

/**
 * Get user-friendly action labels
 */
export function getActionLabels(channel, method) {
  const labels = {
    email: {
      real: { button: 'Send Email', success: 'Email sent', icon: 'Mail' },
      native: { button: 'Open Email Draft', success: 'Email draft opened', icon: 'ExternalLink' }
    },
    text: {
      native: { button: 'Open Text Message', success: 'SMS app opened', icon: 'ExternalLink' }
    },
    call: {
      native: { button: 'Call Contact', success: 'Phone dialer opened', icon: 'Phone' }
    },
    linkedin: {
      native: { button: 'Message on LinkedIn', success: 'LinkedIn opened', icon: 'ExternalLink' }
    },
    calendar: {
      native: { button: 'Create Calendar Event', success: 'Calendar opened', icon: 'Calendar' }
    }
  };

  return labels[channel]?.[method] || { button: 'Send', success: 'Done', icon: 'Send' };
}
