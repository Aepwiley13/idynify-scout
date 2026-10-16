#!/usr/bin/env node
/**
 * captureTry — read one real business-card photo the way captureExtract does,
 * from your own machine, and print what came back.
 *
 *   node --env-file=.env scripts/captureTry.mjs <photo> [options]
 *
 *     --model <id>          CAPTURE_EXTRACT_MODEL for this run (default claude-opus-5-5)
 *     --effort <level>      low | medium | high (default low)
 *     --extractor <id>      claude-vision (default) or fake
 *     --scenario <name>     a fake scenario (with --extractor fake)
 *     --json                print the whole CardExtraction as JSON
 *     --save-prepared <f>   also write the prepared JPEG that was sent, to check it
 *
 * The same code path as the endpoint, minus Firebase: the extractor registry,
 * the orchestrator (deadline, one retry), the reading check and the assembler
 * (validators, safeguards, confidence). ANTHROPIC_API_KEY comes from your
 * environment (for example --env-file=.env); it is never printed.
 *
 * The photo is prepared like card-image/v1 in the app: JPEG, long edge at most
 * 2000 px, at most 1.5 MB, upright, metadata stripped. A JPEG already inside
 * those limits is used as it is. Anything else (HEIC, PNG, a 12 MP photo, a
 * rotated JPEG) is converted with macOS's built-in `sips`; on other systems,
 * resize it to a JPEG first. Quality preflight (blur, glare, dark) runs only
 * in the browser, so it is not measured here.
 *
 * LOCAL ONLY. The card's values are printed to this terminal and nowhere else:
 * nothing is logged, stored, or sent anywhere but the extractor. Do not paste
 * the output into a ticket or a commit; per-card results stay on your machine.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import {
  PREPARED_IMAGE_VERSION, MAX_LONG_EDGE_PX, MIN_SHORT_EDGE_PX, MAX_BYTES,
  readJpegHeader, stripJpegMetadata, encodeBase64, checkPreparedImage,
} from '../src/capture/preparedImage.js';
import { resolveExtractor } from '../netlify/functions/utils/capture/extractors.js';
import { runExtraction } from '../netlify/functions/utils/capture/orchestrator.js';

/** $ per million tokens, input / output (prompts under 100K tokens). */
export const PRICES = Object.freeze({
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
});

// ─── Arguments ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { extractor: 'claude-vision', json: false };
  const flags = { '--model': 'model', '--effort': 'effort', '--extractor': 'extractor', '--scenario': 'scenario', '--save-prepared': 'savePrepared' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (flags[arg]) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      options[flags[arg]] = argv[++i];
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (!options.photo) options.photo = arg;
    else throw new Error('one photo at a time');
  }
  if (!options.photo) throw new Error('no photo given');
  return options;
}

// ─── Preparing the photo ────────────────────────────────────────────────────

/** The EXIF orientation (1–8) of a JPEG, or 1 when it has none. */
export function exifOrientation(bytes) {
  const header = readJpegHeader(bytes);
  if (!header) return 1;
  for (const [marker, start, end] of header.segments) {
    if (marker !== 0xE1) continue;
    const seg = bytes.subarray(start + 4, end);
    if (String.fromCharCode(...seg.subarray(0, 6)) !== 'Exif\0\0') continue;
    const tiff = seg.subarray(6);
    const little = tiff[0] === 0x49 && tiff[1] === 0x49;
    const u16 = at => (little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1]);
    const u32 = at => (little
      ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16) | (tiff[at + 3] << 24)) >>> 0
      : ((tiff[at] << 24) | (tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]) >>> 0);
    if (tiff.length < 8) return 1;
    const ifd = u32(4);
    if (ifd + 2 > tiff.length) return 1;
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  }
  return 1;
}

/** Clockwise degrees that make a photo with this EXIF orientation upright (mirrored ones are not handled). */
export const ROTATION = Object.freeze({ 1: 0, 3: 180, 6: 90, 8: 270 });

/** Can this file be sent as it is (after stripping metadata)? */
export function usableAsIs(bytes) {
  const header = readJpegHeader(bytes);
  if (!header) return false;
  const long = Math.max(header.width, header.height);
  const short = Math.min(header.width, header.height);
  return long <= MAX_LONG_EDGE_PX && short >= MIN_SHORT_EDGE_PX && bytes.length <= MAX_BYTES && exifOrientation(bytes) === 1;
}

function sips(args) {
  const run = spawnSync('sips', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`sips failed (${run.status ?? run.error?.code})`);
  return run.stdout;
}

/** Convert, turn upright and shrink with macOS sips, into a JPEG inside the card-image/v1 limits. */
function prepareWithSips(path) {
  const dir = mkdtempSync(join(tmpdir(), 'capture-try-'));
  try {
    const upright = join(dir, 'upright.jpg');
    sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', path, '--out', upright]);
    const orientation = exifOrientation(readFileSync(upright));
    const degrees = ROTATION[orientation];
    if (degrees === undefined) throw new Error(`mirrored EXIF orientation ${orientation} is not handled; rotate the photo first`);
    if (degrees) sips(['-r', String(degrees), upright]);

    const { width, height } = readJpegHeader(readFileSync(upright));
    for (const [longEdge, quality] of [[2000, 85], [2000, 75], [1600, 80]]) {
      const out = join(dir, `card-${longEdge}-${quality}.jpg`);
      const resize = Math.max(width, height) > longEdge ? ['-Z', String(longEdge)] : [];
      sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), ...resize, upright, '--out', out]);
      const bytes = new Uint8Array(readFileSync(out));
      if (bytes.length <= MAX_BYTES) return { bytes, note: `converted with sips (orientation ${orientation}, long edge ${longEdge}, quality ${quality})` };
    }
    throw new Error('could not get the photo under 1.5 MB');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The photo as a card-image/v1, checked exactly as the server checks it. */
export function preparePhoto(path, { platform = process.platform } = {}) {
  const original = new Uint8Array(readFileSync(path));
  let prepared;
  if (usableAsIs(original)) prepared = { bytes: original, note: 'used as it is' };
  else if (platform === 'darwin') prepared = prepareWithSips(path);
  else throw new Error('this photo needs converting: resize it to a JPEG with a long edge of at most 2000 px and under 1.5 MB, upright, and try again');

  const stripped = stripJpegMetadata(prepared.bytes);
  if (!stripped) throw new Error('not a JPEG after preparation');
  const { width, height } = readJpegHeader(stripped.bytes);
  if (Math.min(width, height) < MIN_SHORT_EDGE_PX) throw new Error(`too small to read: ${width}×${height}`);
  const image = {
    version: PREPARED_IMAGE_VERSION, mimeType: 'image/jpeg', data: encodeBase64(stripped.bytes), bytes: stripped.bytes.length,
    widthPx: width, heightPx: height,
    preflight: { blur: 0, brightness: 0, glareRatio: 0, warnings: [], userOverrode: false },
  };
  const check = checkPreparedImage(image);
  if (!check.ok) throw new Error(`the server would refuse this image: ${check.reason}`);
  return { image, jpeg: stripped.bytes, note: prepared.note, metadataRemoved: stripped.removed };
}

// ─── Running it ─────────────────────────────────────────────────────────────

/**
 * The environment one local run builds its extractor from: yours, plus the
 * extractor, model, effort and fake scenario chosen on the command line. The
 * capture mode is internal only so that the fake can be tried; it reaches no
 * deploy. Shared with captureBenchmark.
 */
export function extractorEnv({ extractor = 'claude-vision', model, effort, scenario } = {}, env = process.env) {
  return {
    ...env,
    CAPTURE_MODE: 'internal',
    CAPTURE_EXTRACTOR: extractor,
    ...(model ? { CAPTURE_EXTRACT_MODEL: model } : {}),
    ...(effort ? { CAPTURE_EXTRACT_EFFORT: effort } : {}),
    ...(scenario ? { CAPTURE_FAKE_SCENARIO: scenario } : {}),
  };
}

export function estimateCost(modelId, usage) {
  const price = PRICES[modelId];
  if (!price || usage.inputTokens === null || usage.outputTokens === null) return null;
  return (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1e6;
}

const pad = (value, width) => String(value ?? '').slice(0, width).padEnd(width);

/** The fields of a CardExtraction as printable rows. */
export function fieldRows(extraction) {
  const rows = [];
  const add = (path, f) => {
    if (f.value === null) return;
    rows.push([path, f.value, f.extraction.level, f.extraction.score, f.extraction.checks.join(',')]);
  };
  const { person, company } = extraction;
  for (const key of ['fullName', 'givenName', 'middleName', 'familyName', 'suffix', 'title']) add(`person.${key}`, person[key]);
  person.emails.forEach((f, i) => add(`person.emails[${i}] (${f.kind})`, f));
  person.phones.forEach((f, i) => add(`person.phones[${i}] (${f.kind.value ?? 'no label'}${f.extension ? ` x${f.extension}` : ''})`, f));
  add('person.linkedinUrl', person.linkedinUrl);
  for (const key of ['name', 'domain', 'website', 'address', 'linkedinUrl']) add(`company.${key}`, company[key]);
  return rows;
}

export async function main(argv = process.argv.slice(2), { out = console.log, env = process.env } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out(`captureTry: ${error.message}\nusage: node --env-file=.env scripts/captureTry.mjs <photo> [--model id] [--effort low|medium|high] [--extractor claude-vision|fake] [--scenario name] [--json] [--save-prepared file]`);
    return 2;
  }

  let prepared;
  try {
    prepared = preparePhoto(options.photo);
  } catch (error) {
    out(`captureTry: ${error.message}`);
    return 1;
  }
  if (options.savePrepared) writeFileSync(options.savePrepared, prepared.jpeg);

  let extractor;
  try {
    extractor = resolveExtractor(extractorEnv(options, env));
  } catch {
    out(options.extractor === 'claude-vision' && !env.ANTHROPIC_API_KEY
      ? 'captureTry: ANTHROPIC_API_KEY is not set in this environment (try --env-file=.env)'
      : `captureTry: the ${options.extractor} extractor could not be built with these settings`);
    return 1;
  }

  const startedAt = Date.now();
  const result = await runExtraction({ extractor, image: prepared.image, operationId: `cap_${randomUUID()}`, startedAt });
  const modelId = result.modelId ?? extractor.modelId;
  const cost = estimateCost(modelId, result.usage);
  const { image } = prepared;

  if (options.json && result.ok) {
    out(JSON.stringify(result.extraction, null, 2));
    return 0;
  }
  out(`captureTry · ${extractor.id} · model ${extractor.modelId}${modelId !== extractor.modelId ? ` (answered by ${modelId})` : ''} · prompt ${extractor.promptVersion}${extractor.effort ? ` · effort ${extractor.effort}` : ''}`);
  out(`image ${image.widthPx}×${image.heightPx} · ${(image.bytes / 1024).toFixed(0)} KB · ${prepared.note} · metadata segments removed: ${prepared.metadataRemoved}`);
  out(`${result.ok ? `status ${result.extraction.capture.status}` : `FAILED ${result.code}${result.reason ? ` (${result.reason})` : ''}`} · ${((Date.now() - startedAt) / 1000).toFixed(1)} s · attempts ${result.attempts} · tokens in ${result.usage.inputTokens ?? '–'} / out ${result.usage.outputTokens ?? '–'}${cost === null ? '' : ` · est. $${cost.toFixed(4)}`}`);
  if (!result.ok) return 1;
  if (result.extraction.capture.status === 'no_text') out('(the endpoint answers 422 no_text and the scan fails: retake)');

  out('');
  out(`${pad('field', 34)} ${pad('value', 44)} ${pad('level', 10)} ${pad('score', 6)} checks`);
  for (const [path, value, level, score, checks] of fieldRows(result.extraction)) {
    out(`${pad(path, 34)} ${pad(value, 44)} ${pad(level, 10)} ${pad(score, 6)} ${checks}`);
  }
  const { counts } = result.extraction.capture;
  out('');
  out(`counts: ${counts.fields} fields · ${counts.confirmed} confirmed · ${counts.likely} likely · ${counts.possible} to review`);
  out(`company safeguards: ${result.extraction.company.safeguards.join(', ') || 'none'}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
