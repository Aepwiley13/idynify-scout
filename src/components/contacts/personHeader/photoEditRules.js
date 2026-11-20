/**
 * photoEditRules — the pure rules for adding, replacing and removing a contact's photo from the header.
 *
 * ONE PHOTO FIELD, THE ONE THAT ALREADY EXISTS. A contact stores a single `photo_url` (and `photo_source`, which
 * says where it came from). A new address is written the way IdentityCard's "Paste photo URL" writes it:
 * photo_url plus photo_source "manual_url". Removing writes an empty photo_url and leaves photo_source alone.
 * No second photo store, no thumbnail field, nothing else.
 *
 * WHAT IS REFUSED. An address that is not a plain https address (see utils/photoUrl), one the app already treats
 * as "not a person's face" (a placeholder, a company logo: it would be saved and then never shown), a blank,
 * and an address already on the contact. A replacement overwrites an address that may have come from an import or
 * an enrichment: that is the explicit act the person asked for, and `previous` is kept so a failed write puts it back.
 */
import { isPlaceholderPhoto, hasRealContactPhoto } from '../../../utils/contactPhoto';
import { isHttpsPhotoUrl } from '../../../utils/photoUrl';

export const PHOTO_SOURCE_MANUAL = 'manual_url';

const hasId = (contact) => Boolean(contact) && typeof contact.id === 'string' && contact.id !== '';

/** @returns {{ ok: false, reason: string } | { ok: true, patch: object, previous: object }} */
export function planPhotoSet(contact, raw) {
  if (!hasId(contact)) return { ok: false, reason: 'no_contact' };
  if (typeof raw !== 'string') return { ok: false, reason: 'not_text' };
  const url = raw.trim();
  if (url === '') return { ok: false, reason: 'blank' };
  if (!isHttpsPhotoUrl(url)) return { ok: false, reason: 'not_https' };
  if (isPlaceholderPhoto(url)) return { ok: false, reason: 'not_a_photo' };
  if (url === (typeof contact.photo_url === 'string' ? contact.photo_url.trim() : '')) return { ok: false, reason: 'unchanged' };
  return {
    ok: true,
    patch: { photo_url: url, photo_source: PHOTO_SOURCE_MANUAL },
    previous: { photo_url: contact.photo_url, photo_source: contact.photo_source },
  };
}

/** @returns {{ ok: false, reason: string } | { ok: true, patch: object, previous: object }} */
export function planPhotoRemove(contact) {
  if (!hasId(contact)) return { ok: false, reason: 'no_contact' };
  if (!hasRealContactPhoto(contact)) return { ok: false, reason: 'no_photo' };
  return { ok: true, patch: { photo_url: '' }, previous: { photo_url: contact.photo_url } };
}
