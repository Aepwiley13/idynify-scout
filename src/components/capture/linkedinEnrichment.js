/**
 * What a confirmed LinkedIn profile adds to a contact, and what it may only
 * suggest. Pure: no Firestore, no network.
 *
 * WHOSE VALUE WINS
 * ───────────────
 *   user-confirmed  >  card-observed  >  verified enrichment  >  inferred
 *
 * A contact saved from a card holds values the user reviewed, so any value it
 * already has stays. The profile (Apollo's record for the exact LinkedIn URL
 * the user confirmed: verified enrichment) only fills fields that are empty.
 * Where it disagrees with a value the contact has, that is a suggestion for
 * the user, never a write: the title can be taken with one tap; the company is
 * shown for information, because changing it means changing which company
 * the person belongs to.
 *
 * Never touched: name, email, phones, company, website, notes, status. The
 * LinkedIn URL itself is the user's confirmation, recorded as such.
 *
 * The rules are shared with Barry Enrich: src/utils/contactProtection.js.
 */
import { normalizeLinkedInUrl } from '../../utils/identityNormalization';
import { hasRealContactPhoto } from '../../utils/contactPhoto';
import { text, isBlank as empty, differenceSuggestions } from '../../utils/contactProtection';

/** Where a value came from, in `enrichment_provenance` (the map Barry's enrichment also keeps). */
export const PROVENANCE = Object.freeze({ CONFIRMED: 'user_confirmed', PROFILE: 'apollo_match', ACCEPTED: 'user_accepted' });

/** https://www.linkedin.com/in/<id> for a person's profile; null for anything else. */
export function profileUrl(value) {
  const key = normalizeLinkedInUrl(typeof value === 'string' ? value : '')?.replace(/^[a-z]{2,3}\.(?=linkedin\.com\/)/, '');
  return key && /^linkedin\.com\/in\/[^/]+$/.test(key) ? `https://www.${key}` : null;
}

/** "Salt Lake City, Utah", or the country alone, from a profile's parts. */
function locationOf(profile) {
  return text(profile.location) ?? text([profile.city, profile.state].filter(Boolean).join(', ')) ?? text(profile.country);
}

/**
 * The fields a profile may fill, each filled only when the contact's own is
 * empty. Names match what Barry's enrichment writes, so the profile's
 * existing panels show them.
 */
const FILLABLE = Object.freeze([
  ['title', p => text(p.title)],
  ['headline', p => text(p.headline)],
  ['seniority', p => text(p.seniority)],
]);

const LOCATION_FIELDS = Object.freeze(['location', 'city', 'state', 'country']);

/**
 * The update for a contact whose LinkedIn profile the user just confirmed.
 *
 * @param {object}      contact       the contact as stored
 * @param {string}      linkedinUrl   the profile the user confirmed
 * @param {object|null} profile       findContactByLinkedInUrl's contact, or null when unavailable
 * @param {object}      [options]
 * @param {boolean}     [options.apolloIdTaken]  another contact already holds the profile's Apollo id
 * @param {string}      [options.now]
 * @returns {{ patch: object, filled: string[], suggestions: Array<{ field, current, suggested, actionable }> }}
 */
export function enrichmentFromProfile(contact, linkedinUrl, profile, { apolloIdTaken = false, now = new Date().toISOString() } = {}) {
  const url = profileUrl(linkedinUrl);
  if (!url) throw new Error('not a LinkedIn profile URL');

  const provenance = { ...(contact.enrichment_provenance ?? {}), linkedin_url: PROVENANCE.CONFIRMED };
  const patch = {
    linkedin_url: url,
    linkedin_url_normalized: normalizeLinkedInUrl(url),
    linkedin_confirmed_at: now,
  };
  const filled = [];
  const suggestions = [];

  if (profile) {
    for (const [field, read] of FILLABLE) {
      const value = read(profile);
      if (value && empty(contact[field])) {
        patch[field] = value;
        provenance[field] = PROVENANCE.PROFILE;
        filled.push(field);
      }
    }

    const departments = Array.isArray(profile.departments) ? profile.departments.map(text).filter(Boolean) : [];
    if (departments.length && !(Array.isArray(contact.departments) && contact.departments.length)) {
      patch.departments = departments;
      provenance.departments = PROVENANCE.PROFILE;
      filled.push('departments');
    }

    // Where they are, as one: filled only when the contact says nothing about it,
    // so a city from one source never sits beside a state from another.
    const location = locationOf(profile);
    if (location && LOCATION_FIELDS.every(field => empty(contact[field]))) {
      patch.location = location;
      for (const field of ['city', 'state', 'country']) {
        if (text(profile[field])) patch[field] = text(profile[field]);
      }
      provenance.location = PROVENANCE.PROFILE;
      filled.push('location');
    }

    const photo = text(profile.photo_url);
    if (photo && !hasRealContactPhoto(contact)) {
      patch.photo_url = photo;
      patch.photo_source = 'linkedin';
      provenance.photo_url = PROVENANCE.PROFILE;
      filled.push('photo_url');
    }

    // An identifier, not a fact about the person: kept only if no other contact has it.
    const apolloId = text(profile.apollo_person_id);
    if (apolloId && empty(contact.apollo_person_id) && !apolloIdTaken) patch.apollo_person_id = apolloId;

    suggestions.push(...differenceSuggestions(contact, { title: profile.title, company: profile.organization_name }));

    patch.last_enriched_at = now;
  }

  patch.enrichment_provenance = provenance;
  return { patch, filled, suggestions };
}
