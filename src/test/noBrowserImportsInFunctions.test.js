/**
 * No Netlify Function's import graph may reach a browser-only package or
 * import.meta.env.
 *
 * Netlify bundles netlify/functions/*.js with esbuild for the Lambda
 * compatibility runtime — not Vite. Vite is what makes import.meta.env work:
 * its dev server and build step inject those values at transform time. Under
 * esbuild + plain Node, import.meta.env is simply undefined, so any module
 * that reads import.meta.env.SOMETHING crashes at cold start with
 * "Cannot read properties of undefined (reading 'SOMETHING')" — before a
 * single request is handled.
 *
 * This bit a real incident: gmail-reply-sync-worker.js imported
 * CONTACT_STATUSES from src/utils/contactStateMachine.js, which — for
 * reasons that have nothing to do with CONTACT_STATUSES itself — also
 * imports firebase/firestore and src/firebase/config.js (which reads
 * import.meta.env.VITE_FIREBASE_API_KEY at module scope to initialize the
 * browser Firebase SDK). Importing one named export still runs the WHOLE
 * module's top-level code; ES module imports are not lazy per-symbol. Three
 * functions reached this same chain: gmail-poll-replies.js,
 * gmail-reply-sync-worker.js, and process-scheduled-engagements.js, all via
 * CONTACT_STATUSES. The fix moved CONTACT_STATUSES to
 * src/constants/contactStatuses.js (zero imports), which
 * contactStateMachine.js now re-exports for its existing frontend callers.
 *
 * WHY NO EXISTING TEST CAUGHT THIS: every test for these functions either
 * mocks replyPolling.js/contactStateMachine.js directly (never touching the
 * real import graph), or runs under Vitest — which, like Vite, DOES provide
 * a working import.meta.env, masking exactly the gap that breaks in
 * production. A test that imports the real module under Vitest proves
 * nothing about this failure mode. This test instead walks the import graph
 * statically, by reading source text — the same check that would have
 * caught this before it ever shipped, and the only one immune to Vite's own
 * import.meta.env injection. See also: the separate production-equivalent
 * esbuild-bundle-and-run-under-plain-node check in
 * scripts/verifyFunctionBundlesInitialize.mjs, which proves the actual
 * runtime behavior this test's static analysis predicts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const functionsDir = resolve(repoRoot, 'netlify/functions');

const BROWSER_ONLY_PACKAGES = [
  'firebase/app', 'firebase/auth', 'firebase/firestore',
  'firebase/storage', 'firebase/analytics',
];

const IMPORT_RE = /^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/gm;
const IMPORT_META_ENV_RE = /import\.meta\.env/;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function resolveLocal(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // bare package import — checked separately
  const base = resolve(dirname(fromFile), spec);
  for (const suffix of ['', '.js', '.jsx', '/index.js', '/index.jsx']) {
    const candidate = base + suffix;
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // try the next suffix
    }
  }
  return null;
}

/**
 * Walk one entry file's import graph (local files only — node_modules
 * packages are leaves, checked by name) and report whether it reaches a
 * browser-only package or import.meta.env, with the chain that got there.
 */
function analyze(entryFile, seen = new Set(), chain = []) {
  if (seen.has(entryFile)) return { hit: false, chain: [] };
  seen.add(entryFile);

  const raw = readFileSync(entryFile, 'utf8');
  const text = stripComments(raw);

  if (IMPORT_META_ENV_RE.test(text)) {
    return { hit: true, chain: [...chain, entryFile] };
  }

  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (BROWSER_ONLY_PACKAGES.includes(spec)) {
      return { hit: true, chain: [...chain, entryFile, `[package] ${spec}`] };
    }
    const resolved = resolveLocal(entryFile, spec);
    if (!resolved) continue;
    const sub = analyze(resolved, seen, [...chain, entryFile]);
    if (sub.hit) return sub;
  }

  return { hit: false, chain: [] };
}

const functionEntryFiles = readdirSync(functionsDir)
  .filter((f) => extname(f) === '.js')
  .map((f) => resolve(functionsDir, f));

describe('No Netlify Function reaches a browser-only package or import.meta.env', () => {
  it(`scans a non-trivial number of function entry files (sanity check on the test itself)`, () => {
    expect(functionEntryFiles.length).toBeGreaterThan(50);
  });

  it.each(functionEntryFiles.map((f) => [relative(repoRoot, f), f]))(
    '%s',
    (_label, entryFile) => {
      const result = analyze(entryFile);
      if (result.hit) {
        const chain = result.chain.map((f) => f.startsWith('[package]') ? f : relative(repoRoot, f));
        throw new Error(
          `${relative(repoRoot, entryFile)} reaches a browser-only dependency via:\n  ` +
          chain.join('\n  -> ')
        );
      }
      expect(result.hit).toBe(false);
    }
  );

  it('actually detects a violation when one exists (the check can fail, not just pass)', () => {
    // A boundary test that cannot fail is decoration. tmp-probe files are
    // written and cleaned up by this test alone.
    const probeDir = resolve(repoRoot, 'src/constants');
    const probePath = resolve(probeDir, '__noBrowserImports_probe.js');
    writeFileSync(probePath, "export const bad = import.meta.env.SOMETHING;\n");
    try {
      const result = analyze(probePath);
      expect(result.hit).toBe(true);
    } finally {
      unlinkSync(probePath);
    }
  });
});
