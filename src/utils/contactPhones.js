/**
 * A contact's phone numbers: one canonical list, read from whatever shape a
 * record has, and written back with the older single fields kept in step.
 *
 * THE CANONICAL ENTRY — `contact.phones[]`
 * ───────────────────────────────────────
 *   id             stable within the list
 *   value          the number as written, without its printed label or extension
 *   extension      "204" for "x204", or null
 *   label          what the number is: phoneLabels.CONTACT_PHONE_LABELS
 *   labelSource    who said so: card | user | enrichment | legacy; null when unknown
 *   observedLabel  the source's own word, when there was one: "C", "Main Line",
 *                  a provider's type. Review can show what the card said, not
 *                  only how it was read
 *   normalized     the matching form: normalizePhone(value)
 *
 * WHY A LIST, AND WHY THE OLD FIELDS STAY
 * ──────────────────────────────────────
 * Records carry up to four phone shapes at once: `phone`, the typed
 * `phone_mobile` / `phone_direct` / `phone_work` / `phone_home` from
 * enrichment, the provider's raw `phone_numbers[]`, and `phones[]` from the
 * profile editor. Dozens of readers (call and text buttons, lists, exports,
 * missions) read the single fields. So `phones[]` becomes the one place a
 * number and its label live, and every write through buildPhoneWrite also
 * sets the single fields from it. Nothing is migrated: a record without
 * `phones[]` is read from its old fields, and gains the list the next time
 * its numbers are saved.
 *
 * A record's `phones[]`, once present (even empty), is the list: the old
 * fields are not merged back in. That is how a deleted number stays deleted.
 */
import { normalizePhone } from './identityNormalization.js';
import { isContactPhoneLabel, labelFromProviderType, PERSON_PHONE_LABELS, PHONE_LABEL_SOURCES } from './phoneLabels.js';

/** The same extension shapes normalizeCapturePhone accepts: "x204", "ext. 204", "extension 204". */
const EXTENSION = /[\s,;]*(?:ext\.?|extension|x)\s*\.?\s*(\d{1,6})\s*$/i;

/** Which number to call: a person's own lines first, then the company's. A fax is never called. */
const CALL_ORDER = ['mobile', 'direct', 'main', 'work', 'home', 'other', 'unknown'];

/** How the profile lists numbers. */
const DISPLAY_ORDER = ['mobile', 'direct', 'main', 'work', 'home', 'other', 'unknown', 'fax'];

const text = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/**
 * Split a typed or stored number into its value and extension.
 * "801-555-1234 x12" → { value: "801-555-1234", extension: "12" }.
 */
export function splitExtension(input) {
  const raw = text(input);
  const match = raw.match(EXTENSION);
  if (!match) return { value: raw, extension: null };
  return { value: raw.slice(0, match.index).trim(), extension: match[1] };
}

/**
 * One canonical entry. An unrecognised label is `unknown`, and an unknown
 * label has no source: nothing claims to know what the number is.
 *
 * @returns {object|null} null when there is no number
 */
export function makePhone({ id, value, extension = null, label = 'unknown', labelSource = null, observedLabel = null } = {}) {
  const split = splitExtension(value);
  if (!split.value) return null;
  const finalLabel = isContactPhoneLabel(label) ? label : 'unknown';
  const ext = text(extension) || split.extension;
  return {
    id: text(id) || null,
    value: split.value,
    extension: ext && /^\d{1,6}$/.test(ext) ? ext : null,
    label: finalLabel,
    labelSource: finalLabel === 'unknown' || !PHONE_LABEL_SOURCES.includes(labelSource) ? null : labelSource,
    observedLabel: text(observedLabel) || null,
    normalized: normalizePhone(split.value),
  };
}

/** A stored `phones[]` entry, old shape ({ id, value, label }) or new. Labels set in the editor are the user's. */
function fromStored(entry, i) {
  if (!entry || typeof entry !== 'object') return null;
  const label = isContactPhoneLabel(entry.label) ? entry.label : 'unknown';
  return makePhone({
    id: entry.id ?? String(i),
    value: entry.value,
    extension: entry.extension,
    label,
    labelSource: entry.labelSource ?? 'user',
    observedLabel: entry.observedLabel,
  });
}

/** The typed single fields, in the order they are read. */
const LEGACY_TYPED = [['phone_mobile', 'mobile'], ['phone_direct', 'direct'], ['phone_work', 'work'], ['phone_home', 'home']];

/** A provider phone object ({ sanitized_number, raw_number, type }) as an entry. */
function fromProvider(obj, id) {
  if (!obj || typeof obj !== 'object') return null;
  const value = [obj.sanitized_number, obj.raw_number, obj.number].find(v => text(v));
  const label = labelFromProviderType(obj.type);
  return makePhone({ id, value, label, labelSource: 'enrichment', observedLabel: typeof obj.type === 'string' ? obj.type : null });
}

/**
 * Every number on a contact, as canonical entries in stored order.
 *
 * With `phones[]`: that list. Without it: the old fields, typed by the field
 * they sit in (phone_mobile is mobile), then the provider's numbers by their
 * own type, then `phone` itself as `unknown`. `phone` has no type of its own,
 * so it is no longer shown as "mobile". A number already listed is not listed
 * again; non-string junk (a provider object stored in `phone`) is read for
 * its number or skipped, never shown as "[object Object]".
 */
export function readContactPhones(contact) {
  if (!contact || typeof contact !== 'object') return [];
  if (Array.isArray(contact.phones)) return contact.phones.map(fromStored).filter(Boolean);

  const out = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry) return;
    const key = entry.normalized ?? entry.value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const [field, label] of LEGACY_TYPED) add(makePhone({ id: field, value: contact[field], label, labelSource: 'legacy' }));
  if (Array.isArray(contact.phone_numbers)) contact.phone_numbers.forEach((p, i) => add(fromProvider(p, `phone_numbers.${i}`)));
  if (contact.phone && typeof contact.phone === 'object') add(fromProvider(contact.phone, 'phone'));
  else add(makePhone({ id: 'phone', value: contact.phone }));
  return out;
}

const firstBy = (list, order, accept = () => true) => {
  for (const label of order) {
    const hit = list.find(p => p.label === label && accept(p));
    if (hit) return hit;
  }
  return null;
};

/** The number to call: mobile, then direct, main, work, home, other, unknown. Never a fax. */
export const primaryPhone = list => firstBy(list, CALL_ORDER);

/**
 * The number to text: a mobile, else a number whose type isn't set (on most
 * older records that is the only number, and it may well be a mobile; the
 * person sending knows). Never a main, work, direct, home or fax line: a
 * switchboard, a desk phone or a fax can't take a text.
 */
export const textablePhone = list => list.find(p => p.label === 'mobile') ?? list.find(p => p.label === 'unknown') ?? null;

/**
 * The number that identifies this person for automatic matching: a mobile,
 * direct or home number (PERSON_PHONE_LABELS, in that order), never a main,
 * work, fax, other or unknown one.
 */
export const identityPhone = list => firstBy(list, PERSON_PHONE_LABELS, p => p.normalized !== null);

/** For the profile: mobile, direct, main, work, home, other, unknown, fax; stored order within each. */
export function sortPhonesForDisplay(list) {
  return [...list].sort((a, b) => DISPLAY_ORDER.indexOf(a.label) - DISPLAY_ORDER.indexOf(b.label));
}

/** "801-555-1234" or "801-555-1234 x12": how the single fields carry an entry. */
export const phoneDisplay = p => (p ? (p.extension ? `${p.value} x${p.extension}` : p.value) : null);

/**
 * The Firestore update for a contact's numbers: the canonical list plus the
 * single fields, all derived from it. A type the list no longer has clears
 * its field, so a number deleted here does not come back from an old field.
 * `phone_normalized` is the identity number, so it is null when the person
 * has no mobile, direct or home number: a main line never identifies them.
 * `phone_numbers` (the provider's raw data) is left as it is.
 */
export function buildPhoneWrite(list) {
  const phones = list.map((p, i) => makePhone({ ...p, id: p.id ?? String(i) })).filter(Boolean);
  const first = label => phoneDisplay(phones.find(p => p.label === label));
  return {
    phones,
    phone: phoneDisplay(primaryPhone(phones)),
    phone_mobile: first('mobile'),
    phone_direct: first('direct'),
    phone_work: first('work'),
    phone_home: first('home'),
    phone_normalized: identityPhone(phones)?.normalized ?? null,
  };
}
