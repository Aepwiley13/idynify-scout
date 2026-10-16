/**
 * Turn a phone photo of a business card into a card-image/v1 object
 * (src/capture/preparedImage.js), the only format captureExtract accepts.
 * Architecture section 17.
 *
 *   decode    orientation applied at decode (createImageBitmap with
 *             imageOrientation 'from-image', falling back to <img>, which
 *             browsers orient by default)
 *   size      long edge at most 2,000 px, never upscaled; a short edge under
 *             600 px is a hard stop (too_small)
 *   encode    one JPEG from the decoded photo, never a re-encode of a JPEG:
 *             quality 0.85; if over 1.5 MB, 0.75; then 1,600 px at 0.80;
 *             still over is too_large
 *   strip     the canvas writes no EXIF; the output is checked anyway and any
 *             metadata segment removed before it leaves this function
 *   check     blur, glare and darkness on a 512 px-wide copy (preflight.js)
 *   validate  the finished object must pass validatePreparedImage, so this
 *             side can never send a shape the server would refuse
 *
 * HEIC/HEIF has no converter in V1: if the browser cannot decode it, the
 * user is asked for a photo or a JPG/PNG (unsupported_format).
 *
 * Memory: the decoded bitmap is closed and object URLs revoked on every path;
 * each canvas is shrunk to zero once read. Nothing is written to storage.
 *
 * The browser calls are behind `platform` so tests can drive every branch
 * without a canvas (jsdom has none). Unused by the app until the Capture Lab.
 */
import {
  PREPARED_IMAGE_VERSION, PREPARED_IMAGE_MIME_TYPE, MAX_LONG_EDGE_PX, MIN_SHORT_EDGE_PX, MAX_BYTES, IMAGE_ERRORS,
  encodeBase64, readJpegHeader, stripJpegMetadata, validatePreparedImage,
} from '../../capture/preparedImage.js';
import { ANALYSIS_WIDTH_PX, assessQuality } from './preflight.js';

/** The encode ladder, tried in order until the JPEG fits in 1.5 MB. */
export const ENCODE_STEPS = Object.freeze([
  Object.freeze({ longEdge: MAX_LONG_EDGE_PX, quality: 0.85 }),
  Object.freeze({ longEdge: MAX_LONG_EDGE_PX, quality: 0.75 }),
  Object.freeze({ longEdge: 1600, quality: 0.80 }),
]);

/** What the user sees for each preparation error and warning. */
export const MESSAGES = Object.freeze({
  [IMAGE_ERRORS.TOO_SMALL]: 'This image is too small to read.',
  [IMAGE_ERRORS.UNSUPPORTED_FORMAT]: "This photo format isn't supported. Take a photo instead, or use JPG or PNG.",
  [IMAGE_ERRORS.DECODE_FAILED]: "We couldn't open that photo. Try taking it again.",
  [IMAGE_ERRORS.TOO_LARGE]: "That photo is too large to send. Try taking it again.",
  blurry: 'This photo looks blurry.',
  glare: "There's glare on the card.",
  dark: "It's a bit dark.",
});

export class PrepareImageError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PrepareImageError';
    this.code = code;
  }
}

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function looksLikeHeic(file) {
  return HEIC_TYPES.has(String(file?.type ?? '').toLowerCase()) || /\.(heic|heif)$/i.test(String(file?.name ?? ''));
}

/** Scale to fit a long edge, never upscaling. */
export function fitWithin(width, height, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ─── The real browser ────────────────────────────────────────────────────────

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function draw(source, width, height) {
  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, ctx };
}

const release = canvas => { canvas.width = 0; canvas.height = 0; };

export const browserPlatform = Object.freeze({
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

  /** One JPEG encode of the decoded photo at this size and quality. */
  async encodeJpeg(source, width, height, quality) {
    const { canvas } = draw(source, width, height);
    try {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode_failed'))), PREPARED_IMAGE_MIME_TYPE, quality);
      });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      release(canvas);
    }
  },

  /** RGBA pixels of the decoded photo at this size, for the quality checks. */
  async pixels(source, width, height) {
    const { canvas, ctx } = draw(source, width, height);
    try {
      const { data } = ctx.getImageData(0, 0, width, height);
      return { width, height, data };
    } finally {
      release(canvas);
    }
  },
});

// ─── Preparation ─────────────────────────────────────────────────────────────

/**
 * Prepare a photo. Resolves to { image, prepMs } where image is a valid
 * card-image/v1 object with userOverrode false. Rejects with a
 * PrepareImageError whose code is one of IMAGE_ERRORS.
 */
export async function prepareCardImage(file, { platform = browserPlatform } = {}) {
  const startedAt = now();
  if (!file) throw new PrepareImageError(IMAGE_ERRORS.DECODE_FAILED);
  const type = String(file.type ?? '').toLowerCase();
  if (type && !type.startsWith('image/')) throw new PrepareImageError(IMAGE_ERRORS.UNSUPPORTED_FORMAT);

  let decoded;
  try {
    decoded = await platform.decode(file);
  } catch {
    throw new PrepareImageError(looksLikeHeic(file) ? IMAGE_ERRORS.UNSUPPORTED_FORMAT : IMAGE_ERRORS.DECODE_FAILED);
  }

  try {
    const { width, height } = decoded;
    if (!(width > 0 && height > 0)) throw new PrepareImageError(IMAGE_ERRORS.DECODE_FAILED);
    if (Math.min(width, height) < MIN_SHORT_EDGE_PX) throw new PrepareImageError(IMAGE_ERRORS.TOO_SMALL);

    let chosen = null;
    let anyUsableStep = false;
    for (const step of ENCODE_STEPS) {
      const size = fitWithin(width, height, step.longEdge);
      if (Math.min(size.width, size.height) < MIN_SHORT_EDGE_PX) continue;
      anyUsableStep = true;
      let encoded;
      try {
        encoded = await platform.encodeJpeg(decoded.source, size.width, size.height, step.quality);
      } catch {
        throw new PrepareImageError(IMAGE_ERRORS.DECODE_FAILED);
      }
      const clean = stripJpegMetadata(encoded);
      if (!clean) throw new PrepareImageError(IMAGE_ERRORS.DECODE_FAILED);
      const header = readJpegHeader(clean.bytes);
      if (header.width !== size.width || header.height !== size.height) throw new PrepareImageError(IMAGE_ERRORS.DECODE_FAILED);
      if (clean.bytes.length <= MAX_BYTES) {
        chosen = { bytes: clean.bytes, ...size };
        break;
      }
    }
    // A photo so elongated that no step keeps the short edge readable is too small to read.
    if (!anyUsableStep) throw new PrepareImageError(IMAGE_ERRORS.TOO_SMALL);
    if (!chosen) throw new PrepareImageError(IMAGE_ERRORS.TOO_LARGE);

    // The quality checks run on a copy about 512 px wide, whatever the orientation.
    const scale = Math.min(1, ANALYSIS_WIDTH_PX / chosen.width);
    const analysisWidth = Math.max(1, Math.round(chosen.width * scale));
    const analysisHeight = Math.max(1, Math.round(chosen.height * scale));
    const preflight = assessQuality(await platform.pixels(decoded.source, analysisWidth, analysisHeight));

    const image = {
      version: PREPARED_IMAGE_VERSION,
      mimeType: PREPARED_IMAGE_MIME_TYPE,
      data: encodeBase64(chosen.bytes),
      bytes: chosen.bytes.length,
      widthPx: chosen.width,
      heightPx: chosen.height,
      preflight,
    };
    const check = validatePreparedImage(image);
    if (!check.ok) throw new PrepareImageError(check.reason);
    return { image, prepMs: Math.round(now() - startedAt) };
  } catch (error) {
    if (error instanceof PrepareImageError) throw error;
    throw new PrepareImageError(IMAGE_ERRORS.DECODE_FAILED);
  } finally {
    decoded.close?.();
  }
}

/**
 * The user chose "Use anyway" on a warning. Returns a new image with
 * userOverrode true; the extraction caps that scan's levels at likely.
 */
export function useAnyway(image) {
  if (!image?.preflight?.warnings?.length) throw new Error('useAnyway needs a warning to override');
  return { ...image, preflight: { ...image.preflight, userOverrode: true } };
}
