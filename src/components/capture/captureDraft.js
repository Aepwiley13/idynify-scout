/**
 * What the review screen edits: the people read from one capture.
 *
 * A capture is a source, not a person. One photo may hold zero, one or (later)
 * several people, so review always works on a LIST of drafts. Today the
 * extractor reads one card, and the list has exactly one entry.
 *
 * A draft holds plain strings the user can correct, plus the card's phone
 * numbers as canonical entries (src/utils/contactPhones.js), so the contact
 * profile and the save use the same list. Nothing is invented: a field the
 * card did not print is an empty string, never a guess.
 *
 * PHONE TYPES ARE WHAT THE CARD PRINTED
 * ────────────────────────────────────
 * The extraction keeps a number's printed text in `raw` ("C: 801-555-1234").
 * The word before the number is mapped with the approved printed-label table
 * (phoneLabels.labelFromPrinted): Main → main, Direct/D → direct, Mobile/M/
 * Cell/C → mobile, Office/O/Work/W → work, Fax/F → fax, and Tel/T/Phone/P/Ph →
 * "Type not set". With no printed word, only the extractor's mobile, direct
 * and fax are kept; its `office` covers Main, Office and Tel alike, so it is
 * "Type not set" rather than a guess. Capture's own extraction is unchanged.
 *
 * SOCIAL HANDLES ARE WHAT THE CARD PRINTED
 * ───────────────────────────────────────
 * Each social row keeps the printed text and the platform the card showed.
 * A bare handle with no network beside it has no platform until the user
 * chooses one; nothing guesses it. A row the user chose, typed or edited is
 * `confirmed`; one left as read is only observed (src/utils/socialProfiles.js).
 */
import { labelFromPrinted } from '../../utils/phoneLabels';
import { makePhone } from '../../utils/contactPhones';
import { parseSocialReference, REVIEW_SOCIAL_PLATFORMS } from '../../utils/socialProfiles';

/** The word printed before a number: "Main Line" in "Main Line: 801…". The extraction's own prefix shape. */
const PRINTED_LABEL = /^([a-z][a-z ./&'-]{0,24}?)\s*:?\s*(?=[+(\d])/i;

/** Extractor kinds that name one type exactly. `office` does not. */
const KIND_LABELS = Object.freeze({ mobile: 'mobile', direct: 'direct', fax: 'fax' });

/** Levels the reader was unsure of: shown as "check this". */
const UNSURE = new Set(['possible', 'unknown']);

const text = field => (typeof field?.value === 'string' ? field.value.trim() : '');
const unsure = field => text(field) !== '' && UNSURE.has(field?.extraction?.level);

/** The printed label before a number, or null. */
export function printedPhoneLabel(raw) {
  const match = typeof raw === 'string' ? raw.trim().match(PRINTED_LABEL) : null;
  return match ? match[1].trim() : null;
}

/** One extracted phone as a canonical entry, typed only by what the card says. */
export function phoneFromExtraction(phone, index) {
  const printed = printedPhoneLabel(phone?.raw);
  const label = printed ? labelFromPrinted(printed) : (KIND_LABELS[phone?.kind?.value] ?? 'unknown');
  // An unreadable number keeps its printed text as the value; drop the label word from it.
  const value = printed && typeof phone?.value === 'string' ? phone.value.replace(PRINTED_LABEL, '') : phone?.value;
  return makePhone({
    id: `card-${index + 1}`,
    value,
    extension: phone?.extension ?? null,
    label,
    labelSource: 'card',
    observedLabel: printed,
  });
}

/** One extracted social handle as a review row. */
export function socialFromExtraction(social, index) {
  const platform = social?.platform?.value;
  return {
    id: `social-${index + 1}`,
    platform: REVIEW_SOCIAL_PLATFORMS.includes(platform) ? platform : null,
    text: text(social),
    observed: typeof social?.raw === 'string' ? social.raw : text(social),
    fromCard: true,
    confirmed: false,
    unsure: unsure(social),
  };
}

/** A row the user adds by hand. */
export function newSocialRow(existing = []) {
  const ids = new Set(existing.map(row => row.id));
  let n = existing.length + 1;
  while (ids.has(`social-${n}`)) n += 1;
  return { id: `social-${n}`, platform: null, text: '', observed: '', fromCard: false, confirmed: true, unsure: false };
}

/**
 * Rows that cannot be saved as they are: no platform chosen, or text that is
 * not a handle or profile address for it.
 *
 * @returns {Array<{ id: string, problem: 'platform_required' | 'unreadable' }>}
 */
export function socialProblems(draft) {
  return (draft?.socials ?? []).flatMap((row) => {
    if (!row.platform) return [{ id: row.id, problem: 'platform_required' }];
    const parsed = parseSocialReference(row.text, { platform: row.platform });
    return parsed?.platform === row.platform ? [] : [{ id: row.id, problem: 'unreadable' }];
  });
}

/** The name as printed, or its printed parts when only those were read. */
function fullName(person) {
  const full = text(person.fullName);
  if (full) return full;
  return [person.givenName, person.middleName, person.familyName].map(text).filter(Boolean).join(' ');
}

/**
 * The people one extraction holds, as review drafts. Always a list.
 *
 * @param {object} extraction  a CardExtraction v1 (captureExtract's response)
 * @returns {Array<object>}
 */
export function draftsFromExtraction(extraction) {
  const person = extraction?.person;
  const company = extraction?.company;
  if (!person || !company) return [];

  const emails = (person.emails ?? []).map(text).filter(Boolean);
  const toCheck = [
    ['name', person.fullName], ['title', person.title], ['company', company.name],
    ['email', person.emails?.[0]], ['linkedinUrl', person.linkedinUrl], ['website', company.website],
  ].filter(([, field]) => unsure(field)).map(([key]) => key);
  if ((person.phones ?? []).some(unsure)) toCheck.push('phones');

  return [{
    key: 'person-1',
    name: fullName(person),
    title: text(person.title),
    company: text(company.name),
    email: emails[0] ?? '',
    otherEmails: emails.slice(1),
    linkedinUrl: text(person.linkedinUrl),
    website: text(company.website),
    phones: (person.phones ?? []).map(phoneFromExtraction).filter(Boolean),
    socials: (person.socials ?? []).map(socialFromExtraction).filter(row => row.text),
    toCheck,
  }];
}

/** A draft for the user to fill in by hand: the card could not be read. */
export function emptyDraft() {
  return {
    key: 'person-1', name: '', title: '', company: '', email: '', otherEmails: [],
    linkedinUrl: '', website: '', phones: [], socials: [], toCheck: [],
  };
}
