/**
 * The functions' Admin SDK credential (netlify/functions/utils/adminCredential.js).
 *
 * Default, as deployed: the service account from FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY, exactly as before. Only when local staging QA sets
 * FIREBASE_ADMIN_CREDENTIALS=application-default do the functions use
 * Application Default Credentials (short-lived, no key). Mixing the two, or
 * any other value, throws at cold start.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import process from 'node:process';
import { adminAppOptions, ADC_MODE } from '../../netlify/functions/utils/adminCredential.js';

// Fixture project ids, as constants (the hard-coded project id check reads literals as configuration).
const STAGING = 'acme-staging';
const PROD = 'acme-prod';
const sdk = () => ({
  cert: vi.fn((c) => ({ kind: 'cert', ...c })),
  applicationDefault: vi.fn(() => ({ kind: 'adc' })),
  projectId: STAGING,
});

describe('adminAppOptions', () => {
  it('by default uses the service-account key, exactly as before (escaped newlines restored)', () => {
    const s = sdk();
    const options = adminAppOptions({ FIREBASE_CLIENT_EMAIL: 'svc@acme.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'a\\nb' }, s);
    expect(options).toEqual({ credential: { kind: 'cert', projectId: STAGING, clientEmail: 'svc@acme.iam.gserviceaccount.com', privateKey: 'a\nb' } });
    expect(s.applicationDefault).not.toHaveBeenCalled();
  });

  it('passes an unset key through as before (cert decides), and treats an empty mode as unset', () => {
    const s = sdk();
    expect(adminAppOptions({ FIREBASE_ADMIN_CREDENTIALS: '' }, s).credential).toMatchObject({ kind: 'cert', privateKey: undefined });
  });

  it('uses Application Default Credentials only when explicitly asked, with the project id', () => {
    const s = sdk();
    expect(adminAppOptions({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE }, s)).toEqual({ credential: { kind: 'adc' }, projectId: STAGING });
    expect(s.cert).not.toHaveBeenCalled();
  });

  it('refuses both at once, and any other mode', () => {
    expect(() => adminAppOptions({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE, FIREBASE_PRIVATE_KEY: 'k' }, sdk())).toThrow(/not both/);
    expect(() => adminAppOptions({ FIREBASE_ADMIN_CREDENTIALS: 'gcloud' }, sdk())).toThrow(/must be "application-default" or unset/);
  });
});

describe('firebase-admin.js wiring', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
    vi.doUnmock('firebase-admin/app');
    vi.doUnmock('firebase-admin/auth');
    vi.doUnmock('firebase-admin/firestore');
  });

  const load = async (env) => {
    process.env = { ...saved, ...env };
    for (const k of ['FIREBASE_ADMIN_CREDENTIALS', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL']) if (!(k in env)) delete process.env[k];
    const initializeApp = vi.fn();
    vi.doMock('firebase-admin/app', () => ({
      initializeApp, getApps: () => [], cert: (c) => ({ kind: 'cert', ...c }), applicationDefault: () => ({ kind: 'adc' }),
    }));
    vi.doMock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));
    vi.doMock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
    await import('../../netlify/functions/firebase-admin.js');
    return initializeApp.mock.calls[0][0];
  };

  it('deployed configuration: initializes with the key', async () => {
    const options = await load({ FIREBASE_PROJECT_ID: PROD, FIREBASE_CLIENT_EMAIL: `svc@${PROD}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: 'k' });
    expect(options).toEqual({ credential: { kind: 'cert', projectId: PROD, clientEmail: `svc@${PROD}.iam.gserviceaccount.com`, privateKey: 'k' } });
  });

  it('local staging QA with short-lived credentials: initializes with ADC and the project', async () => {
    const options = await load({ FIREBASE_PROJECT_ID: STAGING, FIREBASE_ADMIN_CREDENTIALS: ADC_MODE });
    expect(options).toEqual({ credential: { kind: 'adc' }, projectId: STAGING });
  });

  it('still refuses to start without FIREBASE_PROJECT_ID', async () => {
    await expect(load({ FIREBASE_PROJECT_ID: '', FIREBASE_ADMIN_CREDENTIALS: ADC_MODE })).rejects.toThrow(/FIREBASE_PROJECT_ID is not set/);
  });
});
