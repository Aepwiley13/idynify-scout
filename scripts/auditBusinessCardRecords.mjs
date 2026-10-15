/**
 * Historical audit: what the legacy business-card scanner left in Firestore.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  READ-ONLY. Reports; never repairs. It writes nothing, anywhere.         ║
 * ║  Remediation, if the report calls for it, is a separate, explicitly      ║
 * ║  approved script with its own dry run.                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PR 3 of Relationship Capture (architecture section 26). It selects the
 * contacts and companies the old scanner created or merged into, flags each
 * with machine-readable codes, summarizes historical endpoint usage, and
 * decides by fixed rules whether cleanup is REQUIRED before general release.
 *
 * USAGE
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/read-only-key.json \
 *     node scripts/auditBusinessCardRecords.mjs [--user-id=<uid>] [--details] [--json]
 *
 *   --user-id=<uid>  audit one workspace (a workspace is a user) instead of all
 *   --details        also list document IDs under each flag (off by default)
 *   --json           the same report as JSON instead of text
 *
 * The key must belong to a service account with read-only Firestore access
 * (roles/datastore.viewer). The project comes from the key; nothing is
 * hard-coded, and there is no fallback to other credentials.
 *
 * PRIVACY: the report holds workspace IDs, document IDs, flag codes and counts.
 * It never prints a name, email, phone, domain, company name, OCR text or
 * stored error text.
 *
 * EXIT CODES
 *   0  completed; cleanup NONE or OPTIONAL
 *   2  completed; cleanup REQUIRED
 *   1  did not complete (bad arguments, credentials, or a Firestore error)
 *
 * Every flag, selector and cleanup rule is documented in
 * docs/capture/business-card-audit.md.
 *
 * STRUCTURE: everything above the FIRESTORE READS section is pure and works on
 * plain objects. Every database call lives inside that section, which uses
 * only collection, doc, where, select, limit, get, getAll and listDocuments.
 * A test enforces both.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { nameKey, normalizeEmail, normalizePhone } from '../src/utils/identityNormalization.js';
import { domainKey, domainStem, hostOf, ocrSuspectedHost } from '../src/capture/validators.js';
import {
  CAPTURE_FREE_EMAIL_DOMAINS, CAPTURE_ISP_EMAIL_DOMAINS, GENERIC_COMPANY_WORDS, SAFEGUARDS,
  companyNameSafeguards, isSharedHost,
} from '../src/capture/safeguards.js';

export const AUDIT_VERSION = 'business-card-audit/v1';
export const SCANNER_SOURCE = 'Scanned Business Card';

// ─── What is audited ─────────────────────────────────────────────────────────

/**
 * Per-workspace equality queries, so no new index is needed. A contact or
 * company matched by several selectors is audited once and keeps every
 * lineage that matched. Companies referenced by a selected contact are added
 * with lineage `referenced`.
 */
export const SELECTORS = Object.freeze({
  contacts: Object.freeze([
    Object.freeze({ lineage: 'source', field: 'source', op: '==', value: SCANNER_SOURCE }),
    Object.freeze({ lineage: 'capture_method', field: 'capture_method', op: '==', value: 'business_card_ocr' }),
    Object.freeze({ lineage: 'enrichment_status', field: 'enrichment_status', op: '==', value: 'ocr_extracted' }),
    Object.freeze({ lineage: 'identity_sources', field: 'identity_sources', op: 'array-contains', value: SCANNER_SOURCE }),
  ]),
  companies: Object.freeze([
    Object.freeze({ lineage: 'source', field: 'source', op: '==', value: SCANNER_SOURCE }),
    Object.freeze({ lineage: 'accepted_via', field: 'accepted_via', op: '==', value: SCANNER_SOURCE }),
  ]),
  usage: Object.freeze([
    Object.freeze({ field: 'operation', op: '==', value: 'extractBusinessCard' }),
    Object.freeze({ field: 'endpoint', op: 'in', value: Object.freeze(['APOLLO_EXTRACTBUSINESSCARD', 'GOOGLE_EXTRACTBUSINESSCARD']) }),
  ]),
});

// ─── Flags ───────────────────────────────────────────────────────────────────

export const CONTACT_FLAGS = Object.freeze({
  MISSING_COMPANY: 'No company_id, but the contact has an email at a non-personal domain',
  NO_ADDED_FROM: 'No addedFrom, so People shows the contact as "Manual". The scanner never wrote it: reported as a total only',
  IDENTITY_REVIEW_UNSURFACED: 'identity_review_required is true; no UI has ever shown this flag',
  NAME_LOOKS_LIKE_TITLE: 'The name reads as a job title, or equals the contact\'s own title',
  NAME_LOOKS_LIKE_COMPANY: 'The name equals the contact\'s company, ends in a legal form (Inc, LLC, Ltd…) or is only generic company words',
  NAME_POSSIBLY_STRIPPED: 'HEURISTIC: the name looks damaged by the old parser (an apostrophe dropped, as in "OBrien", or a replacement character)',
  NO_EMAIL_OR_PHONE: 'No usable email and no usable phone',
  DUPLICATE_EMAIL: 'Another contact in the workspace has the same normalized email',
  DUPLICATE_PHONE: 'Another contact in the workspace has the same normalized phone',
});

export const COMPANY_FLAGS = Object.freeze({
  PERSONAL_PROVIDER: 'A stored domain or website is a free-mail or ISP provider, or the name is a free-mail brand (Gmail) and no usable domain exists',
  MALFORMED_DOMAIN: 'domain or primary_domain contains @ or whitespace, or has no registrable domain under the Public Suffix List',
  FIRST_LAST_DOMAIN: 'A stored domain or website is shaped like a person: an email local part, letter labels with no public suffix (sarah.chen), or two labels that are a linked contact\'s name',
  SHARED_HOST_DOMAIN: 'domain or primary_domain is a shared host (site builder, social network), which can never be a company identity key',
  DUPLICATE_DOMAIN: 'Another company in the workspace has the same registrable domain',
  DUPLICATE_NAME: 'Another company in the workspace has the same name key',
  NO_LEGITIMATE_DOMAIN: 'No stored domain or website yields a usable company domain',
  LOCKED_GUESSED_NAME: 'name_source is "user" but the name equals the guess from the domain, so enrichment cannot correct it',
  ORPHAN: 'contact_count is 0 or missing, and no contact references the company',
});

/** Flags inferred from appearance rather than fact. Never used by a REQUIRED rule. */
export const HEURISTIC_FLAGS = Object.freeze(new Set(['NAME_POSSIBLY_STRIPPED']));

/** Systemic flags: counted, but their document IDs are never listed, even with --details. */
export const TOTAL_ONLY_FLAGS = Object.freeze(new Set(['NO_ADDED_FROM']));

// ─── Cleanup decision ────────────────────────────────────────────────────────

export const DUPLICATE_DOMAIN_PAIR_LIMIT = 5;

/**
 * The only inputs to the decision. A company is "linked" when at least one
 * contact's company_id points to it. Evaluated over every audited workspace
 * together; the first matching level wins.
 */
export const CLEANUP_RULES = Object.freeze([
  Object.freeze({ id: 'R1', level: 'REQUIRED', description: 'A PERSONAL_PROVIDER company is linked to a contact' }),
  Object.freeze({ id: 'R2', level: 'REQUIRED', description: 'A FIRST_LAST_DOMAIN company is linked to a contact' }),
  Object.freeze({ id: 'R3', level: 'REQUIRED', description: `More than ${DUPLICATE_DOMAIN_PAIR_LIMIT} duplicate-domain pairs involve an audited company` }),
  Object.freeze({ id: 'R4', level: 'REQUIRED', description: 'An audited contact is flagged NAME_LOOKS_LIKE_TITLE or NAME_LOOKS_LIKE_COMPANY' }),
  Object.freeze({ id: 'O1', level: 'OPTIONAL', description: 'No REQUIRED rule matched, but at least one flag was raised' }),
  Object.freeze({ id: 'N1', level: 'NONE', description: 'No flag was raised' }),
]);

/**
 * @param {{ contacts: Array<{codes: string[]}>, companies: Array<{codes: string[], linked: boolean}>,
 *   duplicateDomainPairs: number }} input
 * @returns {{ level: 'REQUIRED'|'OPTIONAL'|'NONE', matched: Array<{id: string, count: number}> }}
 */
export function decideCleanup({ contacts = [], companies = [], duplicateDomainPairs = 0 } = {}) {
  const counts = {
    R1: companies.filter(c => c.linked && c.codes.includes('PERSONAL_PROVIDER')).length,
    R2: companies.filter(c => c.linked && c.codes.includes('FIRST_LAST_DOMAIN')).length,
    R3: duplicateDomainPairs > DUPLICATE_DOMAIN_PAIR_LIMIT ? duplicateDomainPairs : 0,
    R4: contacts.filter(c => c.codes.includes('NAME_LOOKS_LIKE_TITLE') || c.codes.includes('NAME_LOOKS_LIKE_COMPANY')).length,
  };
  const required = ['R1', 'R2', 'R3', 'R4'].filter(id => counts[id] > 0).map(id => ({ id, count: counts[id] }));
  if (required.length) return { level: 'REQUIRED', matched: required };
  const flags = [...contacts, ...companies].reduce((sum, record) => sum + record.codes.length, 0);
  if (flags > 0) return { level: 'OPTIONAL', matched: [{ id: 'O1', count: flags }] };
  return { level: 'NONE', matched: [{ id: 'N1', count: 0 }] };
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

const PERSONAL_PROVIDERS = new Set([...CAPTURE_FREE_EMAIL_DOMAINS, ...CAPTURE_ISP_EMAIL_DOMAINS]);
/** Free-mail brands only ("Gmail"): ISP names (Verizon, Orange, Sky) are also real companies. */
const FREE_MAIL_STEMS = new Set([...CAPTURE_FREE_EMAIL_DOMAINS].map(domainStem).filter(Boolean));
/** Unambiguous legal forms only: two-letter forms (SA, AG, Co) are also surnames. */
const COMPANY_FORM_WORDS = new Set(['inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation', 'plc', 'gmbh']);
const COMPANY_DOMAIN_FIELDS = ['domain', 'primary_domain'];
const COMPANY_WEBSITE_FIELDS = ['website_url', 'website'];
const KNOWN_ERROR_CODES = new Set([
  'INVALID_REQUEST', 'UNAUTHORIZED', 'USER_MISMATCH', 'METHOD_NOT_ALLOWED', 'LEGACY_ENDPOINT_DISABLED',
  'NO_TEXT_FOUND', 'INTERNAL_ERROR', 'UPSTREAM_OCR_FAILURE',
]);

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Words of a name, accents folded, lower case. */
function foldTokens(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** YYYY-MM from a Firestore Timestamp, Date, ISO string or epoch object; 'unknown' otherwise. */
export function monthOf(value) {
  let date = null;
  if (value instanceof Date) date = value;
  else if (value && typeof value.toDate === 'function') date = value.toDate();
  else if (typeof value === 'string') date = new Date(value);
  else if (value && typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) date = new Date(seconds * 1000);
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().slice(0, 7);
}

/** The contact's email as identity matching sees it: the stored normalized form first. */
export function contactEmail(contact = {}) {
  return normalizeEmail(text(contact.email_normalized) ?? text(contact.email));
}

/** The contact's phone as identity matching sees it: the stored normalized form first. */
export function contactPhone(contact = {}) {
  return text(contact.phone_normalized) ?? normalizePhone(text(contact.phone));
}

function isPersonalEmail(email) {
  const host = hostOf(email.slice(email.lastIndexOf('@') + 1));
  if (!host) return false;
  return PERSONAL_PROVIDERS.has(host) || PERSONAL_PROVIDERS.has(domainKey(host));
}

/** A stored domain value's registrable domain, or null when it is malformed. */
function registrable(value) {
  if (typeof value !== 'string' || /[@\s]/.test(value.trim())) return null;
  return domainKey(value);
}

/**
 * Whether a stored domain or website is shaped like a person rather than a
 * company. `linkedContacts` are contacts known to point at the company.
 */
export function firstLastShaped(value, linkedContacts = []) {
  const host = hostOf(typeof value === 'string' ? value : '');
  if (!host) return false;
  const labels = host.split('.');

  // 1. The local part of a linked contact's email (the legacy parser's defect).
  for (const contact of linkedContacts) {
    const email = contactEmail(contact);
    if (email && email.slice(0, email.lastIndexOf('@')) === host) return true;
  }

  const key = domainKey(host);
  // 2. Letter-only labels with no public suffix: sarah.chen. An OCR misreading
  //    of a real suffix (acme.corn) is MALFORMED_DOMAIN, not this.
  if (!key) {
    return labels.length >= 2 && labels.length <= 3
      && labels.every(label => /^[a-z]+$/.test(label))
      && !ocrSuspectedHost(host);
  }

  // 3. Two or more labels before the public suffix are a linked contact's name.
  const ownLabels = labels.slice(0, labels.length - (key.split('.').length - 1));
  return linkedContacts.some(contact => {
    const tokens = new Set(foldTokens(contact.name));
    return new Set(ownLabels.filter(label => tokens.has(label))).size >= 2;
  });
}

function companyValues(company) {
  return {
    domains: COMPANY_DOMAIN_FIELDS.map(field => text(company[field])).filter(Boolean),
    websites: COMPANY_WEBSITE_FIELDS.map(field => text(company[field])).filter(Boolean),
  };
}

/** Registrable domains this company could legitimately be matched on. */
export function usableDomainKeys(company = {}, linkedContacts = []) {
  const { domains, websites } = companyValues(company);
  const keys = new Set();
  for (const value of [...domains, ...websites]) {
    const key = registrable(value);
    if (!key || PERSONAL_PROVIDERS.has(key) || isSharedHost(value) || firstLastShaped(value, linkedContacts)) continue;
    keys.add(key);
  }
  return [...keys].sort();
}

/** Keys used to find duplicate domains: any registrable key that is not a provider or shared host. */
function duplicateDomainKeys(company = {}) {
  const { domains, websites } = companyValues(company);
  const keys = new Set();
  for (const value of [...domains, ...websites]) {
    const key = registrable(value);
    if (key && !PERSONAL_PROVIDERS.has(key) && !isSharedHost(value)) keys.add(key);
  }
  return [...keys];
}

/** A hand copy of companyIdentityService.companyNameFromDomain (that module is browser-only). Parity is tested. */
export function companyNameFromDomain(domain) {
  const label = String(domain ?? '').split('.')[0];
  if (!label) return null;
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || null;
}

function looksLikeCompanyName(name, contact) {
  const key = nameKey(name);
  const companyKeys = [contact.company, contact.company_name].map(text).filter(Boolean).map(nameKey).filter(Boolean);
  if (key && companyKeys.includes(key)) return true;
  const tokens = foldTokens(name);
  if (tokens.length && COMPANY_FORM_WORDS.has(tokens.at(-1))) return true;
  return Boolean(key) && key.split(' ').every(token => GENERIC_COMPANY_WORDS.has(token));
}

/** HEURISTIC. An apostrophe-dropped surname (OBrien, DAngelo, LEsperance) or a replacement character. */
function possiblyStripped(name) {
  return name.split(/\s+/).some(token => /^[ODL][A-Z][a-z]{2,}$/.test(token)) || /�/.test(name);
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Flag codes for one audited contact, in CONTACT_FLAGS order.
 * @param {object} contact  the stored document
 * @param {{ duplicateEmail?: boolean, duplicatePhone?: boolean }} context
 */
export function classifyContact(contact = {}, { duplicateEmail = false, duplicatePhone = false } = {}) {
  const codes = new Set();
  const email = contactEmail(contact);
  const phone = contactPhone(contact);
  const name = text(contact.name);

  if (!text(contact.company_id) && email && !isPersonalEmail(email)) codes.add('MISSING_COMPANY');
  if (!text(contact.addedFrom)) codes.add('NO_ADDED_FROM');
  if (contact.identity_review_required === true) codes.add('IDENTITY_REVIEW_UNSURFACED');
  if (name) {
    const nameCodes = companyNameSafeguards(
      { value: name, source: 'card_text', extraction: { level: 'confirmed' } },
      { title: text(contact.title) },
    );
    if (nameCodes.includes(SAFEGUARDS.TITLE_AS_COMPANY)) codes.add('NAME_LOOKS_LIKE_TITLE');
    if (looksLikeCompanyName(name, contact)) codes.add('NAME_LOOKS_LIKE_COMPANY');
    if (possiblyStripped(name)) codes.add('NAME_POSSIBLY_STRIPPED');
  }
  if (!email && !phone) codes.add('NO_EMAIL_OR_PHONE');
  if (duplicateEmail) codes.add('DUPLICATE_EMAIL');
  if (duplicatePhone) codes.add('DUPLICATE_PHONE');
  return Object.keys(CONTACT_FLAGS).filter(code => codes.has(code));
}

/**
 * Flag codes for one audited company, in COMPANY_FLAGS order.
 * @param {object} company  the stored document
 * @param {{ linked?: boolean, linkedContacts?: object[], duplicateDomain?: boolean, duplicateName?: boolean }} context
 */
export function classifyCompany(company = {}, { linked = false, linkedContacts = [], duplicateDomain = false, duplicateName = false } = {}) {
  const codes = new Set();
  const { domains, websites } = companyValues(company);
  const all = [...domains, ...websites];
  const usable = usableDomainKeys(company, linkedContacts);
  const key = nameKey(text(company.name) ?? '');

  const providerValue = all.some(value => PERSONAL_PROVIDERS.has(registrable(value)));
  const providerName = Boolean(key) && FREE_MAIL_STEMS.has(key.replace(/ /g, '')) && usable.length === 0;
  if (providerValue || providerName) codes.add('PERSONAL_PROVIDER');
  if (domains.some(value => !registrable(value))) codes.add('MALFORMED_DOMAIN');
  if (all.some(value => firstLastShaped(value, linkedContacts))) codes.add('FIRST_LAST_DOMAIN');
  if (domains.some(value => isSharedHost(value))) codes.add('SHARED_HOST_DOMAIN');
  if (duplicateDomain) codes.add('DUPLICATE_DOMAIN');
  if (duplicateName) codes.add('DUPLICATE_NAME');
  if (usable.length === 0) codes.add('NO_LEGITIMATE_DOMAIN');
  if (company.name_source === 'user' && text(company.name) && text(company.domain)
      && text(company.name) === companyNameFromDomain(text(company.domain))) {
    codes.add('LOCKED_GUESSED_NAME');
  }
  if (!linked && !(Number(company.contact_count) > 0)) codes.add('ORPHAN');
  return Object.keys(COMPANY_FLAGS).filter(code => codes.has(code));
}

/**
 * Audit one workspace from what the read layer collected.
 *
 * @param {{ uid: string,
 *   contacts: Array<{ id: string, data: object, lineage: string[], duplicateEmail?: boolean, duplicatePhone?: boolean }>,
 *   companies: Array<{ id: string, data: object, lineage: string[], linked?: boolean, linkedContact?: object|null }>,
 *   workspaceCompanies: Array<{ id: string, data: object }> }} snapshot
 */
export function auditWorkspace({ uid, contacts = [], companies = [], workspaceCompanies = [] }) {
  // Every company in the workspace, audited ones included, for duplicate checks.
  const everyCompany = new Map(workspaceCompanies.map(company => [company.id, company.data ?? {}]));
  for (const company of companies) everyCompany.set(company.id, company.data ?? {});

  const idsByDomain = new Map();
  const idsByName = new Map();
  for (const [id, data] of everyCompany) {
    for (const key of duplicateDomainKeys(data)) idsByDomain.set(key, [...(idsByDomain.get(key) ?? []), id]);
    const key = nameKey(text(data.name) ?? '');
    if (key) idsByName.set(key, [...(idsByName.get(key) ?? []), id]);
  }

  const audited = new Set(companies.map(company => company.id));
  const pairs = new Set();
  for (const ids of idsByDomain.values()) {
    const unique = [...new Set(ids)].sort();
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        if (audited.has(unique[i]) || audited.has(unique[j])) pairs.add(`${unique[i]}|${unique[j]}`);
      }
    }
  }

  const auditedContacts = contacts.map(contact => ({
    id: contact.id,
    lineage: [...contact.lineage],
    codes: classifyContact(contact.data ?? {}, contact),
  }));

  const auditedCompanies = companies.map(company => {
    const data = company.data ?? {};
    const linkedContacts = contacts.filter(contact => text(contact.data?.company_id) === company.id).map(contact => contact.data ?? {});
    if (company.linkedContact) linkedContacts.push(company.linkedContact);
    const linked = Boolean(company.linked) || linkedContacts.length > 0;
    const nameIds = idsByName.get(nameKey(text(data.name) ?? '')) ?? [];
    return {
      id: company.id,
      lineage: [...company.lineage],
      linked,
      month: monthOf(data.saved_at ?? data.created_at ?? data.createdAt),
      codes: classifyCompany(data, {
        linked,
        linkedContacts,
        duplicateDomain: duplicateDomainKeys(data).some(key => new Set(idsByDomain.get(key)).size > 1),
        duplicateName: new Set(nameIds).size > 1,
      }),
    };
  });

  return { uid, contacts: auditedContacts, companies: auditedCompanies, duplicateDomainPairs: pairs.size };
}

/**
 * Historical endpoint usage. Stored error text is never kept: an errorCode
 * that is not one of the endpoint's own codes is counted as OTHER.
 * @param {Array<{ id: string, data: object }>} rows
 */
export function summarizeUsage(rows = []) {
  const usage = { total: 0, success: 0, error: 0, byMonth: {}, errorCodes: {}, formats: {}, workspaces: 0 };
  const users = new Set();
  for (const { data = {} } of rows) {
    usage.total += 1;
    const status = data.status === 'success' ? 'success' : data.status === 'error' ? 'error' : 'other';
    if (status !== 'other') usage[status] += 1;
    const month = monthOf(data.timestamp);
    usage.byMonth[month] ??= { total: 0, success: 0, error: 0 };
    usage.byMonth[month].total += 1;
    if (status !== 'other') usage.byMonth[month][status] += 1;
    if (status === 'error') {
      const code = text(data.errorCode);
      const bucket = !code ? 'NONE' : KNOWN_ERROR_CODES.has(code) ? code : 'OTHER';
      usage.errorCodes[bucket] = (usage.errorCodes[bucket] ?? 0) + 1;
    }
    const format = ['APOLLO_EXTRACTBUSINESSCARD', 'GOOGLE_EXTRACTBUSINESSCARD'].includes(data.endpoint) ? data.endpoint : 'OTHER';
    usage.formats[format] = (usage.formats[format] ?? 0) + 1;
    if (text(data.userId)) users.add(data.userId);
  }
  usage.workspaces = users.size;
  usage.byMonth = sortKeys(usage.byMonth);
  usage.errorCodes = sortKeys(usage.errorCodes);
  usage.formats = sortKeys(usage.formats);
  return usage;
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

function countFlags(records, flags) {
  const counts = Object.fromEntries(Object.keys(flags).map(code => [code, 0]));
  for (const record of records) for (const code of record.codes) counts[code] += 1;
  return counts;
}

/**
 * The report. IDs-and-codes only. Document IDs appear only with `details`.
 */
export function buildReport({ workspaces = [], usageRows = [], reads = {}, workspacesScanned = 0, scope = 'all' } = {},
  { details = false, generatedAt = null } = {}) {
  const contacts = workspaces.flatMap(workspace => workspace.contacts);
  const companies = workspaces.flatMap(workspace => workspace.companies);
  const duplicateDomainPairs = workspaces.reduce((sum, workspace) => sum + workspace.duplicateDomainPairs, 0);

  const lineageCounts = (records, selectors) => Object.fromEntries(
    selectors.map(lineage => [lineage, records.filter(record => record.lineage.includes(lineage)).length]),
  );
  const byMonth = lineage => sortKeys(companies.filter(company => company.lineage.includes(lineage))
    .reduce((acc, company) => ({ ...acc, [company.month]: (acc[company.month] ?? 0) + 1 }), {}));

  const report = {
    version: AUDIT_VERSION,
    generatedAt,
    readOnly: true,
    scope,
    cleanup: decideCleanup({ contacts, companies, duplicateDomainPairs }),
    totals: {
      workspacesScanned,
      workspacesWithRecords: workspaces.filter(w => w.contacts.length || w.companies.length).length,
      contacts: contacts.length,
      companies: companies.length,
      linkedCompanies: companies.filter(company => company.linked).length,
      duplicateDomainPairs,
    },
    selected: {
      contacts: lineageCounts(contacts, SELECTORS.contacts.map(s => s.lineage)),
      companies: lineageCounts(companies, [...SELECTORS.companies.map(s => s.lineage), 'referenced']),
    },
    contactFlags: countFlags(contacts, CONTACT_FLAGS),
    companyFlags: countFlags(companies, COMPANY_FLAGS),
    heuristicFlags: [...HEURISTIC_FLAGS],
    companiesByMonth: { created: byMonth('source'), promoted: byMonth('accepted_via') },
    usage: summarizeUsage(usageRows),
    byWorkspace: workspaces
      .filter(w => w.contacts.length || w.companies.length)
      .map(w => ({
        workspace: w.uid,
        contacts: w.contacts.length,
        companies: w.companies.length,
        flaggedContacts: w.contacts.filter(c => c.codes.length).length,
        flaggedCompanies: w.companies.filter(c => c.codes.length).length,
        flags: [...w.contacts, ...w.companies].reduce((sum, record) => sum + record.codes.length, 0),
        duplicateDomainPairs: w.duplicateDomainPairs,
      }))
      .sort((a, b) => a.workspace.localeCompare(b.workspace)),
    reads: { queries: reads.queries ?? 0, documents: reads.documents ?? 0, emptyQueries: reads.emptyQueries ?? 0 },
  };

  if (details) {
    const list = (kind, flags) => Object.fromEntries(Object.keys(flags)
      .filter(code => !TOTAL_ONLY_FLAGS.has(code))
      .map(code => [code, workspaces.flatMap(w => w[kind]
        .filter(record => record.codes.includes(code))
        .map(record => `users/${w.uid}/${kind}/${record.id}`)).sort()]));
    report.details = { contacts: list('contacts', CONTACT_FLAGS), companies: list('companies', COMPANY_FLAGS) };
  }
  return report;
}

/** The report as text: summary first; document IDs only when the report carries details. */
export function formatText(report) {
  const lines = [];
  const pad = (label, width = 28) => String(label).padEnd(width);
  const flagLines = counts => Object.entries(counts).map(([code, count]) => {
    const notes = [HEURISTIC_FLAGS.has(code) && 'heuristic', TOTAL_ONLY_FLAGS.has(code) && 'total only'].filter(Boolean);
    return `  ${pad(code)}${String(count).padStart(6)}${notes.length ? `   (${notes.join(', ')})` : ''}`;
  });

  lines.push(`Business-card historical audit — ${report.version} — READ-ONLY, nothing was written`);
  if (report.generatedAt) lines.push(`Generated ${report.generatedAt}; scope: ${report.scope === 'all' ? 'all workspaces' : 'one workspace'}`);
  lines.push('');
  lines.push(`CLEANUP: ${report.cleanup.level}`);
  for (const match of report.cleanup.matched) {
    const rule = CLEANUP_RULES.find(r => r.id === match.id);
    lines.push(`  ${match.id}  ${rule.description} (${match.count})`);
  }
  lines.push('');
  lines.push('Totals');
  const t = report.totals;
  lines.push(`  workspaces scanned ${t.workspacesScanned}, with scanner records ${t.workspacesWithRecords}`);
  lines.push(`  contacts ${t.contacts} (by selector: ${Object.entries(report.selected.contacts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  lines.push(`  companies ${t.companies}, linked ${t.linkedCompanies} (by selector: ${Object.entries(report.selected.companies).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  lines.push(`  duplicate-domain pairs involving audited companies ${t.duplicateDomainPairs}`);
  lines.push('');
  lines.push('Contact flags');
  lines.push(...flagLines(report.contactFlags));
  lines.push('');
  lines.push('Company flags');
  lines.push(...flagLines(report.companyFlags));
  lines.push('');
  lines.push('Scanner companies by month (created / promoted via accepted_via)');
  const months = [...new Set([...Object.keys(report.companiesByMonth.created), ...Object.keys(report.companiesByMonth.promoted)])].sort();
  if (!months.length) lines.push('  none');
  for (const month of months) {
    lines.push(`  ${month}  ${report.companiesByMonth.created[month] ?? 0} / ${report.companiesByMonth.promoted[month] ?? 0}`);
  }
  lines.push('');
  const u = report.usage;
  lines.push(`Endpoint usage (extractBusinessCard): ${u.total} calls, ${u.success} success, ${u.error} error, ${u.workspaces} workspaces`);
  for (const [month, m] of Object.entries(u.byMonth)) lines.push(`  ${month}  ${m.total} (success ${m.success}, error ${m.error})`);
  if (Object.keys(u.errorCodes).length) lines.push(`  error codes: ${Object.entries(u.errorCodes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (Object.keys(u.formats).length) lines.push(`  log formats: ${Object.entries(u.formats).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (u.error) lines.push('  (error rows written before 2026-10-14 recorded an unverified user id)');
  lines.push('');
  lines.push('By workspace');
  if (!report.byWorkspace.length) lines.push('  none');
  for (const w of report.byWorkspace) {
    lines.push(`  ${w.workspace}  contacts ${w.contacts} (flagged ${w.flaggedContacts}), companies ${w.companies} (flagged ${w.flaggedCompanies}), flags ${w.flags}, duplicate-domain pairs ${w.duplicateDomainPairs}`);
  }
  if (report.details) {
    lines.push('');
    lines.push('Details (document IDs by flag)');
    for (const kind of ['contacts', 'companies']) {
      for (const [code, paths] of Object.entries(report.details[kind])) {
        if (!paths.length) continue;
        lines.push(`  ${code}`);
        for (const path of paths) lines.push(`    ${path}`);
      }
    }
  }
  lines.push('');
  lines.push(`Reads: ${report.reads.documents} documents in ${report.reads.queries} queries (${report.reads.emptyQueries} returned nothing)`);
  return `${lines.join('\n')}\n`;
}

// ─── Arguments ───────────────────────────────────────────────────────────────

export class UsageError extends Error {}

export const USAGE = `Usage: FIREBASE_SERVICE_ACCOUNT_PATH=<read-only key> node scripts/auditBusinessCardRecords.mjs [--user-id=<uid>] [--details] [--json]\n`;

/** Only these flags exist. Anything else, including any write-sounding flag, is an error. */
export function parseArgs(argv = []) {
  const options = { userId: null, details: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === '--details') options.details = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--user-id=')) {
      const value = arg.slice('--user-id='.length);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new UsageError('--user-id must be a workspace (user) ID');
      options.userId = value;
    } else {
      throw new UsageError(`unknown argument: ${arg.split('=')[0]}`);
    }
  }
  return options;
}

// ═══ FIRESTORE READS — BEGIN ═════════════════════════════════════════════════
// The only section that touches the database. Read methods only: collection,
// doc, where, select, limit, get, getAll, listDocuments. A test fails the
// build if a write method, or database access outside this section, appears.

/** Open Firestore with the read-only service-account key. No other credential is tried. */
export async function connectReadOnly(env = process.env) {
  const keyPath = text(env.FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!keyPath) {
    throw new UsageError('FIREBASE_SERVICE_ACCOUNT_PATH is required: a key for a service account with read-only Firestore access (roles/datastore.viewer)');
  }
  let key;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    // Never echo the parse error: it can quote the key file.
    throw new UsageError('FIREBASE_SERVICE_ACCOUNT_PATH could not be read as a service-account key');
  }
  if (!text(key?.project_id)) throw new UsageError('the service-account key has no project_id');
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(key), projectId: key.project_id }, `business-card-audit-${Date.now()}`);
  return getFirestore(app);
}

/** Collect everything the audit needs, counting every document read. */
export async function collectAudit(db, { userId = null } = {}) {
  const reads = { queries: 0, documents: 0, emptyQueries: 0 };
  const run = async (query) => {
    const snapshot = await query.get();
    reads.queries += 1;
    reads.documents += snapshot.size;
    if (snapshot.empty) reads.emptyQueries += 1;
    return snapshot.docs;
  };

  let workspaceIds;
  if (userId) {
    workspaceIds = [userId];
  } else {
    const refs = await db.collection('users').listDocuments();
    reads.queries += 1;
    reads.documents += refs.length;
    if (!refs.length) reads.emptyQueries += 1;
    workspaceIds = refs.map(ref => ref.id).sort();
  }

  const workspaces = [];
  for (const uid of workspaceIds) {
    const contactsRef = db.collection('users').doc(uid).collection('contacts');
    const companiesRef = db.collection('users').doc(uid).collection('companies');

    const contactsById = {};
    for (const selector of SELECTORS.contacts) {
      for (const doc of await run(contactsRef.where(selector.field, selector.op, selector.value))) {
        contactsById[doc.id] ??= { id: doc.id, data: doc.data() ?? {}, lineage: [] };
        contactsById[doc.id].lineage.push(selector.lineage);
      }
    }
    const contacts = Object.values(contactsById).sort((a, b) => a.id.localeCompare(b.id));

    // Duplicates: equality queries on the identifiers matching uses, two documents at most each.
    for (const contact of contacts) {
      const others = docs => docs.some(doc => doc.id !== contact.id);
      const email = contactEmail(contact.data);
      if (email) {
        const rawEmail = text(contact.data.email);
        contact.duplicateEmail = others(await run(contactsRef.where('email_normalized', '==', email).select().limit(2)))
          || others(await run(contactsRef.where('email', '==', email).select().limit(2)))
          || (Boolean(rawEmail) && rawEmail !== email && others(await run(contactsRef.where('email', '==', rawEmail).select().limit(2))));
      }
      const phone = contactPhone(contact.data);
      if (phone) {
        const rawPhone = text(contact.data.phone);
        contact.duplicatePhone = others(await run(contactsRef.where('phone_normalized', '==', phone).select().limit(2)))
          || (Boolean(rawPhone) && others(await run(contactsRef.where('phone', '==', rawPhone).select().limit(2))));
      }
    }

    const companiesById = {};
    for (const selector of SELECTORS.companies) {
      for (const doc of await run(companiesRef.where(selector.field, selector.op, selector.value))) {
        companiesById[doc.id] ??= { id: doc.id, data: doc.data() ?? {}, lineage: [] };
        companiesById[doc.id].lineage.push(selector.lineage);
      }
    }
    const referencedIds = [...new Set(contacts.map(contact => text(contact.data.company_id)).filter(Boolean))].sort();
    for (const id of referencedIds) {
      if (companiesById[id]) {
        companiesById[id].lineage.push('referenced');
        continue;
      }
      const [snapshot] = await db.getAll(companiesRef.doc(id));
      reads.queries += 1;
      if (snapshot?.exists) {
        reads.documents += 1;
        companiesById[id] = { id, data: snapshot.data() ?? {}, lineage: ['referenced'] };
      } else {
        reads.emptyQueries += 1;
      }
    }
    const companies = Object.values(companiesById).sort((a, b) => a.id.localeCompare(b.id));

    // Linked: does any contact point at the company? Only asked when no audited contact does.
    for (const company of companies) {
      if (contacts.some(contact => text(contact.data.company_id) === company.id)) {
        company.linked = true;
        continue;
      }
      const [doc] = await run(contactsRef.where('company_id', '==', company.id).select('name', 'email', 'email_normalized').limit(1));
      company.linked = Boolean(doc);
      company.linkedContact = doc ? doc.data() ?? {} : null;
    }

    let workspaceCompanies = [];
    if (companies.length) {
      workspaceCompanies = (await run(companiesRef.select('name', 'domain', 'primary_domain', 'website_url', 'website')))
        .map(doc => ({ id: doc.id, data: doc.data() ?? {} }));
    }

    workspaces.push(auditWorkspace({ uid, contacts, companies, workspaceCompanies }));
  }

  // One field per query, so no composite index. With --user-id the rows are
  // still read in full and narrowed here.
  const usageById = {};
  for (const selector of SELECTORS.usage) {
    const query = db.collection('apiLogs').where(selector.field, selector.op, selector.value)
      .select('timestamp', 'status', 'endpoint', 'errorCode', 'userId');
    for (const doc of await run(query)) usageById[doc.id] ??= { id: doc.id, data: doc.data() ?? {} };
  }
  const usageRows = Object.values(usageById).filter(row => !userId || row.data.userId === userId);

  return {
    workspaces,
    usageRows,
    reads,
    workspacesScanned: workspaceIds.length,
    scope: userId ? 'one' : 'all',
  };
}

// ═══ FIRESTORE READS — END ═══════════════════════════════════════════════════

/**
 * Run the audit. Returns the exit code. `db` is injected by tests; otherwise
 * the read-only key is used.
 */
export async function main(argv = process.argv.slice(2), {
  db = null, env = process.env, write = s => process.stdout.write(s), warn = s => process.stderr.write(s), now = () => new Date(),
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    warn(`business-card audit: ${error.message}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    write(USAGE);
    return 0;
  }
  try {
    const database = db ?? await connectReadOnly(env);
    const collected = await collectAudit(database, { userId: options.userId });
    const report = buildReport(collected, { details: options.details, generatedAt: now().toISOString() });
    write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return report.cleanup.level === 'REQUIRED' ? 2 : 0;
  } catch (error) {
    const reason = error instanceof UsageError ? error.message : `${error?.code ?? error?.name ?? 'Error'}: ${error?.message ?? ''}`;
    warn(`business-card audit did not complete: ${reason}\n`);
    return 1;
  }
}

// Run only when invoked directly. Importing this module (the tests do) must
// not open a Firestore connection or read a key file.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(code => process.exit(code), () => process.exit(1));
}
