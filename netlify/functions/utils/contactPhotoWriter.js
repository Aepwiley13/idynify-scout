import { inspectPhotoDataUrl } from '../../../src/utils/photoPrep.js';
import { isHttpsPhotoUrl } from '../../../src/utils/photoUrl.js';
import { isPlaceholderPhoto } from '../../../src/utils/contactPhoto.js';

const PROJECTION = 'contact_hub_photo';
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 1500
  && id !== '.' && id !== '..' && !id.includes('/');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const versionOf = (photo) => photo ? `${photo.updatedAt.seconds}:${photo.updatedAt.nanoseconds}` : null;
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const rejected = (status, error) => Object.assign(new Error(error), { status, photoError: error });

function validOverride(value) {
  if (value === null) return true;
  if (value?.kind === 'hidden') return exact(value, ['kind']);
  if (value?.kind === 'url') return exact(value, ['kind', 'url']) && isHttpsPhotoUrl(value.url) && !isPlaceholderPhoto(value.url);
  return value?.kind === 'upload' && exact(value, ['kind', 'jpeg']) && inspectPhotoDataUrl(value.jpeg).ok;
}

/** Request authentication and Firestore dependencies are supplied by the Netlify entry point. */
export function createContactPhotoWriter({ db, verifyToken, now, timestampAfter, deleteField, enabled }) {
  return async function handler(event) {
    if (!enabled()) return json(404, { error: 'unavailable' });
    if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
    const token = (event.headers?.authorization ?? event.headers?.Authorization ?? '').match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json(401, { error: 'sign_in' });
    let caller;
    try {
      caller = await verifyToken(token);
    } catch {
      return json(401, { error: 'sign_in' });
    }
    if (!validId(caller?.uid)) return json(401, { error: 'sign_in' });
    if (caller.firebase?.sign_in_provider === 'custom') return json(403, { error: 'read_only' });

    let data;
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || event.body.length > 70_000) throw new Error();
      data = JSON.parse(event.body);
    } catch {
      return json(400, { error: 'invalid_photo' });
    }
    if (!exact(data, ['uid', 'contactId', 'expectedVersion', 'photo'])
      || !validId(data.contactId) || !(data.expectedVersion === null || (typeof data.expectedVersion === 'string' && /^\d{1,12}:\d{1,9}$/.test(data.expectedVersion)))
      || !validOverride(data.photo)) return json(400, { error: 'invalid_photo' });
    if (data.uid !== caller.uid) return json(403, { error: 'read_only' });

    const user = db.doc(`users/${caller.uid}`);
    const contact = user.collection('contacts').doc(data.contactId);
    const photo = contact.collection('private').doc('photo');
    const sessions = db.collection('impersonationSessions')
      .where('adminUserId', '==', caller.uid).where('status', '==', 'active');
    try {
      const version = await db.runTransaction(async (tx) => {
        const [owner, person, current, active] = await Promise.all([
          tx.get(user), tx.get(contact), tx.get(photo), tx.get(sessions),
        ]);
        if (active.docs.some((entry) => {
          const expires = entry.data().expiresAt?.toMillis?.();
          return !Number.isFinite(expires) || expires > now();
        })) throw rejected(403, 'read_only');
        if (!owner.exists || !person.exists) throw rejected(404, 'missing_contact');
        if (versionOf(current.data()) !== data.expectedVersion) throw rejected(409, 'photo_changed');

        if (data.photo === null) {
          if (isPlaceholderPhoto(person.data().photo_url)) throw rejected(409, 'missing_original');
          tx.delete(photo);
          tx.update(contact, { [PROJECTION]: deleteField() });
          return null;
        }
        const updatedAt = timestampAfter(current.data()?.updatedAt);
        tx.set(photo, { ...data.photo, updatedAt });
        tx.update(contact, { [PROJECTION]: data.photo.kind === 'hidden' ? 'hidden' : 'custom' });
        return versionOf({ updatedAt });
      });
      return json(200, { status: 'saved', version });
    } catch (error) {
      return json(error.status ?? 503, { error: error.photoError ?? 'unavailable' });
    }
  };
}
