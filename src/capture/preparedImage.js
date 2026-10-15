/**
 * PreparedCardImage — card-image/v1. The one shape a prepared card photo takes
 * between the phone and the extraction endpoint.
 *
 * Image preparation (PR 5) produces exactly this object; captureExtract (PR 6)
 * accepts exactly this object, as the `image` field of its request. Neither
 * side has a format of its own. Pure and runtime-independent: no DOM, no Node
 * built-ins, so the browser and the server run the same checks.
 *
 *   {
 *     version:  'card-image/v1',
 *     mimeType: 'image/jpeg',
 *     data:     '<standard base64 of the JPEG bytes: no data: prefix, no whitespace>',
 *     bytes:    <decoded length in bytes, 1..1,500,000>,
 *     widthPx:  <integer, as encoded in the JPEG>,
 *     heightPx: <integer, as encoded in the JPEG>,
 *     preflight: {
 *       blur:         <variance of the Laplacian, >= 0>,
 *       brightness:   <mean luma, 0..255>,
 *       glareRatio:   <share of near-white pixels in the central area, 0..1>,
 *       warnings:     <subset of ['blurry', 'glare', 'dark'], in that order>,
 *       userOverrode: <true only if there were warnings and the user chose "Use anyway">
 *     }
 *   }
 *
 * The preflight object is exactly CardExtraction's capture.image.preflight
 * (contract.js), so the endpoint passes it through unchanged.
 *
 * What v1 guarantees beyond the shape:
 *   - Upright: orientation was applied to the pixels when the photo was
 *     decoded, and the JPEG carries no orientation tag.
 *   - Metadata-free: no EXIF, XMP, IPTC, comments or other APPn/COM segments
 *     besides APP0 (JFIF) and APP14 (Adobe colour). No GPS, no camera serial,
 *     no timestamps. The browser's re-encode writes none; the server also
 *     strips any it finds before the image goes anywhere (defence in depth).
 *   - One encode: re-encoding blurs small text, so the JPEG is the first and
 *     only encode of the decoded photo (quality 0.85, or the size fallbacks).
 *   - The long edge is at most 2,000 px and the short edge at least 600 px.
 */

export const PREPARED_IMAGE_VERSION = 'card-image/v1';
export const PREPARED_IMAGE_MIME_TYPE = 'image/jpeg';

export const MAX_LONG_EDGE_PX = 2000;
export const MIN_SHORT_EDGE_PX = 600;
export const MAX_BYTES = 1_500_000;
/** Base64 length of MAX_BYTES: 4 characters per 3 bytes, padded. */
export const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_BYTES / 3);

/** Quality warnings, in the order they are shown. Too small is a hard stop, never a warning. */
export const PREFLIGHT_WARNINGS = Object.freeze(['blurry', 'glare', 'dark']);

/**
 * Every reason a photo can fail to become, or be accepted as, a PreparedCardImage.
 * The browser raises the first four while preparing; the server can return
 * any of them as { error: 'image_rejected', reason }.
 */
export const IMAGE_ERRORS = Object.freeze({
  UNSUPPORTED_FORMAT: 'unsupported_format',   // HEIC/HEIF, or not an image the browser can decode
  DECODE_FAILED: 'decode_failed',             // the file could not be read
  TOO_SMALL: 'too_small',                     // short edge under 600 px after orientation
  TOO_LARGE: 'too_large',                     // over 1.5 MB, or long edge over 2,000 px
  NOT_JPEG: 'not_jpeg',                       // wrong MIME type, or the bytes are not a JPEG
  INVALID_ENCODING: 'invalid_encoding',       // malformed base64, or bytes does not match the data
  DIMENSIONS_MISMATCH: 'dimensions_mismatch', // widthPx / heightPx differ from the JPEG header
  UNSUPPORTED_VERSION: 'unsupported_version', // not card-image/v1
  INVALID_PREFLIGHT: 'invalid_preflight',     // preflight missing, extra keys, bad values, or a bad override
});

const KEYS = ['version', 'mimeType', 'data', 'bytes', 'widthPx', 'heightPx', 'preflight'];
const PREFLIGHT_KEYS = ['blur', 'brightness', 'glareRatio', 'warnings', 'userOverrode'];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasExactKeys = (obj, keys) => isPlainObject(obj)
  && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k) && obj[k] !== undefined);
const isCount = (v, max) => Number.isInteger(v) && v > 0 && v <= max;
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** A rejection: the error code is the whole result, so nothing else can leak through it. */
const reject = reason => ({ ok: false, reason });

/** Validate the preflight object on its own. */
export function validatePreflight(preflight) {
  if (!hasExactKeys(preflight, PREFLIGHT_KEYS)) return reject(IMAGE_ERRORS.INVALID_PREFLIGHT);
  const { blur, brightness, glareRatio, warnings, userOverrode } = preflight;
  if (!inRange(blur, 0, Number.MAX_SAFE_INTEGER) || !inRange(brightness, 0, 255) || !inRange(glareRatio, 0, 1)) {
    return reject(IMAGE_ERRORS.INVALID_PREFLIGHT);
  }
  if (!Array.isArray(warnings) || warnings.some(w => !PREFLIGHT_WARNINGS.includes(w))) return reject(IMAGE_ERRORS.INVALID_PREFLIGHT);
  // In display order, each at most once.
  const ordered = PREFLIGHT_WARNINGS.filter(w => warnings.includes(w));
  if (ordered.length !== warnings.length || ordered.some((w, i) => w !== warnings[i])) return reject(IMAGE_ERRORS.INVALID_PREFLIGHT);
  if (typeof userOverrode !== 'boolean' || (userOverrode && warnings.length === 0)) return reject(IMAGE_ERRORS.INVALID_PREFLIGHT);
  return { ok: true };
}

/**
 * Validate the shape and limits of a PreparedCardImage without decoding it.
 * Never throws. Returns { ok: true } or { ok: false, reason } with a reason
 * from IMAGE_ERRORS.
 */
export function validatePreparedImage(image) {
  if (!isPlainObject(image)) return reject(IMAGE_ERRORS.INVALID_ENCODING);
  if (image.version !== PREPARED_IMAGE_VERSION) return reject(IMAGE_ERRORS.UNSUPPORTED_VERSION);
  if (!hasExactKeys(image, KEYS)) return reject(IMAGE_ERRORS.INVALID_ENCODING);
  if (image.mimeType !== PREPARED_IMAGE_MIME_TYPE) return reject(IMAGE_ERRORS.NOT_JPEG);

  const { data, bytes, widthPx, heightPx } = image;
  if (!Number.isInteger(bytes) || bytes < 1) return reject(IMAGE_ERRORS.INVALID_ENCODING);
  if (bytes > MAX_BYTES) return reject(IMAGE_ERRORS.TOO_LARGE);
  if (typeof data !== 'string' || data.length > MAX_BASE64_LENGTH + 4) return reject(IMAGE_ERRORS.TOO_LARGE);
  if (data.length % 4 !== 0 || !BASE64.test(data) || data.length !== 4 * Math.ceil(bytes / 3)) {
    return reject(IMAGE_ERRORS.INVALID_ENCODING);
  }
  if (!isCount(widthPx, 65535) || !isCount(heightPx, 65535)) return reject(IMAGE_ERRORS.DIMENSIONS_MISMATCH);
  if (Math.max(widthPx, heightPx) > MAX_LONG_EDGE_PX) return reject(IMAGE_ERRORS.TOO_LARGE);
  if (Math.min(widthPx, heightPx) < MIN_SHORT_EDGE_PX) return reject(IMAGE_ERRORS.TOO_SMALL);

  return validatePreflight(image.preflight);
}

// ─── Bytes ──────────────────────────────────────────────────────────────────

/** Standard base64 to bytes. Returns null on malformed input. */
export function decodeBase64(data) {
  if (typeof data !== 'string' || data.length % 4 !== 0 || !BASE64.test(data)) return null;
  let binary;
  try {
    binary = atob(data);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Bytes to standard base64 (the browser's encoding side of decodeBase64). */
export function encodeBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Start-of-frame markers carrying the image size. Not C4 (DHT), C8 (JPG) or CC (DAC).
const SOF = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
const SOS = 0xDA;
const STANDALONE = new Set([0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9]);

/**
 * True for a segment that may carry metadata: APP1–APP13, APP15 (EXIF, XMP,
 * ICC, IPTC, maker notes...) and COM. APP0 (JFIF) and APP14 (Adobe colour
 * transform) are kept: they describe how to decode the pixels, nothing else.
 */
export function isMetadataMarker(marker) {
  return (marker >= 0xE1 && marker <= 0xED) || marker === 0xEF || marker === 0xFE;
}

/**
 * Walk the JPEG header up to the start of scan. Returns null if the bytes are
 * not a well-formed JPEG header, otherwise { width, height, segments } where
 * segments lists [marker, start, end) for every header segment.
 */
export function readJpegHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  let width = null;
  let height = null;
  const segments = [];
  while (i < bytes.length) {
    if (bytes[i] !== 0xFF) return null;
    while (i < bytes.length && bytes[i] === 0xFF) i += 1;   // fill bytes
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    const start = i - 1;
    i += 1;
    if (STANDALONE.has(marker)) {
      if (marker === 0xD9) return null;                       // end of image before any scan
      continue;
    }
    if (i + 1 >= bytes.length) return null;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2 || i + length > bytes.length) return null;
    if (SOF.has(marker)) {
      if (length < 7) return null;
      height = (bytes[i + 3] << 8) | bytes[i + 4];
      width = (bytes[i + 5] << 8) | bytes[i + 6];
    }
    segments.push([marker, start, i + length]);
    if (marker === SOS) {
      return width && height ? { width, height, segments, scanStart: start } : null;
    }
    i += length;
  }
  return null;
}

/**
 * The same JPEG without metadata segments (isMetadataMarker). Pixel data and
 * decoding tables are untouched. Returns { bytes, removed } or null when the
 * input is not a JPEG.
 */
export function stripJpegMetadata(bytes) {
  const header = readJpegHeader(bytes);
  if (!header) return null;
  const drop = header.segments.filter(([marker]) => isMetadataMarker(marker));
  if (drop.length === 0) return { bytes, removed: 0 };
  const parts = [bytes.subarray(0, 2)];
  let cursor = 2;
  for (const [, start, end] of drop) {
    parts.push(bytes.subarray(cursor, start));
    cursor = end;
  }
  parts.push(bytes.subarray(cursor));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return { bytes: out, removed: drop.length };
}

/** True when a JPEG still carries any metadata segment. */
export function hasJpegMetadata(bytes) {
  const header = readJpegHeader(bytes);
  return !!header && header.segments.some(([marker]) => isMetadataMarker(marker));
}

/**
 * Full acceptance check, as the server runs it: the shape and limits, then
 * the bytes themselves. On success returns the JPEG with any metadata
 * stripped: { ok: true, bytes, metadataRemoved }. On failure { ok: false, reason }.
 */
export function checkPreparedImage(image) {
  const shape = validatePreparedImage(image);
  if (!shape.ok) return shape;
  const raw = decodeBase64(image.data);
  if (!raw || raw.length !== image.bytes) return reject(IMAGE_ERRORS.INVALID_ENCODING);
  const stripped = stripJpegMetadata(raw);
  if (!stripped) return reject(IMAGE_ERRORS.NOT_JPEG);
  const { width, height } = readJpegHeader(stripped.bytes);
  if (width !== image.widthPx || height !== image.heightPx) return reject(IMAGE_ERRORS.DIMENSIONS_MISMATCH);
  return { ok: true, bytes: stripped.bytes, metadataRemoved: stripped.removed };
}
