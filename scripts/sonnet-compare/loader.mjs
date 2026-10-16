/**
 * Loader hooks for the capture step of the Sonnet comparison (#699).
 *
 * The capture step imports the REAL endpoint handlers, so each prompt is built
 * by the code that builds it in production. Their side effects are swapped for
 * stubs, and only for imports made from netlify/functions/:
 *
 *   @anthropic-ai/sdk          → a client whose messages.create records the request
 *   firebase-admin/app|/firestore, ./firebase-admin.js
 *                              → an in-memory Firestore holding the synthetic fixtures
 *   utils/logApiUsage.js       → a no-op (it writes usage rows to Firestore)
 *
 * compare.mjs itself imports the real SDK, which is not intercepted.
 *
 * generate-followup.js is CommonJS inside a "type": "module" package (Netlify
 * bundles it with esbuild), and Node will not let it require() the ESM
 * modules it uses. It is served as an ES module instead: each require() it
 * makes becomes an import, the two packages map to the CommonJS stubs, and
 * any other require() throws.
 */
import { readFile } from 'node:fs/promises';

const STUBS = new URL('./stubs/', import.meta.url);
const FUNCTIONS = new URL('../../netlify/functions/', import.meta.url).href;

const fromFunctions = (context) => typeof context.parentURL === 'string' && context.parentURL.startsWith(FUNCTIONS);
const stub = (name) => ({ url: new URL(name, STUBS).href, shortCircuit: true });

export async function resolve(specifier, context, next) {
  if (fromFunctions(context)) {
    if (specifier === '@anthropic-ai/sdk') return stub('anthropic.mjs');
    if (specifier === 'firebase-admin/app') return stub('firebase-admin-app.mjs');
    if (specifier === 'firebase-admin/firestore') return stub('firebase-admin-firestore.mjs');
  }
  const resolved = await next(specifier, context);
  if (fromFunctions(context)) {
    if (resolved.url === `${FUNCTIONS}firebase-admin.js`) return stub('firebase-admin-local.mjs');
    if (resolved.url === `${FUNCTIONS}utils/logApiUsage.js`) return stub('logApiUsage.mjs');
  }
  return resolved;
}

/** CommonJS source → an ES module with a require() limited to what the file asks for. */
function asModule(source) {
  const specifiers = [...new Set([...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))];
  const relative = specifiers.filter((s) => s.startsWith('.'));
  const imports = relative.map((s, i) => `import * as __dep${i} from ${JSON.stringify(s)};`).join('\n');
  const table = [
    ...relative.map((s, i) => `${JSON.stringify(s)}: __dep${i}`),
    `"@anthropic-ai/sdk": globalThis.__sonnetCompareAnthropic`,
    `"firebase-admin": globalThis.__sonnetCompareFirebaseAdmin`,
  ].join(', ');
  return `${imports}
const __modules = { ${table} };
const require = (id) => { if (id in __modules) return __modules[id]; throw new Error('capture: unexpected require ' + id); };
const module = { exports: {} };
const exports = module.exports;
${source}
export const handler = module.exports.handler;
`;
}

export async function load(url, context, next) {
  if (url === `${FUNCTIONS}generate-followup.js`) {
    return { format: 'module', source: asModule(await readFile(new URL(url), 'utf8')), shortCircuit: true };
  }
  return next(url, context);
}
