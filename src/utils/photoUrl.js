/**
 * isHttpsPhotoUrl — may this text be stored as a contact's photo address?
 *
 * Pure. Only a plain https address: no other scheme (javascript:, data:, http:), no credentials in it, no
 * whitespace or line breaks, a real host, and no more than 2000 characters. The text is judged as it is typed;
 * nothing here rewrites it (a signed address must reach the page exactly as it was given).
 */
export const PHOTO_URL_MAX = 2000;

export function isHttpsPhotoUrl(value) {
  if (typeof value !== 'string' || value === '' || value.length > PHOTO_URL_MAX) return false;
  if (/\s/.test(value) || [...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
}
