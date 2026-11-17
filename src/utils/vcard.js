import { publicCardView } from '../pages/ContactHub/cardRules';

/**
 * vCard (.vcf) text, version 3.0, which iPhone and Android contacts both read.
 *
 * Two builders, both pure (text in, text out):
 *   buildContactVCard(contact)  - a Scout contact, as Scout has always sent it.
 *   buildMyCardVCard(card)      - a person's own My Card, from what the public
 *                                 view of it allows and nothing else.
 * downloadVCard(contact) is the Scout download; it uses the first.
 */

export const VCARD_MIME_TYPE = 'text/vcard;charset=utf-8';

// Control characters other than the line breaks (10 and 13), which text handles itself.
function stripControl(value) {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    const control = (code < 32 && code !== 10 && code !== 13) || code === 127;
    if (!control) out += character;
  }
  return out;
}

/**
 * A text value: backslash, semicolon, comma and line breaks escaped as the
 * standard asks, so a value can never end its own line or start a new field.
 */
export function escapeVCardText(value) {
  if (value === null || value === undefined) return '';
  return stripControl(String(value))
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** A web address: kept as written, but never able to carry a line break. */
function uriValue(value) {
  return stripControl(String(value)).replace(/[\r\n]+/g, '');
}

const FOLD_AT = 75;
const encoder = new TextEncoder();

/**
 * One content line folded at 75 bytes, as the standard asks: a break and one
 * space. Never inside a multi-byte character.
 */
function foldLine(line) {
  if (encoder.encode(line).length <= FOLD_AT) return line;
  const parts = [];
  let current = '';
  let size = 0;
  // Continuation lines start with a space, which counts toward their 75.
  let limit = FOLD_AT;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (size + width > limit) {
      parts.push(current);
      current = '';
      size = 1;
      limit = FOLD_AT;
    }
    current += character;
    size += width;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** Lines joined with CRLF and ended with one, as the standard asks. */
function assemble(lines) {
  return `${['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].map(foldLine).join('\r\n')}\r\n`;
}

const SCOUT_SOURCE_LABELS = {
  manual: 'Added Manually',
  networking: 'Met at Networking Event',
  apollo: 'Found via Search',
  'Scanned Business Card': 'Scanned Business Card',
  'Found via Apollo': 'Found via Search',
};

/**
 * A Scout contact as vCard text. Same fields and same order as the download
 * has always had (including the source note); values are now escaped.
 * @param {Object} contact - Contact object with name, email, phone, etc.
 */
export function buildContactVCard(contact) {
  const lines = [];

  // Name: Family;Given;Middle;Prefix;Suffix
  if (contact.name) {
    const nameParts = contact.name.trim().split(' ');
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const firstName = nameParts.length > 0 ? nameParts[0] : '';
    const middleNames = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

    lines.push(`N:${escapeVCardText(lastName)};${escapeVCardText(firstName)};${escapeVCardText(middleNames)};;`);
    lines.push(`FN:${escapeVCardText(contact.name)}`);
  }

  if (contact.company_name || contact.company) {
    lines.push(`ORG:${escapeVCardText(contact.company_name || contact.company)}`);
  }

  if (contact.title) {
    lines.push(`TITLE:${escapeVCardText(contact.title)}`);
  }

  // Email (prefer work_email, fallback to email)
  const email = contact.work_email || contact.email;
  if (email) {
    lines.push(`EMAIL;TYPE=WORK:${escapeVCardText(email)}`);
  }

  if (contact.phone_mobile) {
    lines.push(`TEL;TYPE=CELL:${escapeVCardText(contact.phone_mobile)}`);
  }
  if (contact.phone_direct) {
    lines.push(`TEL;TYPE=WORK,VOICE:${escapeVCardText(contact.phone_direct)}`);
  }
  if (contact.phone_work && !contact.phone_direct) {
    lines.push(`TEL;TYPE=WORK:${escapeVCardText(contact.phone_work)}`);
  }
  if (contact.phone && !contact.phone_mobile && !contact.phone_direct && !contact.phone_work) {
    lines.push(`TEL;TYPE=VOICE:${escapeVCardText(contact.phone)}`);
  }

  if (contact.linkedin_url) {
    lines.push(`URL;TYPE=LINKEDIN:${uriValue(contact.linkedin_url)}`);
  }

  // Note with source information (Scout only; My Card never has one)
  if (contact.source) {
    const sourceLabel = SCOUT_SOURCE_LABELS[contact.source] || contact.source;
    lines.push(`NOTE:${escapeVCardText(`Source: ${sourceLabel}`)}`);
  }

  return assemble(lines);
}

/**
 * A person's own My Card as vCard text, or null when the card has no name.
 *
 * Takes the stored card (or the editor's state) and builds from
 * publicCardView(card) alone, so a field the owner has not switched on, the
 * switches themselves, timestamps and anything else in the record can never
 * reach the file. There is no note and no source: a card is not a sales lead.
 *
 * Profiles are written as plain web addresses with a label, which both iPhone
 * and Android keep; Instagram becomes a link from the name stored on the card.
 */
export function buildMyCardVCard(card) {
  const view = publicCardView(card);
  if (!view) return null;

  const lines = [
    `N:${escapeVCardText(view.lastName)};${escapeVCardText(view.firstName)};;;`,
    `FN:${escapeVCardText(view.name)}`,
  ];
  if (view.organization) lines.push(`ORG:${escapeVCardText(view.organization)}`);
  if (view.title) lines.push(`TITLE:${escapeVCardText(view.title)}`);
  if (view.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(view.email)}`);
  if (view.phone) lines.push(`TEL;TYPE=VOICE:${escapeVCardText(view.phone)}`);
  if (view.website) lines.push(`URL:${uriValue(view.website)}`);
  if (view.linkedinUrl) lines.push(`URL;TYPE=LinkedIn:${uriValue(view.linkedinUrl)}`);
  if (view.instagram) lines.push(`URL;TYPE=Instagram:https://www.instagram.com/${uriValue(view.instagram)}`);
  if (view.photoUrl) lines.push(`PHOTO;VALUE=uri:${uriValue(view.photoUrl)}`);
  return assemble(lines);
}

/** A safe file name for a My Card download: "Ada_Lovelace.vcf", or "contact.vcf". */
export function myCardVCardFileName(card) {
  const view = publicCardView(card);
  const base = view
    ? view.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '')
    : '';
  return `${base || 'contact'}.vcf`;
}

/**
 * Generate and download a vCard (.vcf) file for a Scout contact
 * @param {Object} contact - Contact object with name, email, phone, etc.
 */
export function downloadVCard(contact) {
  const vCardContent = buildContactVCard(contact);

  // Create blob and download
  const blob = new Blob([vCardContent], { type: VCARD_MIME_TYPE });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // Generate filename from contact name
  const fileName = contact.name
    ? `${contact.name.replace(/\s+/g, '_')}.vcf`
    : 'contact.vcf';
  link.download = fileName;

  // Trigger download
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);

  console.log('📱 vCard downloaded:', fileName);
}
