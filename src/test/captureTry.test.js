// @vitest-environment node
/**
 * scripts/captureTry.mjs: the local tool for reading real cards.
 *
 * Pins argument parsing, EXIF orientation reading, which photos are sent as
 * they are, the macOS conversion steps (sips is stubbed: these tests check the
 * commands issued, not sips itself), that the prepared image passes the
 * server's own check, and that a run prints the card and nothing secret. The
 * runs use the fake extractor: no network.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sipsCalls = vi.hoisted(() => []);
const sipsBehaviour = vi.hoisted(() => ({ convert: null }));
vi.mock('node:child_process', () => ({
  spawnSync: (command, args) => {
    sipsCalls.push([command, ...args]);
    const outIndex = args.indexOf('--out');
    if (outIndex >= 0) sipsBehaviour.convert(args[args.length - 3] ?? args[0], args[outIndex + 1], args);
    else if (args[0] === '-r') sipsBehaviour.rotate(args[2], Number(args[1]));
    return { status: 0, stdout: '' };
  },
}));

import {
  parseArgs, exifOrientation, usableAsIs, preparePhoto, estimateCost, fieldRows, main, ROTATION,
} from '../../scripts/captureTry.mjs';
import { hasJpegMetadata, decodeBase64, checkPreparedImage } from '../capture/preparedImage.js';

// Synthetic JPEGs with real header layouts, and EXIF orientation in either byte order.
const seg = (m, p) => [0xFF, m, (p.length + 2) >> 8, (p.length + 2) & 0xFF, ...p];
const sof = (w, h) => seg(0xC0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
const exifBig = o => seg(0xE1, [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat([0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0]));
const exifLittle = o => seg(0xE1, [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0]));
const jpeg = (w, h, extra = [], scan = 2) => new Uint8Array([
  0xFF, 0xD8, ...seg(0xE0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...extra,
  ...seg(0xDB, [0, ...new Array(64).fill(1)]), ...sof(w, h), ...seg(0xC4, [0, ...new Array(16).fill(0)]),
  ...seg(0xDA, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), ...new Array(scan).fill(0x5A), 0xFF, 0xD9,
]);

const dir = mkdtempSync(join(tmpdir(), 'capture-try-test-'));
const file = (name, bytes) => { const path = join(dir, name); writeFileSync(path, bytes); return path; };

beforeEach(() => { sipsCalls.length = 0; });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('captureTry: arguments', () => {
  it('reads a photo and options', () => {
    expect(parseArgs(['card.jpg', '--model', 'claude-sonnet-5-5', '--effort', 'medium', '--json'])).toEqual({
      photo: 'card.jpg', extractor: 'claude-vision', json: true, model: 'claude-sonnet-5-5', effort: 'medium',
    });
    expect(parseArgs(['card.jpg', '--extractor', 'fake', '--scenario', 'no_text'])).toMatchObject({ extractor: 'fake', scenario: 'no_text' });
  });

  it.each([[[]], [['--json']], [['a.jpg', 'b.jpg']], [['a.jpg', '--model']], [['a.jpg', '--verbose']]])('refuses %o', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe('captureTry: preparing the photo', () => {
  it('reads EXIF orientation in both byte orders, and 1 when there is none', () => {
    expect(exifOrientation(jpeg(2000, 1143, exifBig(6)))).toBe(6);
    expect(exifOrientation(jpeg(2000, 1143, exifLittle(8)))).toBe(8);
    expect(exifOrientation(jpeg(2000, 1143))).toBe(1);
    expect(exifOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
    expect(ROTATION).toEqual({ 1: 0, 3: 180, 6: 90, 8: 270 });
  });

  it('sends an upright JPEG inside the limits as it is, without its metadata', () => {
    expect(usableAsIs(jpeg(2000, 1143, exifBig(1)))).toBe(true);
    const { image, note, metadataRemoved } = preparePhoto(file('ok.jpg', jpeg(2000, 1143, exifBig(1))), { platform: 'linux' });
    expect(note).toBe('used as it is');
    expect(metadataRemoved).toBe(1);
    expect(hasJpegMetadata(decodeBase64(image.data))).toBe(false);
    expect(checkPreparedImage(image).ok).toBe(true);
  });

  it.each([
    ['too large', jpeg(4032, 3024)],
    ['rotated', jpeg(2000, 1143, exifBig(6))],
    ['not a JPEG', new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])],
  ])('a %s photo needs converting; off macOS it says how', (_, bytes) => {
    expect(usableAsIs(bytes)).toBe(false);
    expect(() => preparePhoto(file('x.bin', bytes), { platform: 'linux' })).toThrow(/needs converting/);
  });

  it('on macOS converts with sips: to JPEG, upright by its EXIF orientation, then shrunk to 2000 px', () => {
    const big = join(dir, 'converted-source.jpg');
    writeFileSync(big, jpeg(4032, 3024, exifBig(6)));
    sipsBehaviour.convert = (_, out, args) => {
      if (args.includes('-Z')) writeFileSync(out, jpeg(1500, 2000));     // shrunk, already upright
      else copyFileSync(big, out);                                          // converted, tag kept
    };
    sipsBehaviour.rotate = (path) => writeFileSync(path, jpeg(3024, 4032));
    const { image, note } = preparePhoto(file('photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])), { platform: 'darwin' });
    const steps = sipsCalls.map(call => call.slice(1).filter(a => !a.includes('/')).join(' '));
    expect(steps).toEqual([
      '-s format jpeg -s formatOptions 95 --out',
      '-r 90',
      '-s format jpeg -s formatOptions 85 -Z 2000 --out',
    ]);
    expect(note).toMatch(/orientation 6/);
    expect([image.widthPx, image.heightPx]).toEqual([1500, 2000]);
    expect(checkPreparedImage(image).ok).toBe(true);
  });

  it('refuses a photo too small to read', () => {
    expect(() => preparePhoto(file('small.jpg', jpeg(800, 500)), { platform: 'linux' })).toThrow(/needs converting|too small/);
  });
});

describe('captureTry: a run', () => {
  const photo = () => file('card.jpg', jpeg(2000, 1143, exifBig(1)));

  it('prints the card read by the extractor, and never the API key', async () => {
    const lines = [];
    const code = await main([photo(), '--extractor', 'fake'], { out: l => lines.push(l), env: { ANTHROPIC_API_KEY: 'sk-test-secret-value' } });
    const text = lines.join('\n');
    expect(code).toBe(0);
    expect(text).toMatch(/captureTry · fake · model fake-v1 · prompt fake-v1/);
    expect(text).toMatch(/status ok/);
    expect(text).toMatch(/person\.fullName\s+Avery Quinn\s+confirmed/);
    expect(text).toMatch(/counts: 12 fields · 4 confirmed · 8 likely · 0 to review/);
    expect(text).not.toContain('sk-test-secret-value');
  });

  it('--json prints the CardExtraction', async () => {
    const lines = [];
    expect(await main([photo(), '--extractor', 'fake', '--json'], { out: l => lines.push(l), env: {} })).toBe(0);
    expect(JSON.parse(lines.join('\n')).version).toBe('card-extraction/v2');
  });

  it('a failure exits 1 with its code', async () => {
    const lines = [];
    expect(await main([photo(), '--extractor', 'fake', '--scenario', 'rate_limited'], { out: l => lines.push(l), env: {} })).toBe(1);
    expect(lines.join('\n')).toMatch(/FAILED rate_limited · .* attempts 2/);
  });

  it('without a key it says where to set one, and exits 1', async () => {
    const lines = [];
    expect(await main([photo()], { out: l => lines.push(l), env: {} })).toBe(1);
    expect(lines).toEqual(['captureTry: ANTHROPIC_API_KEY is not set in this environment (try --env-file=.env)']);
  });

  it('bad arguments exit 2 with usage', async () => {
    const lines = [];
    expect(await main([], { out: l => lines.push(l), env: {} })).toBe(2);
    expect(lines[0]).toMatch(/no photo given/);
  });

  it('estimates cost from the model that answered', () => {
    expect(estimateCost('claude-opus-5-5', { inputTokens: 4000, outputTokens: 800 })).toBeCloseTo(0.032, 6);
    expect(estimateCost('claude-haiku-5-5', { inputTokens: 4000, outputTokens: 800 })).toBeCloseTo(0.0008, 6);
    expect(estimateCost('fake-v1', { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(estimateCost('claude-opus-5-5', { inputTokens: null, outputTokens: 1 })).toBeNull();
  });

  it('lists only printed fields', () => {
    expect(fieldRows({
      person: { fullName: { value: 'A', extraction: { level: 'likely', score: 0.9, checks: [] } }, givenName: { value: null }, middleName: { value: null }, familyName: { value: null }, suffix: { value: null }, title: { value: null }, emails: [], phones: [], linkedinUrl: { value: null } },
      company: { name: { value: null }, domain: { value: null }, website: { value: null }, address: { value: null }, linkedinUrl: { value: null } },
    })).toEqual([['person.fullName', 'A', 'likely', 0.9, '']]);
  });
});

