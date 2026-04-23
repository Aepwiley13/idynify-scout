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

import { doc, getDoc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS } from './contactStateMachine';

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
 * Check if Google Calendar is connected for a user
 */
export async function checkCalendarConnection(userId) {
  try {
    const calDoc = await getDoc(
      doc(db, 'users', userId, 'integrations', 'googleCalendar')
    );

    if (!calDoc.exists()) {
      return { connected: false, reason: 'not_setup' };
    }

    const data = calDoc.data();
    if (data.status !== 'connected') {
      return { connected: false, reason: 'expired' };
    }

    if (data.expiresAt && Date.now() >= data.expiresAt - 300000) {
      return { connected: true, mayNeedRefresh: true };
    }

    return { connected: true, email: data.email };
  } catch (error) {
    console.error('Error checking Calendar connection:', error);
    return { connected: false, reason: 'error' };
  }
}

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
      // Always allow text - opens native SMS app even without a saved phone number
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
      const calendarStatus = await checkCalendarConnection(userId);
      if (calendarStatus.connected) {
        return { method: 'real', integration: 'googleCalendar' };
      }
      return { method: 'native', fallbackReason: 'Google Calendar not connected' };

    default:
      return { method: 'disabled', reason: 'Unknown channel' };
  }
}

/**
 * OPTION A: Send email via Gmail API
 */
export async function sendEmailViaGmail({ userId, contact, subject, body, ccRecipients }) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const authToken = await user.getIdToken();

    const ccEmails = (ccRecipients || []).map(r => ({ name: r.name, email: r.email }));

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
        contactId: contact.id,
        // Preserve the existing Gmail thread for follow-ups (Sprint 3)
        existingThreadId: contact.gmail_thread_id || null,
        ccEmails: ccEmails.length > 0 ? ccEmails : undefined,
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
 * OPTION B (Outlook): Open Outlook via mailto: link.
 * Works with desktop Outlook and any system-default mail client.
 * Pre-fills To, Subject, CC, and Body so the user just hits Send.
 */
export function openOutlookEmail({ contact, subject, body, ccRecipients }) {
  const to = contact.email || '';
  const ccString = (ccRecipients || []).map(r => r.email).join(',');

  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body)    parts.push(`body=${encodeURIComponent(body)}`);
  if (ccString) parts.push(`cc=${encodeURIComponent(ccString)}`);

  const mailtoUrl = `mailto:${to}${parts.length ? '?' + parts.join('&') : ''}`;
  window.location.href = mailtoUrl;

  return {
    result: SEND_RESULT.OPENED,
    message: 'Outlook opened — email pre-filled and ready to send',
    clipboardCopied: false
  };
}

/**
 * OPTION B (Gmail): Open Gmail web compose + copy draft to clipboard.
 * Used when Gmail is not integrated. Opens Gmail in a new tab with
 * To/Subject pre-filled and copies the full draft to clipboard so
 * the user can paste the body without relying on URL length limits.
 */
export function openNativeEmail({ contact, subject, body, ccRecipients }) {
  const to = contact.email || '';

  // Build Gmail compose URL (web-based, works without integration)
  const gmailParams = new URLSearchParams({ view: 'cm', fs: '1' });
  if (to) gmailParams.set('to', to);
  if (subject) gmailParams.set('su', subject);
  // Body is intentionally omitted from the URL — Gmail truncates long URLs.
  // The full draft is copied to clipboard instead (see below).
  const ccString = (ccRecipients || []).map(r => r.email).join(',');
  if (ccString) gmailParams.set('cc', ccString);

  window.open(`https://mail.google.com/mail/?${gmailParams.toString()}`, '_blank');

  // Copy the full draft to clipboard so user can paste the body
  const fullDraft = [
    to ? `To: ${to}` : '',
    subject ? `Subject: ${subject}` : '',
    '',
    body || ''
  ].filter((line, i) => i >= 2 || line !== '').join('\n');

  navigator.clipboard.writeText(fullDraft).catch(() => {});

  return {
    result: SEND_RESULT.OPENED,
    message: 'Gmail opened — full draft copied to clipboard. Paste the body to send.',
    clipboardCopied: true
  };
}

/**
 * OPTION B: Open native SMS app
 */
export function openNativeSMS({ contact, body }) {
  const phone = contact.phone || contact.phone_mobile || '';
  // Build SMS link - if no phone number, opens SMS app with blank "To" field
  const recipient = phone ? encodeURIComponent(phone) : '';
  const smsUrl = `sms:${recipient}?body=${encodeURIComponent(body || '')}`;

  // Copy message to clipboard so user can paste it if the SMS body doesn't prefill
  if (body) {
    navigator.clipboard.writeText(body).catch(() => {});
  }

  window.location.href = smsUrl;

  return {
    result: SEND_RESULT.OPENED,
    message: phone
      ? 'SMS app opened — message copied to clipboard'
      : 'SMS app opened — message copied to clipboard, add the recipient and send',
    clipboardCopied: true
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
 * OPTION A: Create calendar event via Google Calendar API
 */
export async function createCalendarEventViaApi({ userId, contact, title, description, startDateTime, endDateTime, timeZone, location }) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const authToken = await user.getIdToken();

    const response = await fetch('/.netlify/functions/calendar-create-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        authToken,
        title,
        description,
        startDateTime,
        endDateTime,
        timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        attendeeEmail: contact.email || null,
        attendeeName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || null,
        contactId: contact.id,
        location: location || ''
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create calendar event');
    }

    return {
      result: SEND_RESULT.SENT,
      eventId: data.eventId,
      eventLink: data.eventLink,
      message: 'Meeting scheduled via Google Calendar'
    };

  } catch (error) {
    console.error('Calendar create event error:', error);
    return {
      result: SEND_RESULT.FAILED,
      error: error.message
    };
  }
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
  strategy,
  ccRecipients,
  // Calendar-specific params
  startDateTime,
  endDateTime,
  timeZone,
  location
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
        sendResult = await sendEmailViaGmail({ userId, contact, subject, body, ccRecipients });
        activityType = sendResult.result === SEND_RESULT.SENT ? 'email_sent' : 'email_failed';
      } else {
        // Option B: Native mailto
        sendResult = openNativeEmail({ contact, subject, body, ccRecipients });
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
      if (resolution.method === 'real') {
        // Option A: Real Google Calendar event creation
        // startDateTime / endDateTime should be passed in subject/body fields when channel is calendar
        // The caller should pass startDateTime and endDateTime via the options object
        sendResult = await createCalendarEventViaApi({
          userId,
          contact,
          title: subject,
          description: body,
          startDateTime: startDateTime || null,
          endDateTime: endDateTime || null,
          timeZone: timeZone || null,
          location: location || null
        });
        activityType = sendResult.result === SEND_RESULT.SENT ? 'meeting_scheduled' : 'calendar_failed';
      } else {
        // Option B: Native calendar handoff
        sendResult = openNativeCalendar({
          title: subject,
          description: body,
          contact
        });
        activityType = 'calendar_opened';
      }
      break;

    default:
      return {
        result: SEND_RESULT.UNAVAILABLE,
        reason: 'Unknown channel'
      };
  }

  // Log the activity (legacy activity_log array — untouched)
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

  // Log timeline event: message_sent
  logTimelineEvent({
    userId,
    contactId: contact.id,
    type: 'message_sent',
    actor: ACTORS.USER,
    preview: subject || (body ? body.substring(0, 120) : null),
    metadata: {
      channel,
      method: resolution.method,
      sendResult: sendResult.result,
      engagementIntent: engagementIntent || null,
      strategy: strategy || null,
      subject: subject || null,
      fullMessage: body || null,
      ...(ccRecipients && ccRecipients.length > 0 && { ccRecipients: ccRecipients.map(r => r.email) }),
      ...(sendResult.gmailMessageId && { gmailMessageId: sendResult.gmailMessageId })
    }
  });

  // State Machine: Message sent → Awaiting Reply (only on successful send/handoff)
  if (sendResult.result === SEND_RESULT.SENT || sendResult.result === SEND_RESULT.OPENED) {
    updateContactStatus({
      userId,
      contactId: contact.id,
      trigger: STATUS_TRIGGERS.MESSAGE_SENT
    });

    // Auto-set a follow-up reminder so the OVERDUE indicator fires if no reply arrives
    const FOLLOW_UP_DAYS = 3;
    const nextDue = new Date(Date.now() + FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    updateDoc(doc(db, 'users', userId, 'contacts', contact.id), {
      next_step_due: nextDue,
      updated_at: now,
      'engagement_summary.last_contact_at': now,
      'engagement_summary.total_messages_sent': increment(1),
    }).catch(() => {}); // fire-and-forget — non-fatal
  }

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
      real:    { button: 'Send Email',       success: 'Email sent',                                    icon: 'Mail' },
      native:  { button: 'Open in Gmail',    success: 'Gmail opened — draft copied to clipboard',      icon: 'ExternalLink' },
      outlook: { button: 'Open in Outlook',  success: 'Outlook opened — email pre-filled',             icon: 'Mail' }
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
      real: { button: 'Schedule Meeting', success: 'Meeting scheduled', icon: 'Calendar' },
      native: { button: 'Create Calendar Event', success: 'Calendar opened', icon: 'Calendar' }
    }
  };

  return labels[channel]?.[method] || { button: 'Send', success: 'Done', icon: 'Send' };
}
