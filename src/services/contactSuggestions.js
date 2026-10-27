/**
 * Taking a suggestion Barry Enrich returned (src/utils/contactProtection.js).
 *
 * Only a title can be taken: the user's choice, written with
 * `enrichment_provenance.title: 'user_accepted'` so the profile shows it as
 * theirs, and so the next Enrich keeps it (an existing title is never
 * overwritten). A company difference is information only and has no action.
 * The provenance entry is written by path, so every other entry stays.
 */
import { doc, updateDoc } from 'firebase/firestore';
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
