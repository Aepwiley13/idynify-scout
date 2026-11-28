/**
 * CH-GMAIL-001.2 — the staging tools' --gmail mode.
 *
 * Staging refuses every Google OAuth key (stagingPreflight.mjs, I5). A Gmail run now allows the
 * three GOOGLE_* variables, and nothing else, for a dedicated staging client in idynify-staging,
 * with production's client and project refused and the callback pinned to the local launcher.
 * The default and billing runs are unchanged.
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
import {
  checkGmailStagingMode, clientProjectNumber, GMAIL_STAGING_KEYS, STAGING_GMAIL_PROJECT,
  STAGING_GMAIL_REDIRECT_URI, GMAIL_RUN_FORBIDDEN, dropFromShellForGmail,
} from '../../scripts/staging/gmailStagingMode.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/staging/stagingPreflight.mjs');
const P = STAGING_GMAIL_PROJECT;
const PROD = 'acme-production';
const STAGING_NUMBER = '424242424242';
const PROD_NUMBER = '111111111111';
const KEY = '-----BEGIN PRIVATE KEY-----\\nSECRETKEYMATERIAL\\n-----END PRIVATE KEY-----';
const PROD_CLIENT = `${PROD_NUMBER}-prodclientabc123.apps.googleusercontent.com`;
const STAGING_CLIENT = `${STAGING_NUMBER}-stagingclient987.apps.googleusercontent.com`;
const SECRET = 'GOCSPX-STAGINGSECRETvalue_123456';

const firebase = (project = P, sender = STAGING_NUMBER) => ({
  VITE_FIREBASE_API_KEY: 'AIzaSECRETWEBKEY', VITE_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: project,
  VITE_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: sender, VITE_FIREBASE_APP_ID: `1:${sender}:web:abc`,
  FIREBASE_PROJECT_ID: project, FIREBASE_CLIENT_EMAIL: `qa@${project}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: KEY,
});
const gmailClient = (over = {}) => ({
  GOOGLE_CLIENT_ID: STAGING_CLIENT, GOOGLE_CLIENT_SECRET: SECRET, GOOGLE_REDIRECT_URI: STAGING_GMAIL_REDIRECT_URI, ...over,
});
const stripeTest = () => ({
  STRIPE_SECRET_KEY: 'sk_test_SECRETVALUE123', STRIPE_WEBHOOK_SECRET: 'whsec_SECRETVALUE123',
  STRIPE_PRICE_STARTER: 'price_starter123', STRIPE_PRICE_PRO: 'price_pro123', BILLING_LEDGER_EPOCH_UNIX: '1795000000',
});

const gmailRun = { gmail: true, productionGoogleClientId: PROD_CLIENT };
const failing = (env, opts = {}) => checkStagingEnv(env, { productionProjectId: PROD, ...opts }).filter((r) => !r.ok).map((r) => r.id);

// ── Default and billing runs are unchanged ──────────────────────────────────────────────────

describe('without --gmail, staging is unchanged', () => {
  it('passes the same isolated setup as before', () => {
    expect(failing(firebase())).toEqual([]);
  });

  it('still refuses every Google OAuth key, even a valid staging client', () => {
    expect(failing({ ...firebase(), ...gmailClient() })).toEqual(['no-integrations']);
    for (const k of GMAIL_STAGING_KEYS) expect(INTEGRATION_KEYS).toContain(k);
  });

  it('adds none of the Gmail-mode checks', () => {
    const ids = checkStagingEnv(firebase(), { productionProjectId: PROD }).map((r) => r.id);
    expect(ids.some((id) => id.startsWith('gmail-'))).toBe(false);
  });

  it('a production client id in the options changes nothing unless --gmail is set', () => {
    expect(failing(firebase(), { productionGoogleClientId: PROD_CLIENT })).toEqual([]);
  });
});

describe('--billing is unchanged', () => {
  it('still passes a Stripe test-mode run', () => {
    expect(failing({ ...firebase(), ...stripeTest() }, { billing: true })).toEqual([]);
  });

  it('still refuses the Google OAuth client in a billing run', () => {
    expect(failing({ ...firebase(), ...stripeTest(), ...gmailClient() }, { billing: true })).toEqual(['no-integrations']);
  });

  it('a Gmail run does not admit Stripe', () => {
    expect(failing({ ...firebase(), ...gmailClient(), ...stripeTest() }, gmailRun)).toEqual(['no-integrations']);
  });
});

// ── --gmail ─────────────────────────────────────────────────────────────────────────────────

describe('--gmail accepts a valid staging setup', () => {
  it('passes idynify-staging with its own OAuth client and the exact callback', () => {
    expect(failing({ ...firebase(), ...gmailClient() }, gmailRun)).toEqual([]);
  });

  it('reads the owning Google Cloud project from the client id', () => {
    expect(clientProjectNumber(STAGING_CLIENT)).toBe(STAGING_NUMBER);
    expect(clientProjectNumber('not-a-client')).toBeNull();
    expect(clientProjectNumber(undefined)).toBeNull();
  });

  it('accepts dry_run for the ingestion mode, which is its fail-safe default', () => {
    expect(failing({ ...firebase(), ...gmailClient(), GMAIL_IDENTITY_MODE: 'dry_run' }, gmailRun)).toEqual([]);
  });
});

describe('--gmail rejects production credentials', () => {
  it('the production client id itself', () => {
    expect(failing({ ...firebase(), ...gmailClient({ GOOGLE_CLIENT_ID: PROD_CLIENT }) }, gmailRun))
      .toEqual(expect.arrayContaining(['gmail-not-production-client', 'gmail-dedicated-client']));
  });

  it('another client from the production Google Cloud project', () => {
    const sibling = `${PROD_NUMBER}-anotherclient55.apps.googleusercontent.com`;
    expect(failing({ ...firebase(), ...gmailClient({ GOOGLE_CLIENT_ID: sibling }) }, gmailRun))
      .toEqual(expect.arrayContaining(['gmail-not-production-client', 'gmail-dedicated-client']));
  });

  it('a client that is not production but not staging\'s own either', () => {
    const elsewhere = `999999999999-someoneelse0001.apps.googleusercontent.com`;
    expect(failing({ ...firebase(), ...gmailClient({ GOOGLE_CLIENT_ID: elsewhere }) }, gmailRun)).toEqual(['gmail-dedicated-client']);
  });

  it('fails closed when the production client is not given, so it cannot be ruled out', () => {
    expect(failing({ ...firebase(), ...gmailClient() }, { gmail: true })).toEqual(['gmail-not-production-client']);
    expect(failing({ ...firebase(), ...gmailClient() }, { gmail: true, productionGoogleClientId: '' })).toEqual(['gmail-not-production-client']);
  });

  it('fails closed when the production client id is malformed', () => {
    expect(failing({ ...firebase(), ...gmailClient() }, { gmail: true, productionGoogleClientId: 'prod' })).toEqual(['gmail-not-production-client']);
  });

  it('fails closed when the staging client id cannot be read', () => {
    expect(failing({ ...firebase(), ...gmailClient({ GOOGLE_CLIENT_ID: 'garbage' }) }, gmailRun))
      .toEqual(['gmail-client-id', 'gmail-dedicated-client', 'gmail-not-production-client']);
  });

  it('a secret that is not a Google client secret', () => {
    expect(failing({ ...firebase(), ...gmailClient({ GOOGLE_CLIENT_SECRET: 'short' }) }, gmailRun)).toEqual(['gmail-client-secret']);
  });
});

describe('--gmail rejects the wrong Firebase project', () => {
  it('production Firebase', () => {
    const prod = firebase(PROD, PROD_NUMBER);
    expect(failing({ ...prod, ...gmailClient() }, gmailRun))
      .toEqual(expect.arrayContaining(['looks-like-staging', 'not-production', 'gmail-project', 'gmail-dedicated-client']));
  });

  it('any staging project other than idynify-staging', () => {
    expect(failing({ ...firebase('acme-staging'), ...gmailClient() }, gmailRun)).toEqual(['gmail-project']);
  });
});

describe('--gmail rejects any other callback', () => {
  it.each([
    'https://localhost:8888/.netlify/functions/gmail-oauth-callback',
    'http://127.0.0.1:8888/.netlify/functions/gmail-oauth-callback',
    'http://localhost:5173/.netlify/functions/gmail-oauth-callback',
    'http://localhost:8888/.netlify/functions/gmail-oauth-callback/',
    'http://localhost:8888/.netlify/functions/contact-hub-gmail-callback',
    'https://idynify.com/.netlify/functions/gmail-oauth-callback',
    ` ${STAGING_GMAIL_REDIRECT_URI}`,
  ])('%s', (uri) => {
    expect(failing({ ...firebase(), ...gmailClient({ GOOGLE_REDIRECT_URI: uri }) }, gmailRun)).toEqual(['gmail-redirect-uri']);
  });
});

describe('--gmail rejects missing configuration', () => {
  it.each(GMAIL_STAGING_KEYS)('%s missing', (key) => {
    const ids = failing({ ...firebase(), ...gmailClient({ [key]: '' }) }, gmailRun);
    expect(ids).toContain('gmail-config');
  });

  it('nothing set at all', () => {
    expect(failing(firebase(), gmailRun)).toEqual(expect.arrayContaining(['gmail-config', 'gmail-redirect-uri', 'gmail-client-id', 'gmail-client-secret']));
  });

  it('the staging Firebase checks still apply: no service account', () => {
    expect(failing({ ...firebase(), FIREBASE_CLIENT_EMAIL: '', ...gmailClient() }, gmailRun)).toEqual(expect.arrayContaining(['server-config']));
  });
});

describe('--gmail keeps every unrelated integration prohibited', () => {
  it.each([
    ['Apollo', { APOLLO_API_KEY: 'x' }, 'no-integrations'],
    ['Claude', { ANTHROPIC_API_KEY: 'x' }, 'no-integrations'],
    ['LinkedIn', { LINKEDIN_CLIENT_ID: 'x' }, 'no-integrations'],
    ['Calendar', { GOOGLE_CALENDAR_REDIRECT_URI: 'http://localhost:8888/x' }, 'no-integrations'],
    ['Resend', { RESEND_API_KEY: 'x' }, 'no-integrations'],
    ['the env admin list', { ADMIN_USER_IDS: 'u1' }, 'no-integrations'],
    ['real Stripe switched on', { VITE_STRIPE_ENABLED: 'true' }, 'no-integrations'],
    // Refused twice since CH-GMAIL-001.3: by I5 in every run, and by the Gmail run's own check.
    ['Contact Hub Gmail on', { CONTACT_HUB_GMAIL: 'on' }, ['no-integrations', 'gmail-ingestion-off']],
    ['Contact Hub Gmail client', { CONTACT_HUB_GMAIL_CLIENT_ID: STAGING_CLIENT, CONTACT_HUB_GMAIL_CLIENT_SECRET: SECRET }, ['no-integrations', 'gmail-ingestion-off']],
    ['scheduled reply sync', { GMAIL_REPLY_SYNC_ENABLED: 'true' }, 'gmail-ingestion-off'],
    ['live inbox ingestion', { GMAIL_IDENTITY_MODE: 'live' }, 'gmail-ingestion-off'],
  ])('%s', (_label, extra, ids) => {
    expect(failing({ ...firebase(), ...gmailClient(), ...extra }, gmailRun)).toEqual([ids].flat());
  });

  it('names the variables, never their values', () => {
    const env = { ...firebase(), ...gmailClient({ GOOGLE_CLIENT_ID: PROD_CLIENT }), CONTACT_HUB_GMAIL_CLIENT_SECRET: 'GOCSPX-OTHERSECRETxxxxxxxxxxxx' };
    const out = JSON.stringify(checkStagingEnv(env, { productionProjectId: PROD, ...gmailRun }));
    for (const value of [SECRET, PROD_CLIENT, STAGING_CLIENT, 'OTHERSECRET', 'SECRETKEYMATERIAL', PROD_NUMBER]) expect(out).not.toContain(value);
    expect(JSON.stringify(checkGmailStagingMode({ GOOGLE_CLIENT_SECRET: 'GOCSPX-TOPSECRET' }))).not.toContain('TOPSECRET');
  });
});

// ── The launcher ────────────────────────────────────────────────────────────────────────────

describe('stagingDev in a Gmail run takes the Google client from the env file only', () => {
  const credential = { source: 'test', clientEmail: `qa@${P}.iam.gserviceaccount.com`, privateKey: KEY, projectId: P };
  const shellEnv = {
    PATH: '/bin', GOOGLE_CLIENT_ID: PROD_CLIENT, GOOGLE_CLIENT_SECRET: 'GOCSPX-FROMSHELLprodsecret0000',
    CONTACT_HUB_GMAIL: 'on', CONTACT_HUB_GMAIL_CLIENT_SECRET: 'GOCSPX-FROMSHELLcontacthub000', GMAIL_IDENTITY_MODE: 'live',
    GMAIL_REPLY_SYNC_ENABLED: 'true', PRODUCTION_GOOGLE_CLIENT_ID: PROD_CLIENT,
  };

  it('the env file staging client reaches the app; nothing Gmail-related from the shell does', () => {
    const plan = planDevRun({ fileEnv: { ...firebase(), ...gmailClient() }, credential, shellEnv, checks: [], gmail: true });
    expect(plan.ok).toBe(true);
    expect(plan.childEnv.GOOGLE_CLIENT_ID).toBe(STAGING_CLIENT);
    expect(plan.childEnv.GOOGLE_CLIENT_SECRET).toBe(SECRET);
    expect(plan.childEnv.GOOGLE_REDIRECT_URI).toBe(STAGING_GMAIL_REDIRECT_URI);
    for (const name of ['CONTACT_HUB_GMAIL', 'CONTACT_HUB_GMAIL_CLIENT_SECRET', 'GMAIL_IDENTITY_MODE', 'GMAIL_REPLY_SYNC_ENABLED', 'PRODUCTION_GOOGLE_CLIENT_ID']) {
      expect(plan.childEnv).not.toHaveProperty(name);
    }
    expect(JSON.stringify(plan.childEnv)).not.toContain('FROMSHELL');
    expect(plan.childEnv.PATH).toBe('/bin');
  });

  it('refuses to start when a Gmail check failed', () => {
    const plan = planDevRun({ fileEnv: firebase(), credential, checks: [{ id: 'gmail-not-production-client', ok: false, message: 'm' }], gmail: true });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toContain('gmail-not-production-client');
  });

  it('the default run still drops the shell\'s Google keys, as before', () => {
    expect(dropFromShell('GOOGLE_CLIENT_ID')).toBe(true);
    expect(dropFromShell('GOOGLE_CLIENT_SECRET')).toBe(true);
    const plan = planDevRun({ fileEnv: firebase(), credential, shellEnv: { PATH: '/bin', GOOGLE_CLIENT_ID: PROD_CLIENT }, checks: [] });
    expect(plan.childEnv).not.toHaveProperty('GOOGLE_CLIENT_ID');
  });

  it('the Gmail-only shell drop covers every forbidden Gmail switch', () => {
    for (const name of [...GMAIL_RUN_FORBIDDEN, 'GMAIL_IDENTITY_MODE', 'PRODUCTION_GOOGLE_CLIENT_ID']) expect(dropFromShellForGmail(name)).toBe(true);
    expect(dropFromShellForGmail('PATH')).toBe(false);
  });
});

// ── The command line ────────────────────────────────────────────────────────────────────────

describe('stagingPreflight --gmail on the command line', () => {
  const run = (args, env = {}) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...env } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const writeEnv = (vars) => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-gmail-'));
    const file = join(dir, '.env.staging');
    writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join('\n'));
    return file;
  };
  const cleanCheckout = () => mkdtempSync(join(tmpdir(), 'checkout-'));
  const shell = { PRODUCTION_FIREBASE_PROJECT_ID: PROD, PRODUCTION_GOOGLE_CLIENT_ID: PROD_CLIENT };

  it('passes a valid Gmail run and prints no secret or client id', () => {
    const { status, out } = run([`--env=${writeEnv({ ...firebase(), ...gmailClient() })}`, `--checkout=${cleanCheckout()}`, '--gmail'], shell);
    expect(status).toBe(0);
    expect(out).toContain('Preflight passed for a Gmail run');
    expect(out).toContain('--gmail');
    for (const value of [SECRET, STAGING_CLIENT, PROD_CLIENT, 'SECRETKEYMATERIAL', 'AIzaSECRETWEBKEY']) expect(out).not.toContain(value);
  });

  it('refuses the same file without --gmail, as staging always has', () => {
    const { status, out } = run([`--env=${writeEnv({ ...firebase(), ...gmailClient() })}`, `--checkout=${cleanCheckout()}`], shell);
    expect(status).toBe(1);
    expect(out).toContain('no-integrations');
  });

  it('refuses without PRODUCTION_GOOGLE_CLIENT_ID in the shell', () => {
    const { status, out } = run([`--env=${writeEnv({ ...firebase(), ...gmailClient() })}`, `--checkout=${cleanCheckout()}`, '--gmail'], { PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(1);
    expect(out).toContain('PRODUCTION_GOOGLE_CLIENT_ID');
  });

  it('refuses the production client', () => {
    const { status, out } = run([`--env=${writeEnv({ ...firebase(), ...gmailClient({ GOOGLE_CLIENT_ID: PROD_CLIENT }) })}`, `--checkout=${cleanCheckout()}`, '--gmail'], shell);
    expect(status).toBe(1);
    expect(out).toContain('PRODUCTION OAuth client');
    expect(out).not.toContain(PROD_CLIENT);
  });

  it('refuses --gmail together with --billing', () => {
    const { status, out } = run([`--env=${writeEnv({ ...firebase(), ...gmailClient(), ...stripeTest() })}`, `--checkout=${cleanCheckout()}`, '--gmail', '--billing'], shell);
    expect(status).toBe(1);
    expect(out).toContain('not both');
  });
});
