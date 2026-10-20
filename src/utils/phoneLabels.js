/**
 * Phone labels — what each number on a person represents.
 *
 * One vocabulary for the contact profile, Capture and identity matching.
 * Before it, three disagreed: the profile editor said mobile/work/home/other,
 * Capture said mobile/office/direct/fax, Apollo enrichment said
 * mobile/direct/work/home, and none of them could say "main".
 *
 *   mobile   the person's mobile / cell number
 *   direct   the person's direct work line
 *   main     the company's main / switchboard number
 *   work     a work number, not stated whether main or direct ("Office")
 *   fax      a fax number
 *   home     the person's home number
 *   other    a number the user filed as something else
 *   unknown  the type is not known: never guessed, left for review
 *
 * A label is only ever what the source states. A printed "Tel" says nothing
 * about whose line it is, so it is `unknown`, not `work`; a number with no
 * label at all is `unknown`, not `mobile`.
 *
 * No imports: identityNormalization.js reads PERSON_PHONE_LABELS from here, and
 * contactPhones.js imports identityNormalization.js.
 */

export const CONTACT_PHONE_LABELS = Object.freeze(['mobile', 'direct', 'main', 'work', 'fax', 'home', 'other', 'unknown']);

/**
 * Numbers that belong to one person, and only those, may identify a person
 * for automatic matching. A main, work or fax line is shared by everyone at
 * the company, and an unknown one may be: matching on it would merge two
 * coworkers into one record.
 */
export const PERSON_PHONE_LABELS = Object.freeze(['mobile', 'direct', 'home']);

/** Where a label came from. A number whose label is `unknown` has no label source. */
export const PHONE_LABEL_SOURCES = Object.freeze(['card', 'user', 'enrichment', 'legacy']);

export const isContactPhoneLabel = label => CONTACT_PHONE_LABELS.includes(label);
export const isPersonPhoneLabel = label => PERSON_PHONE_LABELS.includes(label);

/**
 * Printed labels, exactly as approved. Anything not listed is `unknown`,
 * including labels that look close ("Mob", "Cellular", "Telephone"): a new
 * label is a decision to add here, not something to infer.
 */
const PRINTED_LABELS = new Map([
  ...['main', 'main line', 'main office', 'switchboard'].map(l => [l, 'main']),
  ...['direct', 'd', 'dd', 'direct line'].map(l => [l, 'direct']),
  ...['mobile', 'm', 'cell', 'c'].map(l => [l, 'mobile']),
  ...['office', 'o', 'work', 'w'].map(l => [l, 'work']),
  ...['fax', 'f'].map(l => [l, 'fax']),
  // Tel, T, Phone, P and Ph say a number is a phone, not whose it is.
  ...['tel', 't', 'phone', 'p', 'ph'].map(l => [l, 'unknown']),
]);

/** "Main Line:", "D.", " CELL " → the key PRINTED_LABELS is keyed by. */
const printedKey = text => text.toLowerCase().replace(/[.:]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The label for a label printed beside a number on a card ("C", "Main Line:").
 * Not used by Capture yet: Capture keeps its own table until the change that
 * moves it here, after the 50-card pilot.
 *
 * @param {string|null|undefined} observed
 * @returns {string} one of CONTACT_PHONE_LABELS
 */
export function labelFromPrinted(observed) {
  if (typeof observed !== 'string') return 'unknown';
  return PRINTED_LABELS.get(printedKey(observed)) ?? 'unknown';
}

/**
 * The label for an enrichment provider's phone `type`. Only the types the
 * existing enrichment code already recognises, matched exactly; any other is
 * `unknown`, with the provider's word kept as the observed label.
 *
 * @param {string|null|undefined} type
 * @returns {string} one of CONTACT_PHONE_LABELS
 */
export function labelFromProviderType(type) {
  if (typeof type !== 'string') return 'unknown';
  const key = type.trim().toLowerCase();
  return ['mobile', 'direct', 'work', 'home', 'fax', 'other'].includes(key) ? key : 'unknown';
}
