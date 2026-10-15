/**
 * The capture foundation is unused by production code.
 *
 * PR 2 adds src/capture/*, two helpers in identityNormalization.js and the
 * `tldts` dependency, and claims to change no application behaviour. That
 * claim is only checkable if nothing in the app, the server functions or the
 * scripts imports them yet. Tests may. When a later PR wires capture in, it
 * updates the allow-list below on purpose, in review.
 *
 * Approved so far: one offline, read-only script (PR 3's historical audit),
 * which no shipped code imports. It changes no application behaviour.
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
const APPROVED_OFFLINE_CONSUMERS = ['scripts/auditBusinessCardRecords.mjs'];
const isApproved = path => APPROVED_OFFLINE_CONSUMERS.includes(path);

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

  it('the capture modules import only each other, identityNormalization and tldts', () => {
    const capture = sources(['src/capture']);
    expect(capture.map(([path]) => path).sort()).toEqual([
      'src/capture/confidence.js', 'src/capture/contract.js', 'src/capture/safeguards.js', 'src/capture/validators.js',
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

  it('no capture endpoint or flag exists', () => {
    const functions = sources(['netlify/functions']).map(([path]) => path);
    expect(functions.filter(path => /capture/i.test(path))).toEqual([]);
    const flagged = PRODUCTION.filter(([, src]) => /\bCAPTURE_MODE\b/.test(src)).map(([path]) => path);
    expect(flagged).toEqual([]);
  });
});
