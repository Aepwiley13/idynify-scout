/**
 * The staging preflight (scripts/staging/stagingPreflight.mjs) refuses any
 * env file that is not provably an isolated staging setup, and never prints a
 * secret.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { parseEnvFile, checkStagingEnv, INTEGRATION_KEYS } from '../../scripts/staging/stagingPreflight.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/staging/stagingPreflight.mjs');
const P = 'acme-staging';
const PROD = 'acme-prod';
const KEY = '-----BEGIN PRIVATE KEY-----\\nSECRETKEYMATERIAL\\n-----END PRIVATE KEY-----';
const good = () => ({
  VITE_FIREBASE_API_KEY: 'AIzaSECRETWEBKEY', VITE_FIREBASE_AUTH_DOMAIN: `${P}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: P,
  VITE_FIREBASE_STORAGE_BUCKET: `${P}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123', VITE_FIREBASE_APP_ID: '1:123:web:abc',
  FIREBASE_PROJECT_ID: P, FIREBASE_CLIENT_EMAIL: `qa@${P}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: KEY,
});
const failing = (env, opts = {}) => checkStagingEnv(env, { productionProjectId: PROD, ...opts }).filter((r) => !r.ok).map((r) => r.id);

describe('checkStagingEnv', () => {
  it('passes an isolated staging setup', () => {
    expect(failing(good())).toEqual([]);
  });

  it.each([
    ['the production project', { ...good(), VITE_FIREBASE_PROJECT_ID: PROD, FIREBASE_PROJECT_ID: PROD, VITE_FIREBASE_AUTH_DOMAIN: `${PROD}.firebaseapp.com`, FIREBASE_CLIENT_EMAIL: `qa@${PROD}.iam.gserviceaccount.com` }, ['looks-like-staging', 'not-production']],
    ['browser and functions on different projects', { ...good(), FIREBASE_PROJECT_ID: 'other-staging' }, ['same-project']],
    ['a service account from another project', { ...good(), FIREBASE_CLIENT_EMAIL: `qa@${PROD}.iam.gserviceaccount.com` }, ['service-account']],
    ['an auth domain from another project', { ...good(), VITE_FIREBASE_AUTH_DOMAIN: `${PROD}.firebaseapp.com` }, ['auth-domain']],
    ['a missing web value', { ...good(), VITE_FIREBASE_APP_ID: '' }, ['web-config']],
    ['no private key', { ...good(), FIREBASE_PRIVATE_KEY: 'nope' }, ['private-key']],
    ['an integration key', { ...good(), STRIPE_SECRET_KEY: 'sk_live_SECRET', APOLLO_API_KEY: 'x' }, ['no-integrations']],
    ['real Stripe switched on', { ...good(), VITE_STRIPE_ENABLED: 'true' }, ['no-integrations']],
    ['the env admin list', { ...good(), ADMIN_USER_IDS: 'u1' }, ['no-integrations']],
  ])('refuses %s', (_label, env, ids) => {
    expect(failing(env)).toEqual(ids);
  });

  it('refuses when the production id is not given, so it cannot be ruled out', () => {
    expect(failing(good(), { productionProjectId: null })).toEqual(['not-production']);
  });

  it('refuses a checkout linked to a Netlify site, whose variables netlify dev would inject', () => {
    expect(failing(good(), { linkedSite: true })).toEqual(['netlify-unlinked']);
  });

  it('refuses a checkout with a root .env file Vite would also load', () => {
    const results = checkStagingEnv(good(), { productionProjectId: PROD, rootEnvFiles: ['.env', '.env.local'] });
    const r = results.find((x) => x.id === 'no-root-env');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('.env, .env.local');
  });

  it('refuses an env file git would commit', () => {
    expect(failing(good(), { fileCommittable: true })).toEqual(['file-not-committable']);
  });

  it('names offending keys, never their values', () => {
    const text = JSON.stringify(checkStagingEnv({ ...good(), STRIPE_SECRET_KEY: 'sk_live_SECRET' }, { productionProjectId: PROD }));
    expect(text).toContain('STRIPE_SECRET_KEY');
    for (const secret of ['sk_live_SECRET', 'SECRETKEYMATERIAL', 'AIzaSECRETWEBKEY']) expect(text).not.toContain(secret);
  });

  it('covers the integrations the functions read', () => {
    for (const key of ['STRIPE_SECRET_KEY', 'GOOGLE_CLIENT_SECRET', 'APOLLO_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'ADMIN_USER_IDS']) {
      expect(INTEGRATION_KEYS).toContain(key);
    }
  });
});

describe('parseEnvFile', () => {
  it('reads KEY=value lines, strips quotes, skips comments', () => {
    expect(parseEnvFile('# c\nA=1\nexport B="two words"\nC=\'x=y\'\n\nbad line\n')).toEqual({ A: '1', B: 'two words', C: 'x=y' });
  });
});

describe('the tool itself', () => {
  const run = (args, env = {}) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...env } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const writeEnv = (vars) => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
    const file = join(dir, '.env.staging');
    writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join('\n'));
    return file;
  };

  // A clean checkout: not linked to Netlify, no root .env (a developer's own clone may have both).
  const cleanCheckout = () => mkdtempSync(join(tmpdir(), 'checkout-'));

  it('passes a good file outside the repo, and prints no secret', () => {
    const { status, out } = run([`--env=${writeEnv(good())}`, `--checkout=${cleanCheckout()}`], { PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(0);
    expect(out).toContain('Preflight passed.');
    for (const secret of ['SECRETKEYMATERIAL', 'AIzaSECRETWEBKEY']) expect(out).not.toContain(secret);
  });

  it('refuses a checkout linked to Netlify, from the command line', () => {
    const checkout = cleanCheckout();
    mkdirSync(join(checkout, '.netlify'));
    writeFileSync(join(checkout, '.netlify', 'state.json'), '{"siteId":"x"}');
    const { status, out } = run([`--env=${writeEnv(good())}`, `--checkout=${checkout}`], { PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(1);
    expect(out).toContain('netlify-unlinked');
  });

  it('refuses a bad file with exit 1', () => {
    const { status, out } = run([`--env=${writeEnv({ ...good(), STRIPE_SECRET_KEY: 'sk_live_SECRET' })}`, `--checkout=${cleanCheckout()}`], { PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(1);
    expect(out).toContain('Refused:');
    expect(out).not.toContain('sk_live_SECRET');
  });

  it('refuses without --env', () => {
    expect(run([]).status).toBe(1);
  });
});
