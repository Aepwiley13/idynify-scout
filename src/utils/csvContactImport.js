/**
 * csvContactImport — the pure half of the Scout+ CSV contact import.
 *
 * Parsing, header mapping, row validation, in-file duplicate detection and the
 * import-group tag. No Firestore here: everything below is a function of the
 * file the user picked, so it can be tested exhaustively without a database.
 * The half that talks to Firestore (identity resolution against the workspace,
 * company resolution, the writes) is src/services/csvImportService.js.
 *
 * WHY PAPAPARSE
 * ─────────────
 * The previous parser was `text.split('\n')` then `line.split(',')`. A company
 * written `"Acme, Inc."` became two cells and shifted every column after it,
 * so the row imported with its title in the company field and its email in the
 * title. Nothing flagged it. Papa handles quoting, escaped quotes, CRLF, BOMs
 * and newlines inside quoted cells, and it was already a dependency.
 *
 * NOTHING IS DROPPED SILENTLY
 * ───────────────────────────
 * Every data row in the file comes back from `classifyRows` with a status and,
 * when it will not be imported, a human-readable reason. Every header that
 * does not map to a contact field is reported as ignored. The UI shows both.
 */

import Papa from 'papaparse';
import { extractIdentifiers } from './identityNormalization.js';
import { hasArchiveSignal } from '../constants/statusModel.js';

/** Hard cap on rows per import. Rows past it are reported, never discarded quietly. */
export const MAX_IMPORT_ROWS = 500;

/** Same rule as ManualContactForm, so the two paths agree on what an email is. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Row outcomes, in the order the preview reports them. */
export const ROW_STATUS = Object.freeze({
  READY: 'ready',                       // will import
  MISSING: 'missing',                   // no name and no email
  INVALID: 'invalid',                   // bad email, or a malformed row
  DUPLICATE_IN_FILE: 'duplicate_in_file', // same person earlier in this file
  OVER_LIMIT: 'over_limit',             // past MAX_IMPORT_ROWS
});

/**
 * Header aliases → contact field. Keys are headers after `normalizeHeader`.
 * Exported so tests (and the UI's guidelines) can enumerate them.
 */
export const HEADER_ALIASES = Object.freeze({
  // Full name
  'name': 'name',
  'full name': 'name',
  'contact name': 'name',
  'contact': 'name',
  // First / last
  'first name': 'first_name',
  'first': 'first_name',
  'fname': 'first_name',
  'firstname': 'first_name',
  'given name': 'first_name',
  'last name': 'last_name',
  'last': 'last_name',
  'lname': 'last_name',
  'lastname': 'last_name',
  'surname': 'last_name',
  'family name': 'last_name',
  // Email
  'email': 'email',
  'email address': 'email',
  'e mail': 'email',
  'work email': 'email',
  'business email': 'email',
  'primary email': 'email',
  // Phone
  'phone': 'phone',
  'phone number': 'phone',
  'mobile': 'phone',
  'mobile phone': 'phone',
  'cell': 'phone',
  'cell phone': 'phone',
  'work phone': 'phone',
  'direct phone': 'phone',
  // Company
  'company': 'company',
  'company name': 'company',
  'organization': 'company',
  'organisation': 'company',
  'account name': 'company',
  'account': 'company',
  'employer': 'company',
  // Title
  'title': 'title',
  'job title': 'title',
  'position': 'title',
  'role': 'title',
  // LinkedIn
  'linkedin': 'linkedin_url',
  'linkedin url': 'linkedin_url',
  'linkedin profile': 'linkedin_url',
  'linkedin profile url': 'linkedin_url',
  'person linkedin url': 'linkedin_url',
  // Industry
  'industry': 'industry',
  'vertical': 'industry',
  'sector': 'industry',
  // State / location
  'state': 'state',
  'state/province': 'state',
  'province': 'state',
  'region': 'state',
  'location': 'location',
  'city': 'location',
  // Notes
  'notes': 'notes',
  'note': 'notes',
  'comments': 'notes',
  'comment': 'notes',
});

/** The contact fields a CSV row can carry. */
export const CONTACT_FIELDS = Object.freeze([
  'name', 'first_name', 'last_name', 'email', 'phone', 'company', 'title',
  'linkedin_url', 'industry', 'state', 'location', 'notes',
]);

/** `"  First_Name "` → `"first name"`. Strips a UTF-8 BOM from the first header. */
export function normalizeHeader(header) {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/** The contact field a header maps to, or null when it maps to none. */
export function mapHeader(header) {
  return HEADER_ALIASES[normalizeHeader(header)] ?? null;
}

/**
 * Parse CSV text into header-keyed rows.
 *
 * @returns {{
 *   headers: string[],          raw headers, as written in the file
 *   mappedHeaders: object,      raw header → contact field (mapped ones only)
 *   ignoredHeaders: string[],   headers that map to no contact field
 *   rows: Array<{rowNumber: number, raw: object, malformed: string|null}>,
 *   fatal: string|null,         a whole-file problem (no header, no rows)
 * }}
 *
 * `rowNumber` is the 1-based line a user would see in a spreadsheet, with the
 * header as row 1. It is exact for files without line breaks inside quoted
 * cells, which is every common export.
 */
export function parseContactCsv(text) {
  // Blank lines are NOT skipped by Papa: it would drop them before indexing,
  // and every row after a blank line would then report the wrong row number.
  // They are filtered below, after each row's position is fixed.
  const result = Papa.parse(String(text ?? ''), {
    header: true,
    skipEmptyLines: false,
    transformHeader: (h) => String(h ?? '').replace(/^\uFEFF/, '').trim(),
  });

  const headers = (result.meta?.fields ?? []).filter((h) => h !== '');
  const mappedHeaders = {};
  const ignoredHeaders = [];
  for (const h of headers) {
    const field = mapHeader(h);
    if (field) mappedHeaders[h] = field;
    else ignoredHeaders.push(h);
  }

  // Papa reports a row with MORE cells than the header as a FieldMismatch and
  // parks the overflow in __parsed_extra. That is almost always an unquoted
  // comma — the exact corruption this parser exists to prevent — so the row
  // is flagged rather than imported with its columns shifted. A row with
  // FEWER cells is just trailing blanks, which spreadsheets omit routinely.
  const malformedByIndex = new Map();
  for (const err of result.errors ?? []) {
    if (err.code === 'TooManyFields' && Number.isInteger(err.row)) {
      malformedByIndex.set(err.row, 'Row has more columns than the header — check for an unquoted comma');
    }
  }

  const isBlank = (raw) => Object.entries(raw ?? {})
    .every(([k, v]) => k === '__parsed_extra' ? (v ?? []).every((x) => !String(x ?? '').trim()) : !String(v ?? '').trim());

  const rows = (result.data ?? [])
    .map((raw, index) => ({
      rowNumber: index + 2,
      raw,
      malformed: malformedByIndex.get(index) ?? null,
    }))
    .filter((r) => !isBlank(r.raw));

  let fatal = null;
  if (headers.length === 0) fatal = 'The file has no header row.';
  else if (Object.keys(mappedHeaders).length === 0) {
    fatal = 'None of the columns look like contact fields. Include a header such as Name, First Name, or Email.';
  } else if (rows.length === 0) fatal = 'The file has a header but no data rows.';

  return { headers, mappedHeaders, ignoredHeaders, rows, fatal };
}

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Map one raw row onto contact fields.
 *
 * When two headers map to the same field (e.g. "Email" and "Work Email"), the
 * first non-empty value wins, in header order.
 */
export function normalizeRow(raw, mappedHeaders) {
  const out = {};
  for (const [header, field] of Object.entries(mappedHeaders)) {
    const value = clean(raw?.[header]);
    if (value && !out[field]) out[field] = value;
  }
  // Split names take precedence over a full name — they are the more
  // structured signal, and keeping both lets the record carry first/last.
  if (out.first_name) {
    out.name = [out.first_name, out.last_name].filter(Boolean).join(' ');
  } else if (out.name && !out.last_name) {
    // Derive first/last from a full name so the record carries both forms,
    // as the People schema does. Only the first token is the first name.
    const parts = out.name.split(/\s+/);
    out.first_name = parts[0];
    if (parts.length > 1) out.last_name = parts.slice(1).join(' ');
  }
  if (out.email) out.email = out.email.toLowerCase();
  return out;
}

/**
 * Identity keys for in-file duplicate detection — the exact identifiers of the
 * canonical hierarchy (email, LinkedIn URL, phone), normalized the same way the
 * workspace resolver normalizes them. Name+company is deliberately absent: the
 * resolver only flags that signal, never merges on it, and neither does this.
 */
export function identityKeys(contact) {
  const ids = extractIdentifiers(contact);
  const keys = [];
  if (ids.email) keys.push(`email:${ids.email}`);
  if (ids.linkedinUrl) keys.push(`linkedin:${ids.linkedinUrl}`);
  if (ids.phone) keys.push(`phone:${ids.phone}`);
  return keys;
}

/**
 * Classify every parsed row.
 *
 * @returns {Array<{
 *   rowNumber: number,
 *   status: string,            one of ROW_STATUS
 *   reason: string|null,       why it will not import (null when READY)
 *   warnings: string[],        imported, but something was set aside
 *   contact: object,           normalized contact fields
 *   duplicateOfRow?: number,
 * }>}
 */
export function classifyRows(parsedRows, mappedHeaders, { maxRows = MAX_IMPORT_ROWS } = {}) {
  const seen = new Map(); // identity key → rowNumber of first occurrence
  let readyCount = 0;

  return parsedRows.map(({ rowNumber, raw, malformed }) => {
    const contact = normalizeRow(raw, mappedHeaders);
    const warnings = [];
    const row = (status, reason = null, extra = {}) => ({ rowNumber, status, reason, warnings, contact, ...extra });

    if (malformed) return row(ROW_STATUS.INVALID, malformed);

    if (!contact.name && !contact.email) {
      return row(ROW_STATUS.MISSING, 'Needs a name or an email address');
    }

    if (contact.email && !EMAIL_PATTERN.test(contact.email)) {
      return row(ROW_STATUS.INVALID, `Invalid email address: ${contact.email}`);
    }

    if (contact.linkedin_url && !/linkedin\.com/i.test(contact.linkedin_url)) {
      warnings.push(`LinkedIn URL ignored (not a linkedin.com link): ${contact.linkedin_url}`);
      delete contact.linkedin_url;
    }

    // A person with an email but no name still needs something to be called.
    // The address is the honest choice: it is what the user gave us.
    if (!contact.name) contact.name = contact.email;

    const keys = identityKeys(contact);
    const firstSeen = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
    if (firstSeen !== undefined) {
      return row(ROW_STATUS.DUPLICATE_IN_FILE, `Same person as row ${firstSeen}`, { duplicateOfRow: firstSeen });
    }

    if (readyCount >= maxRows) {
      return row(ROW_STATUS.OVER_LIMIT, `Over the ${maxRows}-row import limit — split the file and upload the rest separately`);
    }

    keys.forEach((k) => seen.set(k, rowNumber));
    readyCount += 1;
    return row(ROW_STATUS.READY);
  });
}

/** Counts per status, for the preview summary. */
export function summarizeRows(rows) {
  const counts = Object.fromEntries(Object.values(ROW_STATUS).map((s) => [s, 0]));
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

/** `"Beyond Words list.csv"` → `"Beyond Words list"`. */
export function defaultImportName(fileName) {
  return String(fileName ?? '').replace(/\.csv$/i, '').replace(/[_]+/g, ' ').trim() || 'Upload';
}

/** Local calendar date as YYYY-MM-DD — the date the user sees, not UTC's. */
export function localDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The tag that identifies one import as a group: `CSV Import - <name> - <date>`.
 *
 * A tag rather than a new collection because People already filters on
 * `tags` (AllLeads tag picker), contact cards already render them, and the
 * profile already edits them. "These are the 47 people I just uploaded" is a
 * tag filter that exists today.
 */
export function buildImportTag(importName, date = new Date()) {
  const name = String(importName ?? '').replace(/\s+/g, ' ').trim() || 'Upload';
  return `CSV Import - ${name} - ${localDateStamp(date)}`;
}

/**
 * The candidate payload handed to the identity resolver for one row. Raw
 * identifiers, un-normalized — the resolver's contract requires that.
 */
export function toIdentityCandidate(contact) {
  return {
    email: contact.email || null,
    phone: contact.phone || null,
    linkedin_url: contact.linkedin_url || null,
    name: contact.name || null,
    first_name: contact.first_name || null,
    last_name: contact.last_name || null,
    company: contact.company || null,
    company_name: contact.company || null,
    source: 'csv_import',
  };
}

/**
 * Is this contact hidden from the standard People view?
 *
 * The same two signals People filters on: the contact itself is archived, or
 * its company was archived (companyArchiveService cascades `company_archived`
 * onto every contact at that company). An import can still match such a
 * contact — identity does not care about archive state — and People shows it
 * only inside that import's own tag view, so the group count reconciles. It is
 * never reactivated.
 */
export function isHiddenFromPeople(contact) {
  return hasArchiveSignal(contact) || contact?.company_archived === true;
}
