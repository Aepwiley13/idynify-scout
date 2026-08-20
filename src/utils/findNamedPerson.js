/**
 * findNamedPerson.js — turning "Dana at Acme" into one record, or a question.
 *
 * Engagement and Preparation are about someone specific. Before Barry can say
 * anything useful he has to know who, and getting that wrong is expensive in a
 * way getting targeting wrong is not: a snapshot of the wrong person reads as
 * confident, correct and completely fabricated.
 *
 * So this never guesses. One defensible match answers; several ask which;
 * none says so plainly. The matching itself is pure — retrieval is the
 * caller's job — which is what makes every rule below testable.
 */

/** Words people put around a name that are not part of it. */
const FILLER = /^(my |the |a |an |with |to |for |about |contact |client |customer |friend |colleague )+/i;

/** Phrases that describe a group rather than name a person. */
const PLURAL = /\b(clients|customers|contacts|people|prospects|leads|everyone|anyone|folks|accounts|relationships)\b/i;

/** Trim, drop filler, and normalize for comparison. */
function normalize(text) {
  if (typeof text !== 'string') return '';
  return text.trim().replace(FILLER, '').replace(/\s+/g, ' ').trim();
}

function lower(text) {
  return normalize(text).toLowerCase();
}

/**
 * Split "Dana at Acme" into the person and the company.
 * "Dana Whitfield" has no company part; "the Acme call" has no person part.
 */
export function splitSubject(subject) {
  const cleaned = normalize(subject);
  if (!cleaned) return { person: '', company: '' };

  const at = cleaned.match(/^(.*?)\s+(?:at|from|of|with)\s+(.+)$/i);
  if (at) return { person: normalize(at[1]), company: normalize(at[2]) };

  return { person: cleaned, company: '' };
}

/**
 * Is this subject a named individual at all?
 *
 * "old clients" and "people I've lost touch with" are real things to want and
 * are not a person. Treating them as a failed lookup would have Barry say he
 * cannot find someone the user never named.
 */
export function namesAnIndividual(subject) {
  const cleaned = normalize(subject);
  if (!cleaned) return false;
  if (PLURAL.test(cleaned)) return false;
  // A name has a capital letter somewhere. Lowercase free text ("the meeting
  // tomorrow", "a few people") does not name anybody.
  return /[A-Z]/.test(cleaned);
}

function fieldsOf(contact) {
  return {
    name: lower(contact?.name || `${contact?.first_name || ''} ${contact?.last_name || ''}`),
    company: lower(contact?.company || contact?.company_name || contact?.organization_name || ''),
  };
}

/** Whole-word containment, so "Dan" does not match "Danielle". */
function containsWord(haystack, needle) {
  if (!haystack || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(haystack);
}

export const FOUND = 'found';
export const SEVERAL = 'several';
export const NONE = 'none';
export const UNNAMED = 'unnamed';

/**
 * Match a spoken subject against records the user already has.
 *
 * @param {string} subject   - what the user called them, verbatim
 * @param {Array<object>} contacts - candidate records already retrieved
 * @returns {{status: string, contact: object|null, candidates: object[], person: string, company: string}}
 */
export function matchNamedPerson(subject, contacts = []) {
  const { person, company } = splitSubject(subject);

  if (!namesAnIndividual(subject)) {
    return { status: UNNAMED, contact: null, candidates: [], person, company };
  }

  const people = Array.isArray(contacts) ? contacts.filter(Boolean) : [];
  const needle = lower(person);

  // Full name, exactly. The only match strong enough to skip everything below.
  const exact = people.filter(c => fieldsOf(c).name === needle);
  if (exact.length === 1) {
    return { status: FOUND, contact: exact[0], candidates: [], person, company };
  }

  // Otherwise: every record whose name contains what the user said. A company
  // in the subject narrows it, and is never used to widen it — a company match
  // alone is not a person match.
  let hits = people.filter(c => containsWord(fieldsOf(c).name, needle));
  if (company && hits.length > 1) {
    const needleCompany = lower(company);
    const narrowed = hits.filter(c => containsWord(fieldsOf(c).company, needleCompany) || fieldsOf(c).company === needleCompany);
    if (narrowed.length > 0) hits = narrowed;
  }

  if (hits.length === 1) return { status: FOUND, contact: hits[0], candidates: [], person, company };
  if (hits.length > 1) {
    // Deliberately not "pick the most recently contacted". A plausible guess
    // that is wrong is the failure mode this module exists to prevent.
    return { status: SEVERAL, contact: null, candidates: hits.slice(0, 5), person, company };
  }

  return { status: NONE, contact: null, candidates: [], person, company };
}

/** The search term to hand to the local people search — the person, not the filler. */
export function searchTermFor(subject) {
  const { person } = splitSubject(subject);
  return person;
}
