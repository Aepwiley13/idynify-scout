/**
 * Capture validators — is this value well-formed, and what is its matching key?
 *
 * Part of the Relationship Capture foundation (PR 2). Pure and runtime-
 * independent: no Firestore, no React, no firebase-admin, so the browser and
 * the server functions can share it. NOTHING IN THE APP IMPORTS THIS YET;
 * src/test/captureNoProductionImports.test.js keeps it that way until the
 * capture pipeline adopts it.
 *
 * VALIDATORS CHECK, THEY DO NOT REPAIR
 * ───────────────────────────────────
 * A validator may reject a value or report a doubt (a check code). It never
 * rewrites the value into something it believes was meant: `acme.c0m` is
 * flagged `ocr_suspected` and left as printed, not turned into `acme.com` and
 * treated as truth. The only transformations are deterministic normal forms
 * (case, scheme, `www.`, trailing slash).
 *
 * Check codes go into a field's `extraction.checks`. confidence.js decides what
 * each one does to the field's level.
 */

import { parse as parsePublicSuffix } from 'tldts';
import { normalizeEmail, normalizeCapturePhone } from '../utils/identityNormalization.js';

export const CHECKS = Object.freeze({
  EMAIL_SYNTAX_OK: 'email_syntax_ok',
  EMAIL_SYNTAX_INVALID: 'email_syntax_invalid',
  HOST_OK: 'host_ok',
  HOST_INVALID: 'host_invalid',
  URL_OK: 'url_ok',
  URL_INVALID: 'url_invalid',
  LINKEDIN_PERSON_OK: 'linkedin_person_ok',
  LINKEDIN_COMPANY_OK: 'linkedin_company_ok',
  LINKEDIN_INVALID: 'linkedin_invalid',
  PHONE_OK: 'phone_ok',
  PHONE_TOO_SHORT: 'phone_too_short',
  PHONE_TOO_LONG: 'phone_too_long',
  PHONE_INVALID_CHARACTERS: 'phone_invalid_characters',
  PHONE_COUNTRY_UNRESOLVED: 'phone_country_unresolved',
  OCR_SUSPECTED: 'ocr_suspected',
});

/** Checks that make a value unusable. confidence.js forces such a field to `unknown`. */
export const FAILING_CHECKS = Object.freeze(new Set([
  CHECKS.EMAIL_SYNTAX_INVALID, CHECKS.HOST_INVALID, CHECKS.URL_INVALID, CHECKS.LINKEDIN_INVALID,
  CHECKS.PHONE_TOO_SHORT, CHECKS.PHONE_TOO_LONG, CHECKS.PHONE_INVALID_CHARACTERS,
]));

/** Checks that cast doubt on the reading. confidence.js caps such a field at `possible`. */
export const DOUBT_CHECKS = Object.freeze(new Set([CHECKS.OCR_SUSPECTED]));

// ─── Hosts and registrable domains ───────────────────────────────────────────

/**
 * The bare hostname inside whatever was printed, or null.
 *
 * Accepts `acme.com`, `www.acme.com`, `https://www.acme.com/about?x=1`, a
 * trailing-dot FQDN and a port. Rejects an `@` before the path (an email
 * address or embedded credentials is never a host; callers wanting an
 * email's domain use `emailHost`), whitespace, or an empty label
 * (`acme..com`, a bare `www.`). An `@` inside the path is fine:
 * `youtube.com/@acme` has the host `youtube.com`.
 */
export function hostOf(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  if (value.includes('@')) return null;
  value = value
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!value || value.split('.').some(label => label === '')) return null;
  return value;
}

/** The host part of an email address, or null. */
export function emailHost(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return hostOf(normalized.slice(normalized.lastIndexOf('@') + 1));
}

/**
 * The registrable domain (eTLD+1) under the ICANN section of the Public Suffix
 * List, or null.
 *
 *   www.acme.com → acme.com        sales.acme.co.uk → acme.co.uk
 *   acme.corn    → null (not a public suffix)
 *   sarah.chen   → null (an email local part, not a domain)
 *
 * Private PSL entries are deliberately ignored, so `acme.wixsite.com` keys to
 * `wixsite.com`. A shared host is never a company key either way; safeguards.js
 * refuses those by hostname.
 */
export function domainKey(input) {
  const host = hostOf(input);
  if (!host) return null;
  const parsed = parsePublicSuffix(host, { allowPrivateDomains: false });
  if (!parsed || parsed.isIp || parsed.isIcann !== true || !parsed.domain) return null;
  return parsed.domain;
}

/** The label before the public suffix (`acme` for `acme.co.uk`), or null. */
export function domainStem(input) {
  const key = domainKey(input);
  if (!key) return null;
  return parsePublicSuffix(key, { allowPrivateDomains: false }).domainWithoutSuffix || null;
}

/**
 * OCR slips that show in the top-level label: a digit (`c0m`, `n3t`) or a
 * common misreading that is not a real suffix (`corn`). Real ccTLDs that are
 * also typo-shaped (`.cm`, `.om`) are not listed: a real Cameroon or Oman
 * domain must not be flagged.
 */
const TLD_MISREADINGS = new Set([
  'corn', 'con', 'cpm', 'cim', 'comm', 'coom', 'vom', 'xom', 'cmo', 'ocm',
  'nte', 'ner', 'orq', 'ogr',
]);

export function ocrSuspectedHost(input) {
  const host = hostOf(input);
  if (!host) return false;
  const tld = host.slice(host.lastIndexOf('.') + 1);
  return /\d/.test(tld) || TLD_MISREADINGS.has(tld);
}

export function validateHost(input) {
  const key = domainKey(input);
  if (key) return { ok: true, domainKey: key, checks: [CHECKS.HOST_OK] };
  return {
    ok: false,
    domainKey: null,
    checks: ocrSuspectedHost(input) ? [CHECKS.OCR_SUSPECTED] : [CHECKS.HOST_INVALID],
  };
}

// ─── Email ───────────────────────────────────────────────────────────────────

const EMAIL_LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/**
 * Syntax only. A plus-address (`dana+events@acme.com`) is kept whole: it is a
 * real routing distinction, and the legacy parser's habit of cutting it to
 * `events@acme.com` produced a different person's address.
 *
 * A host that fails only because its suffix looks misread (`acme.c0m`) is
 * reported as `ocr_suspected`, not invalid: the reading is doubtful, so the
 * user is asked, but nothing is rewritten.
 */
export function validateEmail(input) {
  const normalized = normalizeEmail(input);
  if (!normalized || normalized.indexOf('@') !== normalized.lastIndexOf('@')) {
    return { ok: false, normalized: null, checks: [CHECKS.EMAIL_SYNTAX_INVALID] };
  }
  const local = normalized.slice(0, normalized.lastIndexOf('@'));
  const host = emailHost(normalized);
  if (!EMAIL_LOCAL_PART.test(local) || !host) {
    return { ok: false, normalized: null, checks: [CHECKS.EMAIL_SYNTAX_INVALID] };
  }
  if (!domainKey(host)) {
    return ocrSuspectedHost(host)
      ? { ok: false, normalized, checks: [CHECKS.OCR_SUSPECTED] }
      : { ok: false, normalized: null, checks: [CHECKS.EMAIL_SYNTAX_INVALID] };
  }
  return { ok: true, normalized, checks: [CHECKS.EMAIL_SYNTAX_OK] };
}

// ─── URLs ────────────────────────────────────────────────────────────────────

function parseHttpUrl(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  // An @ before the path is an email address or embedded credentials; one in
  // the path (`youtube.com/@acme`) is an ordinary URL.
  const authority = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
  if (!value || /\s/.test(value) || authority.includes('@')) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url;
}

/**
 * A printed website. Normalized form: scheme-less host (without `www.`) plus
 * path, no query or fragment, no trailing slash. An email address is never a
 * URL (though a path may contain `@`, as in `youtube.com/@acme`), and a host
 * without a real public suffix (`jane.smith`) is invalid.
 */
export function validateUrl(input) {
  const url = parseHttpUrl(input);
  const host = url ? hostOf(url.hostname) : null;
  if (!host) return { ok: false, normalized: null, host: null, domainKey: null, checks: [CHECKS.URL_INVALID] };

  const key = domainKey(host);
  const path = url.pathname.replace(/\/+$/, '');
  const normalized = `${host.replace(/^www\./, '')}${path}`;
  if (!key) {
    return ocrSuspectedHost(host)
      ? { ok: false, normalized, host, domainKey: null, checks: [CHECKS.OCR_SUSPECTED] }
      : { ok: false, normalized: null, host, domainKey: null, checks: [CHECKS.URL_INVALID] };
  }
  return { ok: true, normalized, host, domainKey: key, checks: [CHECKS.URL_OK] };
}

const LINKEDIN_HOST = /^(?:[a-z]{2,3}\.|www\.)?linkedin\.com$/;
const LINKEDIN_SLUG = /^[a-z0-9][a-z0-9_%-]{1,99}$/;

function validateLinkedIn(input, section, okCheck) {
  const url = parseHttpUrl(input);
  const host = url ? url.hostname.toLowerCase() : null;
  const [kind, slug] = url ? url.pathname.toLowerCase().split('/').filter(Boolean) : [];
  if (!host || !LINKEDIN_HOST.test(host) || kind !== section || !slug || !LINKEDIN_SLUG.test(slug)) {
    return { ok: false, normalized: null, checks: [CHECKS.LINKEDIN_INVALID] };
  }
  return { ok: true, normalized: `linkedin.com/${section}/${slug}`, checks: [okCheck] };
}

/** `linkedin.com/in/<slug>` — a person's profile. */
export function validateLinkedInPerson(input) {
  return validateLinkedIn(input, 'in', CHECKS.LINKEDIN_PERSON_OK);
}

/** `linkedin.com/company/<slug>` — a company page. */
export function validateLinkedInCompany(input) {
  return validateLinkedIn(input, 'company', CHECKS.LINKEDIN_COMPANY_OK);
}

// ─── Phone ───────────────────────────────────────────────────────────────────

const PHONE_ISSUE_CHECKS = {
  empty: CHECKS.PHONE_INVALID_CHARACTERS,
  invalid_characters: CHECKS.PHONE_INVALID_CHARACTERS,
  too_short: CHECKS.PHONE_TOO_SHORT,
  too_long: CHECKS.PHONE_TOO_LONG,
  country_unresolved: CHECKS.PHONE_COUNTRY_UNRESOLVED,
};

/**
 * Digit-length and character checks over normalizeCapturePhone. An
 * unresolved country is informational: the digits were read correctly, only
 * the country is not known, so it does not lower confidence.
 */
export function validatePhone(raw, options) {
  const phone = normalizeCapturePhone(raw, options);
  const checks = phone.issues.map(issue => PHONE_ISSUE_CHECKS[issue]);
  if (phone.valid) checks.unshift(CHECKS.PHONE_OK);
  return { ok: phone.valid, phone, checks: [...new Set(checks)] };
}

// ─── Names ───────────────────────────────────────────────────────────────────

/**
 * A person's name folded for COMPARISON: accents folded, lowercase, dots and
 * apostrophes joined, other punctuation a space, spaces collapsed. "José
 * O'Brien" → "jose obrien". The printed name is kept separately for display;
 * the legacy parser's habit of stripping it to "Jos OBrien" for display is
 * exactly what this split prevents.
 */
export function personNameKey(name) {
  if (typeof name !== 'string') return null;
  const key = name
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return key || null;
}
