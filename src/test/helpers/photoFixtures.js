/**
 * Synthetic profile photos for tests: real JPEG byte layouts (a header the
 * card's inspection accepts), of any size, with or without metadata. They are
 * not pictures of anything. Never a real photograph.
 */
import { encodeBase64 } from '../../capture/preparedImage.js';
import { PHOTO } from '../../utils/photoPrep.js';

const seg = (marker, payload) => [0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload];
const ascii = (text) => [...text].map((c) => c.charCodeAt(0) & 0xFF);

export const JFIF = seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const GPS_MARKER = 'GPS 51.5072N 0.1276W';
export const EXIF = seg(0xE1, ascii(`Exif\0\0${GPS_MARKER}`));

/** A JPEG of this size and (at least) this many bytes. */
export function jpegBytes(edge = 320, length = 20_000, { extra = [], end = true, width = edge, height = edge } = {}) {
  const head = [
    0xFF, 0xD8, ...JFIF, ...extra,
    ...seg(0xC0, [8, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 1, 1, 0x11, 0]),
    ...seg(0xDA, [1, 1, 0, 0, 63, 0]),
  ];
  const out = new Uint8Array(Math.max(length, head.length + 2)).fill(0x5A);
  out.set(head);
  if (end) out.set([0xFF, 0xD9], out.length - 2);
  return out;
}

/** A finished profile photo as a data URL, like the one photoPrep makes. `tag` makes two photos differ. */
export function photoDataUrl(edge = 320, length = 20_000, options = {}) {
  const bytes = jpegBytes(edge, length, options);
  if (options.tag !== undefined) bytes[bytes.length - 3] = options.tag & 0xFF;
  return `${PHOTO.DATA_URL_PREFIX}${encodeBase64(bytes)}`;
}

/** The base64 part of a data URL: what must never be shown as text or logged. */
export const base64Of = (dataUrl) => dataUrl.slice(PHOTO.DATA_URL_PREFIX.length);

/** A fragment of the picture's base64 that no ordinary text would contain, for "is it on the page?" checks. */
export const fingerprintOf = (dataUrl) => base64Of(dataUrl).slice(200, 260);
