/**
 * CardReading — card-reading/v1. What every extractor returns.
 *
 * Every extractor (a model reading the photo, OCR plus a parser, the test
 * fake) only reports what is printed on the card, verbatim, with its own 0–1
 * confidence per field. It never normalizes, validates, infers or classifies,
 * and it cannot supply a level, a check, a source or a company domain: the
 * shape has no place for them, and validateCardReading refuses extra keys.
 * assembleExtraction.js decides all of that the same way for every
 * extractor, so a benchmark compares only what each one reads.
 *
 *   {
 *     status: 'read' | 'no_text',
 *     person: {
 *       fullName, givenName, middleName, familyName, suffix, title: Text,
 *       emails: Text[],
 *       phones: Array<Text & { label: 'mobile' | 'office' | 'direct' | 'fax' | null }>,
 *       linkedinUrl: Text
 *     },
 *     company: {
 *       name: Text & { fromLogo: boolean },   // true when only the logo shows the name
 *       website, address, linkedinUrl: Text
 *     }
 *   }
 *
 *   Text = { raw: string | null, score: number }   raw is exactly what is
 *          printed (null when it is not on the card), without a field label
 *          such as "E:" or "Web:"; score is 0..1. A phone's printed label
 *          ("M:", "Fax") may stay in its raw text and also goes in `label`.
 *
 * A field not printed is { raw: null, score: 0 }. 'no_text' means nothing on
 * the image could be read; every raw is then null.
 */

export const CARD_READING_VERSION = 'card-reading/v1';
export const PHONE_LABELS = Object.freeze(['mobile', 'office', 'direct', 'fax']);

const PERSON_TEXT = ['fullName', 'givenName', 'middleName', 'familyName', 'suffix', 'title', 'linkedinUrl'];
const COMPANY_TEXT = ['website', 'address', 'linkedinUrl'];
const MAX_RAW = 300;
const MAX_ITEMS = 5;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (obj, keys) => isPlainObject(obj)
  && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));

/** A field that is not on the card. */
export const notPrinted = () => ({ raw: null, score: 0 });

/** An empty reading, every field not printed. */
export function emptyReading(status = 'no_text') {
  return {
    status,
    person: {
      fullName: notPrinted(), givenName: notPrinted(), middleName: notPrinted(), familyName: notPrinted(),
      suffix: notPrinted(), title: notPrinted(), emails: [], phones: [], linkedinUrl: notPrinted(),
    },
    company: { name: { ...notPrinted(), fromLogo: false }, website: notPrinted(), address: notPrinted(), linkedinUrl: notPrinted() },
  };
}

function textOk(text, extraKeys = []) {
  if (!exactKeys(text, ['raw', 'score', ...extraKeys])) return false;
  if (!(text.raw === null || (typeof text.raw === 'string' && text.raw.length <= MAX_RAW))) return false;
  return typeof text.score === 'number' && Number.isFinite(text.score) && text.score >= 0 && text.score <= 1;
}

/**
 * Is this a well-formed card-reading/v1? Returns { ok } or { ok: false, path }
 * naming the first problem by path only (never by value).
 */
export function validateCardReading(reading) {
  const bad = path => ({ ok: false, path });
  if (!exactKeys(reading, ['status', 'person', 'company'])) return bad('reading');
  if (!['read', 'no_text'].includes(reading.status)) return bad('status');

  const { person, company } = reading;
  if (!exactKeys(person, [...PERSON_TEXT, 'emails', 'phones'])) return bad('person');
  for (const key of PERSON_TEXT) if (!textOk(person[key])) return bad(`person.${key}`);
  if (!Array.isArray(person.emails) || person.emails.length > MAX_ITEMS) return bad('person.emails');
  for (let i = 0; i < person.emails.length; i += 1) if (!textOk(person.emails[i])) return bad(`person.emails[${i}]`);
  if (!Array.isArray(person.phones) || person.phones.length > MAX_ITEMS) return bad('person.phones');
  for (let i = 0; i < person.phones.length; i += 1) {
    const phone = person.phones[i];
    if (!textOk(phone, ['label']) || !(phone.label === null || PHONE_LABELS.includes(phone.label))) return bad(`person.phones[${i}]`);
  }

  if (!exactKeys(company, ['name', ...COMPANY_TEXT])) return bad('company');
  if (!textOk(company.name, ['fromLogo']) || typeof company.name.fromLogo !== 'boolean') return bad('company.name');
  for (const key of COMPANY_TEXT) if (!textOk(company[key])) return bad(`company.${key}`);

  if (reading.status === 'no_text') {
    const anything = [...PERSON_TEXT.map(k => person[k]), ...person.emails, ...person.phones, company.name, ...COMPANY_TEXT.map(k => company[k])]
      .some(text => text.raw !== null);
    if (anything) return bad('status');
  }
  return { ok: true };
}
