/**
 * "This is Kristin": attach the LinkedIn profile the user confirmed, and
 * complete the contact from it.
 *
 * Network lookup and duplicate discovery happen before persistence. The final
 * contact decision is made again inside a Firestore transaction against the
 * latest canonical document so a manual edit made while those requests are in
 * flight always wins.
 */
import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { resolveContact, RESOLUTION } from '../../services/contactIdentityService';
import { IdentityConflictError } from '../../utils/identityResolution';
import { normalizeLinkedInUrl } from '../../utils/identityNormalization';
import { enrichmentFromProfile, profileUrl, PROVENANCE } from './linkedinEnrichment.js';

const WRITE_PATH = 'FindLinkedIn';

/** Apollo's record for one exact profile URL, through LinkedIn Link's lookup. */
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
 *   | { status: 'taken', by: { contactId, name, count } }
 *   | { status: 'has_other' }
 *   | { status: 'invalid' } | { status: 'missing' }
 * >}
 */
export async function confirmLinkedIn(uid, contactId, linkedinUrl, { fetchProfile = fetchLinkedInProfile } = {}) {
  const url = profileUrl(linkedinUrl);
  if (!uid || !contactId || !url) return { status: 'invalid' };

  const ref = doc(db, 'users', uid, 'contacts', contactId);
  const initialSnap = await getDoc(ref);
  if (!initialSnap.exists()) return { status: 'missing' };
  const initial = { id: initialSnap.id, ...initialSnap.data() };

  const initialOwn = normalizeLinkedInUrl(initial.linkedin_url);
  if (initialOwn && initialOwn !== normalizeLinkedInUrl(url)) return { status: 'has_other' };

  const holder = await otherHolder(uid, contactId, { linkedin_url: url });
  if (holder) return { status: 'taken', by: holder };

  const fetched = await fetchProfile(url);
  const profile = fetched.status === 'found' ? fetched.profile : null;
  const apolloId = profile?.apollo_person_id;
  const apolloIdTaken = Boolean(apolloId
    && await otherHolder(uid, contactId, { apollo_person_id: apolloId }).catch(() => true));

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return { status: 'missing' };
    const latest = { id: snap.id, ...snap.data() };

    // The user's newer LinkedIn decision wins. We never replace a different
    // profile that appeared while lookup/enrichment was running.
    const own = normalizeLinkedInUrl(latest.linkedin_url);
    if (own && own !== normalizeLinkedInUrl(url)) return { status: 'has_other' };

    const { patch, filled, suggestions } = enrichmentFromProfile(latest, url, profile, {
      // If the latest contact already owns this Apollo id it is not "taken";
      // otherwise the preflight duplicate check controls whether it may attach.
      apolloIdTaken: Boolean(apolloId && !latest.apollo_person_id && apolloIdTaken),
    });

    transaction.update(ref, patch);
    return { status: 'linked', profileStatus: fetched.status, filled, suggestions };
  });
}

/** Take a suggestion the user tapped (the title today): their choice, recorded as theirs. */
export async function acceptLinkedInSuggestion(uid, contactId, suggestion) {
  if (suggestion?.field !== 'title' || !suggestion.actionable) throw new Error('only the title can be taken from LinkedIn');
  await updateDoc(doc(db, 'users', uid, 'contacts', contactId), {
    title: suggestion.suggested,
    'enrichment_provenance.title': PROVENANCE.ACCEPTED,
  });
}
