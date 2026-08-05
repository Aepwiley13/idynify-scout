/**
 * identityNormalization — how two identifiers are decided to be the same one.
 *
 * Extracted from contactIdentityService so that BOTH the live resolver and the
 * offline duplicate-detection script can import it. That is the entire reason
 * this file exists: a report that normalizes differently from the resolver
 * reports duplicates the product would not have merged, and misses ones it
 * would — which makes the report worse than no report, because it looks
 * authoritative.
 *
 * Deliberately dependency-free. No Firestore, no React, no firebase-admin.
 * `scripts/detectDuplicateContacts.mjs` runs under Node with the Admin SDK and
 * `src/services/contactIdentityService.js` runs in the browser with the web
 * SDK; the only way both can share this code is if it imports neither.
 *
 * Every function is total: any input, including null and the wrong type,
 * returns either a normalized string or null. A normalizer that throws on a
 * malformed record would take down a save, and malformed records exist.
 */

/**
 * Normalize an email for matching: lowercase, trim.
 *
 * Deliberately NOT doing more. Gmail dot-stripping and plus-tag removal are
 * tempting and wrong here: `a.b@gmail.com` and `ab@gmail.com` are the same
 * Gmail inbox but different addresses at most other providers, and
 * `user+acme@` is a real routing distinction people rely on. Over-normalizing
 * merges two people; under-normalizing creates a duplicate the user can see
 * and fix. The second failure is the recoverable one.
 *
 * @returns {string|null} normalized address, or null if there isn't one
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
}

/**
 * Normalize a LinkedIn URL for matching.
 *
 * The same profile arrives as `https://www.linkedin.com/in/jane-doe/`,
 * `http://linkedin.com/in/jane-doe`, and `linkedin.com/in/jane-doe?trk=…`.
 * Scheme, `www.`, trailing slash, query string, fragment and case are noise.
 */
export function normalizeLinkedInUrl(url) {
  if (typeof url !== 'string') return null;
  let value = url.trim().toLowerCase();
  if (!value) return null;
  value = value.split('?')[0].split('#')[0];
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  return value || null;
}

/**
 * Normalize a phone number to its digits, keeping a leading +.
 *
 * `(415) 555-0100`, `415-555-0100` and `+1 415 555 0100` are the same number
 * written three ways. Note the last normalizes to `+14155550100` and the first
 * two to `4155550100` — this does NOT infer a country code, because guessing
 * +1 for a workspace selling into Europe would merge unrelated people.
 */
export function normalizePhone(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 7) return null; // too short to identify anyone
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/** Normalize a name or company for the weak name+company comparison. */
export function normalizeLoose(value) {
  if (typeof value !== 'string') return null;
  const out = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return out || null;
}

/**
 * Pull the identifiers out of whatever shape a contact-ish record happens to
 * hold.
 *
 * Apollo payloads, Gmail headers, OCR output, CSV rows and hand-typed forms
 * all name these fields differently — `organization_name` vs `company_name` vs
 * `company`, `phone_numbers[0].sanitized_number` vs `phone` vs `phone_mobile`.
 * Every caller normalizing that itself is how ten write paths diverged in the
 * first place, so it happens once, here.
 *
 * Reads the `*_normalized` fields first where they exist: records written from
 * the canonical-identity sprint forward carry them, and trusting the stored
 * value keeps the report consistent with what the resolver matched on.
 */
export function extractIdentifiers(candidate = {}) {
  const email = normalizeEmail(
    candidate.email_normalized
    ?? candidate.email
    ?? candidate.work_email
    ?? candidate.email_address
    ?? null
  );

  const phoneSource =
    candidate.phone_normalized
    ?? candidate.phone
    ?? candidate.phone_mobile
    ?? candidate.mobile_phone
    ?? candidate.phone_numbers?.[0]?.sanitized_number
    ?? candidate.phone_numbers?.[0]
    ?? null;

  return {
    contactId: candidate.contactId ?? candidate.contact_id ?? null,
    email,
    apolloPersonId: candidate.apollo_person_id ?? candidate.apolloPersonId ?? null,
    linkedinUrl: normalizeLinkedInUrl(
      candidate.linkedin_url_normalized ?? candidate.linkedin_url ?? candidate.linkedinUrl ?? null
    ),
    phone: normalizePhone(phoneSource),
    name: normalizeLoose(
      candidate.name
      ?? [candidate.first_name ?? candidate.firstName, candidate.last_name ?? candidate.lastName]
        .filter(Boolean).join(' ')
    ),
    company: normalizeLoose(
      candidate.company_name
      ?? candidate.companyName
      ?? candidate.company
      ?? candidate.organization_name
      ?? candidate.organization?.name
      ?? null
    ),
    companyId: candidate.company_id ?? candidate.companyId ?? null,
  };
}

export default {
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizePhone,
  normalizeLoose,
  extractIdentifiers,
};
