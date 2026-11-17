/**
 * My Card — suggestions: what the account already knows that could fill a
 * card, and the only ways a suggestion may enter one.
 *
 * Pure functions: no Firebase, no React, no network. The caller reads the
 * account, the LinkedIn connection and Recon's answers and passes what it got;
 * nothing here reads or writes anything.
 *
 * THE RULES
 *   - A suggestion is only ever a value, never a change. Nothing becomes part
 *     of a card until acceptSuggestion or prefilledNewCard is called with it,
 *     and nothing becomes part of a SAVED card until the owner saves.
 *   - Every value is checked by the card's own rules (normalizeCardField), so
 *     a suggestion is always something the editor would have accepted.
 *   - A saved value is never overwritten: acceptSuggestion leaves any field
 *     that already holds text exactly as it is.
 *   - Switches and the master sharing setting are never touched. A suggested
 *     email is still private until the owner switches it on.
 *
 * WHO SUPPLIES WHAT (highest first; the first source that has a valid value wins)
 *   name         the display name chosen in Settings, then LinkedIn's given and
 *                family name, then the account's firstName and lastName, then
 *                its legacy `name`. Never derived from an email address.
 *                A name comes from ONE source whole, so two people's parts
 *                are never mixed.
 *   email        the account's email, then LinkedIn's email, only when LinkedIn
 *                says it is verified (exactly `true`).
 *   photoUrl     LinkedIn's picture, https only.
 *   title        Recon's "your role/title" answer.
 *   organization Recon's "company name" answer.
 *   Phone, Instagram, website and the LinkedIn address have no source, so
 *   they are never suggested.
 */
import {
  CARD_FIELDS, normalizeCardField, newCard,
} from './myCardRules.js';

export const SUGGESTION_SOURCES = Object.freeze({
  SETTINGS: 'settings',
  LINKEDIN: 'linkedin',
  ACCOUNT: 'account',
  RECON: 'recon',
});

/** The fields a suggestion can be for. The rest of the card has no source. */
export const SUGGESTIBLE_FIELDS = Object.freeze([
  'firstName', 'lastName', 'photoUrl', 'title', 'organization', 'email',
]);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const read = (object, key) => (isPlainObject(object) && own(object, key) ? object[key] : undefined);

/** A field's value if the card's rules accept it and it is not empty; otherwise ''. */
function validValue(field, raw) {
  const { value, error } = normalizeCardField(field, raw);
  return error ? '' : value;
}

/**
 * "Mary Ann Smith" as { firstName: 'Mary Ann', lastName: 'Smith' }: the last
 * word is the family name, as Scout's own vCard has always split it. One word
 * is a first name only. The name shown on the card is the same either way,
 * and the owner can change either part.
 */
function splitFullName(raw) {
  if (typeof raw !== 'string') return null;
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return { firstName: words[0], lastName: '' };
  return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] };
}

/** One source's name, if every part of it is acceptable and there is at least one. */
function nameFrom(source, parts) {
  if (!parts) return null;
  const firstName = validValue('firstName', parts.firstName);
  const lastName = validValue('lastName', parts.lastName);
  // A part that is present but refused sinks the whole source: half a name
  // from one place is not a name to suggest.
  const refused = (field, raw) => normalizeCardField(field, raw).error;
  if (refused('firstName', parts.firstName) || refused('lastName', parts.lastName)) return null;
  if (!firstName && !lastName) return null;
  return { source, firstName, lastName };
}

/** LinkedIn's connection, only while it is connected. */
function connectedLinkedIn(linkedin) {
  return isPlainObject(linkedin) && read(linkedin, 'status') === 'connected' ? linkedin : null;
}

/**
 * What the account could fill a card with.
 *
 * @param {Object} sources
 * @param {Object} [sources.account]  users/{uid}: displayName, firstName,
 *   lastName, name, email.
 * @param {Object} [sources.linkedin] users/{uid}/integrations/linkedin.
 * @param {Object} [sources.recon]    Recon's section 1 answers (companyName, role).
 * @returns {Readonly<Record<string, Readonly<{ value: string, source: string }>>>}
 *   One entry per field that has a valid suggestion; fields with none are absent.
 */
export function buildCardSuggestions({ account, linkedin, recon } = {}) {
  const linked = connectedLinkedIn(linkedin);
  const suggestions = {};
  const suggest = (field, value, source) => {
    if (value) suggestions[field] = Object.freeze({ value, source });
  };

  // Name: one source, whole.
  const name = [
    nameFrom(SUGGESTION_SOURCES.SETTINGS, splitFullName(read(account, 'displayName'))),
    linked && nameFrom(SUGGESTION_SOURCES.LINKEDIN, {
      firstName: read(linked, 'givenName'), lastName: read(linked, 'familyName'),
    }),
    nameFrom(SUGGESTION_SOURCES.ACCOUNT, {
      firstName: read(account, 'firstName'), lastName: read(account, 'lastName'),
    }),
    nameFrom(SUGGESTION_SOURCES.ACCOUNT, splitFullName(read(account, 'name'))),
  ].find(Boolean);
  if (name) {
    suggest('firstName', name.firstName, name.source);
    suggest('lastName', name.lastName, name.source);
  }

  // Email: the account's, else LinkedIn's if LinkedIn has verified it.
  const accountEmail = validValue('email', read(account, 'email'));
  if (accountEmail) {
    suggest('email', accountEmail, SUGGESTION_SOURCES.ACCOUNT);
  } else if (linked && read(linked, 'emailVerified') === true) {
    suggest('email', validValue('email', read(linked, 'email')), SUGGESTION_SOURCES.LINKEDIN);
  }

  // Photo: LinkedIn's picture, which the card's rules only take over https.
  if (linked) suggest('photoUrl', validValue('photoUrl', read(linked, 'pictureUrl')), SUGGESTION_SOURCES.LINKEDIN);

  // Title and company: what the person told Recon about themselves.
  suggest('title', validValue('title', read(recon, 'role')), SUGGESTION_SOURCES.RECON);
  suggest('organization', validValue('organization', read(recon, 'companyName')), SUGGESTION_SOURCES.RECON);

  return Object.freeze(suggestions);
}

/** The suggestion for a field, if it is a real one: a known field and a valid value. */
function usableSuggestion(suggestions, field) {
  if (!SUGGESTIBLE_FIELDS.includes(field) || !isPlainObject(suggestions) || !own(suggestions, field)) return null;
  const entry = suggestions[field];
  const value = validValue(field, read(entry, 'value'));
  return value ? { value, source: read(entry, 'source') } : null;
}

/** Whether a card field holds text. Spaces alone are empty. */
function isFilled(card, field) {
  const raw = read(card, field);
  return typeof raw === 'string' && raw.trim() !== '';
}

/**
 * The owner's "use this" for one field: the card with that one field filled
 * from the suggestion.
 *
 * Returns a new card, and changes nothing else: not the other fields, not the
 * switches, not the master sharing setting. Returns the card exactly as it
 * was (the same object) when there is nothing to do:
 *   - the field already holds text (a saved value is never overwritten);
 *   - the field is not one that has suggestions;
 *   - the suggestion is missing, or its value is not valid.
 */
export function acceptSuggestion(card, field, suggestion) {
  if (!isPlainObject(card)) return card;
  if (!SUGGESTIBLE_FIELDS.includes(field) || isFilled(card, field)) return card;
  const usable = usableSuggestion({ [field]: suggestion }, field);
  if (!usable) return card;
  return { ...card, [field]: usable.value };
}

/**
 * The suggestions that could still be used on this card: only for fields that
 * are empty, and only valid ones. What an editor offers as "use this".
 */
export function openSuggestions(card, suggestions) {
  const open = {};
  for (const field of SUGGESTIBLE_FIELDS) {
    if (isFilled(card, field)) continue;
    const usable = usableSuggestion(suggestions, field);
    if (usable) open[field] = Object.freeze(usable);
  }
  return Object.freeze(open);
}

/**
 * A new card for the editor to start from, filled with every valid
 * suggestion: the default switches, sharing off, and no stored copy. Held in
 * memory until the owner saves; for a card that already exists, use
 * acceptSuggestion one field at a time instead.
 */
export function prefilledNewCard(suggestions) {
  const values = {};
  for (const field of CARD_FIELDS) {
    const usable = usableSuggestion(suggestions, field);
    if (usable) values[field] = usable.value;
  }
  return newCard(values);
}
