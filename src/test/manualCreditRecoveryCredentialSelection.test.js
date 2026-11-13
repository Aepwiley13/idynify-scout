/**
 * scripts/manualCreditRecovery.mjs — which Firestore credential a recovery run uses.
 *
 * Two modes, exactly one at a time: short-lived application-default credentials that
 * impersonate one service account, or a service-account key file. Everything else fails
 * closed, before the tool connects to Firestore or Stripe. Nothing here touches a network
 * or a real credential: every file is a fixture supplied through an injected reader.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { resolveFirestoreCredential, CredentialError, ADC_MODE } from '../../scripts/manualCreditRecovery.mjs';

const TARGET = 'acme-billing';
const OTHER = 'acme-other';
const ACCOUNT = `billing-recovery@${TARGET}.iam.gserviceaccount.com`;
const url = (email) => `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`;

const impersonated = (over = {}) => ({
  type: 'impersonated_service_account', service_account_impersonation_url: url(ACCOUNT), delegates: [],
  source_credentials: { type: 'authorized_user', client_id: 'x', client_secret: 'FIXTURE-CLIENT-SECRET', refresh_token: 'FIXTURE-REFRESH-TOKEN' },
  ...over,
});
const keyFile = (over = {}) => ({
  type: 'service_account', project_id: TARGET, client_email: ACCOUNT, private_key: '-----BEGIN PRIVATE KEY-----\nFIXTURE-PRIVATE-KEY\n-----END PRIVATE KEY-----\n', ...over,
});
const files = (map) => ({
  readFile: (path) => {
    if (!(path in map)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return typeof map[path] === 'string' ? map[path] : JSON.stringify(map[path]);
  },
});
const adcEnv = (over = {}) => ({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE, GOOGLE_APPLICATION_CREDENTIALS: '/out/adc.json', FIREBASE_PROJECT_ID: TARGET, ...over });
const refusal = (env, map = {}) => {
  try {
    resolveFirestoreCredential(env, files(map));
  } catch (err) {
    expect(err).toBeInstanceOf(CredentialError);
    return err.message;
  }
  throw new Error('expected a CredentialError');
};

describe('manual recovery — credential selection', () => {
  it('short-lived mode: impersonated credentials for the stated project', () => {
    expect(resolveFirestoreCredential(adcEnv(), files({ '/out/adc.json': impersonated() }))).toEqual({
      mode: 'short-lived', projectId: TARGET, clientEmail: ACCOUNT,
    });
  });

  it('short-lived mode also accepts a workload-identity credential that impersonates the account', () => {
    const external = { type: 'external_account', service_account_impersonation_url: url(ACCOUNT), audience: '//iam.googleapis.com/x' };
    expect(resolveFirestoreCredential(adcEnv(), files({ '/out/adc.json': external })).mode).toBe('short-lived');
  });

  it('key-file mode is unchanged: the key decides the project, and the key is handed back for cert()', () => {
    const key = keyFile();
    const resolved = resolveFirestoreCredential({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json' }, files({ '/out/key.json': key }));
    expect(resolved).toEqual({ mode: 'key-file', projectId: TARGET, clientEmail: ACCOUNT, key });
  });

  it('a short-lived result never carries key material', () => {
    const resolved = resolveFirestoreCredential(adcEnv(), files({ '/out/adc.json': impersonated() }));
    expect(resolved.key).toBeUndefined();
    expect(JSON.stringify(resolved)).not.toMatch(/FIXTURE-/);
  });
});

describe('manual recovery — credential selection fails closed', () => {
  it('neither mode configured', () => {
    expect(refusal({})).toMatch(/WRITE-capable Firestore credential is required/);
    expect(refusal({ FIREBASE_ADMIN_CREDENTIALS: '', FIREBASE_SERVICE_ACCOUNT_PATH: '  ' })).toMatch(/is required/);
  });

  it('an ambient default login is not enough: GOOGLE_APPLICATION_CREDENTIALS alone selects nothing', () => {
    expect(refusal({ GOOGLE_APPLICATION_CREDENTIALS: '/out/adc.json', FIREBASE_PROJECT_ID: TARGET }, { '/out/adc.json': impersonated() }))
      .toMatch(/is required/);
  });

  it('both modes configured', () => {
    expect(refusal(adcEnv({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json' }), { '/out/adc.json': impersonated(), '/out/key.json': keyFile() }))
      .toMatch(/not both/);
  });

  it('an unknown mode value', () => {
    for (const value of ['true', '1', 'adc', 'Application-Default']) {
      expect(refusal(adcEnv({ FIREBASE_ADMIN_CREDENTIALS: value }), { '/out/adc.json': impersonated() })).toMatch(/must be "application-default" or unset/);
    }
  });

  it('short-lived mode without an explicit project, or without an explicit credential file', () => {
    expect(refusal(adcEnv({ FIREBASE_PROJECT_ID: undefined }), { '/out/adc.json': impersonated() })).toMatch(/FIREBASE_PROJECT_ID is required/);
    expect(refusal(adcEnv({ GOOGLE_APPLICATION_CREDENTIALS: undefined }))).toMatch(/GOOGLE_APPLICATION_CREDENTIALS is required/);
  });

  it('a personal login, or a key file passed off as short-lived', () => {
    expect(refusal(adcEnv(), { '/out/adc.json': { type: 'authorized_user', refresh_token: 'FIXTURE-REFRESH-TOKEN' } })).toMatch(/personal Google login/);
    expect(refusal(adcEnv(), { '/out/adc.json': keyFile() })).toMatch(/not a short-lived credential/);
    expect(refusal(adcEnv(), { '/out/adc.json': { type: 'something_else' } })).toMatch(/not a short-lived credential type/);
  });

  it('an impersonated account in a different project than the one stated', () => {
    const elsewhere = impersonated({ service_account_impersonation_url: url(`billing-recovery@${OTHER}.iam.gserviceaccount.com`) });
    expect(refusal(adcEnv(), { '/out/adc.json': elsewhere })).toMatch(/different project than FIREBASE_PROJECT_ID/);
    expect(refusal(adcEnv({ FIREBASE_PROJECT_ID: OTHER }), { '/out/adc.json': impersonated() })).toMatch(/different project than FIREBASE_PROJECT_ID/);
  });

  it('a target that cannot be established', () => {
    const cases = [
      impersonated({ service_account_impersonation_url: undefined }),
      impersonated({ service_account_impersonation_url: 'https://example.com/v1/projects/-/serviceAccounts/x:generateAccessToken' }),
      impersonated({ service_account_impersonation_url: url('someone@gmail.com') }),
      impersonated({ service_account_impersonation_url: url(`a@${TARGET}.iam.gserviceaccount.com.evil.example`) }),
      impersonated({ delegates: [`other@${OTHER}.iam.gserviceaccount.com`] }),
      impersonated({ source_credentials: undefined }),
    ];
    for (const json of cases) expect(refusal(adcEnv(), { '/out/adc.json': json })).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it('a credential billed to, or an environment pointing at, another project', () => {
    expect(refusal(adcEnv(), { '/out/adc.json': impersonated({ quota_project_id: OTHER }) })).toMatch(/billed to another project/);
    expect(resolveFirestoreCredential(adcEnv(), files({ '/out/adc.json': impersonated({ quota_project_id: TARGET }) })).projectId).toBe(TARGET);
    for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
      expect(refusal(adcEnv({ [name]: OTHER }), { '/out/adc.json': impersonated() })).toMatch(new RegExp(name));
    }
  });

  it('a missing or unreadable file, in either mode', () => {
    expect(refusal(adcEnv())).toMatch(/GOOGLE_APPLICATION_CREDENTIALS could not be read/);
    expect(refusal(adcEnv(), { '/out/adc.json': '{not json' })).toMatch(/not valid JSON/);
    expect(refusal(adcEnv(), { '/out/adc.json': 'null' })).toMatch(/not valid JSON/);
    expect(refusal({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json' })).toMatch(/FIREBASE_SERVICE_ACCOUNT_PATH could not be read/);
    expect(refusal({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json' }, { '/out/key.json': '{not json' })).toMatch(/not valid JSON/);
  });

  it('key-file mode: not a service-account key, or a project that contradicts FIREBASE_PROJECT_ID', () => {
    expect(refusal({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json' }, { '/out/key.json': impersonated() })).toMatch(/not a service-account key/);
    expect(refusal({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json' }, { '/out/key.json': keyFile({ private_key: '' }) })).toMatch(/not a service-account key/);
    expect(refusal({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json', FIREBASE_PROJECT_ID: OTHER }, { '/out/key.json': keyFile() })).toMatch(/different project than the service-account key/);
  });

  it('no refusal ever repeats credential content', () => {
    const messages = [
      refusal(adcEnv(), { '/out/adc.json': { type: 'authorized_user', refresh_token: 'FIXTURE-REFRESH-TOKEN' } }),
      refusal(adcEnv(), { '/out/adc.json': impersonated({ quota_project_id: OTHER }) }),
      refusal(adcEnv(), { '/out/adc.json': keyFile() }),
      refusal({ FIREBASE_SERVICE_ACCOUNT_PATH: '/out/key.json', FIREBASE_PROJECT_ID: OTHER }, { '/out/key.json': keyFile() }),
      refusal(adcEnv(), { '/out/adc.json': '{"private_key":"FIXTURE-PRIVATE-KEY",' }),
    ];
    for (const message of messages) expect(message).not.toMatch(/FIXTURE-/);
  });
});

describe('manual recovery — the command line stops before connecting to anything', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const ARGS = ['--uid', 'u1', '--subscription-id', 'sub_1', '--price-id', 'price_1', '--evidence-stripe-session-id', 'cs_1', '--evidence-note', 'n', '--dry-run'];
  const run = (env) => {
    try {
      const stdout = execFileSync('node', ['scripts/manualCreditRecovery.mjs', ...ARGS], {
        cwd: REPO, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output: stdout };
    } catch (err) {
      return { status: err.status, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('no Firestore credential: exit 1, nothing else attempted', () => {
    const result = run({ STRIPE_SECRET_KEY: 'sk_test_fixture' });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/WRITE-capable Firestore credential is required/);
  });

  it('a personal login as the short-lived credential: exit 1 before Stripe or Firestore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'recovery-cred-'));
    const file = join(dir, 'adc.json');
    writeFileSync(file, JSON.stringify({ type: 'authorized_user', refresh_token: 'FIXTURE-REFRESH-TOKEN' }));
    const result = run({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE, GOOGLE_APPLICATION_CREDENTIALS: file, FIREBASE_PROJECT_ID: TARGET, STRIPE_SECRET_KEY: 'sk_test_fixture' });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/personal Google login/);
    expect(result.output).not.toMatch(/FIXTURE-/);
  });

  it('a valid short-lived credential but no Stripe key: still exit 1, as before', () => {
    const dir = mkdtempSync(join(tmpdir(), 'recovery-cred-'));
    const file = join(dir, 'adc.json');
    writeFileSync(file, JSON.stringify(impersonated()));
    const result = run({ FIREBASE_ADMIN_CREDENTIALS: ADC_MODE, GOOGLE_APPLICATION_CREDENTIALS: file, FIREBASE_PROJECT_ID: TARGET });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/STRIPE_SECRET_KEY is required/);
  });

  it('the credential is resolved before the Admin SDK or Stripe is loaded', () => {
    const source = readFileSync(resolve(REPO, 'scripts/manualCreditRecovery.mjs'), 'utf8');
    const main = source.slice(source.indexOf('async function main()'));
    expect(main.indexOf('resolveFirestoreCredential(process.env)')).toBeGreaterThan(0);
    expect(main.indexOf("await import('firebase-admin/app')")).toBeGreaterThan(main.indexOf('resolveFirestoreCredential(process.env)'));
    expect(main.indexOf("await import('stripe')")).toBeGreaterThan(main.indexOf('resolveFirestoreCredential(process.env)'));
  });

  it('the recovery transaction and its evidence checks are untouched by credential selection', () => {
    const source = readFileSync(resolve(REPO, 'scripts/manualCreditRecovery.mjs'), 'utf8');
    for (const name of ['export async function verifyPurchaseAgainstStripe', 'export async function applyManualRecovery', 'AlreadyGrantedError', 'if (dryRun) {']) {
      expect(source).toContain(name);
    }
    const transaction = source.slice(source.indexOf('export async function applyManualRecovery'), source.indexOf('async function main()'));
    expect(transaction).not.toMatch(/process\.env|resolveFirestoreCredential|applicationDefault/);
  });
});
