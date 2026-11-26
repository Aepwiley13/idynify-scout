/**
 * CH-GMAIL-001.5 — the Gmail send and reply functions use the shared Firebase Admin init.
 *
 * gmail-send-quick, gmail-send, gmail-send-wave, gmail-get-thread, gmail-poll-replies and
 * check-replies each built their own Admin app from FIREBASE_PRIVATE_KEY, so they could not run on
 * staging's keyless short-lived credentials. They now take `db` from netlify/functions/firebase-admin.js,
 * which already serves both configurations. This pins, for each function:
 *   - production (FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL): one app, from cert(), with the same
 *     project, client email and key as before (escaped newlines restored);
 *   - staging (FIREBASE_ADMIN_CREDENTIALS=application-default, no key): one app, from
 *     applicationDefault(), and cert() never called;
 *   - both at once is still refused by the shared guard;
 *   - no function builds its own app any more.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const FUNCTIONS = ['gmail-send-quick', 'gmail-send', 'gmail-send-wave', 'gmail-get-thread', 'gmail-poll-replies', 'check-replies'];
const PROD = 'acme-prod';
const STAGING = 'acme-staging';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../netlify/functions');

const h = vi.hoisted(() => ({ apps: [], initializeApp: null, cert: null, applicationDefault: null }));
vi.mock('firebase-admin/app', () => {
  h.initializeApp = vi.fn((options) => { const app = { options }; h.apps.push(app); return app; });
  h.cert = vi.fn((params) => ({ kind: 'cert', params }));
  h.applicationDefault = vi.fn(() => ({ kind: 'application-default' }));
  return {
    getApps: () => h.apps,
    initializeApp: (...a) => h.initializeApp(...a),
    cert: (...a) => h.cert(...a),
    applicationDefault: (...a) => h.applicationDefault(...a),
  };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: vi.fn() }) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: vi.fn(), doc: vi.fn() }),
  FieldValue: { serverTimestamp: () => 'ts', increment: (n) => n, arrayUnion: (...a) => a, delete: () => 'del' },
  Timestamp: { now: () => ({ toMillis: () => 0 }), fromDate: (d) => d, fromMillis: (m) => m },
}));

const ENV_KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_ADMIN_CREDENTIALS', 'FIRESTORE_EMULATOR_HOST', 'GOOGLE_APPLICATION_CREDENTIALS'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  h.apps.length = 0;
  h.initializeApp?.mockClear(); h.cert?.mockClear(); h.applicationDefault?.mockClear();
  vi.resetModules();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('no Gmail function builds its own Firebase app', () => {
  it.each(FUNCTIONS)('%s imports the shared init and holds no key handling', (name) => {
    const source = readFileSync(resolve(DIR, `${name}.js`), 'utf8');
    expect(source).toContain("from './firebase-admin.js'");
    expect(source).not.toMatch(/\binitializeApp\b|\bcert\(|FIREBASE_PRIVATE_KEY|getFirestore\(/);
  });
});

describe('production credentials (service-account key)', () => {
  it.each(FUNCTIONS)('%s runs on one app built from cert() with the same values as before', async (name) => {
    process.env.FIREBASE_PROJECT_ID = 'acme-prod';
    process.env.FIREBASE_CLIENT_EMAIL = 'svc@acme-prod.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n';
    const mod = await import(`../../netlify/functions/${name}.js`);
    expect(typeof mod.handler).toBe('function');
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.applicationDefault).not.toHaveBeenCalled();
    expect(h.cert).toHaveBeenCalledWith({
      projectId: PROD,
      clientEmail: 'svc@acme-prod.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
    });
    expect(h.initializeApp.mock.calls[0][0].credential).toEqual({ kind: 'cert', params: expect.any(Object) });
  });
});

describe('staging short-lived credentials (no key)', () => {
  it.each(FUNCTIONS)('%s runs on one app built from applicationDefault(), and never touches cert()', async (name) => {
    process.env.FIREBASE_PROJECT_ID = 'acme-staging';
    process.env.FIREBASE_CLIENT_EMAIL = 'qa@acme-staging.iam.gserviceaccount.com';
    process.env.FIREBASE_ADMIN_CREDENTIALS = 'application-default';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/staging-adc.json';
    const mod = await import(`../../netlify/functions/${name}.js`);
    expect(typeof mod.handler).toBe('function');
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
    expect(h.initializeApp).toHaveBeenCalledWith({ credential: { kind: 'application-default' }, projectId: STAGING });
    expect(h.cert).not.toHaveBeenCalled();
  });

  it('a key and short-lived credentials together are still refused by the shared guard', async () => {
    process.env.FIREBASE_PROJECT_ID = 'acme-staging';
    process.env.FIREBASE_ADMIN_CREDENTIALS = 'application-default';
    process.env.FIREBASE_PRIVATE_KEY = 'x';
    await expect(import('../../netlify/functions/gmail-send-quick.js')).rejects.toThrow(/not both/);
    expect(h.initializeApp).not.toHaveBeenCalled();
  });
});

describe('several Gmail functions in one runtime', () => {
  it('share a single app instead of each creating one', async () => {
    process.env.FIREBASE_PROJECT_ID = 'acme-staging';
    process.env.FIREBASE_ADMIN_CREDENTIALS = 'application-default';
    for (const name of FUNCTIONS) await import(`../../netlify/functions/${name}.js`);
    expect(h.initializeApp).toHaveBeenCalledTimes(1);
  });
});
