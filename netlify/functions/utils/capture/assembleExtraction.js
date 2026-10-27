/**
 * CardReading (what an extractor says is printed) → CardExtraction v2 (what
 * the app shows, reviews and later saves).
 *
 * The same for every extractor, so they differ only in what they read. All of
 * PR 2's rules apply here, on the server, whatever the extractor claimed:
 *
 *   - validators decide whether each value is well-formed and give its
 *     matching form; they never repair a value
 *   - safeguards stop a website that is really an email, and doubt a company
 *     name that is really a title or a person
 *   - confidence.js turns the extractor's 0–1 score into a level, then only
 *     lowers it: a failing check forces unknown, a doubt caps possible, an
 *     unchecked identifier (no witness in V1) caps likely, and a photo kept
 *     through "Use anyway" caps everything at likely
 *   - a name part is never more certain than the printed full name, and one
 *     that is not in the printed full name (an invented initial) is dropped
 *   - the company domain is derived here from printed text (a clean website,
 *     else a work email), never read from the extractor, and never from a
 *     free-mail, ISP, role or shared-host address
 *   - nothing is invented: a field not printed is unknown, and a company name
 *     is never made up from a domain
 *   - a social's platform is the one its printed address names; else the one
 *     the extractor saw beside it, never more than likely; else none, for the
 *     user to choose. LinkedIn stays in its own field, and a network the app
 *     does not support yet is left out
 *
 * The result must pass validateCardExtraction; if it does not, that is an
 * error, never a partial response.
 */
import {
  CONTRACT_VERSION, makeField, makeEmailField, makePhoneField, makeSocialField, emptyCaptureMeta, validateCardExtraction,
} from '../../../../src/capture/contract.js';
import {
  CHECKS, validateEmail, validatePhone, validateUrl, validateLinkedInPerson, validateLinkedInCompany, validateSocial,
  personNameKey, domainKey, emailHost,
} from '../../../../src/capture/validators.js';
import {
  SAFEGUARDS, classifyEmailKind, websiteSafeguards, companyNameSafeguards, assessCompanyEvidence, emailDomainSafeguards,
} from '../../../../src/capture/safeguards.js';
import { computeExtractionLevel, LEVEL_ORDER } from '../../../../src/capture/confidence.js';
import { nameKey } from '../../../../src/utils/identityNormalization.js';
import { REVIEW_SOCIAL_PLATFORMS } from '../../../../src/utils/socialProfiles.js';

/** No witness runs in V1, so every identifier is unchecked: capped at likely. */
const NO_WITNESS = 'skipped';

const clean = raw => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '');
const lowest = (a, b) => (LEVEL_ORDER.indexOf(a) <= LEVEL_ORDER.indexOf(b) ? a : b);
const roundScore = s => Math.round(Math.min(1, Math.max(0, s)) * 1000) / 1000;

// A leading printed label ("M:", "Tel.") and a trailing extension ("x204"),
// which the phone's kind and extension carry separately. The same shapes
// normalizeCapturePhone accepts.
const PHONE_LABEL_PREFIX = /^[a-z][a-z ./&'-]{0,24}?\s*:?\s*(?=[+(\d])/i;
const PHONE_EXTENSION_SUFFIX = /[\s,;]*(?:ext\.?|extension|x)\s*\.?\s*\d{1,6}\s*$/i;

/** The makeField parameters for one printed value, its level decided by confidence.js. */
function fieldParams({
  text, value, raw = text.raw, normalized = null, checks = [], safeguards = [], witnessed = false, overridden,
  source = 'card_text', inferredFrom = null, ceiling = 'confirmed',
}) {
  const { level } = computeExtractionLevel({
    score: text.score, checks, safeguards, witnessed, witness: witnessed ? NO_WITNESS : null, imageOverridden: overridden,
  });
  return {
    raw, value, normalized, source, inferredFrom, score: roundScore(text.score), level: lowest(level, ceiling),
    checks: [...new Set([...checks, ...safeguards])], witness: witnessed ? NO_WITNESS : null,
  };
}

const field = options => makeField(fieldParams(options));

/** A plain text field (title, suffix, address). */
function textField(text, { overridden, normalize = personNameKey } = {}) {
  const value = clean(text.raw);
  if (!value) return makeField();
  return field({ text, value, normalized: normalize ? normalize(value) : null, overridden });
}

/**
 * A given, middle or family name. When a full name is printed, the part must
 * be in it (every word of the part is a word of the full name) and is never
 * more certain than it.
 */
function namePartField(text, fullName, overridden) {
  const value = clean(text.raw);
  if (!value) return makeField();
  const normalized = personNameKey(value);
  if (fullName.value !== null) {
    const words = new Set((fullName.normalized ?? '').split(' '));
    if (!normalized || !normalized.split(' ').every(word => words.has(word))) return makeField();
  }
  return field({ text, value, normalized, overridden, ceiling: fullName.value !== null ? fullName.extraction.level : 'confirmed' });
}

function emailFields(texts, overridden) {
  const seen = new Set();
  const out = [];
  for (const text of texts) {
    const value = clean(text.raw);
    if (!value) continue;
    const check = validateEmail(value);
    const key = check.normalized ?? value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(makeEmailField(
      fieldParams({ text, value, normalized: check.ok ? check.normalized : null, checks: check.checks, witnessed: true, overridden }),
      classifyEmailKind(value),
    ));
  }
  return out;
}

function phoneFields(texts, overridden) {
  const seen = new Set();
  const out = [];
  for (const text of texts) {
    const printed = clean(text.raw);
    if (!printed) continue;
    const check = validatePhone(printed);
    const key = check.phone.normalized ?? printed;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = check.ok ? printed.replace(PHONE_LABEL_PREFIX, '').replace(PHONE_EXTENSION_SUFFIX, '').trim() : printed;
    // A label printed beside the number wins over the extractor's, which is
    // never confirmed on its word alone.
    const kindValue = check.phone.kind ?? text.label;
    const kind = kindValue
      ? fieldParams({ text, raw: null, value: kindValue, normalized: kindValue, overridden, ceiling: check.phone.kind ? 'confirmed' : 'likely' })
      : {};
    out.push(makePhoneField(
      fieldParams({ text, value, normalized: check.ok ? check.phone.normalized : null, checks: check.checks, witnessed: true, overridden }),
      { kind, extension: check.ok ? check.phone.extension : null },
    ));
  }
  return out;
}

function linkedinField(text, validate, overridden) {
  const value = clean(text.raw);
  if (!value) return makeField();
  const check = validate(value);
  return field({ text, value, normalized: check.normalized, checks: check.checks, witnessed: true, overridden });
}

/**
 * The social handles and profile addresses printed, each with its platform.
 * LinkedIn (its own field) and networks not supported yet are left out; the
 * same handle on the same platform is kept once.
 */
function socialFields(texts, overridden) {
  const seen = new Set();
  const out = [];
  for (const text of texts) {
    const value = clean(text.raw);
    if (!value || text.platform === 'linkedin' || text.platform === 'other') continue;
    const check = validateSocial(value);
    if (check.platform && !REVIEW_SOCIAL_PLATFORMS.includes(check.platform)) continue;
    const fromAddress = check.platform !== null;
    const platformValue = check.platform ?? (REVIEW_SOCIAL_PLATFORMS.includes(text.platform) ? text.platform : null);
    const key = `${platformValue ?? ''}:${check.normalized ?? value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const platform = platformValue
      ? fieldParams({ text, raw: null, value: platformValue, normalized: platformValue, overridden, ceiling: fromAddress ? 'confirmed' : 'likely' })
      : {};
    out.push(makeSocialField(
      fieldParams({ text, value, normalized: check.normalized, checks: check.checks, witnessed: true, overridden }),
      { platform },
    ));
  }
  return out;
}

function websiteField(text, emails, overridden) {
  const value = clean(text.raw);
  if (!value) return makeField();
  const safeguards = websiteSafeguards(value, { emails });
  // An email's local part or an address read as a website is not a website at all.
  if (safeguards.includes(SAFEGUARDS.WEBSITE_FROM_EMAIL)) return makeField();
  const check = validateUrl(value);
  return field({ text, value, normalized: check.normalized, checks: check.checks, safeguards, witnessed: true, overridden });
}

function companyNameField(text, { personName, title, domain, overridden }) {
  const value = clean(text.raw);
  if (!value) return makeField();
  const source = text.fromLogo ? 'card_logo' : 'card_text';
  const base = field({ text, value, normalized: nameKey(value), overridden, source });
  const safeguards = companyNameSafeguards(base, { personName, title, domain });
  return field({ text, value, normalized: nameKey(value), safeguards, overridden, source });
}

/**
 * The company domain, derived from the printed website or work email the
 * evidence chose, or an unknown field. Never more certain than that text.
 */
function domainField({ evidence, website, emails, overridden }) {
  if (!evidence.domain.usable) return makeField();
  const key = evidence.domain.key;
  const from = evidence.domain.from === 'website'
    ? website
    : emails.find(email => !emailDomainSafeguards(email.value).length && domainKey(emailHost(email.value)) === key);
  if (!from) return makeField();
  return field({
    text: { raw: null, score: from.extraction.score }, value: key, normalized: key, checks: [CHECKS.HOST_OK],
    witnessed: true, overridden, inferredFrom: evidence.domain.from, ceiling: from.extraction.level,
  });
}

function counts(extraction) {
  const all = [
    ...['fullName', 'givenName', 'middleName', 'familyName', 'suffix', 'title', 'linkedinUrl'].map(k => extraction.person[k]),
    ...extraction.person.emails, ...extraction.person.phones, ...extraction.person.socials,
    ...['name', 'domain', 'website', 'address', 'linkedinUrl'].map(k => extraction.company[k]),
  ].filter(f => f.value !== null);
  const by = level => all.filter(f => f.extraction.level === level).length;
  return { fields: all.length, confirmed: by('confirmed'), likely: by('likely'), possible: by('possible') };
}

/**
 * ok: a name or a person identifier is usable. partial: something else was
 * read. unreadable: text was read but nothing usable came of it. no_text: the
 * extractor found nothing to read.
 */
function statusOf(reading, extraction) {
  if (reading.status === 'no_text') return 'no_text';
  const usable = f => f.value !== null && f.extraction.level !== 'unknown';
  const p = extraction.person;
  const named = [p.fullName, p.givenName, p.familyName].some(usable);
  const identifier = [...p.emails, ...p.phones, p.linkedinUrl].some(usable);
  if (named || identifier) return 'ok';
  const c = extraction.company;
  const anything = [p.middleName, p.suffix, p.title, ...p.socials, c.name, c.domain, c.website, c.address, c.linkedinUrl].some(usable);
  return anything ? 'partial' : 'unreadable';
}

/**
 * Build the CardExtraction. `context` carries the capture meta that is not the
 * extractor's to say: the operation, the prepared image's size and preflight,
 * the provider's identity, timings and token usage.
 *
 * @returns {{ ok: true, extraction } | { ok: false, errors: string[] }}  errors are 'path:code', never values
 */
export function assembleExtraction(reading, {
  operationId, extractedAt, image, provider, timing = {}, usage = {},
}) {
  // A photo that reached extraction with a quality warning was kept through
  // "Use anyway", whatever the flag says.
  const overridden = image.preflight.userOverrode === true || image.preflight.warnings.length > 0;
  const p = reading.person;
  const c = reading.company;

  const emails = emailFields(p.emails, overridden);
  const fullName = textField(p.fullName, { overridden });
  const title = textField(p.title, { overridden });
  const website = websiteField(c.website, emails.map(e => e.value), overridden);
  const givenName = namePartField(p.givenName, fullName, overridden);
  const familyName = namePartField(p.familyName, fullName, overridden);
  const personName = fullName.value ?? ([givenName.value, familyName.value].filter(Boolean).join(' ') || null);

  // The domain comes from what is printed; the company name is judged against it.
  const evidenceInputs = {
    website: website.value, emails: emails.filter(e => e.normalized).map(e => e.value), personName, title: title.value,
  };
  const preliminary = assessCompanyEvidence({ ...evidenceInputs, companyName: null });
  const name = companyNameField(c.name, { personName, title: title.value, domain: preliminary.domain.key, overridden });
  const evidence = assessCompanyEvidence({ ...evidenceInputs, companyName: name.value === null ? null : name });

  const extraction = {
    version: CONTRACT_VERSION,
    person: {
      fullName,
      givenName,
      middleName: namePartField(p.middleName, fullName, overridden),
      familyName,
      suffix: textField(p.suffix, { overridden, normalize: null }),
      title,
      emails,
      phones: phoneFields(p.phones, overridden),
      linkedinUrl: linkedinField(p.linkedinUrl, validateLinkedInPerson, overridden),
      socials: socialFields(p.socials, overridden),
    },
    company: {
      name,
      domain: domainField({ evidence, website, emails, overridden }),
      website,
      address: textField(c.address, { overridden, normalize: null }),
      linkedinUrl: linkedinField(c.linkedinUrl, validateLinkedInCompany, overridden),
      safeguards: evidence.codes,
    },
    capture: emptyCaptureMeta({ operationId, extractedAt }),
  };

  const meta = extraction.capture;
  meta.status = statusOf(reading, extraction);
  meta.provider = {
    id: provider.id, adapterVersion: provider.adapterVersion, modelId: provider.modelId, promptVersion: provider.promptVersion,
  };
  meta.witness = { enabled: false, providerId: null, status: 'skipped' };
  meta.image = {
    sides: 1, widthPx: image.widthPx, heightPx: image.heightPx, bytes: image.bytes, mimeType: image.mimeType,
    preflight: { ...image.preflight, warnings: [...image.preflight.warnings] },
  };
  meta.timing = {
    providerMs: timing.providerMs ?? null, witnessMs: null, validateMs: timing.validateMs ?? null, totalMs: timing.totalMs ?? null,
  };
  meta.usage = { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null };
  meta.counts = counts(extraction);

  const check = validateCardExtraction(extraction);
  return check.ok ? { ok: true, extraction } : { ok: false, errors: check.errors.map(e => `${e.path}:${e.code}`) };
}
