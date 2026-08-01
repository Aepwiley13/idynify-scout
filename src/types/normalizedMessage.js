/**
 * NormalizedMessage — shared contract between Team A (Gmail ingestion) and Team B (processing).
 *
 * @typedef {"inbound" | "outbound"} MessageDirection
 *
 * @typedef {"reply" | "new_inbound" | "unknown" | "automated" | "internal"} MessageCategory
 *
 * @typedef {Object} AttachmentMeta
 * @property {string} filename
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {string} gmailAttachmentId
 *
 * @typedef {Object} NormalizedMessage
 * @property {string} idynifyUserId      - Firestore user doc ID
 * @property {string} gmailAccountId     - Connected Gmail address
 * @property {string} gmailMessageId     - Unique Gmail message ID (dedup key)
 * @property {string} gmailThreadId      - Gmail thread this belongs to
 * @property {MessageDirection} direction
 * @property {MessageCategory} category
 * @property {string} fromEmail
 * @property {string|null} fromName
 * @property {string[]} toEmails
 * @property {string[]} ccEmails
 * @property {string} subject
 * @property {string} receivedAt         - ISO 8601 UTC
 * @property {string|null} sentAt
 * @property {string} bodyText           - Plain text, quoted replies removed (max 50k chars)
 * @property {string|null} bodyHtml
 * @property {string|null} quotedReplyText
 * @property {string|null} signature
 * @property {AttachmentMeta[]} attachments
 * @property {number} threadMessageCount
 * @property {boolean} isFirstMessageInThread
 * @property {string} ingestedAt         - ISO 8601 UTC
 * @property {string} ingestionVersion
 */

export const MESSAGE_DIRECTIONS = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
};

export const MESSAGE_CATEGORIES = {
  REPLY: 'reply',
  NEW_INBOUND: 'new_inbound',
  UNKNOWN: 'unknown',
  AUTOMATED: 'automated',
  INTERNAL: 'internal',
};

const REQUIRED_FIELDS = [
  'idynifyUserId',
  'gmailAccountId',
  'gmailMessageId',
  'gmailThreadId',
  'direction',
  'category',
  'fromEmail',
  'toEmails',
  'subject',
  'receivedAt',
  'bodyText',
  'attachments',
  'threadMessageCount',
  'isFirstMessageInThread',
  'ingestedAt',
  'ingestionVersion',
];

const MAX_BODY_LENGTH = 50000;

export function validateNormalizedMessage(msg) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (msg[field] === undefined || msg[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (msg.bodyText !== undefined && msg.bodyText !== null) {
    if (typeof msg.bodyText !== 'string' || msg.bodyText.length === 0) {
      errors.push('bodyText must be a non-empty string');
    }
    if (typeof msg.bodyText === 'string' && msg.bodyText.length > MAX_BODY_LENGTH) {
      errors.push(`bodyText exceeds ${MAX_BODY_LENGTH} characters`);
    }
  }

  if (msg.direction && !Object.values(MESSAGE_DIRECTIONS).includes(msg.direction)) {
    errors.push(`Invalid direction: ${msg.direction}`);
  }

  if (msg.category && !Object.values(MESSAGE_CATEGORIES).includes(msg.category)) {
    errors.push(`Invalid category: ${msg.category}`);
  }

  if (msg.attachments !== undefined && msg.attachments !== null && !Array.isArray(msg.attachments)) {
    errors.push('attachments must be an array');
  }

  return { valid: errors.length === 0, errors };
}
