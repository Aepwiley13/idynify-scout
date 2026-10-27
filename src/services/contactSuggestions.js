/**
 * Taking a suggestion Barry Enrich returned (src/utils/contactProtection.js).
 *
 * A title can be taken: the user's choice, written with
 * `enrichment_provenance.title: 'user_accepted'` so the profile shows it as
 * theirs, and so the next Enrich keeps it (an existing title is never
 * overwritten). So can an email found on the company website, and only while
 * the contact still has none: it may be a shared inbox, so the user decides.
 * A company difference is information only and has no action. Provenance
 * entries are written by path, so every other entry stays.
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { text } from '../utils/contactProtection';

export const USER_ACCEPTED = 'user_accepted';

/** Writes the suggested title onto the contact and returns the fields written. */
export async function acceptTitleSuggestion(uid, contactId, suggestion) {
  const title = text(suggestion?.suggested);
  if (suggestion?.field !== 'title' || !suggestion.actionable || !title) {
    throw new Error('only a title suggestion can be accepted');
  }
  const update = { title, 'enrichment_provenance.title': USER_ACCEPTED };
  await updateDoc(doc(db, 'users', uid, 'contacts', contactId), update);
  return update;
}

/**
 * Writes an email Enrich found on the company website, only while the contact
 * still has no email, and returns the fields written.
 */
export async function acceptEmailSuggestion(uid, contactId, suggestion) {
  const email = text(suggestion?.suggested);
  if (suggestion?.field !== 'email' || !suggestion.actionable || !email) {
    throw new Error('only an email suggestion can be accepted');
  }
  const ref = doc(db, 'users', uid, 'contacts', contactId);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data() : null;
  if (!current || text(current.email) || text(current.work_email)) throw new Error('the contact already has an email');
  const update = { email, 'enrichment_provenance.email': USER_ACCEPTED };
  await updateDoc(ref, update);
  return update;
}
