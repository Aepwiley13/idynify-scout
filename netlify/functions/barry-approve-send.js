/**
 * barry-approve-send — Sprint 3 Team Alpha
 *
 * Sends a Barry reply draft the user has approved (and possibly edited), into
 * the Gmail thread the original message came from, then records the send.
 *
 * Barry never sends on its own — this endpoint only ever runs from an explicit
 * user tap on Send Reply in BarryReplyCard, and the body it sends is whatever
 * was in the editable textarea at that moment.
 *
 * POST body:
 *   { userId, authToken, contactId, messageRecordId, bodyText,
 *     gmailThreadId, recipientEmail }
 *
 * Response:
 *   { success: true, gmailMessageId, gmailThreadId }
 *
 * Firestore writes on success (and nothing else — stage, brigade, icpScore,
 * name and company are never touched):
 *   1. barry_drafts/{messageRecordId} → approvalStatus/draftStatus "sent"
 *   2. contacts/{contactId}           → conversationState, lastOutboundAt, updatedAt
 *   3. contacts/{contactId}/timeline  → a reply_sent event
 */

import { google } from 'googleapis';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase-admin.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { getGmailSignature, appendSignature } from './utils/gmailSignature.js';
import { CONVERSATION_STATES } from '../../src/types/conversationState.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (statusCode, payload) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(payload),
});

/** Plain text → HTML. Mirrors toHtml() in gmail-send-quick.js. */
function toHtml(text) {
  return text
    .split(/\n\n+/)
    .map((para) => '<p>' + para.replace(/\n/g, '<br>') + '</p>')
    .join('');
}

/** Strip CR/LF so no field can inject extra MIME headers. */
function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * A reply keeps the original subject with a single "Re:" prefix.
 * @param {string} subject
 */
export function buildReplySubject(subject) {
  const clean = sanitizeHeader(subject) || '(no subject)';
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

/**
 * Build the RFC 2822 reply message.
 *
 * `inReplyTo` is the original message's RFC Message-ID header — not the Gmail
 * API message ID. Gmail keeps the message in the right thread via the threadId
 * on the send call, but the recipient's mail client threads on these headers,
 * so they have to be the real Message-ID or threading breaks everywhere else.
 * When it cannot be resolved the headers are omitted rather than faked.
 *
 * Exported for testing.
 */
export function buildReplyMime({ toEmail, subject, bodyText, inReplyTo }) {
  const lines = [`To: ${sanitizeHeader(toEmail)}`, `Subject: ${sanitizeHeader(subject)}`];

  if (inReplyTo) {
    const messageId = sanitizeHeader(inReplyTo);
    lines.push(`In-Reply-To: ${messageId}`, `References: ${messageId}`);
  }

  lines.push('Content-Type: text/html; charset=utf-8', 'MIME-Version: 1.0', '', toHtml(bodyText));
  return lines.join('\n');
}

/** Base64url encoding as the Gmail API expects for `raw`. */
function encodeRaw(mime) {
  return Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Look up the original inbound message's RFC Message-ID header.
 * Returns null when it cannot be read — the send still proceeds, threaded by
 * threadId alone.
 */
async function fetchRfcMessageId(gmail, gmailApiMessageId) {
  if (!gmailApiMessageId) return null;
  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: gmailApiMessageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID'],
    });
    const headers = res.data?.payload?.headers || [];
    const hit = headers.find((h) => h.name?.toLowerCase() === 'message-id');
    return hit?.value || null;
  } catch (err) {
    console.warn('[barry-approve-send] Could not read Message-ID header:', err.message);
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const {
      userId,
      contactId,
      messageRecordId,
      bodyText,
      gmailThreadId,
      recipientEmail,
    } = body;

    // ── Validate request ──────────────────────────────────────────────────
    if (!userId || !contactId || !messageRecordId) {
      return json(400, { error: 'Missing userId, contactId, or messageRecordId' });
    }
    if (typeof bodyText !== 'string' || !bodyText.trim()) {
      return json(400, { error: 'bodyText is required and cannot be empty' });
    }
    // Thread continuity is non-negotiable: a reply that starts a new thread
    // loses all Gmail context. Refuse rather than send it wrong.
    if (!gmailThreadId) {
      return json(400, { error: 'gmailThreadId is required — a reply must stay in its thread' });
    }
    if (!recipientEmail) {
      return json(400, { error: 'recipientEmail is required' });
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    const authToken = extractAuthToken(event);
    if (!authToken) {
      return json(401, { error: 'Missing authorization token' });
    }
    try {
      await verifyAuthToken(authToken, userId);
    } catch (authErr) {
      return json(401, { error: authErr.message });
    }

    // ── Load the inbound message this is replying to ──────────────────────
    const commSnap = await db.collection('communication_records').doc(messageRecordId).get();
    if (!commSnap.exists) {
      return json(404, { error: `Communication record ${messageRecordId} not found` });
    }
    const commRecord = commSnap.data();
    if (commRecord.idynifyUserId !== userId) {
      return json(403, { error: 'Communication record belongs to a different user' });
    }

    const replySubject = buildReplySubject(commRecord.subject);

    // ── Gmail OAuth (same pattern as gmail-send-quick.js) ─────────────────
    const gmailDoc = await db
      .collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .get();

    if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
      return json(400, { error: 'Gmail is not connected', code: 'GMAIL_NOT_CONNECTED' });
    }
    const gmailData = gmailDoc.data();

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      throw new Error('Google OAuth not configured');
    }

    const oauth2Client = new google.auth.OAuth2(
      googleClientId,
      googleClientSecret,
      googleRedirectUri
    );
    oauth2Client.setCredentials({
      access_token: gmailData.accessToken,
      refresh_token: gmailData.refreshToken,
    });

    if (Date.now() >= (gmailData.expiresAt || 0) - 60000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        await gmailDoc.ref.update({
          accessToken: credentials.access_token,
          expiresAt: credentials.expiry_date,
          updatedAt: new Date().toISOString(),
        });
      } catch (refreshErr) {
        console.error('[barry-approve-send] Token refresh failed:', refreshErr.message);
        return json(400, {
          error: 'Gmail connection expired. Please reconnect Gmail.',
          code: 'GMAIL_REFRESH_FAILED',
        });
      }
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // ── Compose ───────────────────────────────────────────────────────────
    const signature = await getGmailSignature(gmail);
    const bodyWithSignature = appendSignature(bodyText.trim(), signature);
    const inReplyTo = await fetchRfcMessageId(gmail, commRecord.gmailMessageId);

    const raw = encodeRaw(
      buildReplyMime({
        toEmail: recipientEmail,
        subject: replySubject,
        bodyText: bodyWithSignature,
        inReplyTo,
      })
    );

    // ── Send, threaded ────────────────────────────────────────────────────
    let sendResult;
    try {
      sendResult = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, threadId: gmailThreadId },
      });
    } catch (sendErr) {
      console.error('[barry-approve-send] Gmail send failed:', sendErr.message);
      return json(502, { error: `Gmail rejected the send: ${sendErr.message}` });
    }

    const sentMessageId = sendResult.data.id;
    const sentThreadId = sendResult.data.threadId || gmailThreadId;

    // ── Record the send ───────────────────────────────────────────────────
    // The Gmail send already happened; a Firestore failure here must not be
    // reported to the user as a failed send, or they will send it twice.
    const contactRef = db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId);

    try {
      await contactRef
        .collection('barry_drafts').doc(messageRecordId)
        .update({
          approvalStatus: 'sent',
          draftStatus: 'sent',
          sentAt: FieldValue.serverTimestamp(),
          sentMessageId,
          updatedAt: FieldValue.serverTimestamp(),
        });

      // Only these three fields. Never stage, brigade, icpScore, name or company.
      await contactRef.update({
        conversationState: CONVERSATION_STATES.WAITING_ON_CONTACT,
        lastOutboundAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await contactRef.collection('timeline').add({
        eventType: 'reply_sent',
        contactId,
        messageRecordId,
        direction: 'outbound',
        subject: replySubject,
        preview: bodyText.trim().slice(0, 200),
        sentAt: FieldValue.serverTimestamp(),
        source: 'barry_approved',
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (writeErr) {
      console.error(
        `[barry-approve-send] Sent ${sentMessageId} but Firestore update failed:`,
        writeErr.message
      );
      return json(200, {
        success: true,
        gmailMessageId: sentMessageId,
        gmailThreadId: sentThreadId,
        warning: 'Reply sent, but the contact record could not be updated.',
      });
    }

    console.log(`[barry-approve-send] ✅ Replied to ${recipientEmail} in thread ${sentThreadId}`);

    return json(200, {
      success: true,
      gmailMessageId: sentMessageId,
      gmailThreadId: sentThreadId,
    });

  } catch (error) {
    console.error('[barry-approve-send] Error:', error);
    return json(500, { error: error.message });
  }
};
