/**
 * CH-GMAIL-001.3 — Contact Hub's Gmail integration stays out of every staging run.
 *
 * CONTACT_HUB_GMAIL, CONTACT_HUB_GMAIL_SEND and Contact Hub's own OAuth client
 * (CONTACT_HUB_GMAIL_CLIENT_ID / _SECRET / _REDIRECT_URI) are now integration keys: the
 * preflight refuses them in the env file in default, billing and Gmail runs (I5), and the
 * launchers strip them from the developer's shell, so a production secret exported there never
 * reaches a staging process. Nothing else about the runs changes.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { checkStagingEnv, INTEGRATION_KEYS } from '../../scripts/staging/stagingPreflight.mjs';
import { dropFromShell, planDevRun } from '../../scripts/staging/stagingDev.mjs';
import { dropFromShell as dropFromRehearsalShell } from '../../scripts/staging/billingRehearsal.mjs';
import { STAGING_GMAIL_PROJECT, STAGING_GMAIL_REDIRECT_URI } from '../../scripts/staging/gmailStagingMode.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/staging/stagingPreflight.mjs');
const P = STAGING_GMAIL_PROJECT;
const PROD = 'acme-production';
const NUMBER = '424242424242';
const KEY = '-----BEGIN PRIVATE KEY-----\\nSECRETKEYMATERIAL\\n-----END PRIVATE KEY-----';
const SECRET_VALUE = 'GOCSPX-CONTACTHUBPRODSECRET_0001';

const CONTACT_HUB_GMAIL_KEYS = [
  'CONTACT_HUB_GMAIL', 'CONTACT_HUB_GMAIL_SEND',
  'CONTACT_HUB_GMAIL_CLIENT_ID', 'CONTACT_HUB_GMAIL_CLIENT_SECRET', 'CONTACT_HUB_GMAIL_REDIRECT_URI',
];
const contactHubValues = () => ({
  CONTACT_HUB_GMAIL: 'on',
  CONTACT_HUB_GMAIL_SEND: 'on',
  CONTACT_HUB_GMAIL_CLIENT_ID: '111111111111-contacthubprod01.apps.googleusercontent.com',
  CONTACT_HUB_GMAIL_CLIENT_SECRET: SECRET_VALUE,
  CONTACT_HUB_GMAIL_REDIRECT_URI: 'https://idynify.com/.netlify/functions/contact-hub-gmail-callback',
});

const firebase = () => ({
  VITE_FIREBASE_API_KEY: 'AIzaSECRETWEBKEY', VITE_FIREBASE_AUTH_DOMAIN: `${P}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: P,
  VITE_FIREBASE_STORAGE_BUCKET: `${P}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: NUMBER, VITE_FIREBASE_APP_ID: `1:${NUMBER}:web:abc`,
  FIREBASE_PROJECT_ID: P, FIREBASE_CLIENT_EMAIL: `qa@${P}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: KEY,
});
const stripeTest = () => ({
  STRIPE_SECRET_KEY: 'sk_test_SECRETVALUE123', STRIPE_WEBHOOK_SECRET: 'whsec_SECRETVALUE123',
  STRIPE_PRICE_STARTER: 'price_starter123', STRIPE_PRICE_PRO: 'price_pro123', BILLING_LEDGER_EPOCH_UNIX: '1795000000',
});
const gmailClient = () => ({
  GOOGLE_CLIENT_ID: `${NUMBER}-stagingclient987.apps.googleusercontent.com`,
  GOOGLE_CLIENT_SECRET: 'GOCSPX-STAGINGSECRETvalue_123456', GOOGLE_REDIRECT_URI: STAGING_GMAIL_REDIRECT_URI,
});

const MODES = {
  default: { env: () => firebase(), opts: {} },
  billing: { env: () => ({ ...firebase(), ...stripeTest() }), opts: { billing: true } },
  gmail: {
    env: () => ({ ...firebase(), ...gmailClient() }),
    opts: { gmail: true, productionGoogleClientId: '111111111111-prodclientabc123.apps.googleusercontent.com' },
  },
};
const failing = (env, opts) => checkStagingEnv(env, { productionProjectId: PROD, ...opts }).filter((r) => !r.ok).map((r) => r.id);

describe('Contact Hub Gmail settings are integration keys', () => {
  it.each(CONTACT_HUB_GMAIL_KEYS)('%s is listed', (key) => {
    expect(INTEGRATION_KEYS).toContain(key);
  });
});

describe.each(Object.entries(MODES))('%s run', (mode, { env, opts }) => {
  it('still passes without them (nothing else changed)', () => {
    expect(failing(env(), opts)).toEqual([]);
  });

  it.each(CONTACT_HUB_GMAIL_KEYS)('refuses %s in the env file', (key) => {
    const ids = failing({ ...env(), [key]: contactHubValues()[key] }, opts);
    expect(ids).toContain('no-integrations');
    if (mode !== 'gmail') expect(ids).toEqual(['no-integrations']);
  });

  it('names the setting, never its value', () => {
    const results = checkStagingEnv({ ...env(), ...contactHubValues() }, { productionProjectId: PROD, ...opts });
    const i5 = results.find((r) => r.id === 'no-integrations');
    expect(i5.ok).toBe(false);
    for (const key of CONTACT_HUB_GMAIL_KEYS) expect(i5.message).toContain(key);
    const out = JSON.stringify(results);
    // The client id, secret and callback; the on/off switches are too short to search for.
    for (const key of ['CONTACT_HUB_GMAIL_CLIENT_ID', 'CONTACT_HUB_GMAIL_CLIENT_SECRET', 'CONTACT_HUB_GMAIL_REDIRECT_URI']) {
      expect(out).not.toContain(contactHubValues()[key]);
    }
  });

  it('an empty value is not a setting, as for every other integration key', () => {
    const blanks = Object.fromEntries(CONTACT_HUB_GMAIL_KEYS.map((k) => [k, '']));
    expect(failing({ ...env(), ...blanks }, opts)).toEqual([]);
  });
});

describe('the shell cannot carry them into a staging process', () => {
  const credential = { source: 'test', clientEmail: `qa@${P}.iam.gserviceaccount.com`, privateKey: KEY, projectId: P };
  const shellEnv = { PATH: '/bin', HOME: '/home/dev', ...contactHubValues() };

  it.each(CONTACT_HUB_GMAIL_KEYS)('stagingDev and the billing rehearsal both drop %s', (key) => {
    expect(dropFromShell(key)).toBe(true);
    expect(dropFromRehearsalShell(key)).toBe(true);
  });

  it.each([['default', false], ['gmail', true]])('a %s run starts without them', (_mode, gmail) => {
    const fileEnv = gmail ? { ...firebase(), ...gmailClient() } : firebase();
    const plan = planDevRun({ fileEnv, credential, shellEnv, checks: [], gmail });
    expect(plan.ok).toBe(true);
    for (const key of CONTACT_HUB_GMAIL_KEYS) expect(plan.childEnv).not.toHaveProperty(key);
    expect(JSON.stringify(plan.childEnv)).not.toContain(SECRET_VALUE);
    expect(plan.childEnv.PATH).toBe('/bin');
    expect(plan.childEnv.HOME).toBe('/home/dev');
  });

  it('an env file carrying them never gets a plan, because the checks refuse it', () => {
    const fileEnv = { ...firebase(), ...contactHubValues() };
    const checks = checkStagingEnv(fileEnv, { productionProjectId: PROD });
    const plan = planDevRun({ fileEnv, credential, shellEnv: {}, checks });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toContain('no-integrations');
    expect(JSON.stringify(plan.problems)).not.toContain(SECRET_VALUE);
  });
});

describe('stagingPreflight on the command line', () => {
  const run = (args, env = {}) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...env } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const writeEnv = (vars) => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-chg-'));
    const file = join(dir, '.env.staging');
    writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join('\n'));
    return file;
  };
  const checkout = () => mkdtempSync(join(tmpdir(), 'checkout-'));

  it.each([['default', [], firebase], ['billing', ['--billing'], () => ({ ...firebase(), ...stripeTest() })]])(
    'refuses a %s run whose env file holds Contact Hub Gmail, printing names only',
    (_mode, flags, base) => {
      const { status, out } = run([`--env=${writeEnv({ ...base(), ...contactHubValues() })}`, `--checkout=${checkout()}`, ...flags],
        { PRODUCTION_FIREBASE_PROJECT_ID: PROD });
      expect(status).toBe(1);
      expect(out).toContain('no-integrations');
      expect(out).toContain('CONTACT_HUB_GMAIL_CLIENT_SECRET');
      for (const value of [SECRET_VALUE, 'contacthubprod01', 'SECRETKEYMATERIAL', 'AIzaSECRETWEBKEY', 'sk_test_SECRETVALUE123']) {
        expect(out).not.toContain(value);
      }
    },
  );

  it('still passes the same run once they are removed', () => {
    const { status } = run([`--env=${writeEnv(firebase())}`, `--checkout=${checkout()}`], { PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(0);
  });
});
