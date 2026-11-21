/**
 * Profile photo processing: a picture from a phone or computer becomes one
 * small square JPEG, as a data URL, or fails with a plain reason.
 *
 *   decode    the browser decodes the file, with its orientation applied
 *             (createImageBitmap with imageOrientation 'from-image', falling
 *             back to <img>, which browsers orient by default). Everything
 *             after this works on the picture as a person sees it.
 *   crop      a square, from a centre (x, y) and a zoom (see cropRect)
 *   resize    to about 320 px, never upscaled; a big picture is halved in
 *             steps first, so a 4000 px photo is not squeezed in one jump
 *   flatten   onto white, so a transparent PNG is not black
 *   encode    one JPEG from the decoded picture (never a re-encode of a JPEG),
 *             down a ladder of quality, then of size, until the finished data
 *             URL is within the cap
 *   strip     the canvas writes no EXIF; the bytes are checked anyway and any
 *             metadata segment (EXIF with its GPS, XMP, ICC, IPTC, comments)
 *             is removed before the result leaves this module
 *   check     the finished photo is inspected as a STRING (inspectPhotoDataUrl):
 *             the type, the bytes, the real dimensions, no metadata, and the
 *             size. That same check is what any later code should use before
 *             it trusts a stored photo.
 *
 * It takes a File and returns a string. It saves nothing, sends nothing and
 * keeps nothing: the decoded picture and every canvas are released on every
 * path. The browser calls are behind `platform` so tests can drive every
 * branch without a canvas (jsdom has none); processing in a real browser is
 * checked by scripts/visual/photo-prep.
 *
 * THE LIMITS ARE PROVISIONAL (P1): 320 px and a 65,536-character data URL
 * (the prefix counts) are the starting point for the My Card photo, to be
 * confirmed against real photographs before anything depends on them.
 *
 * HEIC/HEIF has no converter here: where the browser cannot decode it, the
 * person is asked for a JPG or PNG.
 */
import {
  decodeBase64, encodeBase64, hasJpegMetadata, readJpegHeader, stripJpegMetadata,
} from '../capture/preparedImage.js';

export const PHOTO = Object.freeze({
  MIME_TYPE: 'image/jpeg',
  DATA_URL_PREFIX: 'data:image/jpeg;base64,',
  /** The size to aim for. A smaller picture is not enlarged to it. */
  TARGET_EDGE_PX: 320,
  /** Under this a picture, or the part of it that is cropped, is too small to be a photo. */
  MIN_EDGE_PX: 64,
  MAX_ZOOM: 8,
  /** The whole data URL, prefix included. Provisional. */
  MAX_DATA_URL_CHARS: 65_536,
  /** A file bigger than this is not decoded at all. */
  MAX_INPUT_BYTES: 30 * 1024 * 1024,
  /** A picture with more pixels than this is not decoded into memory. */
  MAX_INPUT_PIXELS: 100_000_000,
});

/** Sizes, largest first, and for each the qualities, highest first: the first that fits wins. */
export const ENCODE_EDGES = Object.freeze([320, 256, 192, 128]);
export const ENCODE_QUALITIES = Object.freeze([0.85, 0.75, 0.65, 0.55]);

export const PHOTO_ERRORS = Object.freeze({
  NO_FILE: 'no_file',
  UNSUPPORTED_FORMAT: 'unsupported_format',
  DECODE_FAILED: 'decode_failed',
  TOO_LARGE_SOURCE: 'too_large_source',
  TOO_SMALL: 'too_small',
  CANNOT_FIT: 'cannot_fit',
  ENCODE_FAILED: 'encode_failed',
});

/** What a person is told. Plain, and none of it says anything about the picture itself. */
export const PHOTO_MESSAGES = Object.freeze({
  [PHOTO_ERRORS.NO_FILE]: 'Choose a picture to use.',
  [PHOTO_ERRORS.UNSUPPORTED_FORMAT]: 'This kind of picture isn\'t supported here. Use a JPG, PNG or WebP picture.',
  [PHOTO_ERRORS.DECODE_FAILED]: 'We couldn\'t open that picture. It may be damaged. Try another one.',
  [PHOTO_ERRORS.TOO_LARGE_SOURCE]: 'That picture is too large to open here. Try a smaller one.',
  [PHOTO_ERRORS.TOO_SMALL]: 'That picture is too small. Try a larger one, or zoom out.',
  [PHOTO_ERRORS.CANNOT_FIT]: 'We couldn\'t make that picture small enough. Try a simpler one.',
  [PHOTO_ERRORS.ENCODE_FAILED]: 'Something went wrong preparing that picture. Try again, or try another one.',
});

export class PreparePhotoError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PreparePhotoError';
    this.code = code;
  }
}

// ─── The crop ────────────────────────────────────────────────────────────────

/** The whole picture's largest square, centred. */
export const DEFAULT_CROP = Object.freeze({ x: 0.5, y: 0.5, zoom: 1 });

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));

/**
 * A crop as numbers that mean something, from anything. `x` and `y` are where
 * the CENTRE of the square sits, as a fraction (0 to 1) of the picture's
 * width and height; `zoom` is 1 for the largest square that fits and more for
 * a smaller part of it (2 is half the side). A value that is not a number is
 * the default; the rest is held to its range.
 */
export function normalizeCrop(crop) {
  const source = crop !== null && typeof crop === 'object' ? crop : {};
  return {
    x: finite(source.x) ? clamp(source.x, 0, 1) : DEFAULT_CROP.x,
    y: finite(source.y) ? clamp(source.y, 0, 1) : DEFAULT_CROP.y,
    zoom: finite(source.zoom) ? clamp(source.zoom, 1, PHOTO.MAX_ZOOM) : DEFAULT_CROP.zoom,
  };
}

/**
 * The square to cut from a picture of this size, in its pixels:
 * { sx, sy, side }. The square always lies wholly inside the picture: a centre
 * too near an edge is moved in until it does.
 */
export function cropRect(width, height, crop) {
  const { x, y, zoom } = normalizeCrop(crop);
  const side = Math.max(1, Math.min(Math.min(width, height), Math.round(Math.min(width, height) / zoom)));
  const sx = Math.round(clamp(x * width - side / 2, 0, width - side));
  const sy = Math.round(clamp(y * height - side / 2, 0, height - side));
  return { sx, sy, side };
}

// ─── Checking a finished photo ───────────────────────────────────────────────

/**
 * Whether a string is a finished profile photo: a JPEG data URL, whose bytes
 * are a well-formed square JPEG with no metadata, within the size cap.
 *
 * @returns {{ ok: true, widthPx: number, heightPx: number, bytes: number, chars: number }
 *         | { ok: false, reason: string }}  the reason is a short code, never the data
 */
export function inspectPhotoDataUrl(dataUrl, { maxChars = PHOTO.MAX_DATA_URL_CHARS } = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PHOTO.DATA_URL_PREFIX)) return { ok: false, reason: 'not-a-jpeg-data-url' };
  if (dataUrl.length > maxChars) return { ok: false, reason: 'too-long' };
  const bytes = decodeBase64(dataUrl.slice(PHOTO.DATA_URL_PREFIX.length));
  if (!bytes || bytes.length === 0) return { ok: false, reason: 'bad-encoding' };
  const header = readJpegHeader(bytes);
  if (!header) return { ok: false, reason: 'not-a-jpeg' };
  if (bytes[bytes.length - 2] !== 0xFF || bytes[bytes.length - 1] !== 0xD9) return { ok: false, reason: 'truncated' };
  if (header.width !== header.height) return { ok: false, reason: 'not-square' };
  if (header.width < PHOTO.MIN_EDGE_PX || header.width > PHOTO.TARGET_EDGE_PX) return { ok: false, reason: 'wrong-size' };
  if (hasJpegMetadata(bytes)) return { ok: false, reason: 'has-metadata' };
  return { ok: true, widthPx: header.width, heightPx: header.height, bytes: bytes.length, chars: dataUrl.length };
}

// ─── The real browser ────────────────────────────────────────────────────────

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const release = (canvas) => { canvas.width = 0; canvas.height = 0; };

export const browserPhotoPlatform = Object.freeze({
  /** Decode with orientation applied. Returns { width, height, source, close }. */
  async decode(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
      } catch {
        // Fall through to <img>, which some browsers decode when createImageBitmap cannot.
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, source: img, close: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  },

  /**
   * One JPEG of the square `rect` ({ sx, sy, side }) of the decoded picture,
   * `edge` px on a side, on white. A large reduction is done in halves, then a
   * last step to the size, which keeps a big photo sharp.
   */
  async encodeJpeg(source, rect, edge, quality) {
    let from = source;
    let { sx, sy, side } = rect;
    let scratch = null;
    try {
      while (side / 2 >= edge * 1.5) {
        const half = Math.floor(side / 2);
        const next = canvasOf(half, half);
        const ctx = next.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(from, sx, sy, side, side, 0, 0, half, half);
        if (scratch) release(scratch);
        scratch = next;
        from = next;
        sx = 0; sy = 0; side = half;
      }
      const out = canvasOf(edge, edge);
      try {
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, edge, edge);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(from, sx, sy, side, side, 0, 0, edge, edge);
        const blob = await new Promise((resolve, reject) => {
          out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), PHOTO.MIME_TYPE, quality);
        });
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        release(out);
      }
    } finally {
      if (scratch) release(scratch);
    }
  },
});

// ─── Preparation ─────────────────────────────────────────────────────────────

const KNOWN_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/x-png', 'image/webp']);
const KNOWN_EXTENSION = /\.(jpe?g|jfif|png|webp)$/i;
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

const typeOf = (file) => String(file?.type ?? '').toLowerCase();
export const looksLikeHeic = (file) => HEIC_TYPES.has(typeOf(file)) || /\.(heic|heif)$/i.test(String(file?.name ?? ''));
const looksLikeJpegPngWebp = (file) => KNOWN_TYPES.has(typeOf(file)) || (typeOf(file) === '' && KNOWN_EXTENSION.test(String(file?.name ?? '')));

/**
 * Prepare a profile photo. Resolves to the finished photo; rejects with a
 * PreparePhotoError whose `code` is one of PHOTO_ERRORS (and PHOTO_MESSAGES
 * has the words for it).
 *
 * @param {File|Blob} file
 * @param {object} [options]
 * @param {{ x?: number, y?: number, zoom?: number }} [options.crop]  see normalizeCrop
 * @param {number} [options.maxChars]  the cap on the data URL's length
 * @param {object} [options.platform]  the browser calls, replaceable for tests
 * @returns {Promise<{ dataUrl: string, mimeType: string, widthPx: number, heightPx: number,
 *   bytes: number, chars: number, crop: object, attempts: number }>}
 */
export async function prepareProfilePhoto(file, { crop, maxChars = PHOTO.MAX_DATA_URL_CHARS, platform = browserPhotoPlatform } = {}) {
  if (!file) throw new PreparePhotoError(PHOTO_ERRORS.NO_FILE);
  const type = typeOf(file);
  if (type && !type.startsWith('image/')) throw new PreparePhotoError(PHOTO_ERRORS.UNSUPPORTED_FORMAT);
  if (typeof file.size === 'number') {
    if (file.size === 0) throw new PreparePhotoError(PHOTO_ERRORS.DECODE_FAILED);
    if (file.size > PHOTO.MAX_INPUT_BYTES) throw new PreparePhotoError(PHOTO_ERRORS.TOO_LARGE_SOURCE);
  }

  let decoded;
  try {
    decoded = await platform.decode(file);
  } catch {
    // A JPEG, PNG or WebP that will not open is damaged. Anything else is a kind we cannot read.
    throw new PreparePhotoError(looksLikeJpegPngWebp(file) ? PHOTO_ERRORS.DECODE_FAILED
      : (looksLikeHeic(file) || type.startsWith('image/') ? PHOTO_ERRORS.UNSUPPORTED_FORMAT : PHOTO_ERRORS.DECODE_FAILED));
  }

  try {
    const { width, height } = decoded;
    if (!(width > 0 && height > 0)) throw new PreparePhotoError(PHOTO_ERRORS.DECODE_FAILED);
    if (width * height > PHOTO.MAX_INPUT_PIXELS) throw new PreparePhotoError(PHOTO_ERRORS.TOO_LARGE_SOURCE);
    if (Math.min(width, height) < PHOTO.MIN_EDGE_PX) throw new PreparePhotoError(PHOTO_ERRORS.TOO_SMALL);

    const chosenCrop = normalizeCrop(crop);
    const rect = cropRect(width, height, chosenCrop);
    // Zoomed in until what is left is too small to be a photo.
    if (rect.side < PHOTO.MIN_EDGE_PX) throw new PreparePhotoError(PHOTO_ERRORS.TOO_SMALL);

    let attempts = 0;
    const tried = new Set();
    for (const targetEdge of ENCODE_EDGES) {
      // Never larger than the target, and never larger than what was cropped: no upscaling.
      const edge = Math.min(targetEdge, rect.side, PHOTO.TARGET_EDGE_PX);
      for (const quality of ENCODE_QUALITIES) {
        const key = `${edge}@${quality}`;
        if (tried.has(key)) continue;
        tried.add(key);
        attempts += 1;
        let encoded;
        try {
          encoded = await platform.encodeJpeg(decoded.source, rect, edge, quality);
        } catch {
          throw new PreparePhotoError(PHOTO_ERRORS.ENCODE_FAILED);
        }
        const clean = encoded instanceof Uint8Array ? stripJpegMetadata(encoded) : null;
        if (!clean) throw new PreparePhotoError(PHOTO_ERRORS.ENCODE_FAILED);
        const header = readJpegHeader(clean.bytes);
        if (!header || header.width !== edge || header.height !== edge) throw new PreparePhotoError(PHOTO_ERRORS.ENCODE_FAILED);

        const dataUrl = `${PHOTO.DATA_URL_PREFIX}${encodeBase64(clean.bytes)}`;
        if (dataUrl.length > maxChars) continue;
        // The finished photo is checked as a string, the way anything that receives it will.
        const inspected = inspectPhotoDataUrl(dataUrl, { maxChars });
        if (!inspected.ok || inspected.widthPx !== edge) throw new PreparePhotoError(PHOTO_ERRORS.ENCODE_FAILED);
        return {
          dataUrl,
          mimeType: PHOTO.MIME_TYPE,
          widthPx: inspected.widthPx,
          heightPx: inspected.heightPx,
          bytes: inspected.bytes,
          chars: inspected.chars,
          crop: chosenCrop,
          attempts,
        };
      }
    }
    throw new PreparePhotoError(PHOTO_ERRORS.CANNOT_FIT);
  } catch (error) {
    if (error instanceof PreparePhotoError) throw error;
    throw new PreparePhotoError(PHOTO_ERRORS.DECODE_FAILED);
  } finally {
    decoded.close?.();
  }
}
