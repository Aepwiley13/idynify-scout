/**
 * saveContactFields — the one write for a contact's identity lines (name, title, company_name).
 *
 * It writes the contact document that already exists, users/{uid}/contacts/{id}, with the fields given and
 * updated_at: the same document and the same shape IdentityCard writes. It adds no field and no schema.
 *
 * FAILS CLOSED, BEFORE ANY WRITE. It refuses unless all of these hold at the moment of the call:
 *   - the contact id and the patch are well formed (only the allowed fields, all text);
 *   - someone is signed in;
 *   - the session is not an impersonated one (an admin viewing as a user does not edit their contacts);
 *   - the effective account is the account that BEGAN the edit (expectUid): a captured id is compared with the
 *     live one here, not trusted on its own, so an account switch between the edit and the write writes nothing.
 * Firestore's own rules remain the final gate; this stops the write before it is asked for.
 *
 * Errors carry a `code`. A failed Firestore write is passed on unchanged.
 */
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';
import { isHttpsPhotoUrl } from '../utils/photoUrl';

/**
 * The fields this helper may write. Widened only by a reviewed milestone.
 *   name, title, company_name   any text (the identity lines)
 *   photo_url                   '' (remove) or a plain https address
 *   photo_source                only "manual_url", the value the card's own "Paste photo URL" writes
 */
export const CONTACT_FIELD_WRITES = Object.freeze(['name', 'title', 'company_name', 'photo_url', 'photo_source']);

const VALID_VALUE = Object.freeze({
  photo_url: (value) => value === '' || isHttpsPhotoUrl(value),
  photo_source: (value) => value === 'manual_url',
});

export class ContactFieldsError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContactFieldsError';
    this.code = code;
  }
}

const validId = (id) => typeof id === 'string' && id !== '' && id !== '.' && id !== '..' && !id.includes('/');

function validPatch(patch) {
  if (!patch || typeof patch !== 'object') return false;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => CONTACT_FIELD_WRITES.includes(k) && typeof patch[k] === 'string' && (VALID_VALUE[k]?.(patch[k]) ?? true));
}

/**
 * @param {string} contactId
 * @param {{ name?: string, title?: string, company_name?: string }} patch
 * @param {{ expectUid?: string }} options  the account that began the edit
 */
export async function saveContactFields(contactId, patch, { expectUid } = {}) {
  if (!validId(contactId) || !validPatch(patch)) throw new ContactFieldsError('invalid_write');
  let uid = null;
  let impersonated = false;
  try {
    const user = getEffectiveUser();
    uid = user?.uid || null;
    impersonated = Boolean(user?._isImpersonated);
  } catch {
    uid = null;
  }
  if (!uid) throw new ContactFieldsError('no_user');
  if (impersonated) throw new ContactFieldsError('read_only');
  if (typeof expectUid !== 'string' || expectUid === '' || expectUid !== uid) throw new ContactFieldsError('account_changed');
  await updateDoc(doc(db, 'users', uid, 'contacts', contactId), { ...patch, updated_at: new Date().toISOString() });
}
