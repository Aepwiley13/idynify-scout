/**
 * CardExtraction v1 — the one shape every reader's output becomes.
 *
 * Part of the Relationship Capture foundation (PR 2). Pure, runtime-
 * independent and NOT IMPORTED BY THE APP YET.
 *
 * The preview, the commit and the UI will accept only this shape, and it will
 * cross the network between them, so it is plain JSON by construction: no
 * Dates, Maps, undefined or non-finite numbers, and validateCardExtraction()
 * rejects any that slip in. It is transient: request and response bodies and
 * screen state, never Firestore.
 *
 * EVERY FIELD KEEPS SEVEN THINGS APART
 * ───────────────────────────────────
 *   raw / value     what was printed, and what we believe the field contains
 *   normalized      the form that is safe to match or validate on
 *   source          where the value came from (card_text, card_logo, inferred, user)
 *   inferredFrom    for an inferred value, from what
 *   extraction      how sure we are it was READ correctly: score, level, checks
 *   witness         what a second reader said, or null where none checks this field
 *   userEdited / userConfirmed   what the user later did
 *
 * They are never collapsed into one confidence number, and identity
 * confidence ("is this that existing record?") is not in here at all.
 *
 * NOT PRINTED MEANS UNKNOWN
 * ────────────────────────
 * A field nobody printed is { value: null, level: 'unknown' }. Never a guess:
 * sarah@gmail.com produces no company, and sarah@acme.com produces a domain
 * candidate, not a display name.
 */

import { nameKey } from '../utils/identityNormalization.js';
import { CHECKS, domainKey, domainStem, emailHost } from './validators.js';
import {
  SAFEGUARDS, CAPTURE_FREE_EMAIL_DOMAINS, CAPTURE_ISP_EMAIL_DOMAINS,
  domainSafeguards, emailDomainSafeguards, websiteSafeguards,
} from './safeguards.js';

export const CONTRACT_VERSION = 'card-extraction/v1';

export const SOURCES = Object.freeze(['card_text', 'card_logo', 'inferred', 'user']);
export const INFERRED_FROM = Object.freeze(['email_domain', 'email_local_part', 'website', 'full_name']);
export const LEVELS = Object.freeze(['confirmed', 'likely', 'possible', 'unknown']);
export const WITNESS_RESULTS = Object.freeze(['agree', 'minor_mismatch', 'contradicted', 'absent', 'skipped']);
export const EMAIL_KINDS = Object.freeze(['work', 'personal', 'role', 'unknown']);
export const PHONE_KINDS = Object.freeze(['mobile', 'office', 'direct', 'fax', 'unknown']);
export const CAPTURE_STATUSES = Object.freeze(['ok', 'partial', 'no_text', 'unreadable']);
export const WITNESS_RUN_STATUSES = Object.freeze(['ok', 'skipped', 'error']);

/** Every code a field's `extraction.checks` may carry. */
export const KNOWN_CHECKS = Object.freeze(new Set([...Object.values(CHECKS), ...Object.values(SAFEGUARDS)]));

// ─── Constructors ────────────────────────────────────────────────────────────

/**
 * One field. Defaults describe a field nobody printed. Arrays are copied so a
 * caller's later mutation cannot reach into a built extraction.
 */
export function makeField({
  raw = null, value = null, normalized = null, source = null, inferredFrom = null,
  score = 0, level = 'unknown', checks = [], witness = null,
  userEdited = false, userConfirmed = false,
} = {}) {
  return {
    raw, value, normalized, source, inferredFrom,
    extraction: { score, level, checks: [...checks] },
    witness, userEdited, userConfirmed,
  };
}

export const unknownField = () => makeField();

/** An email: a field plus its kind (work / personal / role / unknown), derived by rules. */
export function makeEmailField(field = {}, kind = 'unknown') {
  return { ...makeField(field), kind };
}

/**
 * A phone: a field plus its own kind field (a printed label has its own
 * confidence) and the extension, kept out of the number.
 */
export function makePhoneField(field = {}, { kind = makeField(), extension = null } = {}) {
  return { ...makeField(field), kind: makeField(kind), extension };
}

export function emptyCaptureMeta({ operationId, extractedAt } = {}) {
  return {
    operationId: operationId ?? null,
    extractedAt: extractedAt ?? null,
    status: 'no_text',
    provider: { id: null, adapterVersion: null, modelId: null, promptVersion: null },
    witness: { enabled: false, providerId: null, status: null },
    image: {
      sides: 1, widthPx: null, heightPx: null, bytes: null, mimeType: null,
      preflight: { blur: null, brightness: null, glareRatio: null, warnings: [], userOverrode: false },
    },
    timing: { providerMs: null, witnessMs: null, validateMs: null, totalMs: null },
    usage: { inputTokens: null, outputTokens: null },
    counts: { fields: 0, confirmed: 0, likely: 0, possible: 0 },
  };
}

/** A complete extraction with every field unknown. */
export function emptyCardExtraction(meta = {}) {
  return {
    version: CONTRACT_VERSION,
    person: {
      fullName: makeField(), givenName: makeField(), middleName: makeField(),
      familyName: makeField(), suffix: makeField(), title: makeField(),
      emails: [], phones: [], linkedinUrl: makeField(),
    },
    company: {
      name: makeField(), domain: makeField(), website: makeField(), address: makeField(),
      linkedinUrl: makeField(), safeguards: [],
    },
    capture: emptyCaptureMeta(meta),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const FIELD_KEYS = ['raw', 'value', 'normalized', 'source', 'inferredFrom', 'extraction', 'witness', 'userEdited', 'userConfirmed'];
const PERSON_FIELDS = ['fullName', 'givenName', 'middleName', 'familyName', 'suffix', 'title', 'linkedinUrl'];
const COMPANY_FIELDS = ['name', 'domain', 'website', 'address', 'linkedinUrl'];
/** Fields a witness checks (identifiers). `witness` must be null on every other field. */
const WITNESSED = new Set(['person.linkedinUrl', 'company.domain', 'company.website', 'company.linkedinUrl']);

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNullableString = v => v === null || typeof v === 'string';
const isNullableNumber = v => v === null || (typeof v === 'number' && Number.isFinite(v));

/**
 * Validate a CardExtraction v1. Structural (types, enums, no unknown keys, no
 * undefined, JSON-safe) and semantic (the contract rules). Never throws.
 *
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string }> }}
 */
export function validateCardExtraction(extraction) {
  const errors = [];
  const fail = (path, code) => errors.push({ path, code });

  const exactKeys = (obj, path, keys) => {
    if (!isPlainObject(obj)) { fail(path, 'not_object'); return false; }
    for (const key of Object.keys(obj)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown_key');
    for (const key of keys) {
      if (!(key in obj)) fail(`${path}.${key}`, 'missing_key');
      else if (obj[key] === undefined) fail(`${path}.${key}`, 'undefined_value');
    }
    return true;
  };

  // `derivedOrigin`: company.domain records which PRINTED text it was read from
  // (a website or a work email) without being a guess, so it may carry an
  // origin while its source stays card_text and its level can be confirmed.
  const checkField = (field, path, { witnessed = false, valueType = 'string', derivedOrigin = false } = {}) => {
    if (!exactKeys(field, path, FIELD_KEYS)) return;
    const { raw, value, normalized, source, inferredFrom, extraction: ex, witness, userEdited, userConfirmed } = field;

    if (!isNullableString(raw)) fail(`${path}.raw`, 'bad_type');
    if (!(value === null || typeof value === valueType)) fail(`${path}.value`, 'bad_type');
    if (!isNullableString(normalized)) fail(`${path}.normalized`, 'bad_type');
    if (!(source === null || SOURCES.includes(source))) fail(`${path}.source`, 'bad_enum');
    if (!(inferredFrom === null || INFERRED_FROM.includes(inferredFrom))) fail(`${path}.inferredFrom`, 'bad_enum');
    if (typeof userEdited !== 'boolean') fail(`${path}.userEdited`, 'bad_type');
    if (typeof userConfirmed !== 'boolean') fail(`${path}.userConfirmed`, 'bad_type');
    if (!(witness === null || WITNESS_RESULTS.includes(witness))) fail(`${path}.witness`, 'bad_enum');

    if (exactKeys(ex, `${path}.extraction`, ['score', 'level', 'checks'])) {
      if (typeof ex.score !== 'number' || !Number.isFinite(ex.score) || ex.score < 0 || ex.score > 1) {
        fail(`${path}.extraction.score`, 'bad_score');
      }
      if (!LEVELS.includes(ex.level)) fail(`${path}.extraction.level`, 'bad_enum');
      if (!Array.isArray(ex.checks)) fail(`${path}.extraction.checks`, 'bad_type');
      else ex.checks.forEach((check, i) => { if (!KNOWN_CHECKS.has(check)) fail(`${path}.extraction.checks[${i}]`, 'bad_enum'); });
    }
    const level = ex?.level;

    // Not printed means unknown — never a guess.
    if (value === null && level !== 'unknown') fail(path, 'null_value_not_unknown');
    if (value === null && normalized !== null) fail(`${path}.normalized`, 'normalized_without_value');
    if (value !== null && source === null) fail(`${path}.source`, 'value_without_source');
    // Inference is labelled, and never above possible until the user confirms
    // it. Confirming raises the level but keeps the label: provenance is never lost.
    if (source === 'inferred' && inferredFrom === null) fail(`${path}.inferredFrom`, 'inferred_without_origin');
    if (inferredFrom !== null && source !== 'inferred' && !derivedOrigin) fail(`${path}.inferredFrom`, 'origin_without_inferred');
    if (source === 'inferred' && !userConfirmed && ['confirmed', 'likely'].includes(level)) fail(`${path}.extraction.level`, 'inferred_above_possible');
    // The user's word is final.
    if (userEdited && source !== 'user') fail(`${path}.source`, 'user_edit_without_user_source');
    if ((userEdited || userConfirmed) && level !== 'confirmed') fail(`${path}.extraction.level`, 'user_action_not_confirmed');
    // A witness only speaks about identifiers.
    if (!witnessed && witness !== null) fail(`${path}.witness`, 'witness_on_unwitnessed_field');
  };

  if (!exactKeys(extraction, 'extraction', ['version', 'person', 'company', 'capture'])) return { ok: false, errors };
  if (extraction.version !== CONTRACT_VERSION) fail('extraction.version', 'bad_version');

  // ── person ──
  const person = extraction.person;
  if (exactKeys(person, 'person', [...PERSON_FIELDS, 'emails', 'phones'])) {
    for (const name of PERSON_FIELDS) {
      if (isPlainObject(person[name])) checkField(person[name], `person.${name}`, { witnessed: WITNESSED.has(`person.${name}`) });
    }
    if (!Array.isArray(person.emails)) fail('person.emails', 'bad_type');
    else person.emails.forEach((email, i) => {
      const path = `person.emails[${i}]`;
      if (!isPlainObject(email)) { fail(path, 'not_object'); return; }
      const { kind, ...field } = email;
      if (!EMAIL_KINDS.includes(kind)) fail(`${path}.kind`, 'bad_enum');
      checkField(field, path, { witnessed: true });
    });
    if (!Array.isArray(person.phones)) fail('person.phones', 'bad_type');
    else person.phones.forEach((phone, i) => {
      const path = `person.phones[${i}]`;
      if (!isPlainObject(phone)) { fail(path, 'not_object'); return; }
      const { kind, extension, ...field } = phone;
      if (!(extension === null || (typeof extension === 'string' && /^\d{1,6}$/.test(extension)))) fail(`${path}.extension`, 'bad_type');
      checkField(field, path, { witnessed: true });
      if (isPlainObject(kind)) {
        checkField(kind, `${path}.kind`);
        if (!(kind.value === null || PHONE_KINDS.includes(kind.value))) fail(`${path}.kind.value`, 'bad_enum');
      } else {
        fail(`${path}.kind`, 'not_object');
      }
    });
  }

  // ── company ──
  const company = extraction.company;
  if (exactKeys(company, 'company', [...COMPANY_FIELDS, 'safeguards'])) {
    for (const name of COMPANY_FIELDS) {
      if (isPlainObject(company[name])) {
        checkField(company[name], `company.${name}`, {
          witnessed: WITNESSED.has(`company.${name}`),
          derivedOrigin: name === 'domain',
        });
      }
    }
    const safeguardCodes = new Set(Object.values(SAFEGUARDS));
    if (!Array.isArray(company.safeguards)) fail('company.safeguards', 'bad_type');
    else company.safeguards.forEach((code, i) => { if (!safeguardCodes.has(code)) fail(`company.safeguards[${i}]`, 'bad_enum'); });

    const emails = Array.isArray(person?.emails) ? person.emails.map(e => e?.value).filter(v => typeof v === 'string') : [];
    const { domain, website, name } = company;

    // A website is only ever printed URL text: never inferred, never an email.
    if (isPlainObject(website) && website.value !== null) {
      if (website.source === 'inferred') fail('company.website.source', 'website_inferred');
      if (websiteSafeguards(website.value, { emails }).includes(SAFEGUARDS.WEBSITE_FROM_EMAIL)) {
        fail('company.website.value', 'website_from_email');
      }
    }
    // The domain is a registrable domain, never a mailbox provider or a shared
    // host. Unless the user typed it, it names the printed text it was read
    // from, and that text is on this card and usable: a clean website at this
    // domain, or a work address at it (not a role, free-mail or ISP address).
    if (isPlainObject(domain) && domain.value !== null) {
      const fromUser = domain.source === 'user';
      if (domain.inferredFrom === null ? !fromUser : !['website', 'email_domain'].includes(domain.inferredFrom)) {
        fail('company.domain.inferredFrom', 'domain_bad_origin');
      }
      const key = domainKey(domain.value);
      if (!key || domain.normalized !== key) fail('company.domain.normalized', 'domain_not_registrable');
      const codes = domainSafeguards(domain.value);
      if (codes.includes(SAFEGUARDS.FREE_EMAIL_DOMAIN) || codes.includes(SAFEGUARDS.ISP_EMAIL_DOMAIN)) {
        fail('company.domain.value', 'domain_from_mailbox_provider');
      }
      if (codes.includes(SAFEGUARDS.SHARED_HOST_DOMAIN)) fail('company.domain.value', 'domain_shared_host');
      const fromWebsite = isPlainObject(website) && typeof website.value === 'string'
        && !websiteSafeguards(website.value, { emails }).length && domainKey(website.value) === key;
      const fromWorkEmail = emails.some(email => !emailDomainSafeguards(email).length && domainKey(emailHost(email)) === key);
      if (key && ((domain.inferredFrom === 'website' && !fromWebsite) || (domain.inferredFrom === 'email_domain' && !fromWorkEmail))) {
        fail('company.domain.inferredFrom', 'domain_origin_not_on_card');
      }
    }
    // A company name is never manufactured from a mailbox provider: "Gmail"
    // from a gmail.com address. A personal address printed beside a work one
    // does not taint a name inferred from the work domain.
    if (isPlainObject(name) && typeof name.value === 'string' && name.source === 'inferred' && name.inferredFrom === 'email_domain') {
      const providers = emails.map(emailHost).map(domainKey)
        .filter(key => CAPTURE_FREE_EMAIL_DOMAINS.has(key) || CAPTURE_ISP_EMAIL_DOMAINS.has(key));
      if (providers.some(key => domainKey(name.value) === key || nameKey(name.value) === domainStem(key))) {
        fail('company.name', 'company_name_from_mailbox_provider');
      }
    }
  }

  // ── capture meta: a fixed set of keys, so nothing personal can ride along ──
  const capture = extraction.capture;
  if (exactKeys(capture, 'capture', ['operationId', 'extractedAt', 'status', 'provider', 'witness', 'image', 'timing', 'usage', 'counts'])) {
    if (!(capture.operationId === null || (typeof capture.operationId === 'string' && /^cap_[A-Za-z0-9_-]+$/.test(capture.operationId)))) {
      fail('capture.operationId', 'bad_operation_id');
    }
    if (!(capture.extractedAt === null || (typeof capture.extractedAt === 'string' && !Number.isNaN(Date.parse(capture.extractedAt))))) {
      fail('capture.extractedAt', 'bad_timestamp');
    }
    if (!CAPTURE_STATUSES.includes(capture.status)) fail('capture.status', 'bad_enum');

    const strings = (obj, path, keys) => {
      if (exactKeys(obj, path, keys)) keys.forEach(k => { if (!isNullableString(obj[k])) fail(`${path}.${k}`, 'bad_type'); });
    };
    const numbers = (obj, path, keys) => {
      if (exactKeys(obj, path, keys)) keys.forEach(k => { if (!isNullableNumber(obj[k])) fail(`${path}.${k}`, 'bad_type'); });
    };
    strings(capture.provider, 'capture.provider', ['id', 'adapterVersion', 'modelId', 'promptVersion']);
    if (exactKeys(capture.witness, 'capture.witness', ['enabled', 'providerId', 'status'])) {
      if (typeof capture.witness.enabled !== 'boolean') fail('capture.witness.enabled', 'bad_type');
      if (!isNullableString(capture.witness.providerId)) fail('capture.witness.providerId', 'bad_type');
      if (!(capture.witness.status === null || WITNESS_RUN_STATUSES.includes(capture.witness.status))) fail('capture.witness.status', 'bad_enum');
    }
    if (exactKeys(capture.image, 'capture.image', ['sides', 'widthPx', 'heightPx', 'bytes', 'mimeType', 'preflight'])) {
      if (![1, 2].includes(capture.image.sides)) fail('capture.image.sides', 'bad_enum');
      ['widthPx', 'heightPx', 'bytes'].forEach(k => { if (!isNullableNumber(capture.image[k])) fail(`capture.image.${k}`, 'bad_type'); });
      if (!isNullableString(capture.image.mimeType)) fail('capture.image.mimeType', 'bad_type');
      const preflight = capture.image.preflight;
      if (exactKeys(preflight, 'capture.image.preflight', ['blur', 'brightness', 'glareRatio', 'warnings', 'userOverrode'])) {
        ['blur', 'brightness', 'glareRatio'].forEach(k => { if (!isNullableNumber(preflight[k])) fail(`capture.image.preflight.${k}`, 'bad_type'); });
        if (!Array.isArray(preflight.warnings) || preflight.warnings.some(w => typeof w !== 'string')) fail('capture.image.preflight.warnings', 'bad_type');
        if (typeof preflight.userOverrode !== 'boolean') fail('capture.image.preflight.userOverrode', 'bad_type');
      }
    }
    numbers(capture.timing, 'capture.timing', ['providerMs', 'witnessMs', 'validateMs', 'totalMs']);
    numbers(capture.usage, 'capture.usage', ['inputTokens', 'outputTokens']);
    numbers(capture.counts, 'capture.counts', ['fields', 'confirmed', 'likely', 'possible']);
  }

  return { ok: errors.length === 0, errors };
}
