/**
 * contactDisplayName — the one rule for what to call a contact on screen.
 *
 *   first + last  →  "Ana Lopez"
 *   first only    →  "Ana"
 *   last only     →  "Lopez"
 *   no name       →  the email address (or "Unknown contact" when the email
 *                    is already shown next to it)
 *
 * An email address is never turned into a human name ("sam.ray@x.com" is not
 * "Sam Ray"). Older CSV imports stored the address in `name` for email-only
 * rows; a `name` containing "@" is treated as no name, so those contacts read
 * the same as new ones. Presentation only — nothing here is written back.
 *
 * Pure: imported by the browser and by netlify/functions/barryBulkPersonalize.js.
 */
import { displayNameCase } from './emailGreeting.js';

export const UNKNOWN_CONTACT = 'Unknown contact';

/** A usable name part, or ''. Drops blanks, email addresses and "undefined"/"null" left by bad exports. */
export function cleanNamePart(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text.includes('@') || /^(undefined|null|n\/a|none|-+)$/i.test(text)) return '';
  return text;
}

/** The structured name parts a contact carries, from whichever field shape it uses. */
export function nameParts(contact) {
  const c = contact ?? {};
  const name = cleanNamePart(c.name);
  const explicitFirst = cleanNamePart(c.first_name ?? c.firstName);
  const explicitLast = cleanNamePart(c.last_name ?? c.lastName);
  // A full name is only split when it is more than the last name on its own
  // ("Lopez" with last_name "Lopez" has no first name).
  const nameIsJustLast = explicitLast && name.toLowerCase() === explicitLast.toLowerCase();
  const tokens = name && !nameIsJustLast ? name.split(' ') : [];
  return {
    name,
    first: explicitFirst || tokens[0] || '',
    last: explicitLast || tokens.slice(1).join(' '),
  };
}

/** First name for a greeting: display-cased, or '' when the contact has none. */
export function contactFirstName(contact) {
  return displayNameCase(nameParts(contact).first);
}

/**
 * The label for a contact.
 * @param {object} contact
 * @param {{ email?: boolean }} [opts]  email: false → "Unknown contact" instead
 *   of the address, for places that already show the email beside the name.
 */
export function contactDisplayName(contact, { email = true } = {}) {
  const { name, first, last } = nameParts(contact);
  const label = name || [first, last].filter(Boolean).join(' ');
  if (label) return displayNameCase(label);
  const address = String(contact?.email ?? contact?.work_email ?? '').trim();
  return email && address ? address : UNKNOWN_CONTACT;
}

/** Which name parts are missing: [] for a complete name, else e.g. ['first name', 'last name']. */
export function missingNameFields(contact) {
  const { first, last } = nameParts(contact);
  return [!first && 'first name', !last && 'last name'].filter(Boolean);
}

/** No usable name at all — the "Needs name" signal in People and the CSV preview. */
export function needsName(contact) {
  return missingNameFields(contact).length === 2;
}
