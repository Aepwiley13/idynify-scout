/**
 * Profile photo processing (My Card, P1): a picture becomes one small square
 * JPEG data URL, or fails with a plain reason. Pure logic and the preparation
 * flow, driven through a stand-in browser.
 *
 * jsdom has no canvas, so the browser calls are replaced by a platform that
 * returns real JPEG byte layouts of the size and length asked for. That drives
 * every branch: the crop, the encode ladder, the cap, the hard stops, metadata,
 * and releasing the decoded picture on every path. Orientation, the pixels and
 * a real canvas encode are checked in a real browser by
 * scripts/visual/photo-prep (see its README line in the P1 report).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  PHOTO, PHOTO_ERRORS, PHOTO_MESSAGES, PreparePhotoError, DEFAULT_CROP, ENCODE_EDGES, ENCODE_QUALITIES,
  normalizeCrop, cropRect, inspectPhotoDataUrl, prepareProfilePhoto, looksLikeHeic,
} from '../utils/photoPrep.js';
import { decodeBase64, encodeBase64, hasJpegMetadata, readJpegHeader } from '../capture/preparedImage.js';

// ─── A stand-in browser ─────────────────────────────────────────────────────

const seg = (marker, payload) => [0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload];
const ascii = (text) => [...text].map((c) => c.charCodeAt(0) & 0xFF);
const GPS_TEXT = 'GPS 51.5072N 0.1276W';
const EXIF = seg(0xE1, ascii(`Exif\0\0${GPS_TEXT}`));
const XMP = seg(0xE1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
const ICC = seg(0xE2, ascii('ICC_PROFILE\0\0\0'));
const IPTC = seg(0xED, ascii('Photoshop 3.0\0'));
const COMMENT = seg(0xFE, ascii('taken at home'));
const JFIF = seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

/** A JPEG of these dimensions and (at least) this many bytes. */
function jpegBytes(width, height, length, { extra = [], end = true } = {}) {
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

const dataUrlOf = (bytes) => `${PHOTO.DATA_URL_PREFIX}${encodeBase64(bytes)}`;
const bytesOf = (dataUrl) => decodeBase64(dataUrl.slice(PHOTO.DATA_URL_PREFIX.length));
/** The data URL's length for a JPEG of n bytes. */
const charsFor = (n) => PHOTO.DATA_URL_PREFIX.length + 4 * Math.ceil(n / 3);

/**
 * sizes: bytes produced for each "edge@quality", defaulting to a small photo.
 * A function can be given instead, or `encode` to take over completely.
 */
function platform({ width = 4000, height = 3000, sizes = {}, size, extra = [], decodeError = false, encode, source = { kind: 'bitmap' } } = {}) {
  const close = vi.fn();
  const calls = [];
  return {
    close,
    calls,
    decodeCalls: 0,
    async decode() {
      this.decodeCalls += 1;
      if (decodeError) throw new Error('cannot decode');
      return { width, height, source, close };
    },
    async encodeJpeg(src, rect, edge, quality) {
      calls.push({ src, rect, edge, quality });
      if (encode) return encode(edge, quality, rect);
      const length = typeof size === 'function' ? size(edge, quality) : (sizes[`${edge}@${quality}`] ?? 20_000);
      return jpegBytes(edge, edge, length, { extra });
    },
  };
}

const file = (name = 'me.jpg', type = 'image/jpeg', size = 1_000_000) => ({ name, type, size });
const run = (options, f = file(), config) => {
  const p = platform(options);
  return prepareProfilePhoto(f, { platform: p, ...config }).then((result) => ({ result, p }), (error) => Promise.reject(Object.assign(error, { p })));
};
const failure = async (promise) => { try { await promise; } catch (error) { return error; } throw new Error('expected a failure'); };

// ─── The crop ────────────────────────────────────────────────────────────────

describe('the crop', () => {
  it('is the largest centred square by default, for a landscape, a portrait and a square picture', () => {
    expect(cropRect(4000, 3000, undefined)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(cropRect(3000, 4000, undefined)).toEqual({ sx: 0, sy: 500, side: 3000 });
    expect(cropRect(1000, 1000, undefined)).toEqual({ sx: 0, sy: 0, side: 1000 });
    expect(normalizeCrop(undefined)).toEqual(DEFAULT_CROP);
  });

  it('zooms: 2 is half the side, around the same centre', () => {
    expect(cropRect(4000, 3000, { zoom: 2 })).toEqual({ sx: 1250, sy: 750, side: 1500 });
    expect(cropRect(4000, 3000, { zoom: 3 }).side).toBe(1000);
  });

  it('puts the centre where it is asked: x and y are fractions of the width and the height', () => {
    // zoom 2 on 4000x3000: a 1500 px square centred on x = 25% (1000 px), y = 50% (1500 px)
    expect(cropRect(4000, 3000, { x: 0.25, y: 0.5, zoom: 2 })).toEqual({ sx: 250, sy: 750, side: 1500 });
    expect(cropRect(4000, 3000, { x: 0.75, y: 0.25, zoom: 2 })).toEqual({ sx: 2250, sy: 0, side: 1500 });
  });

  it('moves a centre that is too near an edge until the square is wholly inside', () => {
    expect(cropRect(4000, 3000, { x: 0, y: 0, zoom: 2 })).toEqual({ sx: 0, sy: 0, side: 1500 });
    expect(cropRect(4000, 3000, { x: 1, y: 1, zoom: 2 })).toEqual({ sx: 2500, sy: 1500, side: 1500 });
    // At zoom 1 the square fills the short side, so only the long side can move.
    expect(cropRect(4000, 3000, { x: 0, y: 0.5, zoom: 1 })).toEqual({ sx: 0, sy: 0, side: 3000 });
    expect(cropRect(4000, 3000, { x: 1, y: 0.5, zoom: 1 })).toEqual({ sx: 1000, sy: 0, side: 3000 });
  });

  it('holds zoom and position to their range, and takes anything that is not a number as the default', () => {
    expect(normalizeCrop({ x: -3, y: 9, zoom: 100 })).toEqual({ x: 0, y: 1, zoom: PHOTO.MAX_ZOOM });
    expect(normalizeCrop({ zoom: 0.2 }).zoom).toBe(1);
    expect(normalizeCrop({ zoom: -5 }).zoom).toBe(1);
    for (const bad of [NaN, Infinity, -Infinity, '2', null, undefined, {}, []]) {
      expect(normalizeCrop({ x: bad, y: bad, zoom: bad }), String(bad)).toEqual(DEFAULT_CROP);
    }
    for (const notACrop of [null, 'crop', 5, true, []]) expect(normalizeCrop(notACrop)).toEqual(DEFAULT_CROP);
  });

  it('never leaves the picture, whatever the picture and the crop: a grid of shapes, centres and zooms', () => {
    const shapes = [[4000, 3000], [3000, 4000], [64, 64], [6000, 64], [64, 6000], [1, 1], [10_000, 100], [333, 777]];
    for (const [w, h] of shapes) {
      for (const x of [-1, 0, 0.1, 0.5, 0.9, 1, 2]) {
        for (const y of [-1, 0, 0.5, 1, 2]) {
          for (const zoom of [0, 1, 1.5, 2, 3.7, 8, 50]) {
            const { sx, sy, side } = cropRect(w, h, { x, y, zoom });
            expect(side, `${w}x${h}`).toBeGreaterThanOrEqual(1);
            expect(sx).toBeGreaterThanOrEqual(0);
            expect(sy).toBeGreaterThanOrEqual(0);
            expect(sx + side).toBeLessThanOrEqual(w);
            expect(sy + side).toBeLessThanOrEqual(h);
            expect(Number.isInteger(sx) && Number.isInteger(sy) && Number.isInteger(side)).toBe(true);
          }
        }
      }
    }
  });

  it('handles unusual shapes: a panorama, a tall strip and a one-pixel picture', () => {
    expect(cropRect(10_000, 100, undefined)).toEqual({ sx: 4950, sy: 0, side: 100 });
    expect(cropRect(100, 10_000, undefined)).toEqual({ sx: 0, sy: 4950, side: 100 });
    expect(cropRect(1, 1, { zoom: 8 })).toEqual({ sx: 0, sy: 0, side: 1 });
  });

  it('does not change the crop it is given', () => {
    const crop = Object.freeze({ x: 0.3, y: 0.7, zoom: 2 });
    expect(() => cropRect(4000, 3000, crop)).not.toThrow();
    expect(normalizeCrop(crop)).toEqual({ x: 0.3, y: 0.7, zoom: 2 });
  });
});

// ─── A photo, start to finish ────────────────────────────────────────────────

describe('preparing a photo', () => {
  it('makes a 320 px square JPEG data URL from a large photo, and says exactly what it made', async () => {
    const { result, p } = await run();
    expect(result.dataUrl.startsWith(PHOTO.DATA_URL_PREFIX)).toBe(true);
    expect(result).toMatchObject({ mimeType: 'image/jpeg', widthPx: 320, heightPx: 320, crop: DEFAULT_CROP, attempts: 1 });
    expect(result.chars).toBe(result.dataUrl.length);
    expect(result.bytes).toBe(bytesOf(result.dataUrl).length);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]).toMatchObject({ edge: 320, quality: 0.85, rect: { sx: 500, sy: 0, side: 3000 } });
  });

  it('hands the encoder the decoded picture and the crop it asked for, in the picture\'s own pixels', async () => {
    const source = { kind: 'oriented bitmap' };
    // A portrait, as the decoder reports it AFTER applying its orientation: the crop works on that.
    const { p } = await run({ width: 3024, height: 4032, source }, file(), { crop: { x: 0.5, y: 0.25, zoom: 2 } });
    expect(p.calls[0].src).toBe(source);
    expect(p.calls[0].rect).toEqual(cropRect(3024, 4032, { x: 0.5, y: 0.25, zoom: 2 }));
  });

  it('is a data URL that is within the cap, counting the prefix', async () => {
    const { result } = await run({ sizes: { '320@0.85': 30_000 } });
    expect(result.chars).toBeLessThanOrEqual(PHOTO.MAX_DATA_URL_CHARS);
    expect(PHOTO.MAX_DATA_URL_CHARS).toBe(65_536);
  });

  it('works from JPEG, PNG and WebP files alike', async () => {
    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.gif', 'image/gif'], ['a.avif', 'image/avif'], ['a.bmp', 'image/bmp']]) {
      const { result } = await run({}, file(name, type));
      expect(result.widthPx, type).toBe(320);
    }
  });

  it('accepts a file with no type when the browser can decode it', async () => {
    const { result } = await run({}, file('photo', ''));
    expect(result.widthPx).toBe(320);
  });

  it('does not make a small picture bigger: the side of what was cropped is the limit', async () => {
    const { result, p } = await run({ width: 200, height: 150 });
    expect(result.widthPx).toBe(150);
    expect(p.calls[0].edge).toBe(150);
    const exact = await run({ width: 64, height: 64 });
    expect(exact.result.widthPx).toBe(64);
    // Zooming in on a big picture to a part smaller than 320 px has the same limit.
    const zoomed = await run({ width: 1000, height: 1000 }, file(), { crop: { zoom: 4 } });
    expect(zoomed.result.widthPx).toBe(250);
  });

  it('handles a panorama and a tall strip: the square is the short side', async () => {
    const wide = await run({ width: 10_000, height: 100 });
    expect(wide.result.widthPx).toBe(100);
    expect(wide.p.calls[0].rect).toEqual({ sx: 4950, sy: 0, side: 100 });
    const tall = await run({ width: 100, height: 10_000 });
    expect(tall.result.widthPx).toBe(100);
  });

  it('echoes the crop it used, held to its range, and never reports the caller\'s own object', async () => {
    const crop = { x: 5, y: -5, zoom: 99 };
    const { result } = await run({}, file(), { crop });
    expect(result.crop).toEqual({ x: 1, y: 0, zoom: PHOTO.MAX_ZOOM });
    expect(result.crop).not.toBe(crop);
    expect(crop).toEqual({ x: 5, y: -5, zoom: 99 });
  });
});

// ─── Compression ─────────────────────────────────────────────────────────────

describe('adaptive compression', () => {
  const OVER = 60_000;   // base64 of this is over the cap
  const FITS = 20_000;

  it('lowers the quality before the size: the first step that fits wins', async () => {
    const { result, p } = await run({ sizes: { '320@0.85': OVER, '320@0.75': OVER, '320@0.65': FITS } });
    expect(p.calls.map((c) => `${c.edge}@${c.quality}`)).toEqual(['320@0.85', '320@0.75', '320@0.65']);
    expect(result).toMatchObject({ widthPx: 320, attempts: 3 });
  });

  it('goes to a smaller size only when no quality fits at this one, and then starts at the best quality again', async () => {
    const sizes = Object.fromEntries(ENCODE_QUALITIES.map((q) => [`320@${q}`, OVER]));
    const { result, p } = await run({ sizes });
    expect(p.calls.map((c) => `${c.edge}@${c.quality}`)).toEqual([...ENCODE_QUALITIES.map((q) => `320@${q}`), '256@0.85']);
    expect(result.widthPx).toBe(256);
  });

  it('walks the whole ladder, edges largest first, qualities highest first', async () => {
    const { p } = await run({ size: () => OVER }).catch((error) => ({ p: error.p }));
    const expected = ENCODE_EDGES.flatMap((e) => ENCODE_QUALITIES.map((q) => `${e}@${q}`));
    expect(p.calls.map((c) => `${c.edge}@${c.quality}`)).toEqual(expected);
  });

  it('says the picture cannot be made small enough when nothing on the ladder fits', async () => {
    const error = await failure(run({ size: () => OVER }));
    expect(error).toBeInstanceOf(PreparePhotoError);
    expect(error.code).toBe(PHOTO_ERRORS.CANNOT_FIT);
    expect(error.p.decodeCalls).toBe(1);
    expect(error.p.close).toHaveBeenCalledTimes(1);
  });

  it('keeps to a cap it is given, exactly: at the cap is fine, one over is not', async () => {
    const n = 3000;
    const cap = charsFor(n);
    const fits = await run({ size: () => n }, file(), { maxChars: cap });
    expect(fits.result.chars).toBe(cap);
    const over = await failure(run({ size: () => n }, file(), { maxChars: cap - 1 }));
    expect(over.code).toBe(PHOTO_ERRORS.CANNOT_FIT);
  });

  it('counts the prefix in the cap, not just the encoded bytes', async () => {
    // 48,000 bytes encode to exactly 64,000 characters: with the 23-character prefix, 64,023.
    const { result } = await run({ size: () => 48_000 });
    expect(result.chars).toBe(64_000 + PHOTO.DATA_URL_PREFIX.length);
    // 49,150 bytes encode to 65,536 characters on their own: the prefix pushes it over.
    const edge = await failure(run({ size: () => 49_150 }));
    expect(edge.code).toBe(PHOTO_ERRORS.CANNOT_FIT);
  });

  it('does not try the same size and quality twice when the picture is already smaller than the ladder', async () => {
    const { p } = await run({ width: 100, height: 100, size: () => OVER }).catch((error) => ({ p: error.p }));
    const keys = p.calls.map((c) => `${c.edge}@${c.quality}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(ENCODE_QUALITIES.length);
    expect(p.calls.every((c) => c.edge === 100)).toBe(true);
  });
});

// ─── Metadata ────────────────────────────────────────────────────────────────

describe('metadata', () => {
  it('is removed whatever the encoder leaves in: EXIF with GPS, XMP, ICC, IPTC and comments', async () => {
    const { result } = await run({ extra: [...EXIF, ...XMP, ...ICC, ...IPTC, ...COMMENT] });
    const bytes = bytesOf(result.dataUrl);
    expect(hasJpegMetadata(bytes)).toBe(false);
    const text = new TextDecoder('latin1').decode(bytes);
    for (const leaked of ['Exif', GPS_TEXT, 'xmpmeta', 'ICC_PROFILE', 'Photoshop', 'taken at home']) expect(text, leaked).not.toContain(leaked);
    // What describes how to decode the pixels stays.
    expect(readJpegHeader(bytes)).toMatchObject({ width: 320, height: 320 });
    expect(text).toContain('JFIF');
  });

  it('leaves a photo that has none as it is', async () => {
    const { result } = await run();
    expect(hasJpegMetadata(bytesOf(result.dataUrl))).toBe(false);
  });

  it('is removed before the size is measured, so a large EXIF does not cost the photo its place', async () => {
    const bigExif = seg(0xE1, new Array(40_000).fill(0x41));
    const { result, p } = await run({ extra: bigExif, size: () => 8_000 + bigExif.length });
    expect(result.attempts).toBe(1);
    expect(p.calls).toHaveLength(1);
    expect(result.chars).toBeLessThan(PHOTO.MAX_DATA_URL_CHARS);
  });
});

// ─── The hard stops ──────────────────────────────────────────────────────────

describe('what it refuses, and says plainly', () => {
  const reason = async (options, f, config) => (await failure(run(options, f, config))).code;

  it('needs a file', async () => {
    expect((await failure(prepareProfilePhoto(null, { platform: platform() }))).code).toBe(PHOTO_ERRORS.NO_FILE);
    expect((await failure(prepareProfilePhoto(undefined))).code).toBe(PHOTO_ERRORS.NO_FILE);
  });

  it('will not open what is not a picture, and never asks the browser to', async () => {
    for (const type of ['application/pdf', 'text/plain', 'video/mp4', 'application/octet-stream']) {
      const error = await failure(run({}, file('x', type)));
      expect(error.code, type).toBe(PHOTO_ERRORS.UNSUPPORTED_FORMAT);
      expect(error.p.decodeCalls).toBe(0);
    }
  });

  it('calls a JPEG, PNG or WebP that will not open damaged, not unsupported', async () => {
    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.jpeg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.jfif', 'image/pjpeg']]) {
      expect(await reason({ decodeError: true }, file(name, type)), type).toBe(PHOTO_ERRORS.DECODE_FAILED);
    }
    // No type from the system: the name says what it claims to be.
    expect(await reason({ decodeError: true }, file('IMG_1.JPG', ''))).toBe(PHOTO_ERRORS.DECODE_FAILED);
    expect(await reason({ decodeError: true }, file('noextension', ''))).toBe(PHOTO_ERRORS.DECODE_FAILED);
  });

  it('calls another kind of picture that will not open unsupported: HEIC, AVIF, TIFF, GIF', async () => {
    for (const [name, type] of [['a.heic', 'image/heic'], ['a.heif', 'image/heif'], ['a.HEIC', ''], ['a.avif', 'image/avif'], ['a.tiff', 'image/tiff'], ['a.gif', 'image/gif']]) {
      expect(await reason({ decodeError: true }, file(name, type)), `${name} ${type}`).toBe(PHOTO_ERRORS.UNSUPPORTED_FORMAT);
    }
    expect(looksLikeHeic(file('a.HEIC', ''))).toBe(true);
    expect(looksLikeHeic(file('a.jpg', 'image/jpeg'))).toBe(false);
  });

  it('calls an empty file damaged, without opening it', async () => {
    const error = await failure(run({}, file('a.jpg', 'image/jpeg', 0)));
    expect(error.code).toBe(PHOTO_ERRORS.DECODE_FAILED);
    expect(error.p.decodeCalls).toBe(0);
  });

  it('calls a picture that decodes to nothing damaged', async () => {
    for (const [width, height] of [[0, 100], [100, 0], [NaN, NaN], [-5, 100]]) {
      expect(await reason({ width, height }), `${width}x${height}`).toBe(PHOTO_ERRORS.DECODE_FAILED);
    }
  });

  it('refuses a file that is too large to open, without opening it', async () => {
    const error = await failure(run({}, file('big.jpg', 'image/jpeg', PHOTO.MAX_INPUT_BYTES + 1)));
    expect(error.code).toBe(PHOTO_ERRORS.TOO_LARGE_SOURCE);
    expect(error.p.decodeCalls).toBe(0);
    const ok = await run({}, file('edge.jpg', 'image/jpeg', PHOTO.MAX_INPUT_BYTES));
    expect(ok.result.widthPx).toBe(320);
  });

  it('refuses a picture with too many pixels to hold in memory, and lets it go', async () => {
    const error = await failure(run({ width: 20_000, height: 20_000 }));
    expect(error.code).toBe(PHOTO_ERRORS.TOO_LARGE_SOURCE);
    expect(error.p.close).toHaveBeenCalledTimes(1);
    const ok = await run({ width: 10_000, height: 10_000 });
    expect(ok.result.widthPx).toBe(320);
  });

  it('says a picture is too small when its short edge is under the minimum, whatever its shape', async () => {
    for (const [width, height] of [[63, 500], [500, 63], [63, 63], [1, 5000], [5000, 1]]) {
      expect(await reason({ width, height }), `${width}x${height}`).toBe(PHOTO_ERRORS.TOO_SMALL);
    }
  });

  it('says so when zoomed in until what is left is too small, and not before', async () => {
    expect(await reason({ width: 400, height: 400 }, file(), { crop: { zoom: 8 } })).toBe(PHOTO_ERRORS.TOO_SMALL);   // 50 px
    const ok = await run({ width: 512, height: 512 }, file(), { crop: { zoom: 8 } });                              // 64 px
    expect(ok.result.widthPx).toBe(64);
  });

  it('has words for every reason, and none of them is about the picture\'s contents', () => {
    for (const code of Object.values(PHOTO_ERRORS)) {
      expect(PHOTO_MESSAGES[code], code).toEqual(expect.any(String));
      expect(PHOTO_MESSAGES[code].length).toBeGreaterThan(10);
    }
    expect(Object.keys(PHOTO_MESSAGES).sort()).toEqual(Object.values(PHOTO_ERRORS).sort());
  });

  it('lets go of the decoded picture on every path, success or failure', async () => {
    const closes = [];
    const track = async (options, f, config) => {
      const p = platform(options);
      try { await prepareProfilePhoto(f ?? file(), { platform: p, ...config }); } catch { /* the point */ }
      closes.push(p.close.mock.calls.length);
    };
    await track({});                                                           // success
    await track({ width: 40, height: 40 });                                    // too small
    await track({ width: 20_000, height: 20_000 });                            // too many pixels
    await track({ size: () => 90_000 });                                       // cannot fit
    await track({ encode: () => { throw new Error('boom'); } });               // encoder failed
    await track({ encode: (edge) => jpegBytes(edge + 1, edge + 1, 1000) });    // wrong output
    await track({}, file(), { crop: { zoom: 8 }, });                           // fine at 3000 px: success again
    expect(closes).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

// ─── Checking what the encoder gives back ────────────────────────────────────

describe('checking the output the browser produced', () => {
  const code = async (encode) => (await failure(run({ encode }))).code;

  it('refuses output of the wrong dimensions', async () => {
    expect(await code((edge) => jpegBytes(edge + 1, edge, 1000))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code((edge) => jpegBytes(edge, edge - 1, 1000))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(() => jpegBytes(500, 500, 1000))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
  });

  it('refuses output of the wrong dimensions even when it is also too big: the wrong size is the problem, not the cap', async () => {
    // Without this, a wrong-sized JPEG over the cap would be skipped as "too large" and the ladder would carry on.
    expect(await code((edge) => jpegBytes(edge + 1, edge + 1, 90_000))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code((edge) => jpegBytes(edge, edge * 2, 90_000))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
  });

  it('refuses output that is not a JPEG', async () => {
    expect(await code(() => new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(() => new Uint8Array(0))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(() => new Uint8Array([0xFF, 0xD8]))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(() => 'not bytes')).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(() => null)).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(() => [0xFF, 0xD8])).toBe(PHOTO_ERRORS.ENCODE_FAILED);
  });

  it('refuses output that was cut short', async () => {
    expect(await code((edge) => jpegBytes(edge, edge, 5000, { end: false }))).toBe(PHOTO_ERRORS.ENCODE_FAILED);
  });

  it('turns an encoder that throws, or rejects, into one plain reason', async () => {
    expect(await code(() => { throw new Error('the canvas is gone'); })).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(await code(async () => { throw new Error('toBlob failed'); })).toBe(PHOTO_ERRORS.ENCODE_FAILED);
  });

  it('never lets a raw error, a message from the browser or the picture\'s data through', async () => {
    const error = await failure(run({ encode: () => { throw new Error('secret path /Users/me/Pictures/x.jpg'); } }));
    expect(error.message).toBe(PHOTO_ERRORS.ENCODE_FAILED);
    expect(JSON.stringify(error)).not.toMatch(/Users|secret|Pictures/);
  });
});

// ─── Inspecting a finished photo ─────────────────────────────────────────────

describe('inspecting a photo data URL', () => {
  const good = () => dataUrlOf(jpegBytes(320, 320, 20_000));

  it('accepts a finished photo and reports what is in it', () => {
    expect(inspectPhotoDataUrl(good())).toMatchObject({ ok: true, widthPx: 320, heightPx: 320, bytes: 20_000 });
    expect(inspectPhotoDataUrl(dataUrlOf(jpegBytes(64, 64, 2000)))).toMatchObject({ ok: true, widthPx: 64 });
  });

  it('says why not, in a short code that is never the data', () => {
    const reasonOf = (value, options) => inspectPhotoDataUrl(value, options).reason;
    expect(reasonOf(undefined)).toBe('not-a-jpeg-data-url');
    expect(reasonOf(42)).toBe('not-a-jpeg-data-url');
    expect(reasonOf('https://example.com/a.jpg')).toBe('not-a-jpeg-data-url');
    expect(reasonOf('data:image/png;base64,AAAA')).toBe('not-a-jpeg-data-url');
    expect(reasonOf('data:image/svg+xml;base64,AAAA')).toBe('not-a-jpeg-data-url');
    expect(reasonOf(`${PHOTO.DATA_URL_PREFIX}`)).toBe('bad-encoding');
    expect(reasonOf(`${PHOTO.DATA_URL_PREFIX}not base64!`)).toBe('bad-encoding');
    expect(reasonOf(`${PHOTO.DATA_URL_PREFIX}AAA`)).toBe('bad-encoding');
    expect(reasonOf(dataUrlOf(new Uint8Array([1, 2, 3, 4, 5, 6])))).toBe('not-a-jpeg');
    expect(reasonOf(dataUrlOf(jpegBytes(320, 320, 5000, { end: false })))).toBe('truncated');
    expect(reasonOf(dataUrlOf(jpegBytes(320, 200, 5000)))).toBe('not-square');
    expect(reasonOf(dataUrlOf(jpegBytes(400, 400, 5000)))).toBe('wrong-size');
    expect(reasonOf(dataUrlOf(jpegBytes(63, 63, 5000)))).toBe('wrong-size');
    expect(reasonOf(dataUrlOf(jpegBytes(320, 320, 5000, { extra: EXIF })))).toBe('has-metadata');
    expect(reasonOf(dataUrlOf(jpegBytes(320, 320, 5000, { extra: COMMENT })))).toBe('has-metadata');
    expect(reasonOf(good(), { maxChars: 1000 })).toBe('too-long');
  });

  it('holds the cap exactly', () => {
    const url = dataUrlOf(jpegBytes(320, 320, 3000));
    expect(inspectPhotoDataUrl(url, { maxChars: url.length }).ok).toBe(true);
    expect(inspectPhotoDataUrl(url, { maxChars: url.length - 1 }).reason).toBe('too-long');
    expect(inspectPhotoDataUrl(dataUrlOf(jpegBytes(320, 320, 60_000))).reason).toBe('too-long');
  });

  it('does not take a photo whose type is only claimed: the bytes have to be a JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]);
    expect(inspectPhotoDataUrl(dataUrlOf(png)).ok).toBe(false);
  });
});

// ─── Staying in the browser ──────────────────────────────────────────────────

describe('processing stays local', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/utils/photoPrep.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

  it('imports only the JPEG helpers the capture code already uses', () => {
    const imports = [...code.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../capture/preparedImage.js']);
  });

  it('sends nothing and keeps nothing: no network, no storage, no database, no server', () => {
    for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /firebase/i, /\bdb\b/, /\bFormData\b/, /\bnavigator\./, /document\.cookie/]) {
      expect(code, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('builds a blob URL only to decode with, and gives it back', () => {
    expect((code.match(/createObjectURL/g) ?? []).length).toBe(1);
    expect((code.match(/revokeObjectURL/g) ?? []).length).toBe(2);
  });

  it('flattens onto white before drawing, so a transparent picture is not black', () => {
    expect(code.indexOf("fillStyle = '#ffffff'")).toBeGreaterThan(-1);
    expect(code.indexOf("fillStyle = '#ffffff'")).toBeLessThan(code.lastIndexOf('drawImage'));
  });

  it('asks the browser for the picture as it is shown, with its orientation applied', () => {
    expect(code).toMatch(/imageOrientation:\s*'from-image'/);
  });
});
