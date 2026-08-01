/**
 * GMAIL MESSAGE SERVICE — Barry Inbox Intelligence, Sprint 1 (Team A)
 *
 * Shared module for every Team A function that touches Gmail. All OAuth setup,
 * Gmail API access, MIME decoding and NormalizedMessage assembly lives here so
 * the logic is written once and tested once.
 *
 * Team A's responsibility ends at the NormalizedMessage object. Team B's
 * processNormalizedMessage() takes it from there.
 *
 * Exports:
 *   getOAuthClient(userId, db)        — OAuth setup + token refresh (Firestore-backed)
 *   fetchMessage(gmail, messageId)    — single message, format: full
 *   fetchThread(gmail, threadId)      — full thread
 *   fetchHistorySince(gmail, id)      — messages added since a history cursor
 *   fetchRecentInbox(gmail, max)      — bootstrap: recent N INBOX message IDs
 *   normalizeMessage(raw, ...)        — raw Gmail message → NormalizedMessage
 *   decodeBody(payload)               — MIME decoder → { bodyText, bodyHtml, attachments }
 *   classifyMessage(...)              — → MessageCategory
 *   stripQuotedReply(bodyText)        — → { newContent, quotedContent }
 *   extractSignature(bodyText)        — → { bodyWithoutSig, signature }
 *   parseEmailAddress(headerValue)    — → { email, name }
 *   shouldProcessMessage(msg, ctx)    — Section 4 inbound filter
 *   isKnownContact(db, userId, email) — lightweight contacts lookup
 *   isKnownIdynifyThread(db, ...)     — thread already in communication_records
 */

import { google } from 'googleapis';
import { MESSAGE_CATEGORIES, MESSAGE_DIRECTIONS } from '../../../src/types/normalizedMessage.js';

export const INGESTION_VERSION = '1.0.0';

const MAX_BODY_LENGTH = 50000;

/** Gmail labels whose messages are never ingested. */
export const EXCLUDED_LABEL_IDS = [
  'SPAM',
  'TRASH',
  'DRAFT',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_SOCIAL',
  'CATEGORY_FORUMS',
];

/** A message must carry one of these to be considered for ingestion. */
export const INCLUDED_LABEL_IDS = ['INBOX', 'SENT'];

// ─────────────────────────────────────────────────────────────────────────────
// Header helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Case-insensitive header lookup over Gmail's `payload.headers` array.
 * @param {Array<{name: string, value: string}>} headers
 * @param {string} name
 * @returns {string|null}
 */
export function getHeader(headers, name) {
  if (!Array.isArray(headers)) return null;
  const target = String(name).toLowerCase();
  const hit = headers.find((h) => h?.name && String(h.name).toLowerCase() === target);
  return hit?.value ?? null;
}

/**
 * Split an address-list header on commas that are not inside quotes or angle
 * brackets, so `"Doe, Jane" <j@a.com>, bob@b.com` yields two addresses.
 * @param {string|null} headerValue
 * @returns {string[]}
 */
export function splitAddressList(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return [];
  const out = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (const ch of headerValue) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<' && !inQuotes) inAngle = true;
    else if (ch === '>' && !inQuotes) inAngle = false;

    if (ch === ',' && !inQuotes && !inAngle) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);

  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse a single address header value into its email and display name.
 * @param {string|null} headerValue
 * @returns {{ email: string, name: string|null }}
 */
export function parseEmailAddress(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return { email: '', name: null };

  const value = headerValue.trim();
  const angle = value.match(/<([^>]*)>/);

  if (angle) {
    const email = (angle[1] || '').trim().toLowerCase();
    const name = value
      .slice(0, angle.index)
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    return { email, name: name || null };
  }

  const bare = value.match(/[^\s<>,;:"]+@[^\s<>,;:"]+/);
  return { email: bare ? bare[0].toLowerCase() : '', name: null };
}

/** Extract every email address from an address-list header, lowercased. */
function parseAddressListEmails(headerValue) {
  return splitAddressList(headerValue)
    .map((entry) => parseEmailAddress(entry).email)
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME decoding
// ─────────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => NAMED_ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * Convert an HTML body to readable plain text. Block-level tags become line
 * breaks so quoted-reply and signature detection still has line structure.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
      .replace(/<(hr)\s*\/?>/gi, '\n---\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBase64Url(data) {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf-8');
  } catch {
    return '';
  }
}

function isAttachmentPart(part) {
  if (!part) return false;
  if (part.body?.attachmentId) return true;
  return Boolean(part.filename && part.filename.length > 0);
}

function walkParts(part, acc) {
  if (!part) return;

  if (isAttachmentPart(part)) {
    acc.attachments.push({
      filename: part.filename || '(unnamed)',
      mimeType: part.mimeType || 'application/octet-stream',
      sizeBytes: Number(part.body?.size) || 0,
      gmailAttachmentId: part.body?.attachmentId || '',
    });
    return;
  }

  const data = part.body?.data;
  if (data) {
    if (part.mimeType === 'text/plain' && !acc.bodyText) {
      acc.bodyText = decodeBase64Url(data);
    } else if (part.mimeType === 'text/html' && !acc.bodyHtml) {
      acc.bodyHtml = decodeBase64Url(data);
    }
  }

  // Recurse through multipart/mixed → multipart/alternative → leaf parts.
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) walkParts(child, acc);
  }
}

/**
 * Decode a Gmail message payload into plain text, HTML and attachment metadata.
 *
 * Extends the decodeBody() in gmail-get-thread.js: it returns bodyText AND
 * bodyHtml separately, recurses through nested multipart containers, and
 * collects attachment metadata alongside the body.
 *
 * @param {object} payload — rawMessage.payload
 * @returns {{ bodyText: string, bodyHtml: string|null, attachments: Array<{filename: string, mimeType: string, sizeBytes: number, gmailAttachmentId: string}> }}
 */
export function decodeBody(payload) {
  const acc = { bodyText: '', bodyHtml: null, attachments: [] };
  walkParts(payload, acc);

  // No text/plain part (HTML-only sender) — derive plain text from the HTML.
  if (!acc.bodyText && acc.bodyHtml) {
    acc.bodyText = htmlToText(acc.bodyHtml);
  }

  acc.bodyText = (acc.bodyText || '').replace(/\r\n/g, '\n').trim();
  acc.bodyHtml = acc.bodyHtml || null;
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quoted reply stripping
// ─────────────────────────────────────────────────────────────────────────────

const QUOTE_MARKERS = [
  // "On Mon, Jan 1, 2026 at 9:00 AM Jane Doe <jane@acme.com> wrote:" — may wrap.
  /^On\s[\s\S]{0,300}?\bwrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{2,}\s*Forwarded message\s*-{2,}/im,
  // Outlook's horizontal rule separator.
  /^_{10,}\s*$/m,
  // A From: header block that starts a quoted section (must follow a blank line).
  /\n[ \t]*\n[ \t]*From:[ \t]\S/,
  // Classic email quote character at the start of a line.
  /^[ \t]*>/m,
];

/**
 * Split a plain-text body into the sender's new content and the quoted prior
 * conversation. bodyText in NormalizedMessage must contain only new content.
 *
 * @param {string} bodyText
 * @returns {{ newContent: string, quotedContent: string|null }}
 */
export function stripQuotedReply(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') {
    return { newContent: '', quotedContent: null };
  }

  let cutIndex = -1;
  for (const marker of QUOTE_MARKERS) {
    const match = bodyText.match(marker);
    if (!match || match.index === undefined) continue;

    // The `\n\n From:` marker matches the blank line before the header — cut at
    // the header itself so the blank line stays with the new content.
    const offset = match[0].startsWith('\n') ? match[0].search(/\S/) : 0;
    const index = match.index + offset;
    if (cutIndex === -1 || index < cutIndex) cutIndex = index;
  }

  if (cutIndex <= 0) {
    // No marker, or the whole body is quoted (marker at index 0).
    if (cutIndex === 0) return { newContent: '', quotedContent: bodyText.trim() };
    return { newContent: bodyText.trim(), quotedContent: null };
  }

  const newContent = bodyText.slice(0, cutIndex).trim();
  const quotedContent = bodyText.slice(cutIndex).trim();
  return { newContent, quotedContent: quotedContent || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature extraction
// ─────────────────────────────────────────────────────────────────────────────

// RFC 3676 signature delimiter — "-- " on its own line (trailing space optional
// in the wild).
const SIG_DELIMITER = /^--[ \t]*$/m;

const SIG_CLOSINGS =
  /^[ \t]*(best|best regards|regards|thanks|thanks again|thank you|many thanks|cheers|sincerely|warm regards|warmest regards|kind regards|talk soon|all the best|yours truly|respectfully)[,.!]?[ \t]*$/im;

const SIG_MOBILE = /^[ \t]*(sent from my [^\n]*|get outlook for [^\n]*)$/im;

const MAX_SIGNATURE_LINES = 8;

/**
 * Separate a trailing signature block from the message body.
 *
 * Deliberately conservative: a candidate is only accepted when it sits at the
 * end of the message, is short, and leaves a non-empty body behind — bodyText
 * must never be emptied by signature detection.
 *
 * @param {string} bodyText
 * @returns {{ bodyWithoutSig: string, signature: string|null }}
 */
export function extractSignature(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') {
    return { bodyWithoutSig: '', signature: null };
  }

  const accept = (cutIndex) => {
    const body = bodyText.slice(0, cutIndex).trim();
    const signature = bodyText.slice(cutIndex).trim();
    if (!body || !signature) return null;
    if (signature.split('\n').length > MAX_SIGNATURE_LINES) return null;
    return { bodyWithoutSig: body, signature };
  };

  // 1. Explicit "--" delimiter wins — it is unambiguous.
  const delimiter = bodyText.match(SIG_DELIMITER);
  if (delimiter && delimiter.index !== undefined) {
    const result = accept(delimiter.index);
    if (result) return result;
  }

  // 2. "Sent from my iPhone" style footers.
  const mobile = bodyText.match(SIG_MOBILE);
  if (mobile && mobile.index !== undefined) {
    const result = accept(mobile.index);
    if (result) return result;
  }

  // 3. A closing ("Best," / "Thanks,") followed by only a few short lines.
  const closing = bodyText.match(SIG_CLOSINGS);
  if (closing && closing.index !== undefined) {
    const tail = bodyText.slice(closing.index);
    const tailLines = tail.trim().split('\n');
    const looksLikeSignOff =
      tailLines.length <= MAX_SIGNATURE_LINES &&
      tailLines.every((line) => line.trim().length <= 80);
    if (looksLikeSignOff) {
      const result = accept(closing.index);
      if (result) return result;
    }
  }

  return { bodyWithoutSig: bodyText.trim(), signature: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

const NOREPLY_LOCAL_PART =
  /^(no[-._]?reply|do[-._]?not[-._]?reply|donotreply|notifications?|mailer[-._]?daemon|postmaster|bounce[s]?|automated|auto[-._]?reply|alerts?|updates?|newsletter|news|info|support|billing|receipts?)([-._+][^@]*)?$/i;

const AUTOMATED_SUBJECTS =
  /(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|delivery (status )?notification|undeliverable|mail delivery (failed|subsystem)|returned mail|read receipt|unsubscribe confirmation|password reset|verify your email|your receipt|invoice #)/i;

const INTERNAL_LOCAL_PART = /(^|[.+_-])(test|qa|staging|dev|sandbox)([.+_-]|$)/i;

const INTERNAL_SUBJECT = /^\s*\[(test|qa|staging|internal)\]/i;

/**
 * Determine whether a message is machine-generated.
 * @param {Array<{name: string, value: string}>} headers
 * @param {string} fromEmail
 * @returns {boolean}
 */
function looksAutomated(headers, fromEmail) {
  if (getHeader(headers, 'List-Unsubscribe')) return true;
  if (getHeader(headers, 'List-Id')) return true;
  if (getHeader(headers, 'X-Automated-Response')) return true;
  if (getHeader(headers, 'X-Auto-Response-Suppress')) return true;
  if (getHeader(headers, 'Auto-Submitted') &&
      !/^no$/i.test(getHeader(headers, 'Auto-Submitted').trim())) return true;
  if (getHeader(headers, 'Precedence') &&
      /^(bulk|list|junk|auto_reply)$/i.test(getHeader(headers, 'Precedence').trim())) return true;

  const mailer = getHeader(headers, 'X-Mailer');
  if (mailer && /(mailchimp|sendgrid|hubspot|marketo|constant ?contact|klaviyo)/i.test(mailer)) {
    return true;
  }

  const subject = getHeader(headers, 'Subject') || '';
  if (AUTOMATED_SUBJECTS.test(subject)) return true;

  const localPart = (fromEmail || '').split('@')[0] || '';
  if (NOREPLY_LOCAL_PART.test(localPart)) return true;

  return false;
}

/**
 * Classify an inbound message into one of the five MESSAGE_CATEGORIES.
 *
 * Evaluation order is automated → internal → reply → new_inbound → unknown.
 * Automated is checked first on purpose: a newsletter with "Re:" in its subject
 * would otherwise be mistaken for a real reply. An automated message that lands
 * on a thread Idynify already knows about is still ingested (see
 * shouldProcessMessage), so nothing real is lost by checking it first.
 *
 * @param {Array<{name: string, value: string}>} headers
 * @param {string} bodyText
 * @param {string} fromEmail
 * @param {string} userEmail — the connected Gmail address
 * @param {{ threadMessageCount?: number, isKnownContact?: boolean }} [options]
 * @returns {"reply"|"new_inbound"|"unknown"|"automated"|"internal"}
 */
export function classifyMessage(headers, bodyText, fromEmail, userEmail, options = {}) {
  const { threadMessageCount = 1, isKnownContact = false } = options;
  const from = (fromEmail || '').toLowerCase().trim();
  const user = (userEmail || '').toLowerCase().trim();

  if (looksAutomated(headers, from)) return MESSAGE_CATEGORIES.AUTOMATED;

  // Internal: same domain as the connected account AND an explicit test marker.
  const fromDomain = from.split('@')[1] || '';
  const userDomain = user.split('@')[1] || '';
  if (fromDomain && userDomain && fromDomain === userDomain) {
    const localPart = from.split('@')[0] || '';
    const subject = getHeader(headers, 'Subject') || '';
    if (INTERNAL_LOCAL_PART.test(localPart) || INTERNAL_SUBJECT.test(subject)) {
      return MESSAGE_CATEGORIES.INTERNAL;
    }
  }

  const subject = getHeader(headers, 'Subject') || '';
  const isReply =
    /^\s*re\s*:/i.test(subject) ||
    Boolean(getHeader(headers, 'In-Reply-To')) ||
    (Boolean(getHeader(headers, 'References')) && threadMessageCount > 1);
  if (isReply) return MESSAGE_CATEGORIES.REPLY;

  if (isKnownContact) return MESSAGE_CATEGORIES.NEW_INBOUND;

  return MESSAGE_CATEGORIES.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────────
// NormalizedMessage assembly
// ─────────────────────────────────────────────────────────────────────────────

function toIsoOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Convert a raw Gmail message (format: full) into a NormalizedMessage.
 *
 * @param {object} rawMessage — the Gmail API message resource
 * @param {string} idynifyUserId — Firestore user doc ID
 * @param {string} gmailAccountId — the connected Gmail address
 * @param {{ threadMessageCount?: number, isKnownContact?: boolean }} [options]
 * @returns {import('../../../src/types/normalizedMessage.js').NormalizedMessage}
 */
export function normalizeMessage(rawMessage, idynifyUserId, gmailAccountId, options = {}) {
  const headers = rawMessage?.payload?.headers || [];
  const accountId = (gmailAccountId || '').toLowerCase().trim();

  const { bodyText: rawBodyText, bodyHtml, attachments } = decodeBody(rawMessage?.payload);
  const { newContent, quotedContent } = stripQuotedReply(rawBodyText || '');
  const { bodyWithoutSig, signature } = extractSignature(newContent);

  const { email: fromEmailRaw, name: fromName } = parseEmailAddress(getHeader(headers, 'From'));
  const fromEmail = fromEmailRaw.toLowerCase().trim();

  const subject = getHeader(headers, 'Subject') || '(no subject)';

  // internalDate is Gmail's authoritative receive time in epoch milliseconds.
  const receivedAt =
    toIsoOrNull(Number.parseInt(rawMessage?.internalDate, 10)) ||
    toIsoOrNull(getHeader(headers, 'Date')) ||
    new Date().toISOString();

  const toEmails = parseAddressListEmails(getHeader(headers, 'To'));
  const ccEmails = parseAddressListEmails(getHeader(headers, 'Cc'));

  const direction =
    fromEmail && fromEmail === accountId
      ? MESSAGE_DIRECTIONS.OUTBOUND
      : MESSAGE_DIRECTIONS.INBOUND;

  const threadMessageCount = Math.max(1, Number(options.threadMessageCount) || 1);

  // Outbound messages are not categorised — "unknown" keeps the payload schema
  // valid (there is no "outbound" category) and they are filtered out before
  // reaching Team B anyway.
  const category =
    direction === MESSAGE_DIRECTIONS.INBOUND
      ? classifyMessage(headers, bodyWithoutSig, fromEmail, accountId, {
          threadMessageCount,
          isKnownContact: Boolean(options.isKnownContact),
        })
      : MESSAGE_CATEGORIES.UNKNOWN;

  // bodyText must be non-empty — fall back to the subject, then to a marker.
  const bodyText = (bodyWithoutSig || newContent || subject || '(no content)').slice(
    0,
    MAX_BODY_LENGTH
  );

  return {
    idynifyUserId,
    gmailAccountId: accountId,
    gmailMessageId: rawMessage?.id,
    gmailThreadId: rawMessage?.threadId,
    direction,
    category,
    fromEmail,
    fromName: fromName || null,
    toEmails,
    ccEmails,
    subject,
    receivedAt,
    sentAt: toIsoOrNull(getHeader(headers, 'Date')),
    bodyText,
    bodyHtml: bodyHtml || null,
    quotedReplyText: quotedContent || null,
    signature: signature || null,
    attachments: attachments || [],
    threadMessageCount,
    isFirstMessageInThread: threadMessageCount === 1,
    ingestedAt: new Date().toISOString(),
    ingestionVersion: INGESTION_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — inbound filtering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide whether a normalized message should be handed to Team B.
 *
 * The bias is toward processing: Team B queues unknown senders in
 * unmatched_messages, so a false positive is cheap while a dropped reply from a
 * real prospect is not. Only outbound mail and pure automated noise with no
 * known thread are hard skips.
 *
 * @param {import('../../../src/types/normalizedMessage.js').NormalizedMessage} message
 * @param {{ labelIds?: string[], isKnownThread?: boolean }} [context]
 * @returns {{ process: boolean, reason: string }}
 */
export function shouldProcessMessage(message, context = {}) {
  const { labelIds = [], isKnownThread = false } = context;

  if (message.direction === MESSAGE_DIRECTIONS.OUTBOUND) {
    return { process: false, reason: 'outbound' };
  }

  if (message.fromEmail && message.fromEmail === message.gmailAccountId) {
    return { process: false, reason: 'self_sent' };
  }

  if (Array.isArray(labelIds) && labelIds.length > 0) {
    const excluded = labelIds.find((label) => EXCLUDED_LABEL_IDS.includes(label));
    if (excluded) return { process: false, reason: `excluded_label:${excluded}` };

    const included = labelIds.some((label) => INCLUDED_LABEL_IDS.includes(label));
    if (!included) return { process: false, reason: 'no_inbox_or_sent_label' };
  }

  if (message.category === MESSAGE_CATEGORIES.INTERNAL) {
    return { process: false, reason: 'internal' };
  }

  if (message.category === MESSAGE_CATEGORIES.AUTOMATED && !isKnownThread) {
    return { process: false, reason: 'automated_unknown_thread' };
  }

  return { process: true, reason: 'ok' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore lookups used by classification and filtering
// ─────────────────────────────────────────────────────────────────────────────

async function hasMatch(query) {
  const snap = await query.limit(1).get();
  return !snap.empty;
}

/**
 * True when the sender already exists as a contact for this user. Used only to
 * separate "new_inbound" from "unknown" — both are processed either way.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} userId
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function isKnownContact(db, userId, email) {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return false;

  const contacts = db.collection('users').doc(userId).collection('contacts');
  try {
    if (await hasMatch(contacts.where('primaryEmail', '==', normalized))) return true;
    if (await hasMatch(contacts.where('email', '==', normalized))) return true;
    if (await hasMatch(contacts.where('secondaryEmails', 'array-contains', normalized))) return true;
  } catch (err) {
    console.warn('[gmailMessageService] isKnownContact lookup failed:', err.message);
  }
  return false;
}

/**
 * True when this Gmail thread already has a communication_record — i.e. Idynify
 * has seen the conversation before, so even automated mail on it is relevant.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} userId
 * @param {string} threadId
 * @returns {Promise<boolean>}
 */
export async function isKnownIdynifyThread(db, userId, threadId) {
  if (!threadId) return false;
  try {
    return await hasMatch(
      db
        .collection('communication_records')
        .where('gmailThreadId', '==', threadId)
        .where('idynifyUserId', '==', userId)
    );
  } catch (err) {
    console.warn('[gmailMessageService] isKnownIdynifyThread lookup failed:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth + Gmail API access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a user's Gmail credentials and return a ready-to-use OAuth client,
 * refreshing the access token when it is within 60 seconds of expiry.
 *
 * Returns null when the user has no connected Gmail account or the refresh
 * fails — in the latter case syncStatus is set to "needs_reconnect" first.
 * Callers skip the user and continue; this never throws for a single account.
 *
 * @param {string} userId
 * @param {import('firebase-admin/firestore').Firestore} db
 * @returns {Promise<{ oauth2Client: object, gmailData: object, gmailDocRef: object }|null>}
 */
export async function getOAuthClient(userId, db) {
  const gmailDoc = await db
    .collection('users').doc(userId)
    .collection('integrations').doc('gmail')
    .get();

  if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
    return null; // User's Gmail not connected — skip
  }

  const gmailData = gmailDoc.data();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth not configured');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
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
    } catch (err) {
      console.warn(`[gmailMessageService] Token refresh failed for ${userId}:`, err.message);
      await gmailDoc.ref.update({
        syncStatus: 'needs_reconnect',
        lastSyncError: `Token refresh failed: ${err.message}`,
      });
      return null; // Caller skips this user
    }
  }

  return { oauth2Client, gmailData, gmailDocRef: gmailDoc.ref };
}

/**
 * Fetch a single message with its full payload.
 * @param {object} gmail — an authenticated gmail_v1 client
 * @param {string} messageId
 */
export async function fetchMessage(gmail, messageId) {
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  return res.data;
}

/**
 * Fetch a thread. Defaults to metadata format — the sync worker only needs the
 * message count, and metadata is far cheaper than full.
 * @param {object} gmail
 * @param {string} threadId
 * @param {string} [format]
 */
export async function fetchThread(gmail, threadId, format = 'metadata') {
  const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format });
  return res.data;
}

/**
 * List messages added since a history cursor.
 *
 * Each returned entry carries the historyId of the record it came from, so a
 * caller that stops early can still advance the cursor to the last message it
 * successfully processed.
 *
 * @param {object} gmail
 * @param {string} historyId — startHistoryId
 * @param {{ maxPages?: number }} [options]
 * @returns {Promise<{ messages: Array<{ id: string, historyId: string }>, latestHistoryId: string, truncated: boolean }>}
 */
export async function fetchHistorySince(gmail, historyId, options = {}) {
  const { maxPages = 5 } = options;

  const messages = [];
  const seen = new Set();
  let latestHistoryId = historyId;
  let pageToken;
  let pages = 0;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });

    const data = res?.data || {};
    if (data.historyId) latestHistoryId = String(data.historyId);

    for (const record of data.history || []) {
      const recordHistoryId = String(record.id ?? latestHistoryId);
      for (const added of record.messagesAdded || []) {
        const id = added?.message?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        messages.push({ id, historyId: recordHistoryId });
      }
    }

    pageToken = data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return { messages, latestHistoryId: String(latestHistoryId), truncated: Boolean(pageToken) };
}

/**
 * Bootstrap path — the most recent INBOX message IDs, newest first.
 * @param {object} gmail
 * @param {number} [maxResults]
 * @returns {Promise<string[]>}
 */
export async function fetchRecentInbox(gmail, maxResults = 20) {
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    labelIds: ['INBOX'],
  });
  return (res?.data?.messages || []).map((m) => m.id).filter(Boolean);
}
