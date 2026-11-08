/**
 * The staging credential (scripts/staging/stagingCredentials.mjs) and the
 * tools that use it: the key comes from STAGING_SERVICE_ACCOUNT_KEY or a key
 * file, never both; it must belong to the staging project; it is never
 * printed, never written into the env file, and only reaches firebase-tools
 * as a private temporary file. The dev launcher hands the app nothing from
 * the shell that is Firebase, a credential or an integration.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, statSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  parseServiceAccountKey, readStagingCredential, withCredential, checkCredential, temporaryKeyFile, redactKeys,
  CredentialRefusal, KEY_VARIABLE, FILE_VARIABLE,
} from '../../scripts/staging/stagingCredentials.mjs';
import { planDevRun, devArgs, hasEdgeFunctions } from '../../scripts/staging/stagingDev.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const script = (name) => resolve(REPO, 'scripts/staging', name);
const P = 'acme-staging';
const PROD = 'acme-prod';

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
});
// A line from the middle of the key: if any output contains it, the key leaked.
const KEY_LINE = PEM.split('\n')[5];
const keyJson = (over = {}) => ({
  type: 'service_account', project_id: P, private_key_id: 'kid', private_key: PEM,
  client_email: `stickers-staging-qa@${P}.iam.gserviceaccount.com`, client_id: '1', token_uri: 'https://oauth2.googleapis.com/token', ...over,
});
const raw = (over) => JSON.stringify(keyJson(over));
const b64 = (over) => Buffer.from(JSON.stringify(keyJson(over), null, 2)).toString('base64');
const webEnv = (over = {}) => ({
  VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: `${P}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: P,
  VITE_FIREBASE_STORAGE_BUCKET: 'b', VITE_FIREBASE_MESSAGING_SENDER_ID: '1', VITE_FIREBASE_APP_ID: 'a', ...over,
});
const refusal = (fn) => {
  try { fn(); } catch (err) { return err; }
  throw new Error('expected a refusal');
};

describe('parseServiceAccountKey', () => {
  it('reads a raw JSON key and a base64 one alike', () => {
    for (const text of [raw(), b64()]) {
      const c = parseServiceAccountKey(text);
      expect(c.projectId).toBe(P);
      expect(c.clientEmail).toBe(`stickers-staging-qa@${P}.iam.gserviceaccount.com`);
      expect(c.privateKey).toBe(PEM);
    }
  });

  it.each([
    ['empty', ''],
    ['neither JSON nor base64 of JSON', 'not-a-key'],
    ['broken JSON that contains the key', `{"type":"service_account","private_key":"${PEM}"`],
    ['not a service account', raw({ type: 'authorized_user' })],
    ['missing fields', raw({ client_email: '' })],
    ['a private_key that is not a key', raw({ private_key: 'secret-but-not-pem' })],
    ['an account of another project', raw({ client_email: `x@${PROD}.iam.gserviceaccount.com` })],
  ])('refuses %s, without quoting the input', (_, text) => {
    const err = refusal(() => parseServiceAccountKey(text));
    expect(err).toBeInstanceOf(CredentialRefusal);
    expect(err.message).not.toContain(KEY_LINE);
    expect(err.message).not.toContain('secret-but-not-pem');
  });
});

describe('readStagingCredential', () => {
  const keyFile = (text = raw()) => {
    const file = join(mkdtempSync(join(tmpdir(), 'cred-')), 'sa.json');
    writeFileSync(file, text);
    return file;
  };

  it('is null when no credential is set', () => {
    expect(readStagingCredential({})).toBeNull();
  });

  it('reads the inline variable, or the key file', () => {
    expect(readStagingCredential({ [KEY_VARIABLE]: b64() })).toMatchObject({ source: KEY_VARIABLE, projectId: P });
    expect(readStagingCredential({ [FILE_VARIABLE]: keyFile() })).toMatchObject({ source: FILE_VARIABLE, projectId: P });
  });

  it('refuses both at once: a machine-wide key file may belong to another project', () => {
    const err = refusal(() => readStagingCredential({ [KEY_VARIABLE]: raw(), [FILE_VARIABLE]: keyFile() }));
    expect(err.message).toBe(`Set ${KEY_VARIABLE} or ${FILE_VARIABLE}, not both.`);
  });

  it('refuses an unreadable key file by its error code only', () => {
    const err = refusal(() => readStagingCredential({ [FILE_VARIABLE]: '/nonexistent/sa.json' }));
    expect(err.message).toBe(`${FILE_VARIABLE} could not be read (ENOENT).`);
  });
});

describe('withCredential and checkCredential', () => {
  const credential = { source: KEY_VARIABLE, ...parseServiceAccountKey(raw()) };

  it('adds the functions’ account in memory and leaves the file’s values alone', () => {
    const file = webEnv({ FIREBASE_PROJECT_ID: P });
    const merged = withCredential(file, credential);
    expect(merged).toMatchObject({ FIREBASE_PROJECT_ID: P, FIREBASE_CLIENT_EMAIL: credential.clientEmail, FIREBASE_PRIVATE_KEY: PEM });
    expect(file.FIREBASE_PRIVATE_KEY).toBeUndefined();
  });

  it('passes a key of the env file’s project, kept out of the file', () => {
    expect(checkCredential(webEnv(), credential).every((r) => r.ok)).toBe(true);
  });

  it('fails a key of another project, a key also in the file, and a different account in the file', () => {
    const ids = (env, c = credential) => checkCredential(env, c).filter((r) => !r.ok).map((r) => r.id);
    expect(ids(webEnv({ VITE_FIREBASE_PROJECT_ID: 'other-staging' }))).toEqual(['credential-project']);
    expect(ids(webEnv({ FIREBASE_PRIVATE_KEY: 'x' }))).toEqual(['key-not-in-file']);
    expect(ids(webEnv({ FIREBASE_CLIENT_EMAIL: `other@${P}.iam.gserviceaccount.com` }))).toEqual(['credential-account']);
  });

  it('never puts the key in a message', () => {
    for (const r of checkCredential(webEnv({ FIREBASE_PRIVATE_KEY: PEM }), credential)) expect(r.message).not.toContain(KEY_LINE);
  });
});

describe('temporaryKeyFile', () => {
  it('writes a private file outside the repository and removes it', () => {
    const credential = parseServiceAccountKey(raw());
    const key = temporaryKeyFile(credential);
    expect(relative(REPO, key.path).startsWith('..')).toBe(true);
    expect(statSync(key.path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(key.path)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(key.path, 'utf8')).project_id).toBe(P);
    key.remove();
    expect(existsSync(key.path)).toBe(false);
  });
});

describe('redactKeys', () => {
  it('removes a key block, raw or escaped', () => {
    expect(redactKeys(`before ${PEM} after`)).not.toContain(KEY_LINE);
    expect(redactKeys(`x ${JSON.stringify(PEM)} y`)).not.toContain(KEY_LINE);
  });
});

describe('planDevRun (the app launcher)', () => {
  const credential = { source: KEY_VARIABLE, ...parseServiceAccountKey(raw()) };
  const shellEnv = {
    PATH: '/bin', HTTPS_PROXY: 'http://proxy', [KEY_VARIABLE]: raw(), [FILE_VARIABLE]: '/elsewhere/prod.json',
    VITE_FIREBASE_PROJECT_ID: PROD, FIREBASE_PRIVATE_KEY: 'prod-key', FIREBASE_TOKEN: 't', STRIPE_SECRET_KEY: 'sk_live_x',
    ADMIN_USER_IDS: 'u', FIRESTORE_EMULATOR_HOST: 'localhost:8080',
  };

  it('gives the app the env file and the staging account, and nothing Firebase, credential or integration from the shell', () => {
    const { ok, childEnv } = planDevRun({ fileEnv: webEnv(), credential, shellEnv, checks: [{ id: 'a', ok: true }] });
    expect(ok).toBe(true);
    expect(childEnv).toMatchObject({ PATH: '/bin', HTTPS_PROXY: 'http://proxy', VITE_FIREBASE_PROJECT_ID: P, FIREBASE_PROJECT_ID: P, FIREBASE_PRIVATE_KEY: PEM });
    for (const gone of [KEY_VARIABLE, FILE_VARIABLE, 'FIREBASE_TOKEN', 'STRIPE_SECRET_KEY', 'ADMIN_USER_IDS', 'FIRESTORE_EMULATOR_HOST']) {
      expect(childEnv).not.toHaveProperty(gone);
    }
    expect(childEnv.FIRESTORE_PREFER_REST).toBeUndefined();
    expect(planDevRun({ fileEnv: webEnv(), credential, shellEnv, rest: true }).childEnv.FIRESTORE_PREFER_REST).toBe('true');
  });

  it('refuses when any check fails, or without a credential', () => {
    expect(planDevRun({ fileEnv: webEnv(), credential, checks: [{ id: 'not-production', ok: false, message: 'm' }] }).ok).toBe(false);
    expect(planDevRun({ fileEnv: webEnv(), credential: null }).problems.join(' ')).toContain(KEY_VARIABLE);
  });
});

describe('the launcher’s edge-function switch', () => {
  it('runs netlify dev offline, and skips the edge runtime only when asked', () => {
    expect(devArgs()).toEqual(['netlify', 'dev', '--offline']);
    expect(devArgs({ noEdgeFunctions: true })).toEqual(['netlify', 'dev', '--offline', '--internal-disable-edge-functions']);
  });

  it('refuses to skip edge functions a project declares', () => {
    const credential = { source: KEY_VARIABLE, ...parseServiceAccountKey(raw()) };
    const plan = planDevRun({ fileEnv: webEnv(), credential, noEdgeFunctions: true, edgeFunctionsDeclared: true });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toContain('edge-functions');
  });

  it('this project declares none (so the switch changes nothing it serves)', () => {
    expect(hasEdgeFunctions(REPO)).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'edge-'));
    writeFileSync(join(dir, 'netlify.toml'), '[[edge_functions]]\n  path = "/x"\n  function = "x"\n');
    expect(hasEdgeFunctions(dir)).toBe(true);
  });
});

describe('the tools, with the key in STAGING_SERVICE_ACCOUNT_KEY', () => {
  const run = (name, args, env = {}) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [script(name), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...env } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  // The env file holds only the browser's config: the key never goes in a file.
  const envFile = (over = {}) => {
    const file = join(mkdtempSync(join(tmpdir(), 'cred-env-')), '.env.staging');
    writeFileSync(file, Object.entries(webEnv(over)).map(([k, v]) => `${k}="${v}"`).join('\n'));
    return file;
  };
  const cleanCheckout = () => mkdtempSync(join(tmpdir(), 'checkout-'));

  it('the preflight passes, and prints no key', () => {
    const { status, out } = run('stagingPreflight.mjs', [`--env=${envFile()}`, `--checkout=${cleanCheckout()}`], { PRODUCTION_FIREBASE_PROJECT_ID: PROD, [KEY_VARIABLE]: b64() });
    expect(status).toBe(0);
    expect(out).toContain('✓ credential-project');
    expect(out).toContain('✓ private-key');
    expect(out).not.toContain(KEY_LINE);
  });

  it('the preflight refuses a key of another project', () => {
    const other = b64({ project_id: 'other-staging', client_email: 'qa@other-staging.iam.gserviceaccount.com' });
    const { status, out } = run('stagingPreflight.mjs', [`--env=${envFile()}`, `--checkout=${cleanCheckout()}`], { PRODUCTION_FIREBASE_PROJECT_ID: PROD, [KEY_VARIABLE]: other });
    expect(status).toBe(1);
    expect(out).toContain('✗ credential-project');
  });

  it('the rules deploy dry run names the credential source, contacts nothing, and prints no key', () => {
    const { status, out } = run('stagingRulesDeploy.mjs', [`--env=${envFile()}`, `--project=${P}`], { [KEY_VARIABLE]: raw(), STICKERS_STAGING_PROJECTS: P, PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(0);
    expect(out).toContain(`Credential: ${KEY_VARIABLE} (service account of ${P})`);
    expect(out).toContain('Dry run: nothing was contacted or deployed.');
    expect(out).not.toContain(KEY_LINE);
  });

  it('the rules deploy refuses two credentials, and --validate with --apply', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cred-')), 'sa.json');
    writeFileSync(file, raw());
    const both = run('stagingRulesDeploy.mjs', [`--env=${envFile()}`, `--project=${P}`], { [KEY_VARIABLE]: raw(), [FILE_VARIABLE]: file, STICKERS_STAGING_PROJECTS: P, PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(both.status).toBe(1);
    expect(both.out).toContain('not both');
    const flags = run('stagingRulesDeploy.mjs', [`--env=${envFile()}`, `--project=${P}`, '--validate', '--apply'], { [KEY_VARIABLE]: raw(), STICKERS_STAGING_PROJECTS: P, PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(flags.status).toBe(1);
  });

  it('the rollout tool accepts the inline key for its own project only, and prints no key', () => {
    const ok = run('stickersStaging.mjs', [`--project=${P}`, '--mode=beta'], { [KEY_VARIABLE]: b64(), STICKERS_STAGING_PROJECTS: P, PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(ok.status).toBe(0);
    expect(ok.out).toContain('Dry run: nothing was written.');
    expect(ok.out).not.toContain(KEY_LINE);
    const other = run('stickersStaging.mjs', ['--project=other-staging', '--mode=beta'], { [KEY_VARIABLE]: b64(), STICKERS_STAGING_PROJECTS: 'other-staging', PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(other.status).toBe(1);
    expect(other.out).toContain('different project');
  });

  it('the rules deploy hands firebase-tools a key file, never the inline variable', () => {
    const source = readFileSync(script('stagingRulesDeploy.mjs'), 'utf8');
    expect(source).toContain('delete childEnv[KEY_VARIABLE]');
    expect(source.indexOf('temporaryKeyFile(credential)')).toBeLessThan(source.indexOf('spawnSync(command[0]'));
    expect(source).toMatch(/finally \{\s*key\?\.remove\(\);/);
    expect(source).toMatch(/for \(const signal of signals\) process\.once\(signal, onSignal\)/);
  });
});
