/**
 * contactEmailService — saving a contact's email addresses.
 *
 * Each edit runs in a Firestore transaction: it is applied to the contact's
 * list AS STORED NOW and written with all three email fields together
 * (src/utils/contactEmails.js, buildEmailWrite), so
 *   - email, emails[] and email_normalized always agree, and the identity
 *     engine matches the address the contact actually has;
 *   - an address another tab added, or Barry Enrich filled, between the
 *     screen loading and the user saving is kept: Firestore retries the
 *     transaction when the contact changed underneath it.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { readContactEmails, applyEmailEdit, buildEmailWrite } from '../utils/contactEmails';

export class ContactEmailError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ContactEmailError';
    this.code = code;
  }
}

/**
 * Apply one edit ({ type: 'upsert', entry } | { type: 'remove', id }) and
 * return the contact as stored afterwards, with its id.
 */
export async function saveContactEmailEdit(uid, contactId, edit, { now = () => new Date().toISOString() } = {}) {
  if (!uid || !contactId) throw new ContactEmailError('invalid_request', 'A user and a contact are required.');
  const ref = doc(db, 'users', uid, 'contacts', contactId);
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new ContactEmailError('contact_not_found', 'That contact no longer exists.');
    const current = snapshot.data();
    const update = { ...buildEmailWrite(applyEmailEdit(readContactEmails(current), edit)), updated_at: now() };
    tx.update(ref, update);
    return { ...current, ...update, id: contactId };
  });
}

export default { saveContactEmailEdit, ContactEmailError };
