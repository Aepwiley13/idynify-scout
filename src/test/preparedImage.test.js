/**
 * PreparedCardImage (card-image/v1): the contract between image preparation
 * (PR 5, browser) and captureExtract (PR 6, server).
 *
 * Pins the shape and limits, the preflight structure (which must stay
 * identical to CardExtraction's capture.image.preflight), the error codes,
 * and the byte-level guarantees: real JPEG header, matching dimensions, and
 * no metadata segment ever reaching the extractor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PREPARED_IMAGE_VERSION, PREPARED_IMAGE_MIME_TYPE, MAX_LONG_EDGE_PX, MIN_SHORT_EDGE_PX, MAX_BYTES, MAX_BASE64_LENGTH,
  PREFLIGHT_WARNINGS, IMAGE_ERRORS,
  validatePreflight, validatePreparedImage, decodeBase64, encodeBase64, readJpegHeader, stripJpegMetadata,
  hasJpegMetadata, isMetadataMarker, checkPreparedImage,
} from '../capture/preparedImage.js';
import { emptyCaptureMeta } from '../capture/contract.js';

const REAL_JPEG = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/barry-bear.jpg');

// ─── Synthetic JPEGs ────────────────────────────────────────────────────────

const seg = (marker, payload) => {
  const length = payload.length + 2;
  return [0xFF, marker, length >> 8, length & 0xFF, ...payload];
};
const SOI = [0xFF, 0xD8];
const EOI = [0xFF, 0xD9];
const APP0_JFIF = seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const APP1_EXIF_GPS = seg(0xE1, [...'Exif\0\0GPS 37.7749N 122.4194W serial X100'].map(c => c.charCodeAt(0) & 0xFF));
const APP1_XMP = seg(0xE1, [...'http://ns.adobe.com/xap/1.0/ <x:xmpmeta/>'].map(c => c.charCodeAt(0)));
const APP13_IPTC = seg(0xED, [...'Photoshop 3.0 caption'].map(c => c.charCodeAt(0)));
const APP14_ADOBE = seg(0xEE, [0x41, 0x64, 0x6F, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 1]);
const COM = seg(0xFE, [...'shot on my phone'].map(c => c.charCodeAt(0)));
const DQT = seg(0xDB, [0, ...new Array(64).fill(1)]);
const sof = (width, height, marker = 0xC0) => seg(marker, [8, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
const DHT = seg(0xC4, [0, ...new Array(16).fill(0)]);
const SOS = seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
const SCAN = [0x12, 0x34, 0xFF, 0x00, 0x56, 0xFF, 0xD0, 0x78];   // entropy data, a stuffed FF00, a restart marker

function jpeg({ width = 2000, height = 1500, before = [], after = [], marker = 0xC0 } = {}) {
  return new Uint8Array([...SOI, ...APP0_JFIF, ...before, ...DQT, ...sof(width, height, marker), ...DHT, ...after, ...SOS, ...SCAN, ...EOI]);
}

const preflight = (over = {}) => ({ blur: 142.5, brightness: 131.2, glareRatio: 0.004, warnings: [], userOverrode: false, ...over });

function prepared(bytes = jpeg(), over = {}) {
  const header = readJpegHeader(bytes);
  return {
    version: PREPARED_IMAGE_VERSION, mimeType: 'image/jpeg', data: encodeBase64(bytes), bytes: bytes.length,
    widthPx: header?.width ?? 2000, heightPx: header?.height ?? 1500, preflight: preflight(), ...over,
  };
}

// ─── The contract itself ────────────────────────────────────────────────────

describe('card-image/v1 constants', () => {
  it('pins the limits and vocabulary both sides use', () => {
    expect(PREPARED_IMAGE_VERSION).toBe('card-image/v1');
    expect(PREPARED_IMAGE_MIME_TYPE).toBe('image/jpeg');
    expect(MAX_LONG_EDGE_PX).toBe(2000);
    expect(MIN_SHORT_EDGE_PX).toBe(600);
    expect(MAX_BYTES).toBe(1_500_000);
    expect(MAX_BASE64_LENGTH).toBe(2_000_000);
    expect(PREFLIGHT_WARNINGS).toEqual(['blurry', 'glare', 'dark']);
    expect(Object.values(IMAGE_ERRORS).sort()).toEqual([
      'decode_failed', 'dimensions_mismatch', 'invalid_encoding', 'invalid_preflight', 'not_jpeg',
      'too_large', 'too_small', 'unsupported_format', 'unsupported_version',
    ]);
  });

  it('the preflight object is exactly CardExtraction capture.image.preflight', () => {
    expect(Object.keys(preflight()).sort()).toEqual(Object.keys(emptyCaptureMeta().image.preflight).sort());
  });
});

describe('validatePreparedImage', () => {
  it('accepts a well-formed image', () => {
    expect(validatePreparedImage(prepared())).toEqual({ ok: true });
  });

  it('accepts portrait and the exact limits', () => {
    expect(validatePreparedImage(prepared(jpeg({ width: 1500, height: 2000 })))).toEqual({ ok: true });
    expect(validatePreparedImage(prepared(jpeg({ width: 2000, height: 600 })))).toEqual({ ok: true });
  });

  const cases = [
    ['not an object', null, 'invalid_encoding'],
    ['another version', { version: 'card-image/v2' }, 'unsupported_version'],
    ['a data URL prefix', { data: `data:image/jpeg;base64,${encodeBase64(jpeg())}` }, 'invalid_encoding'],
    ['whitespace in base64', { data: `${encodeBase64(jpeg()).slice(0, 8)}\n${encodeBase64(jpeg()).slice(8)}` }, 'invalid_encoding'],
    ['bytes that do not match the data', { bytes: jpeg().length + 7 }, 'invalid_encoding'],
    ['a PNG', { mimeType: 'image/png' }, 'not_jpeg'],
    ['HEIC', { mimeType: 'image/heic' }, 'not_jpeg'],
    ['over 1.5 MB', { bytes: MAX_BYTES + 1 }, 'too_large'],
    ['a long edge over 2000', { widthPx: 2001 }, 'too_large'],
    ['a short edge under 600', { heightPx: 599 }, 'too_small'],
    ['a fractional width', { widthPx: 1999.5 }, 'dimensions_mismatch'],
    ['an extra key', { fileName: 'IMG_0042.HEIC' }, 'invalid_encoding'],
    ['a missing preflight', { preflight: undefined }, 'invalid_encoding'],
    ['an unknown warning', { preflight: preflight({ warnings: ['tilted'] }) }, 'invalid_preflight'],
    ['warnings out of order', { preflight: preflight({ warnings: ['dark', 'blurry'], userOverrode: true }) }, 'invalid_preflight'],
    ['a repeated warning', { preflight: preflight({ warnings: ['glare', 'glare'], userOverrode: true }) }, 'invalid_preflight'],
    ['"Use anyway" with no warning', { preflight: preflight({ userOverrode: true }) }, 'invalid_preflight'],
    ['brightness over 255', { preflight: preflight({ brightness: 300 }) }, 'invalid_preflight'],
    ['a glare ratio over 1', { preflight: preflight({ glareRatio: 1.2 }) }, 'invalid_preflight'],
    ['a missing metric', { preflight: { blur: 1, brightness: 1, warnings: [], userOverrode: false } }, 'invalid_preflight'],
    ['an extra preflight key', { preflight: { ...preflight(), fileName: 'IMG_0042.JPG' } }, 'invalid_preflight'],
  ];
  it.each(cases)('refuses %s as %s', (_, over, reason) => {
    const image = over === null ? null : prepared(jpeg(), over);
    expect(validatePreparedImage(image)).toEqual({ ok: false, reason });
  });

  it('accepts warnings in display order with the override', () => {
    expect(validatePreflight(preflight({ warnings: ['blurry', 'glare', 'dark'], userOverrode: true }))).toEqual({ ok: true });
    expect(validatePreflight(preflight({ warnings: ['glare'], userOverrode: true }))).toEqual({ ok: true });
  });

  it('never echoes a value in a rejection', () => {
    const result = validatePreparedImage(prepared(jpeg(), { fileName: 'jane-smith-acme.jpg' }));
    expect(Object.keys(result)).toEqual(['ok', 'reason']);
    expect(JSON.stringify(result)).not.toContain('jane');
  });
});

// ─── Bytes ──────────────────────────────────────────────────────────────────

describe('base64', () => {
  it('round-trips bytes, including a large buffer', () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 31) & 0xFF);
    expect(decodeBase64(encodeBase64(big))).toEqual(big);
  });

  it.each(['abc', 'ab!=', 'YWJj\n', ' YWJj'])('refuses %j', (bad) => {
    expect(decodeBase64(bad)).toBe(null);
  });
});

describe('the JPEG header', () => {
  it('reads the size from every start-of-frame marker, including progressive', () => {
    for (const marker of [0xC0, 0xC1, 0xC2]) {
      expect(readJpegHeader(jpeg({ width: 1600, height: 1200, marker }))).toMatchObject({ width: 1600, height: 1200 });
    }
  });

  it('reads a real encoder\'s JPEG (public/barry-bear.jpg)', () => {
    const real = new Uint8Array(readFileSync(REAL_JPEG));
    expect(readJpegHeader(real)).toMatchObject({ width: 400, height: 400 });
    expect(hasJpegMetadata(real)).toBe(false);
  });

  it.each([
    ['PNG bytes', new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
    ['a truncated header', jpeg().subarray(0, 30)],
    ['no frame before the scan', new Uint8Array([...SOI, ...APP0_JFIF, ...SOS, ...SCAN, ...EOI])],
    ['an image that ends before its scan', new Uint8Array([...SOI, ...APP0_JFIF, ...EOI])],
    ['empty', new Uint8Array(0)],
  ])('refuses %s', (_, bytes) => {
    expect(readJpegHeader(bytes)).toBe(null);
  });
});

describe('metadata is removed', () => {
  it('knows which segments carry metadata', () => {
    expect([0xE1, 0xE2, 0xED, 0xEF, 0xFE].every(isMetadataMarker)).toBe(true);
    expect([0xE0, 0xEE, 0xDB, 0xC0, 0xC4, 0xDA].some(isMetadataMarker)).toBe(false);
  });

  it('strips EXIF (GPS), XMP, IPTC and comments, and keeps JFIF and Adobe', () => {
    const dirty = jpeg({ before: [...APP1_EXIF_GPS, ...APP1_XMP, ...APP13_IPTC, ...COM, ...APP14_ADOBE] });
    expect(hasJpegMetadata(dirty)).toBe(true);
    const { bytes, removed } = stripJpegMetadata(dirty);
    expect(removed).toBe(4);
    expect(hasJpegMetadata(bytes)).toBe(false);
    expect(bytes).toEqual(jpeg({ before: [...APP14_ADOBE] }));
    const text = new TextDecoder('latin1').decode(bytes);
    for (const leak of ['GPS', '37.7749', 'serial', 'xmpmeta', 'Photoshop', 'shot on my phone']) expect(text).not.toContain(leak);
  });

  it('leaves pixel data and decoding tables untouched', () => {
    const clean = jpeg();
    const dirty = jpeg({ before: APP1_EXIF_GPS, after: COM });
    expect(stripJpegMetadata(dirty).bytes).toEqual(clean);
    expect(stripJpegMetadata(clean)).toEqual({ bytes: clean, removed: 0 });
  });

  it('removes EXIF injected into a real encoder\'s JPEG, byte-for-byte', () => {
    const real = new Uint8Array(readFileSync(REAL_JPEG));
    const app0End = readJpegHeader(real).segments[0][2];
    const dirty = new Uint8Array([...real.subarray(0, app0End), ...APP1_EXIF_GPS, ...real.subarray(app0End)]);
    expect(stripJpegMetadata(dirty).bytes).toEqual(real);
  });
});

describe('checkPreparedImage (what the server runs)', () => {
  it('accepts a clean image and returns its bytes', () => {
    const bytes = jpeg();
    expect(checkPreparedImage(prepared(bytes))).toEqual({ ok: true, bytes, metadataRemoved: 0 });
  });

  it('strips metadata the browser should not have sent, and says how much', () => {
    const dirty = jpeg({ before: APP1_EXIF_GPS });
    const result = checkPreparedImage(prepared(dirty));
    expect(result.ok).toBe(true);
    expect(result.metadataRemoved).toBe(1);
    expect(hasJpegMetadata(result.bytes)).toBe(false);
  });

  it('refuses declared dimensions that differ from the JPEG header', () => {
    expect(checkPreparedImage(prepared(jpeg({ width: 1600, height: 1200 }), { widthPx: 1601 })))
      .toEqual({ ok: false, reason: 'dimensions_mismatch' });
  });

  it('refuses bytes that are not a JPEG', () => {
    const png = new Uint8Array(1200).fill(7);
    png.set([0x89, 0x50, 0x4E, 0x47]);
    expect(checkPreparedImage(prepared(png, { widthPx: 2000, heightPx: 1500 }))).toEqual({ ok: false, reason: 'not_jpeg' });
  });

  it('runs the shape checks first', () => {
    expect(checkPreparedImage(prepared(jpeg(), { mimeType: 'image/webp' }))).toEqual({ ok: false, reason: 'not_jpeg' });
    expect(checkPreparedImage(prepared(jpeg(), { preflight: preflight({ userOverrode: true }) })))
      .toEqual({ ok: false, reason: 'invalid_preflight' });
  });
});
