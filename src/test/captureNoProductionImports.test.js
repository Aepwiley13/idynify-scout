/**
 * The capture foundation is unused by production code.
 *
 * PR 2 adds src/capture/*, two helpers in identityNormalization.js and the
 * `tldts` dependency, and claims to change no application behaviour. That
 * claim is only checkable if nothing in the app, the server functions or the
 * scripts imports them yet. Tests may. When a later PR wires capture in, it
 * updates the allow-list below on purpose, in review.
 *
 * Approved so far: two offline scripts that no shipped code imports and that
 * change no application behaviour: PR 3's read-only historical audit, and
 * PR 8's local pilot benchmark, which scores readings with the same keys.
 *
 * PR 4 adds the first capture server files (the rollout switch, captureConfig
 * and the operation store). They do not import src/capture either, and the
 * list of capture server files below is pinned so the next endpoint is added
 * deliberately.
 *
 * PR 6 adds captureExtract and its server modules. Exactly one of them, the
 * assembler, uses the PR 2 building blocks: it is the trust boundary every
 * extractor's output passes through. The endpoint and the orchestrator know
 * an extractor only through its interface; extractors.js alone names one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every source file under the given roots, as [repo-relative path, contents]. */
function sources(roots) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.netlify'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(m?js|cjs|jsx|ts|tsx|html)$/.test(entry.name)) {
        out.push([relative(repo, full).split(sep).join('/'), readFileSync(full, 'utf8')]);
      }
    }
  };
  for (const root of roots) {
    const dir = resolve(repo, root);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

const isTest = path => path.startsWith('src/test/');
const isCapture = path => path.startsWith('src/capture/');

/** Offline scripts approved, in review, to use the capture building blocks. Never shipped code. */
const APPROVED_OFFLINE_CONSUMERS = ['scripts/auditBusinessCardRecords.mjs', 'scripts/captureBenchmark.mjs'];
/** The one server module approved to use them (PR 6): CardReading → CardExtraction. */
const APPROVED_SERVER_CONSUMERS = ['netlify/functions/utils/capture/assembleExtraction.js'];
const isApproved = path => APPROVED_OFFLINE_CONSUMERS.includes(path) || APPROVED_SERVER_CONSUMERS.includes(path);

/** Production paths: everything that is not a test and not the capture modules themselves. */
const PRODUCTION = sources(['src', 'netlify', 'functions', 'scripts', 'public'])
  .concat([['index.html', readFileSync(resolve(repo, 'index.html'), 'utf8')]])
  .filter(([path]) => !isTest(path) && !isCapture(path));

describe('no production path uses the capture foundation yet', () => {
  it('nothing imports src/capture/*', () => {
    const importers = PRODUCTION
      .filter(([path]) => !isApproved(path))
      .filter(([, src]) => /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*\/capture\/(?:contract|validators|confidence|safeguards)(?:\.js)?['"]/.test(src))
      .map(([path]) => path);
    expect(importers).toEqual([]);
  });

  it('nothing imports nameKey or normalizeCapturePhone from identityNormalization', () => {
    // Matched on the import, not the bare word: an unrelated local variable
    // called `nameKey` already exists elsewhere in the app.
    const named = /import\s*\{[^}]*\b(?:nameKey|normalizeCapturePhone)\b[^}]*\}\s*from\s*['"][^'"]*identityNormalization(?:\.js)?['"]/;
    const viaObject = /\b\w+\s*\.\s*(?:nameKey|normalizeCapturePhone)\s*\(/;
    const importsModule = /['"][^'"]*identityNormalization(?:\.js)?['"]/;
    const callers = PRODUCTION
      .filter(([path]) => path !== 'src/utils/identityNormalization.js' && !isApproved(path))
      .filter(([, src]) => named.test(src) || (importsModule.test(src) && viaObject.test(src)))
      .map(([path]) => path);
    expect(callers).toEqual([]);
  });

  it('the approved consumers are offline scripts that nothing else imports', () => {
    for (const path of APPROVED_OFFLINE_CONSUMERS) {
      expect(path.startsWith('scripts/'), path).toBe(true);
      expect(existsSync(resolve(repo, path)), path).toBe(true);
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.m?js$/, '');
      const importsIt = new RegExp(`['"][^'"]*\\b${name}(?:\\.m?js)?['"]`);
      const referrers = PRODUCTION.filter(([other, src]) => other !== path && importsIt.test(src)).map(([other]) => other);
      expect(referrers, `${path} is imported by other code`).toEqual([]);
    }
  });

  it('only src/capture/validators.js imports tldts', () => {
    const importers = sources(['src', 'netlify', 'functions', 'scripts'])
      .filter(([path]) => !isTest(path))
      .filter(([, src]) => /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]tldts(?:\/[^'"]*)?['"]/.test(src))
      .map(([path]) => path);
    expect(importers).toEqual(['src/capture/validators.js']);
  });

  it('preparedImage.js imports nothing: the browser and the server run the same file', () => {
    const [[, src]] = sources(['src/capture']).filter(([path]) => path === 'src/capture/preparedImage.js');
    expect([...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1])).toEqual([]);
  });

  it('the capture modules import only each other, identityNormalization and tldts', () => {
    const capture = sources(['src/capture']);
    expect(capture.map(([path]) => path).sort()).toEqual([
      'src/capture/confidence.js', 'src/capture/contract.js', 'src/capture/preparedImage.js',
      'src/capture/safeguards.js', 'src/capture/validators.js',
    ]);
    for (const [path, src] of capture) {
      const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const specifier of specifiers) {
        expect(
          ['tldts', '../utils/identityNormalization.js'].includes(specifier) || /^\.\/(contract|validators|confidence|safeguards)\.js$/.test(specifier),
          `${path} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  // PR 4 adds the rollout switch, the config endpoint and the operation store.
  // PR 6 adds the extraction endpoint and its modules, PR 7 the claude-vision
  // extractor: no endpoint that previews or saves a card yet. A later PR adds
  // its files on purpose, in review.
  const APPROVED_CAPTURE_SERVER_FILES = [
    'netlify/functions/captureConfig.js',
    'netlify/functions/captureExtract.js',
    'netlify/functions/utils/capture/assembleExtraction.js',
    'netlify/functions/utils/capture/captureLog.js',
    'netlify/functions/utils/capture/cardReading.js',
    'netlify/functions/utils/capture/claudeVisionExtractor.js',
    'netlify/functions/utils/capture/errors.js',
    'netlify/functions/utils/capture/extractors.js',
    'netlify/functions/utils/capture/fakeExtractor.js',
    'netlify/functions/utils/capture/orchestrator.js',
    'netlify/functions/utils/captureFlags.js',
    'netlify/functions/utils/captureOperations.js',
  ];

  it('the only capture server files are the approved ones', () => {
    const functions = sources(['netlify/functions']).map(([path]) => path);
    expect(functions.filter(path => /capture/i.test(path)).sort()).toEqual([...APPROVED_CAPTURE_SERVER_FILES].sort());
  });

  it('CAPTURE_MODE is read in one place', () => {
    // scripts/captureTry.mjs (PR 7) only sets it, in the environment of its
    // own local run, so the fake extractor can be tried from a terminal.
    const flagged = PRODUCTION.filter(([, src]) => /\bCAPTURE_MODE\b/.test(src)).map(([path]) => path).sort();
    expect(flagged).toEqual(['netlify/functions/utils/captureFlags.js', 'scripts/captureTry.mjs']);
    const [[, tool]] = PRODUCTION.filter(([path]) => path === 'scripts/captureTry.mjs');
    expect([...tool.matchAll(/\bCAPTURE_MODE\b.*/g)].map(m => m[0])).toEqual(["CAPTURE_MODE: 'internal',"]);
  });
});

describe('the extraction endpoint (PR 6)', () => {
  const server = sources(['netlify/functions']).filter(([path]) => /capture/i.test(path));
  const src = path => server.find(([p]) => p === path)[1];
  const imports = text => [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
  const CAPTURE_DIR = 'netlify/functions/utils/capture/';

  it('only the assembler and the endpoint (for the image check) use src/capture', () => {
    const users = server.filter(([, text]) => imports(text).some(spec => spec.includes('/src/capture/'))).map(([path]) => path).sort();
    expect(users).toEqual(['netlify/functions/captureExtract.js', 'netlify/functions/utils/capture/assembleExtraction.js']);
    expect(imports(src('netlify/functions/captureExtract.js')).filter(spec => spec.includes('/src/capture/'))).toEqual(['../../src/capture/preparedImage.js']);
  });

  it('only the orchestrator builds a CardExtraction: no extractor and not the endpoint', () => {
    const builders = server.filter(([, text]) => imports(text).some(spec => /assembleExtraction(\.js)?$/.test(spec))).map(([path]) => path);
    expect(builders).toEqual([`${CAPTURE_DIR}orchestrator.js`]);
  });

  it('the endpoint, orchestrator and assembler are extractor-agnostic', () => {
    for (const path of ['netlify/functions/captureExtract.js', `${CAPTURE_DIR}orchestrator.js`, `${CAPTURE_DIR}assembleExtraction.js`, `${CAPTURE_DIR}cardReading.js`]) {
      const text = src(path);
      expect(text, path).not.toMatch(/anthropic|claude|google|vision|openai/i);
      expect(imports(text).filter(spec => /Extractor(\.js)?$/.test(spec)), path).toEqual([]);
    }
  });

  it('extractors are named in one place: the registry', () => {
    const naming = server.filter(([, text]) => imports(text).some(spec => /\/fakeExtractor(\.js)?$|^\.\/\w+Extractor(\.js)?$/.test(spec))).map(([path]) => path);
    expect(naming).toEqual([`${CAPTURE_DIR}extractors.js`]);
  });

  it('capture server code logs only through captureLog', () => {
    const direct = server
      .filter(([path]) => path.startsWith(CAPTURE_DIR) || path === 'netlify/functions/captureExtract.js')
      .filter(([path]) => path !== `${CAPTURE_DIR}captureLog.js`)
      .filter(([, text]) => /\bconsole\s*\./.test(text))
      .map(([path]) => path);
    expect(direct).toEqual([]);
  });
});
