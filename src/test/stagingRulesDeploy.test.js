/**
 * The staging rules deploy (scripts/staging/stagingRulesDeploy.mjs) targets
 * only the project the app's env file names, and only after every isolation
 * check passes. It never deploys without --apply, and never in a test.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import process from 'node:process';
import { planRulesDeploy } from '../../scripts/staging/stagingRulesDeploy.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/staging/stagingRulesDeploy.mjs');
const P = 'acme-staging';
const PROD = 'acme-prod';
const env = (over = {}) => ({
  VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: `${P}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: P,
  VITE_FIREBASE_STORAGE_BUCKET: 'b', VITE_FIREBASE_MESSAGING_SENDER_ID: '1', VITE_FIREBASE_APP_ID: 'a',
  FIREBASE_PROJECT_ID: P, FIREBASE_CLIENT_EMAIL: `qa@${P}.iam.gserviceaccount.com`,
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----', ...over,
});
const ok = { project: P, credentialsProjectId: P, allowlist: P, productionProjectId: PROD };

describe('planRulesDeploy', () => {
  it('plans exactly one command: rules only, to the env file’s project', () => {
    expect(planRulesDeploy({ env: env(), ...ok })).toEqual({
      ok: true,
      command: ['npx', '--yes', 'firebase-tools@15', 'deploy', '--only', 'firestore:rules', '--project', P, '--non-interactive'],
    });
  });

  it.each([
    ['--project differs from the env file', { ...ok, project: 'other-staging', allowlist: 'other-staging', credentialsProjectId: 'other-staging' }, /must be the project the env file names/],
    ['no --project', { ...ok, project: null }, /--project is required/],
    ['a credential from another project', { ...ok, credentialsProjectId: PROD }, /different project/],
    ['not in STICKERS_STAGING_PROJECTS', { ...ok, allowlist: '' }, /not listed/],
    ['the production id not given', { ...ok, productionProjectId: null }, /not-production/],
    ['a committable env file', { ...ok, fileCommittable: true }, /file-not-committable/],
  ])('refuses %s', (_label, input, reason) => {
    const plan = planRulesDeploy({ env: env(), ...input });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toMatch(reason);
  });

  it('refuses a locally modified firestore.rules unless the lockdown drill asks for it', () => {
    const refused = planRulesDeploy({ env: env(), ...ok, rulesModified: true });
    expect(refused.ok).toBe(false);
    expect(refused.problems.join(' ')).toMatch(/uncommitted changes/);
    expect(planRulesDeploy({ env: env(), ...ok, rulesModified: true, allowModifiedRules: true }).ok).toBe(true);
  });

  it('refuses an env file whose browser and functions disagree', () => {
    const plan = planRulesDeploy({ env: env({ FIREBASE_PROJECT_ID: 'other-staging' }), ...ok });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toMatch(/same-project/);
  });

  it('refuses the production project however it is asked', () => {
    const prodEnv = env({ VITE_FIREBASE_PROJECT_ID: PROD, FIREBASE_PROJECT_ID: PROD, VITE_FIREBASE_AUTH_DOMAIN: `${PROD}.firebaseapp.com`, FIREBASE_CLIENT_EMAIL: `qa@${PROD}.iam.gserviceaccount.com` });
    expect(planRulesDeploy({ env: prodEnv, project: PROD, credentialsProjectId: PROD, allowlist: PROD, productionProjectId: PROD }).ok).toBe(false);
  });
});

describe('the tool itself', () => {
  const run = (args, extra = {}) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...extra } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const files = () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-deploy-'));
    const envFile = join(dir, '.env.staging');
    // The key comes from the credential, so the env file holds none (one credential, kept out of files).
    const { FIREBASE_PRIVATE_KEY: _key, FIREBASE_CLIENT_EMAIL: _account, ...fileEnv } = env();
    writeFileSync(envFile, Object.entries(fileEnv).map(([k, v]) => `${k}="${v}"`).join('\n'));
    const cred = join(dir, 'sa.json');
    // A real-format service-account key: the tool now reads and checks the whole key.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    writeFileSync(cred, JSON.stringify({ type: 'service_account', project_id: P, client_email: `qa@${P}.iam.gserviceaccount.com`, private_key: privateKey }));
    return { envFile, cred };
  };

  it('a dry run prints the command and deploys nothing', () => {
    const { envFile, cred } = files();
    const { status, out } = run([`--env=${envFile}`, `--project=${P}`], { GOOGLE_APPLICATION_CREDENTIALS: cred, STICKERS_STAGING_PROJECTS: P, PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(0);
    expect(out).toContain(`--only firestore:rules --project ${P}`);
    expect(out).toContain('Dry run: nothing was contacted or deployed.');
    expect(out).toMatch(/Rules: {2}firestore\.rules at [0-9a-f]{7}/);
  });

  it('refuses a mismatched --project with exit 1', () => {
    const { envFile, cred } = files();
    const { status, out } = run([`--env=${envFile}`, '--project=other-staging', '--apply'], { GOOGLE_APPLICATION_CREDENTIALS: cred, STICKERS_STAGING_PROJECTS: 'other-staging', PRODUCTION_FIREBASE_PROJECT_ID: PROD });
    expect(status).toBe(1);
    expect(out).toContain('Refused: nothing was deployed.');
  });

  it('only ever runs firebase-tools behind --validate (its own --dry-run) or --apply', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source.match(/spawnSync\(/g)).toHaveLength(1); // one call, and only one
    expect(source.indexOf('if (!apply && !validate)')).toBeLessThan(source.indexOf('spawnSync(command[0]'));
    expect(source).toContain("const command = validate ? [...plan.command, '--dry-run'] : plan.command;");
    expect(source).toContain("'firestore:rules'");
    expect(source).not.toMatch(/--only[^\n]*(functions|hosting|indexes)/);
  });
});
