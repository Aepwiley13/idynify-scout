/**
 * The functions' Admin SDK credential (netlify/functions/firebase-admin.js,
 * utils/adminCredential.js).
 *
 * Deployed: the original key-based initialization, byte for byte unchanged.
 * Only when local staging QA sets FIREBASE_ADMIN_CREDENTIALS=application-default
 * do the functions use Application Default Credentials (short-lived, no key).
 * Mixing the two, or any other value, throws at cold start.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { wantsApplicationDefaultCredentials, ADC_MODE } from '../../netlify/functions/utils/adminCredential.js';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../netlify/functions/firebase-admin.js');
// Fixture project ids, as constants (the hard-coded project id check reads literals as configuration).
const STAGING = 'acme-staging';
const PROD = 'acme-prod';

describe('wantsApplicationDefaultCredentials', () => {
  it('is false when unset or empty: the deployed default', () => {
    expect(wantsApplicationDefaultCredentials({})).toBe(false);
    expect(wantsApplicationDefaultCredentials({ FIREBASE_ADMIN_CREDENTIALS: '', FIREBASE_PRIVATE_KEY: 'k' })).toBe(false);
  });

  it('is true only for the explicit value', () => {
    expect(wantsApplicationDefaultCredentials({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE })).toBe(true);
  });

  it('refuses a private key alongside it, and any other value', () => {
    expect(() => wantsApplicationDefaultCredentials({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE, FIREBASE_PRIVATE_KEY: 'k' })).toThrow(/not both/);
    expect(() => wantsApplicationDefaultCredentials({ FIREBASE_ADMIN_CREDENTIALS: 'gcloud' })).toThrow(/must be "application-default" or unset/);
  });
});

const ORIGINAL_BLOCK = [
  '// Initialize Firebase Admin (only once)',
  'if (getApps().length === 0) {',
  '  const privateKey = process.env.FIREBASE_PRIVATE_KEY',
  "    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\\n')",
  '    : undefined;',
  '',
  '  initializeApp({',
  '    credential: cert({',
  '      projectId: requireProjectId(),',
  '      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,',
  '      privateKey: privateKey',
  '    })',
  '  });',
  '}',
].join('\n');

describe('adminGetUsers.js ("view as" loads the user through it)', () => {
  const file = resolve(dirname(ADMIN), 'adminGetUsers.js');
  it('keeps its original key-based block byte for byte, with the opt-in block before it', () => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain(ORIGINAL_BLOCK);
    expect(source.indexOf('wantsApplicationDefaultCredentials(process.env)')).toBeGreaterThan(-1);
    expect(source.indexOf('wantsApplicationDefaultCredentials(process.env)')).toBeLessThan(source.indexOf(ORIGINAL_BLOCK));
  });
});

describe('firebase-admin.js', () => {
  it('keeps the original key-based initialization block, byte for byte', () => {
    const original = [
      '// Initialize Firebase Admin (only once)',
      'if (getApps().length === 0) {',
      '  const privateKey = process.env.FIREBASE_PRIVATE_KEY',
      "    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\\n')",
      '    : undefined;',
      '',
      '  initializeApp({',
      '    credential: cert({',
      '      projectId: requireProjectId(),',
      '      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,',
      '      privateKey: privateKey',
      '    })',
      '  });',
      '}',
    ].join('\n');
    expect(readFileSync(ADMIN, 'utf8')).toContain(original);
  });

  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
    vi.doUnmock('firebase-admin/app');
    vi.doUnmock('firebase-admin/auth');
    vi.doUnmock('firebase-admin/firestore');
  });

  // Loads the real module with the SDK mocked; returns every initializeApp call.
  const load = async (env) => {
    process.env = { ...saved };
    for (const k of ['FIREBASE_ADMIN_CREDENTIALS', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PROJECT_ID']) delete process.env[k];
    Object.assign(process.env, env);
    const apps = [];
    const initializeApp = vi.fn((options) => { apps.push(options); });
    vi.doMock('firebase-admin/app', () => ({
      initializeApp, getApps: () => apps, cert: (c) => ({ kind: 'cert', ...c }), applicationDefault: () => ({ kind: 'adc' }),
    }));
    vi.doMock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));
    vi.doMock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
    await import('../../netlify/functions/firebase-admin.js');
    return initializeApp.mock.calls.map(([options]) => options);
  };

  it('deployed configuration: one initialization, with the key, as before', async () => {
    const calls = await load({ FIREBASE_PROJECT_ID: PROD, FIREBASE_CLIENT_EMAIL: `svc@${PROD}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: 'a\\nb' });
    expect(calls).toEqual([{ credential: { kind: 'cert', projectId: PROD, clientEmail: `svc@${PROD}.iam.gserviceaccount.com`, privateKey: 'a\nb' } }]);
  });

  it('local staging QA with short-lived credentials: one initialization, with ADC and the project', async () => {
    const calls = await load({ FIREBASE_PROJECT_ID: STAGING, FIREBASE_ADMIN_CREDENTIALS: ADC_MODE });
    expect(calls).toEqual([{ credential: { kind: 'adc' }, projectId: STAGING }]);
  });

  it('still refuses to start without FIREBASE_PROJECT_ID, in either mode', async () => {
    await expect(load({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE })).rejects.toThrow(/FIREBASE_PROJECT_ID is not set/);
    await expect(load({ FIREBASE_PRIVATE_KEY: 'k' })).rejects.toThrow(/FIREBASE_PROJECT_ID is not set/);
  });

  it('refuses a mixed configuration at cold start', async () => {
    await expect(load({ FIREBASE_PROJECT_ID: STAGING, FIREBASE_ADMIN_CREDENTIALS: ADC_MODE, FIREBASE_PRIVATE_KEY: 'k' })).rejects.toThrow(/not both/);
  });
});
