/**
 * Minimal Node loader for the Phase 5 verification script.
 *
 * The harness has to import the REAL `Signup.jsx` — that is the entire point of
 * it — and Node cannot load `.jsx` or the component's `.css` import on its own.
 * Vite normally does this, but Vite is a dev server and this runs headless.
 *
 * So: transform JSX with esbuild (already present as a Vite dependency, so no
 * new package), and resolve CSS imports to an empty module. Nothing else is
 * intercepted, so the component under test is the real one in every respect
 * that matters to Phase 5.
 *
 * Deliberately not a build step and not wired into anything — it exists only
 * for `scripts/phase5-verification.mjs`.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const JSX = /\.jsx$/;
const CSS = /\.css$/;

export async function resolve(specifier, context, next) {
  if (CSS.test(specifier)) {
    // Styles are irrelevant to what this verifies, and jsdom cannot parse them.
    return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  }

  try {
    return await next(specifier, context);
  } catch (err) {
    // Vite resolves extensionless relative imports; Node does not. The app is
    // full of `../firebase/config`, so try the extensions Vite would.
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw err;
    for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
      try { return await next(specifier + ext, context); } catch { /* next candidate */ }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (JSX.test(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { code } = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      target: 'node22',
      jsx: 'automatic',
      sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return next(url, context);
}
