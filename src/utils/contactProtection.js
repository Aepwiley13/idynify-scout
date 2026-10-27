/**
 * Contact protection — what any enrichment may write onto a saved contact.
 * Pure: no Firestore, no network. Shared by LinkedIn confirm (#732,
 * src/components/capture/linkedinEnrichment.js) and Barry Enrich
 * (netlify/functions/barryEnrich.js).
 *
 * WHOSE VALUE WINS
 * ───────────────
 *   user-confirmed  >  card-observed  >  verified enrichment  >  inferred
 *
 * A saved contact holds values the user entered, scanned or reviewed, so any
 * value it already has stays. Enrichment fills fields that are empty, and
 * records where each filled value came from in `enrichment_provenance`.
 * Where a source disagrees with a value the contact has, that is a
 * suggestion for the user, never a write: the title can be taken with one
 * tap; the company is shown for information, because changing it means
 * changing which company the person belongs to.
 *
 * Never overwritten: name, email, phones, company, website.
 *
 * Never written here: a LinkedIn URL. A profile enrichment finds is only a
 * candidate; it is attached when the user confirms it through Find
 * LinkedIn's confirm (src/components/capture/linkedinConfirm.js), which
 * checks no other contact has it and runs the exact lookup.
 */
import { hasRealContactPhoto } from './contactPhoto.js';
import { readContactPhones, makePhone, buildPhoneWrite } from './contactPhones.js';
import { labelFromProviderType } from './phoneLabels.js';

/** The trimmed string, or null when there is none. */
export const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** No value: missing, not a string, or only whitespace. */
export const isBlank = v => text(v) === null;
/** The same words, ignoring case and punctuation ("VP, Sales" = "vp sales"). */
export const sameText = (a, b) => String(a ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  === String(b ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const hasItems = v => Array.isArray(v) && v.length > 0;
const LOCATION_FIELDS = Object.freeze(['location', 'city', 'state', 'country']);

/** The contact's company, under either name a record may use. */
export const ownCompany = contact => text(contact.company_name) ?? text(contact.company);

/**
 * Where a source's title or company differs from the contact's own: offered,
 * never written. Only a value the contact already has can differ; an empty
 * one is filled instead.
 *
 * @returns {Array<{ field: 'title'|'company', current: string, suggested: string, actionable: boolean }>}
 */
export function differenceSuggestions(contact, { title, company }) {
  const suggestions = [];
  const theirTitle = text(title);
  if (theirTitle && !isBlank(contact.title) && !sameText(theirTitle, contact.title)) {
    suggestions.push({ field: 'title', current: text(contact.title), suggested: theirTitle, actionable: true });
  }
  const theirCompany = text(company);
  const mine = ownCompany(contact);
  if (theirCompany && mine && !sameText(theirCompany, mine)) {
    suggestions.push({ field: 'company', current: mine, suggested: theirCompany, actionable: false });
  }
  return suggestions;
}

/** Apollo's phone_numbers as canonical phones[] entries, labelled by Apollo's stated type, else unknown. */
function phonesFromProvider(phoneNumbers) {
  return (Array.isArray(phoneNumbers) ? phoneNumbers : [])
    .map((p, i) => makePhone({
      id: `enrichment-${i + 1}`,
      value: p?.sanitized_number || p?.raw_number || p?.number || '',
      label: labelFromProviderType(p?.type),
      labelSource: 'enrichment',
      observedLabel: typeof p?.type === 'string' ? p.type : null,
    }))
    .filter(Boolean);
}

const SINGLE_PHONE_FIELDS = Object.freeze(['phone', 'phone_mobile', 'phone_direct', 'phone_work', 'phone_home', 'phone_normalized']);

const digitsOf = p => String(p?.normalized ?? p?.value ?? '').replace(/\D/g, '');

/**
 * One number, written with or without its country code: a card's
 * "801-555-1234" and a provider's "+18015551234". Only for not adding a
 * number twice; matching people stays with normalizePhone.
 */
function sameNumber(a, b) {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 10 && long.length - short.length <= 3 && long.endsWith(short);
}

/**
 * The provider's numbers added next to the contact's own.
 *
 * Every number the contact has stays, with its label. A provider number is
 * added only when the contact has no number that is the same (with or
 * without a country code),
 * labelled by the provider's stated type (unknown when it states none we
 * trust, and an unknown number never identifies the person). A number the
 * provider gave before and the user has since removed from the list is not
 * added back. The single fields keep their values: only empty ones are
 * filled, and the number to call (`phone`) is set only on a contact that had
 * no number at all.
 *
 * @returns {{ patch: object, added: object[] }}  an empty patch when nothing is new
 */
export function mergeFoundPhones(contact, phoneNumbers) {
  const found = phonesFromProvider(phoneNumbers);
  if (found.length === 0) return { patch: {}, added: [] };

  const existing = readContactPhones(contact);
  const known = [...existing];
  if (Array.isArray(contact.phones)) known.push(...phonesFromProvider(contact.phone_numbers));

  const added = [];
  for (const phone of found) {
    if (known.some(other => sameNumber(other, phone))) continue;
    known.push(phone);
    added.push({ ...phone, id: `enrichment-${digitsOf(phone)}` });
  }
  if (added.length === 0) return { patch: {}, added };

  const write = buildPhoneWrite([...existing, ...added]);
  const patch = { phones: write.phones };
  for (const field of SINGLE_PHONE_FIELDS) {
    if (field === 'phone' && existing.length > 0) continue;
    if (isBlank(contact[field]) && write[field]) patch[field] = write[field];
  }
  if (!hasItems(contact.phone_numbers)) patch.phone_numbers = phoneNumbers;
  return { patch, added };
}

/**
 * What Barry Enrich may write onto `contact`, from what its steps `found`.
 *
 * Every field is written only when the contact's own is empty; location is
 * filled as one unit (never a city from one source beside a state from
 * another); the provider's numbers are added next to the contact's own
 * (mergeFoundPhones). Title and company differences become suggestions, and
 * so does an email found on a company website. A LinkedIn URL is never
 * written here.
 * `enrichment_provenance` keeps every existing entry and adds one for each
 * field written here.
 *
 * @param {object} contact      the contact as stored
 * @param {object} found        what the enrichment steps found (barryEnrich's enrichedData)
 * @param {object} [options]
 * @param {object} [options.provenance]    field → source for what was found (barryEnrich's provenance)
 * @param {Array}  [options.phoneNumbers]  the provider's phone_numbers
 * @param {object|null} [options.person]  the matched provider record, for title/company suggestions
 * @returns {{ patch: object, filled: string[], suggestions: Array }}
 */
export function enrichmentPatch(contact, found, { provenance = {}, phoneNumbers = [], person = null } = {}) {
  const patch = {};
  const filled = [];
  const sources = {};
  const record = (field, source) => {
    filled.push(field);
    if (source) sources[field] = source;
  };
  const fillText = (field, value, source = provenance[field]) => {
    if (text(value) && isBlank(contact[field])) { patch[field] = text(value); record(field, source); }
  };
  const fillList = (field, value, source = provenance[field]) => {
    if (hasItems(value) && !hasItems(contact[field])) { patch[field] = value; record(field, source); }
  };

  // Email: the contact's own address, or none, decides. One found on a
  // company website may be a shared inbox: offered, never filled.
  let websiteEmail = null;
  if (text(found.email) && isBlank(contact.email)) {
    if (provenance.email === 'website_scrape' || found.emailSource === 'website') {
      websiteEmail = text(found.email);
    } else {
      patch.email = text(found.email);
      if (found.email_status != null) patch.email_status = found.email_status;
      if (found.email_confidence != null) patch.email_confidence = found.email_confidence;
      if (found.emailSource != null) patch.emailSource = found.emailSource;
      record('email', provenance.email);
    }
  }

  // Phones: the provider's numbers next to the contact's own, never instead.
  const phones = mergeFoundPhones(contact, phoneNumbers);
  if (phones.added.length) {
    Object.assign(patch, phones.patch);
    record('phone', provenance.phone ?? 'apollo_match');
  }

  for (const field of ['twitter_url', 'facebook_url', 'seniority', 'headline']) fillText(field, found[field]);
  for (const field of ['departments', 'functions', 'employment_history', 'education']) fillList(field, found[field]);

  // Title and company: filled when empty; a different value is a suggestion.
  const foundTitle = text(found.current_position_title) ?? text(found.title);
  const foundCompany = text(found.current_company_name) ?? text(found.company_name);
  if (foundTitle && isBlank(contact.title)) {
    patch.title = foundTitle;
    record('title', provenance.title ?? provenance.employment_history ?? 'apollo_match');
  }
  if (foundCompany && !ownCompany(contact)) {
    patch.company_name = foundCompany;
    record('company_name', provenance.company_name ?? provenance.employment_history ?? 'apollo_match');
  } else if (isBlank(contact.company_name) && text(contact.company)) {
    // The contact's own company under its other name, so readers of company_name see it.
    patch.company_name = text(contact.company);
  }
  // The older mirror fields follow the contact's own title and company.
  const title = text(contact.title) ?? patch.title ?? null;
  const company = ownCompany(contact) ?? patch.company_name ?? null;
  if (title && isBlank(contact.current_position_title)) patch.current_position_title = title;
  if (company && isBlank(contact.current_company_name)) patch.current_company_name = company;
  // When the job started describes the found title; only kept when that is the contact's title.
  if (text(found.job_start_date) && isBlank(contact.job_start_date) && foundTitle && sameText(foundTitle, title)) {
    patch.job_start_date = text(found.job_start_date);
  }

  // Where they are, as one: only when the contact says nothing about it.
  if (LOCATION_FIELDS.every(field => isBlank(contact[field]))) {
    const personal = text(found.city) || text(found.state) || text(found.country);
    const place = personal
      ? { city: found.city, state: found.state, country: found.country }
      : { city: found.company_city, state: found.company_state, country: found.company_country };
    const parts = Object.fromEntries(Object.entries(place).map(([k, v]) => [k, text(v)]).filter(([, v]) => v));
    if (Object.keys(parts).length) {
      Object.assign(patch, parts);
      if (text(found.time_zone) && isBlank(contact.time_zone)) patch.time_zone = text(found.time_zone);
      record('location', personal ? (provenance.location ?? 'apollo_match') : (provenance.company_location ?? 'google_places'));
    }
  }

  if (text(found.photo_url) && !hasRealContactPhoto(contact)) {
    patch.photo_url = text(found.photo_url);
    record('photo_url', provenance.photo_url);
  }

  for (const field of ['company_website', 'company_phone', 'company_address']) {
    if (field === 'company_website' && !isBlank(contact.website)) continue;
    fillText(field, found[field]);
  }

  // An inferred flag: set once, when the contact has none. Enrich used to
  // rewrite it on every run.
  if (typeof found.is_likely_decision_maker === 'boolean' && contact.is_likely_decision_maker == null) {
    patch.is_likely_decision_maker = found.is_likely_decision_maker;
  }

  const suggestions = differenceSuggestions(contact, {
    title: text(person?.title) ?? text(person?.employment_history?.[0]?.title),
    company: text(person?.organization_name) ?? text(person?.organization?.name) ?? text(person?.employment_history?.[0]?.organization_name),
  });
  if (websiteEmail) suggestions.push({ field: 'email', current: null, suggested: websiteEmail, actionable: true, source: 'website' });

  patch.enrichment_provenance = { ...(contact.enrichment_provenance ?? {}), ...sources };
  return { patch, filled, suggestions };
}
