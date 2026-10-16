/**
 * Image preparation (PR 5): a phone photo becomes exactly one card-image/v1
 * object, or fails with one of the contract's error codes.
 *
 * jsdom has no canvas, so the browser calls are replaced by a stand-in
 * platform that returns real JPEG byte layouts of the size and length asked
 * for. That drives every branch: sizing, the 1.5 MB encode ladder, the hard
 * stops, HEIC, metadata, and releasing the decoded bitmap on every path. The
 * canvas encode itself is checked on real iPhone and Android devices in the
 * Capture Lab.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';
import {
  ENCODE_STEPS, MESSAGES, PrepareImageError, prepareCardImage, useAnyway, fitWithin, looksLikeHeic,
} from '../components/capture/imagePrep.js';
import {
  IMAGE_ERRORS, MAX_BYTES, validatePreparedImage, decodeBase64, readJpegHeader, hasJpegMetadata,
} from '../capture/preparedImage.js';

// ─── A stand-in browser ─────────────────────────────────────────────────────

const seg = (marker, payload) => [0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload];
const EXIF = seg(0xE1, [...'Exif\0\0GPS 51.5072N 0.1276W'].map(c => c.charCodeAt(0) & 0xFF));

/** A JPEG of these dimensions and (at least) this many bytes. */
function jpegBytes(width, height, length, { exif = false } = {}) {
  const head = [
    0xFF, 0xD8,
    ...seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(exif ? EXIF : []),
    ...seg(0xC0, [8, height >> 8, height & 0xFF, width >> 8, width & 0xFF, 1, 1, 0x11, 0]),
    ...seg(0xDA, [1, 1, 0, 0, 63, 0]),
  ];
  const out = new Uint8Array(Math.max(length, head.length + 2)).fill(0x5A);
  out.set(head);
  out.set([0xFF, 0xD9], out.length - 2);
  return out;
}

const SHARP = (w, h) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const x = i % w; const y = Math.floor(i / w);
    const v = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 40 : 200;
    data.set([v, v, v, 255], i * 4);
  }
  return { width: w, height: h, data };
};

/**
 * sizes: bytes produced at each (longEdge, quality) step, keyed "2000@0.85".
 * Defaults to a comfortable 600 KB everywhere.
 */
function platform({ width = 4032, height = 3024, sizes = {}, exif = false, decodeError = false, encode, pixels = SHARP } = {}) {
  const close = vi.fn();
  const calls = [];
  return {
    close,
    calls,
    async decode() {
      if (decodeError) throw new Error('cannot decode');
      return { width, height, source: { kind: 'bitmap' }, close };
    },
    async encodeJpeg(source, w, h, quality) {
      calls.push({ w, h, quality });
      if (encode) return encode(w, h, quality);
      const key = `${Math.max(w, h)}@${quality}`;
      return jpegBytes(w, h, sizes[key] ?? 600_000, { exif });
    },
    async pixels(source, w, h) { return pixels(w, h); },
  };
}

const photo = (name = 'IMG_0001.JPG', type = 'image/jpeg') => ({ name, type });

async function prepare(options, file = photo()) {
  const p = platform(options);
  const result = await prepareCardImage(file, { platform: p });
  return { ...result, p };
}

async function failure(options, file = photo()) {
  const p = platform(options);
  const error = await prepareCardImage(file, { platform: p }).then(() => null, e => e);
  expect(error).toBeInstanceOf(PrepareImageError);
  return { code: error.code, p };
}

// ─── Sizing ─────────────────────────────────────────────────────────────────

describe('sizing', () => {
  it('fits the long edge without ever upscaling', () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1200, 900, 2000)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('a 12 MP landscape photo becomes 2000 × 1500 at quality 0.85', async () => {
    const { image, p } = await prepare();
    expect([image.widthPx, image.heightPx]).toEqual([2000, 1500]);
    expect(p.calls).toEqual([{ w: 2000, h: 1500, quality: 0.85 }]);
  });

  it('a portrait photo becomes 1500 × 2000', async () => {
    const { image } = await prepare({ width: 3024, height: 4032 });
    expect([image.widthPx, image.heightPx]).toEqual([1500, 2000]);
  });

  it('a photo already under 2000 px keeps its size', async () => {
    const { image } = await prepare({ width: 1200, height: 900 });
    expect([image.widthPx, image.heightPx]).toEqual([1200, 900]);
  });

  it('a short edge under 600 px is a hard stop, before any encode', async () => {
    const { code, p } = await failure({ width: 800, height: 599 });
    expect(code).toBe(IMAGE_ERRORS.TOO_SMALL);
    expect(p.calls).toEqual([]);
  });

  it('a photo so elongated no size keeps 600 px on the short edge is too small to read', async () => {
    const { code } = await failure({ width: 4000, height: 1100 });
    expect(code).toBe(IMAGE_ERRORS.TOO_SMALL);
  });
});

// ─── The 1.5 MB encode ladder ───────────────────────────────────────────────

describe('the encode ladder', () => {
  it('pins the three steps', () => {
    expect(ENCODE_STEPS).toEqual([
      { longEdge: 2000, quality: 0.85 }, { longEdge: 2000, quality: 0.75 }, { longEdge: 1600, quality: 0.8 },
    ]);
  });

  it('over 1.5 MB at 0.85 re-encodes the decoded photo at 0.75', async () => {
    const { image, p } = await prepare({ sizes: { '2000@0.85': MAX_BYTES + 1, '2000@0.75': 1_400_000 } });
    expect(p.calls.map(c => c.quality)).toEqual([0.85, 0.75]);
    expect(image.bytes).toBe(1_400_000);
  });

  it('still over at 0.75 drops to 1600 px at 0.80', async () => {
    const { image, p } = await prepare({ sizes: { '2000@0.85': 1_900_000, '2000@0.75': 1_600_000, '1600@0.8': 1_100_000 } });
    expect(p.calls).toEqual([
      { w: 2000, h: 1500, quality: 0.85 }, { w: 2000, h: 1500, quality: 0.75 }, { w: 1600, h: 1200, quality: 0.8 },
    ]);
    expect([image.widthPx, image.heightPx, image.bytes]).toEqual([1600, 1200, 1_100_000]);
  });

  it('exactly 1.5 MB fits', async () => {
    const { image } = await prepare({ sizes: { '2000@0.85': MAX_BYTES } });
    expect(image.bytes).toBe(MAX_BYTES);
  });

  it('over 1.5 MB on every step is too_large', async () => {
    const { code } = await failure({ sizes: { '2000@0.85': 3e6, '2000@0.75': 2e6, '1600@0.8': 1_600_000 } });
    expect(code).toBe(IMAGE_ERRORS.TOO_LARGE);
  });
});

// ─── The output ─────────────────────────────────────────────────────────────

describe('the prepared image', () => {
  it('is a valid card-image/v1 object, and nothing more', async () => {
    const { image, prepMs } = await prepare();
    expect(validatePreparedImage(image)).toEqual({ ok: true });
    expect(Object.keys(image)).toEqual(['version', 'mimeType', 'data', 'bytes', 'widthPx', 'heightPx', 'preflight']);
    expect(image.version).toBe('card-image/v1');
    expect(image.mimeType).toBe('image/jpeg');
    expect(typeof prepMs).toBe('number');
  });

  it('data is standard base64 of exactly `bytes` JPEG bytes with the declared size', async () => {
    const { image } = await prepare();
    expect(image.data).not.toMatch(/^data:|\s/);
    const bytes = decodeBase64(image.data);
    expect(bytes.length).toBe(image.bytes);
    expect(readJpegHeader(bytes)).toMatchObject({ width: image.widthPx, height: image.heightPx });
  });

  it('carries no metadata, even if the encoder wrote some', async () => {
    const { image } = await prepare({ exif: true });
    const bytes = decodeBase64(image.data);
    expect(hasJpegMetadata(bytes)).toBe(false);
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('GPS');
  });

  it('includes the quality checks, not yet overridden', async () => {
    const { image } = await prepare();
    expect(image.preflight).toMatchObject({ warnings: [], userOverrode: false });
    const dark = await prepare({ pixels: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(10) }) });
    expect(dark.image.preflight.warnings).toEqual(['blurry', 'dark']);
  });

  it('analyses a copy about 512 px wide in either orientation', async () => {
    const sizes = [];
    const track = (w, h) => { sizes.push([w, h]); return SHARP(w, h); };
    await prepare({ pixels: track });
    await prepare({ width: 3024, height: 4032, pixels: track });
    expect(sizes).toEqual([[512, 384], [512, 683]]);
  });
});

// ─── Failures ───────────────────────────────────────────────────────────────

describe('failures map to the contract codes', () => {
  it('a HEIC the browser cannot decode is unsupported_format', async () => {
    expect((await failure({ decodeError: true }, photo('IMG_0002.HEIC', 'image/heic'))).code).toBe(IMAGE_ERRORS.UNSUPPORTED_FORMAT);
    expect((await failure({ decodeError: true }, photo('IMG_0003.heif', ''))).code).toBe(IMAGE_ERRORS.UNSUPPORTED_FORMAT);
  });

  it('a HEIC the browser can decode is prepared like any photo', async () => {
    const { image } = await prepare({}, photo('IMG_0004.HEIC', 'image/heic'));
    expect(image.mimeType).toBe('image/jpeg');
  });

  it('any other undecodable file is decode_failed', async () => {
    expect((await failure({ decodeError: true })).code).toBe(IMAGE_ERRORS.DECODE_FAILED);
  });

  it('a file that is not an image is unsupported_format, without decoding', async () => {
    const p = platform();
    const decode = vi.spyOn(p, 'decode');
    const error = await prepareCardImage(photo('card.pdf', 'application/pdf'), { platform: p }).catch(e => e);
    expect(error.code).toBe(IMAGE_ERRORS.UNSUPPORTED_FORMAT);
    expect(decode).not.toHaveBeenCalled();
  });

  it('no file is decode_failed', async () => {
    expect((await prepareCardImage(null, { platform: platform() }).catch(e => e)).code).toBe(IMAGE_ERRORS.DECODE_FAILED);
  });

  it('an encoder that returns the wrong size or not a JPEG is decode_failed', async () => {
    expect((await failure({ encode: (w, h) => jpegBytes(w + 1, h, 500_000) })).code).toBe(IMAGE_ERRORS.DECODE_FAILED);
    expect((await failure({ encode: () => new Uint8Array(1000).fill(1) })).code).toBe(IMAGE_ERRORS.DECODE_FAILED);
    expect((await failure({ encode: () => { throw new Error('toBlob returned null'); } })).code).toBe(IMAGE_ERRORS.DECODE_FAILED);
  });

  it('releases the decoded bitmap on success and on every failure after decoding', async () => {
    const outcomes = [
      {}, { width: 800, height: 500 }, { sizes: { '2000@0.85': 3e6, '2000@0.75': 3e6, '1600@0.8': 3e6 } },
      { encode: () => new Uint8Array(10) }, { pixels: () => { throw new Error('getImageData failed'); } },
    ];
    for (const options of outcomes) {
      const p = platform(options);
      await prepareCardImage(photo(), { platform: p }).catch(() => {});
      expect(p.close).toHaveBeenCalledTimes(1);
    }
  });

  it('error messages never contain the file name', async () => {
    const error = await prepareCardImage(photo('jane-smith-acme.heic', 'image/heic'), { platform: platform({ decodeError: true }) }).catch(e => e);
    expect(`${error.message} ${error.code}`).not.toContain('jane');
  });

  it('detects HEIC by type or extension', () => {
    expect(looksLikeHeic({ type: 'image/HEIF', name: 'x' })).toBe(true);
    expect(looksLikeHeic({ type: '', name: 'IMG.HEIC' })).toBe(true);
    expect(looksLikeHeic({ type: 'image/jpeg', name: 'IMG.JPG' })).toBe(false);
  });
});

// ─── Use anyway ─────────────────────────────────────────────────────────────

describe('Use anyway', () => {
  it('records the override on a copy, and the result is still valid', async () => {
    const dark = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(10) });
    const { image } = await prepare({ pixels: dark });
    const chosen = useAnyway(image);
    expect(chosen.preflight.userOverrode).toBe(true);
    expect(image.preflight.userOverrode).toBe(false);
    expect(validatePreparedImage(chosen)).toEqual({ ok: true });
  });

  it('is not possible without a warning', async () => {
    const { image } = await prepare();
    expect(() => useAnyway(image)).toThrow();
  });
});

describe('not wired into the app yet', () => {
  it('nothing outside src/components/capture imports image preparation until the Capture Lab', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const importers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        const path = relative(repo, full).split(sep).join('/');
        if (entry.isDirectory()) {
          if (!['node_modules', 'test', 'capture'].includes(entry.name) || path === 'src/capture') walk(full);
        } else if (/\.(m?js|jsx|tsx?)$/.test(entry.name)
          && /['"][^'"]*components\/capture\/(imagePrep|preflight)(\.js)?['"]/.test(readFileSync(full, 'utf8'))) {
          importers.push(path);
        }
      }
    };
    walk(resolve(repo, 'src'));
    walk(resolve(repo, 'netlify'));
    expect(importers).toEqual([]);
  });
});

describe('messages', () => {
  it('cover every error the browser raises and every warning', () => {
    for (const code of ['too_small', 'unsupported_format', 'decode_failed', 'too_large', 'blurry', 'glare', 'dark']) {
      expect(typeof MESSAGES[code]).toBe('string');
    }
    expect(MESSAGES.too_small).toBe('This image is too small to read.');
  });
});
