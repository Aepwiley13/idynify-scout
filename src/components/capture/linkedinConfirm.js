/**
 * "This is Kristin": attach the LinkedIn profile the user confirmed, and
 * complete the contact from it.
 *
 *   1. The contact still has no LinkedIn, or has this one (a repeat is safe).
 *   2. No other contact already has this profile: one LinkedIn is one person,
 *      and the shared identity resolver is what says who has it.
 *   3. The verified details: LinkedIn Link's exact lookup
 *      (findContactByLinkedInUrl, Apollo's record for this exact URL).
 *   4. One write: the URL in the canonical identity fields, and the details
 *      only where the contact's own are empty (linkedinEnrichment.js).
 *
 * Nothing is attached without the user's confirmation, and nothing the
 * contact already holds is replaced. A differing title comes back as a
 * suggestion the user can take (acceptLinkedInSuggestion).
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { resolveContact, RESOLUTION } from '../../services/contactIdentityService';
import { IdentityConflictError } from '../../utils/identityResolution';
import { normalizeLinkedInUrl } from '../../utils/identityNormalization';
import { enrichmentFromProfile, profileUrl, PROVENANCE } from './linkedinEnrichment.js';

const WRITE_PATH = 'FindLinkedIn';

/**
 * Apollo's record for one exact profile URL, through LinkedIn Link's lookup.
 * @returns {Promise<{ status: 'found', profile } | { status: 'not_found' } | { status: 'failed' }>}
 */
export async function fetchLinkedInProfile(linkedinUrl) {
  try {
    const user = getEffectiveUser();
    if (!user) return { status: 'failed' };
    const response = await fetch('/.netlify/functions/findContactByLinkedInUrl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.uid, authToken: await user.getIdToken(), linkedin_url: linkedinUrl }),
    });
    if (response.status === 404) return { status: 'not_found' };
    const body = await response.json().catch(() => null);
    return response.ok && body?.contact ? { status: 'found', profile: body.contact } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

/** Who already has this identifier, other than this contact: null when nobody else does. */
async function otherHolder(uid, contactId, candidate) {
  try {
    const found = await resolveContact(uid, candidate, { source: WRITE_PATH });
    if (found.outcome === RESOLUTION.MATCHED && found.contactId !== contactId) {
      return { contactId: found.contactId, name: found.existing?.name ?? null, count: 1 };
    }
    return null;
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      const others = (error.contactIds ?? []).filter(id => id !== contactId);
      return others.length ? { contactId: others[0], name: null, count: others.length } : null;
    }
    throw error;
  }
}

/**
 * @returns {Promise<
 *   { status: 'linked', profileStatus: 'found'|'not_found'|'failed', filled: string[], suggestions: object[] }
 *   | { status: 'taken', by: { contactId, name, count } }   another contact has this profile: nothing written
 *   | { status: 'has_other' }                              the contact has a different LinkedIn: nothing written
 *   | { status: 'invalid' } | { status: 'missing' }
 * >}
 */
export async function confirmLinkedIn(uid, contactId, linkedinUrl, { fetchProfile = fetchLinkedInProfile } = {}) {
  const url = profileUrl(linkedinUrl);
  if (!uid || !contactId || !url) return { status: 'invalid' };

  const ref = doc(db, 'users', uid, 'contacts', contactId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { status: 'missing' };
  const contact = { id: snap.id, ...snap.data() };

  const own = normalizeLinkedInUrl(contact.linkedin_url);
  if (own && own !== normalizeLinkedInUrl(url)) return { status: 'has_other' };

  const holder = await otherHolder(uid, contactId, { linkedin_url: url });
  if (holder) return { status: 'taken', by: holder };

  const fetched = await fetchProfile(url);
  const profile = fetched.status === 'found' ? fetched.profile : null;
  const apolloId = profile?.apollo_person_id;
  const apolloIdTaken = Boolean(apolloId && !contact.apollo_person_id
    && await otherHolder(uid, contactId, { apollo_person_id: apolloId }).catch(() => true));

  const { patch, filled, suggestions } = enrichmentFromProfile(contact, url, profile, { apolloIdTaken });
  await updateDoc(ref, patch);
  return { status: 'linked', profileStatus: fetched.status, filled, suggestions };
}

/** Take a suggestion the user tapped (the title today): their choice, recorded as theirs. */
export async function acceptLinkedInSuggestion(uid, contactId, suggestion) {
  if (suggestion?.field !== 'title' || !suggestion.actionable) throw new Error('only the title can be taken from LinkedIn');
  await updateDoc(doc(db, 'users', uid, 'contacts', contactId), {
    title: suggestion.suggested,
    'enrichment_provenance.title': PROVENANCE.ACCEPTED,
  });
}
