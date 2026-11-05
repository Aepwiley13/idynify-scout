/**
 * contactEmails — a contact's email addresses, written consistently.
 *
 * A contact carries its addresses in three fields that must agree:
 *
 *   emails[]           the list the profile shows and edits: [{ id, value, label }]
 *   email              the primary address: always emails[0].value
 *   email_normalized   the identity key: normalizeEmail(email), or null
 *
 * The identity engine matches on `email_normalized` FIRST
 * (src/utils/identityResolution.js, findByEmail; extractIdentifiers reads it
 * before `email`). Profile edits used to write `emails` and `email` and leave
 * `email_normalized` alone, so after a user changed an address the contact
 * still matched the OLD one, and the new one was found only if it happened to
 * be stored lowercase or the contact fell inside the 200-document fallback
 * scan. A missed match is a duplicate contact.
 *
 * So every write of a contact's email list goes through buildEmailWrite(),
 * which returns all three fields together, and the writers apply it in a
 * transaction against the contact as stored (src/services/contactEmailService.js).
 *
 * KNOWN LIMITATIONS — unchanged by this module, tracked in issue #768, pinned
 * by src/test/emailIdentityCrossRecord.test.js:
 *   - Only the PRIMARY address is an identity (ADR-002). The other entries are
 *     shown and kept but not matched, so an import of a contact's secondary
 *     address creates a second contact.
 *   - A save does not look at other contacts. Making an address primary that
 *     another contact already has leaves two contacts with one identity; the
 *     next import of it is refused as ambiguous (IdentityConflictError),
 *     never merged onto the wrong one.
 *   - Barry Enrich (contactProtection.enrichmentPatch) fills `email` without
 *     the other two fields.
 *

 * Pure: no Firebase import, so the read-only drift script can use it too.
 */
import { normalizeEmail } from './identityNormalization.js';

export const EMAIL_LABELS = Object.freeze(['work', 'personal', 'other']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const addressKey = (value) => normalizeEmail(value) ?? text(value).toLowerCase();

/**
 * The list the profile shows, from whatever shape the contact has: its
 * emails[] when that has entries, else its primary address (email, or the
 * provider's work_email) as one 'work' entry, else nothing.
 */
export function readContactEmails(contact = {}) {
  if (Array.isArray(contact.emails) && contact.emails.length > 0) {
    return contact.emails.map((entry, index) => ({
      id: entry?.id ? String(entry.id) : String(index),
      value: typeof entry?.value === 'string' ? entry.value : '',
      label: EMAIL_LABELS.includes(entry?.label) ? entry.label : 'work',
    }));
  }
  const primary = text(contact.email) || text(contact.work_email);
  return primary ? [{ id: '0', value: primary, label: 'work' }] : [];
}

/**
 * One edit, applied to a list. Edits name entries by id, so applying an edit
 * to the list as stored now (not as the screen last saw it) keeps changes
 * another tab or Barry Enrich made meanwhile.
 *
 *   { type: 'upsert', entry: { id, value, label } }   change an entry, or add it at the end
 *   { type: 'remove', id }                           remove an entry
 */
export function applyEmailEdit(list, edit) {
  if (edit?.type === 'remove') return list.filter((entry) => entry.id !== String(edit.id));
  if (edit?.type === 'upsert' && edit.entry && edit.entry.id !== undefined && edit.entry.id !== null) {
    const id = String(edit.entry.id);
    const next = { id, value: typeof edit.entry.value === 'string' ? edit.entry.value : '', label: EMAIL_LABELS.includes(edit.entry.label) ? edit.entry.label : 'work' };
    return list.some((entry) => entry.id === id) ? list.map((entry) => (entry.id === id ? next : entry)) : [...list, next];
  }
  throw new Error('Unknown email edit.');
}

/**
 * The three fields to write for a list: blank entries dropped, values
 * trimmed, the same address once (the first entry wins), the first entry the
 * primary. Clearing every address writes email and email_normalized as null,
 * so the contact no longer matches an address it no longer has. An entry that
 * is not an address (no "@") is kept as typed but identifies nobody.
 */
export function buildEmailWrite(list) {
  const seen = new Set();
  const emails = [];
  for (const entry of list) {
    const value = text(entry?.value);
    if (!value) continue;
    const key = addressKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push({ id: String(entry.id ?? emails.length), value, label: EMAIL_LABELS.includes(entry.label) ? entry.label : 'work' });
  }
  const primary = emails[0]?.value ?? null;
  return { emails, email: primary, email_normalized: primary ? normalizeEmail(primary) : null };
}

/**
 * The email fields of a saved contact, to merge into the contact a page
 * holds. A page keeps fields it computed itself (ContactProfile fills a
 * display-only message count), so a save hands back these three, not the
 * whole stored document.
 */
export function pickEmailFields(saved = {}) {
  return { emails: saved.emails ?? [], email: saved.email ?? null, email_normalized: saved.email_normalized ?? null };
}

/** Whether the contact already has an address anywhere a reader would look. */
export function hasAnyEmail(contact = {}) {
  return Boolean(text(contact.email) || text(contact.work_email)
    || (Array.isArray(contact.emails) && contact.emails.some((entry) => text(entry?.value))));
}

/** Drift codes, for the read-only assessment (scripts/measureEmailIdentityDrift.mjs). */
export const EMAIL_DRIFT = Object.freeze({
  NORMALIZED_MISSING: 'normalized_missing',        // an address, no identity key
  NORMALIZED_STALE: 'normalized_stale',            // the key names a different address
  NORMALIZED_WITHOUT_EMAIL: 'normalized_without_email', // a key, and no address at all
  PRIMARY_MISMATCH: 'primary_mismatch',            // emails[0] is not `email`
  DUPLICATE_ENTRIES: 'duplicate_entries',          // the same address twice in emails[]
  BLANK_ENTRIES: 'blank_entries',                  // empty values in emails[]
});

/**
 * How a stored contact's email fields disagree, as a list of EMAIL_DRIFT
 * codes (empty when consistent). Reads `email`, not `work_email`, as the
 * primary: `work_email` is a provider field the resolver reads only when
 * there is no `email`.
 */
export function emailIdentityDrift(contact = {}) {
  const codes = [];
  const email = text(contact.email);
  const expected = email ? normalizeEmail(email) : null;
  const stored = typeof contact.email_normalized === 'string' && contact.email_normalized ? contact.email_normalized : null;
  if (expected && !stored) codes.push(EMAIL_DRIFT.NORMALIZED_MISSING);
  if (stored && !email) codes.push(EMAIL_DRIFT.NORMALIZED_WITHOUT_EMAIL);
  else if (stored && stored !== expected) codes.push(EMAIL_DRIFT.NORMALIZED_STALE);
  if (Array.isArray(contact.emails) && contact.emails.length > 0) {
    const values = contact.emails.map((entry) => text(entry?.value));
    if (values.some((value) => !value)) codes.push(EMAIL_DRIFT.BLANK_ENTRIES);
    const keys = values.filter(Boolean).map(addressKey);
    if (new Set(keys).size !== keys.length) codes.push(EMAIL_DRIFT.DUPLICATE_ENTRIES);
    const first = values.find(Boolean) ?? '';
    if (first !== email) codes.push(EMAIL_DRIFT.PRIMARY_MISMATCH);
  }
  return codes;
}

export default { readContactEmails, applyEmailEdit, buildEmailWrite, pickEmailFields, hasAnyEmail, emailIdentityDrift, EMAIL_DRIFT, EMAIL_LABELS };
