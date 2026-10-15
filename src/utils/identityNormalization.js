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

// ─── Relationship Capture keys ──────────────────────────────────────────────
//
// ADDITIVE ONLY. Nothing above this line changed when these were added, and
// nothing in the app calls them yet: the capture pipeline adopts them in later
// PRs. The four helpers above stay exactly as they were because today's contact
// matching depends on their output. `normalizePhone`, for example, folds an
// extension into the number and keeps a UK "(0)"; fixing that here would
// silently change which existing contacts match. `normalizeCapturePhone` does
// both correctly, for capture only.
//
// Like the rest of this file they are dependency-free and total: any input
// returns a value, never a throw. (The public-suffix-aware `domainKey` lives in
// src/capture/validators.js, because its dependency would otherwise be bundled
// into every server function that imports this file.)

/** Legal-form words dropped from the END of a company name for comparison. */
const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'plc', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'bv', 'nv', 'pty', 'pte', 'srl',
  'spa', 'oy', 'ab', 'kk', 'lda',
]);

/**
 * A company name reduced for COMPARISON — never for display.
 *
 * Accents folded, case and punctuation removed, spaces collapsed, a leading
 * "the" and trailing legal forms dropped: "Acmé, Inc." and "ACME INC" both
 * become `acme`. The printed name is always kept separately; this key is only
 * ever compared against another key.
 *
 * Returns null when nothing distinctive is left ("Inc.", "The Co."), so a
 * caller can tell "no key" from "a key".
 */
export function nameKey(name) {
  if (typeof name !== 'string') return null;
  const tokens = name
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Dots and apostrophes join rather than split: "L.L.C." → "llc", "Macy's" → "macys".
    .replace(/[.'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokens[0] === 'the') tokens.shift();
  while (tokens.length && (LEGAL_SUFFIXES.has(tokens.at(-1)) || tokens.at(-1) === 'and')) {
    tokens.pop();
  }
  return tokens.length ? tokens.join(' ') : null;
}

/**
 * Printed labels, tried against the start of the text. A label counts only
 * when the number follows it directly, so "Tel/Fax:" is not read as "Tel".
 */
const PHONE_LABELS = [
  [/^(?:mobile|mob|cell(?:ular)?|m)\b\.?\s*:?\s*(?=[+(\d])/i, 'mobile'],
  [/^(?:fax|f)\b\.?\s*:?\s*(?=[+(\d])/i, 'fax'],
  [/^(?:direct|dir|d)\b\.?\s*:?\s*(?=[+(\d])/i, 'direct'],
  [/^(?:office|work|main|tel(?:ephone)?|phone|ph|t|o|p)\b\.?\s*:?\s*(?=[+(\d])/i, 'office'],
];

/** Any other short printed label ("Toll Free:", "Tel/Fax:", "Hotline"): stripped, kind stays null. */
const OTHER_PHONE_LABEL = /^[a-z][a-z ./&'-]{0,24}?\s*:?\s*(?=[+(\d])/i;

const PHONE_EXTENSION = /[\s,;]*(?:ext\.?|extension|x)\s*\.?\s*(\d{1,6})\s*$/i;

/** US and Canada share +1 and one numbering plan (NANP). */
const NANP_DEFAULT_COUNTRIES = new Set(['US', 'CA']);
const NANP_NUMBER = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * Normalize one printed phone number for capture.
 *
 *  - An explicit `+` is authoritative: `+49 30 1234 5678` → `+493012345678`,
 *    and a UK trunk "(0)" after the country code is dropped, as E.164 requires.
 *  - Without a `+`, +1 is applied only when the default country is US or CA
 *    AND the digits are a valid NANP number. Anything else stays as printed
 *    national digits with `country_unresolved`. A number is never converted
 *    into a country it was not printed for.
 *  - The extension (`x204`, `ext. 204`) and a printed label (M, T, F, D,
 *    Mobile, Office, Fax, Direct) come back as separate fields; an unlabeled
 *    number, or one under any other label ("Toll Free", "Tel/Fax"), has
 *    `kind: null`, never a guess.
 *  - No repair: letters (vanity numbers) or too few digits make it invalid.
 *
 * @param {string} raw
 * @param {{ defaultCountry?: string }} [options]  ISO 3166 alpha-2, e.g. 'US'
 * @returns {{ input: string|null, kind: 'mobile'|'office'|'direct'|'fax'|null,
 *   extension: string|null, e164: string|null, national: string|null,
 *   explicitCountryCode: boolean, normalized: string|null, valid: boolean,
 *   issues: string[] }}
 */
export function normalizeCapturePhone(raw, { defaultCountry = null } = {}) {
  const result = {
    input: null, kind: null, extension: null, e164: null, national: null,
    explicitCountryCode: false, normalized: null, valid: false, issues: [],
  };
  if (typeof raw !== 'string' || !raw.trim()) {
    result.issues.push('empty');
    return result;
  }

  let body = raw.trim();
  result.input = body;

  const label = PHONE_LABELS.find(([pattern]) => pattern.test(body));
  if (label) {
    result.kind = label[1];
    body = body.replace(label[0], '');
  } else {
    body = body.replace(OTHER_PHONE_LABEL, '');
  }

  const extension = body.match(PHONE_EXTENSION);
  if (extension) {
    result.extension = extension[1];
    body = body.slice(0, extension.index);
  }

  body = body.trim();
  if (!body || /[^\d\s()+\-./]/.test(body) || body.indexOf('+', 1) !== -1) {
    result.issues.push('invalid_characters');
    return result;
  }

  result.explicitCountryCode = /^\(?\+/.test(body);
  const digits = (result.explicitCountryCode ? body.replace(/\(0\)/g, '') : body).replace(/\D/g, '');

  if (digits.length < 7) { result.issues.push('too_short'); return result; }
  if (digits.length > 15) { result.issues.push('too_long'); return result; }

  if (result.explicitCountryCode) {
    if (digits.length < 8) { result.issues.push('too_short'); return result; }
    result.e164 = `+${digits}`;
    if (digits.startsWith('1') && NANP_NUMBER.test(digits.slice(1))) result.national = digits.slice(1);
  } else if (NANP_DEFAULT_COUNTRIES.has(String(defaultCountry ?? '').toUpperCase())) {
    const nsn = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (NANP_NUMBER.test(nsn)) {
      result.e164 = `+1${nsn}`;
      result.national = nsn;
    } else {
      result.national = digits;
      result.issues.push('country_unresolved');
    }
  } else {
    result.national = digits;
    result.issues.push('country_unresolved');
  }

  result.normalized = result.e164 ?? result.national;
  result.valid = true;
  return result;
}

export default {
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizePhone,
  normalizeLoose,
  extractIdentifiers,
};
