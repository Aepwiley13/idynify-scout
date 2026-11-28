/**
 * CH-GMAIL-001.4 — stagingDev --gmail --only-gmail-functions.
 *
 * Bundling all ~130 functions under `netlify dev` can take most of an hour on a busy machine, and
 * every page waits for it. A Gmail run can now serve only GMAIL_QA_FUNCTIONS, from the same
 * private temporary folder of links the sticker and billing modes use, with the edge runtime off.
 * The flag is refused without --gmail; --gmail on its own still serves every function.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, statSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { KEY_VARIABLE } from '../../scripts/staging/stagingCredentials.mjs';
import {
  GMAIL_QA_FUNCTIONS, STICKER_QA_FUNCTIONS, BILLING_JOURNEY_FUNCTIONS, functionsFolder, devArgs,
} from '../../scripts/staging/stagingDev.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LAUNCHER = resolve(REPO, 'scripts/staging/stagingDev.mjs');
const P = 'acme-staging';
const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY_LINE = PEM.split('\n')[5];
const key = () => Buffer.from(JSON.stringify({
  type: 'service_account', project_id: P, private_key_id: 'kid', private_key: PEM,
  client_email: `qa@${P}.iam.gserviceaccount.com`, client_id: '1', token_uri: 'https://oauth2.googleapis.com/token',
})).toString('base64');

describe('GMAIL_QA_FUNCTIONS', () => {
  it('names the Gmail checklist functions and the few the screens call, and nothing else', () => {
    expect([...GMAIL_QA_FUNCTIONS].sort()).toEqual([
      'adminGetImpersonationSession', 'barry-approve-send', 'check-replies', 'get-templates',
      'gmail-disconnect', 'gmail-get-thread', 'gmail-oauth-callback', 'gmail-oauth-init', 'gmail-poll-replies',
      'gmail-send', 'gmail-send-quick', 'gmail-send-wave', 'save-template', 'send-welcome-email', 'stickersConfig',
    ]);
  });

  it('leaves the sticker and billing lists unchanged', () => {
    expect(STICKER_QA_FUNCTIONS).toHaveLength(5);
    expect(BILLING_JOURNEY_FUNCTIONS).toHaveLength(8);
  });

  it('every one exists in this checkout', () => {
    for (const name of GMAIL_QA_FUNCTIONS) expect(existsSync(join(REPO, 'netlify/functions', `${name}.js`)), name).toBe(true);
  });

  it('is served from a private temporary folder of links, removed afterwards', () => {
    const folder = functionsFolder(REPO, GMAIL_QA_FUNCTIONS);
    expect(relative(REPO, folder.path).startsWith('..')).toBe(true);
    expect(statSync(folder.path).mode & 0o777).toBe(0o700);
    expect(readdirSync(folder.path).sort()).toEqual(GMAIL_QA_FUNCTIONS.map((n) => `${n}.js`).sort());
    for (const name of GMAIL_QA_FUNCTIONS) {
      expect(realpathSync(join(folder.path, `${name}.js`))).toBe(realpathSync(join(REPO, 'netlify/functions', `${name}.js`)));
    }
    folder.remove();
    expect(existsSync(folder.path)).toBe(false);
    expect(devArgs({ noEdgeFunctions: true, functionsDir: '/x' })).toContain('/x');
  });
});

describe('the launcher', () => {
  const run = (args) => {
    const file = join(mkdtempSync(join(tmpdir(), 'gmailqa-env-')), '.env.staging');
    writeFileSync(file, Object.entries({
      VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: `${P}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: P,
      VITE_FIREBASE_STORAGE_BUCKET: 'b', VITE_FIREBASE_MESSAGING_SENDER_ID: '1', VITE_FIREBASE_APP_ID: 'a',
    }).map(([k, v]) => `${k}="${v}"`).join('\n'));
    try {
      return { status: 0, out: execFileSync(process.execPath, [LAUNCHER, `--env=${file}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PRODUCTION_FIREBASE_PROJECT_ID: 'acme-prod', [KEY_VARIABLE]: key() } }) };
    } catch (err) {
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('refuses --only-gmail-functions without --gmail, before starting anything', () => {
    const { status, out } = run(['--only-gmail-functions']);
    expect(status).toBe(1);
    expect(out).toContain('--only-gmail-functions is for a Gmail run');
    expect(out).not.toContain(KEY_LINE);
  });

  it('still refuses --gmail with the sticker or billing modes', () => {
    for (const other of ['--only-sticker-functions', '--only-billing-functions', '--billing']) {
      const { status, out } = run(['--gmail', '--only-gmail-functions', other]);
      expect(status).toBe(1);
      expect(out).toContain('--gmail runs alone');
    }
  });
});
