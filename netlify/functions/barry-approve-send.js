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
 *
 * SEND-ONCE GUARANTEE (P0A / defect A1)
 * ─────────────────────────────────────
 * Sending an email is irreversible, so the draft is CLAIMED in a transaction
 * before Gmail is called. Two clicks, two tabs, or a client retry all race on
 * the same document, and exactly one wins:
 *
 *   awaiting_user ──claim──> sending ──gmail ok──> sent
 *                               │
 *                               └──gmail failed──> (reverted to prior status)
 *
 * A replay that arrives after "sent" is answered 200 with alreadySent:true and
 * the original message id, because a duplicate click is not a user error — it
 * must simply not produce a second email. A claim still held after
 * STALE_CLAIM_MS is reclaimable, so a function that dies mid-send cannot
 * strand the draft permanently.
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

/**
 * How long a "sending" claim is honoured before another request may take it.
 * Longer than any realistic Gmail round trip, short enough that a crashed
 * invocation does not strand the draft past the user's patience.
 */
const STALE_CLAIM_MS = 2 * 60 * 1000;

/** Firestore Timestamp | ISO string | Date | null → epoch ms (0 when unusable). */
function claimStartedMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Take exclusive ownership of a draft so only one request can send it.
 *
 * @returns {Promise<
 *   { ok: true, tracked: boolean, priorStatus: string|null } |
 *   { ok: false, reason: 'already_sent', sentMessageId: string|null, sentThreadId: string|null } |
 *   { ok: false, reason: 'send_in_progress' }
 * >}
 */
async function claimDraftForSend(draftRef) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(draftRef);

    // No stored draft is legitimate — a reply can be composed without one.
    // There is nothing to claim, and nothing that could be sent twice from it.
    if (!snap.exists) return { ok: true, tracked: false, priorStatus: null };

    const data = snap.data() || {};
    // Captured before the update below. Reading it afterwards would hand back
    // whatever this claim just wrote instead of the status it replaced.
    const priorStatus = data.approvalStatus || null;

    if (data.approvalStatus === 'sent') {
      return {
        ok: false,
        reason: 'already_sent',
        sentMessageId: data.sentMessageId || null,
        sentThreadId: data.sentThreadId || null,
      };
    }

    if (data.approvalStatus === 'sending') {
      const heldFor = Date.now() - claimStartedMillis(data.sendingStartedAt);
      if (heldFor < STALE_CLAIM_MS) return { ok: false, reason: 'send_in_progress' };
      // Older than the stale window — the previous attempt died. Reclaim it.
    }

    tx.update(draftRef, {
      approvalStatus: 'sending',
      sendingStartedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, tracked: true, priorStatus };
  });
}

/**
 * Hand a claimed draft back when the send did not happen, so the user can retry.
 * Best-effort: the stale-claim window already covers the case where this fails.
 */
async function releaseDraftClaim(draftRef, priorStatus) {
  try {
    await draftRef.update({
      approvalStatus: priorStatus || 'awaiting_user',
      sendingStartedAt: FieldValue.delete(),
    });
  } catch (err) {
    console.error('[barry-approve-send] Failed to release draft claim:', err.message);
  }
}

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

  // Declared out here so the catch below can hand the claim back if anything
  // between claiming and sending throws.
  let draftRef = null;
  let claim = null;

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

    // ── Claim the draft before anything irreversible happens ──────────────
    // Everything above this point is a read. Everything below can send mail.
    draftRef = db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('barry_drafts').doc(messageRecordId);

    try {
      claim = await claimDraftForSend(draftRef);
    } catch (claimErr) {
      console.error('[barry-approve-send] Draft claim failed:', claimErr.message);
      return json(500, { error: `Could not lock the draft for sending: ${claimErr.message}` });
    }

    if (!claim.ok && claim.reason === 'already_sent') {
      // A duplicate click, not a failure. Report the original send.
      console.log(`[barry-approve-send] Replay ignored — ${messageRecordId} already sent`);
      return json(200, {
        success: true,
        alreadySent: true,
        gmailMessageId: claim.sentMessageId,
        gmailThreadId: claim.sentThreadId || gmailThreadId,
      });
    }

    if (!claim.ok && claim.reason === 'send_in_progress') {
      return json(409, {
        error: 'This reply is already being sent.',
        code: 'SEND_IN_PROGRESS',
      });
    }

    // From here on, any early return must release the claim or the draft is
    // stuck until the stale window expires.
    const abandonSend = async (statusCode, payload) => {
      if (claim.tracked) await releaseDraftClaim(draftRef, claim.priorStatus);
      return json(statusCode, payload);
    };

    // ── Gmail OAuth (same pattern as gmail-send-quick.js) ─────────────────
    const gmailDoc = await db
      .collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .get();

    if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
      return abandonSend(400, { error: 'Gmail is not connected', code: 'GMAIL_NOT_CONNECTED' });
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
        return abandonSend(400, {
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
      // Gmail refused it, so nothing left the building — the user may retry.
      return abandonSend(502, { error: `Gmail rejected the send: ${sendErr.message}` });
    }

    // Past this line the mail is gone. The claim must never be released again,
    // whatever happens to the Firestore writes below.
    claim = { ...claim, tracked: false };

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
          sentThreadId,
          sendingStartedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

      // Only these three fields. Never stage, brigade, icpScore, name or company.
      await contactRef.update({
        conversationState: CONVERSATION_STATES.WAITING_ON_CONTACT,
        lastOutboundAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // G1-04: was written with `eventType` and no `timestamp`, so it carried no
      // recognised type and was invisible to every orderBy('timestamp') read.
      // `messageRecordId` MUST stay top-level — process-barry-inbox-queue.js
      // queries the timeline on it directly.
      await contactRef.collection('timeline').add({
        type: 'reply_sent',
        actor: 'user',
        timestamp: FieldValue.serverTimestamp(),
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

      // The mail is already gone. The one write that MUST land is the draft's
      // terminal status — while it still reads "sending", the stale-claim
      // window would eventually let a retry send the same reply again. Try it
      // once more on its own, with the smallest possible payload.
      try {
        await draftRef.update({
          approvalStatus: 'sent',
          draftStatus: 'sent',
          sentMessageId,
          sendingStartedAt: FieldValue.delete(),
        });
      } catch (sealErr) {
        console.error(
          `[barry-approve-send] CRITICAL: ${sentMessageId} sent but the draft could not be ` +
          `marked sent (${sealErr.message}). Draft ${messageRecordId} stays claimed until the ` +
          `stale window expires and could be re-sent by a manual retry.`
        );
      }

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
    // If we claimed the draft but never reached the send, hand it back so the
    // user is not locked out of retrying. `tracked` is cleared the moment the
    // mail actually leaves, so this can never re-open a sent draft.
    if (claim?.tracked && draftRef) {
      await releaseDraftClaim(draftRef, claim.priorStatus);
    }
    return json(500, { error: error.message });
  }
};
