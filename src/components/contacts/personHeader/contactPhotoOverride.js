import { isPlaceholderPhoto, resolveContactPhotoSources } from '../../../utils/contactPhoto';
import { inspectPhotoDataUrl } from '../../../utils/photoPrep';
import { isHttpsPhotoUrl } from '../../../utils/photoUrl';

export function resolvePhotoOverride(contact) {
  const original = resolveContactPhotoSources(contact);
  const override = contact.photoOverride;
  if (override?.kind === 'hidden') return { thumbnail: null, full: null };
  if (override?.kind === 'upload' && inspectPhotoDataUrl(override.jpeg).ok) {
    return { thumbnail: override.jpeg, full: override.jpeg };
  }
  if (override?.kind === 'url' && isHttpsPhotoUrl(override.url) && !isPlaceholderPhoto(override.url)) {
    return { thumbnail: override.url, full: override.url };
  }
  return contact.contact_hub_photo ? { thumbnail: null, full: null } : original;
}

export function planPhotoOverride(contact, override) {
  if (override === null && !resolveContactPhotoSources(contact).full) return { ok: false, reason: 'no_photo' };
  if (override?.kind === 'url') {
    if (!isHttpsPhotoUrl(override.url)) return { ok: false, reason: 'not_https' };
    if (isPlaceholderPhoto(override.url)) return { ok: false, reason: 'not_a_photo' };
  } else if (override?.kind === 'upload') {
    if (!inspectPhotoDataUrl(override.jpeg).ok) return { ok: false, reason: 'not_a_photo' };
  } else if (override !== null && override?.kind !== 'hidden') {
    return { ok: false, reason: 'not_a_photo' };
  }
  return { ok: true, patch: { photoOverride: override }, previous: { photoOverride: contact.photoOverride ?? null } };
}
