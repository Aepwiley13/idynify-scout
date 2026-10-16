/**
 * Capture step: run each real endpoint handler on the synthetic fixtures and
 * record the exact request it would send to Claude.
 *
 * Requires loader.mjs to be registered (compare.mjs does this first). Nothing
 * here reaches the network or Firestore: the SDK and Firestore are stubs, and
 * fetch answers only the auth lookup the handlers make.
 */
import { captureState } from './stubs/state.mjs';
import { db } from './stubs/firestore.mjs';
import AnthropicStub from './stubs/anthropic.mjs';
import { CASES, DOCS, USER_ID } from './fixtures.mjs';

/** The one call the handlers make before Claude: Firebase's token lookup. */
async function captureFetch(url) {
  if (String(url).startsWith('https://identitytoolkit.googleapis.com/')) {
    return new Response(JSON.stringify({ users: [{ localId: USER_ID }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`capture is offline; refused fetch to ${new URL(String(url)).host}`);
}

function installStubs() {
  const state = captureState();
  state.docs = new Map(Object.entries(DOCS));
  globalThis.__sonnetCompareAnthropic = AnthropicStub;
  globalThis.__sonnetCompareFirebaseAdmin = {
    apps: [{}],
    initializeApp: () => ({}),
    credential: { cert: () => ({}) },
    firestore: Object.assign(() => db, { FieldValue: {} }),
    auth: () => ({ verifyIdToken: async () => ({ uid: USER_ID }) }),
  };
  // Handlers refuse to run without these. Placeholders only: nothing they
  // configure is reached during capture. A real value in your shell is left
  // alone, and every placeholder is removed again before the comparison runs,
  // so the real client can never pick one up.
  const placeholders = {
    ANTHROPIC_API_KEY: 'capture-placeholder', FIREBASE_API_KEY: 'capture-placeholder',
    FIREBASE_PRIVATE_KEY: 'capture-placeholder', FIREBASE_CLIENT_EMAIL: 'capture-placeholder',
    FIREBASE_PROJECT_ID: 'demo-sonnet-compare',
  };
  const set = Object.keys(placeholders).filter((name) => process.env[name] === undefined);
  for (const name of set) process.env[name] = placeholders[name];
  return () => { for (const name of set) delete process.env[name]; };
}

/** Run `fn` with console output held back, so handler logs don't flood the report. */
async function quietly(fn, verbose) {
  if (verbose) return fn();
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

/**
 * @param {{ verbose?: boolean, only?: string[] }} options
 * @returns {Promise<Array<{ site, file, label, request }>>} one entry per Claude request
 */
export async function captureRequests({ verbose = false, only = null } = {}) {
  const removePlaceholders = installStubs();
  const realFetch = globalThis.fetch;
  globalThis.fetch = captureFetch;
  const captured = [];
  const missing = [];
  try {
    for (const c of CASES) {
      if (only && !only.includes(c.site)) continue;
      const mod = await import(new URL(`../../netlify/functions/${c.file}`, import.meta.url).href);
      const handler = mod.handler ?? mod.default?.handler;
      const state = captureState();
      const before = state.requests.length;
      await quietly(() => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(c.body) }), verbose);
      const sent = state.requests.slice(before);
      if (sent.length === 0) missing.push(`${c.site} / ${c.label}`);
      for (const request of sent) captured.push({ site: c.site, file: c.file, label: c.label, request });
    }
  } finally {
    globalThis.fetch = realFetch;
    removePlaceholders();
  }
  if (missing.length) {
    throw new Error(`these cases sent no Claude request (fixture off-topic or handler changed):\n  ${missing.join('\n  ')}`);
  }
  return captured;
}
