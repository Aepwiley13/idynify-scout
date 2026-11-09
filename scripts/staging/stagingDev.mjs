#!/usr/bin/env node
/**
 * STAGING ONLY: start the app (`netlify dev --offline`) against the staging
 * project, after the preflight passes (docs/contact-hub/STICKERS_STAGING_RUNBOOK.md §2).
 *
 * It re-runs every stagingPreflight.mjs check on the env file, this checkout
 * and the credential, and refuses on any failure. The app then gets:
 *   - the env file's variables (the browser's VITE_FIREBASE_* config);
 *   - the functions' service account from STAGING_SERVICE_ACCOUNT_KEY or
 *     GOOGLE_APPLICATION_CREDENTIALS (stagingCredentials.mjs), in memory only;
 *   - from this shell, only what is not Firebase, a credential or an
 *     integration: any VITE_*, FIREBASE_*, credential or integration variable
 *     already in the shell is dropped, so nothing from another project or
 *     from production reaches the app.
 * --offline keeps the Netlify CLI from fetching any site's settings. Nothing
 * is printed except variable names, the project id and the CLI's own output.
 *
 *   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingDev.mjs --env=/path/outside/repo/.env.staging
 *   (optional) --rest   Firestore Admin over REST instead of gRPC, for HTTPS
 *                       proxies that do not carry gRPC (FIRESTORE_PREFER_REST)
 *   (optional) --only-sticker-functions
 *                       serve only the functions sticker QA uses (STICKER_QA_FUNCTIONS),
 *                       from a private temporary folder of links removed on exit.
 *                       The CLI otherwise bundles all of them at start, which
 *                       can exhaust memory on a small machine; other functions
 *                       then answer 404, which sticker QA never needs.
 *   (optional) --no-edge-functions
 *                       skip the CLI's edge-function runtime, which it downloads
 *                       (Deno) on the first request even when a project has no
 *                       edge functions. Refused when the project declares any,
 *                       so real edge functions are never skipped silently.
 */
import { readFileSync, existsSync, mkdtempSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { checkStagingEnv, parseEnvFile, committable, repoRoot, checkoutInputs, INTEGRATION_KEYS } from './stagingPreflight.mjs';
import {
  readStagingCredential, withCredential, checkCredential, CredentialRefusal, KEY_VARIABLE, FILE_VARIABLE,
} from './stagingCredentials.mjs';

/** Shell variables the app must never inherit. */
const dropFromShell = (name) => name.startsWith('VITE_') || name.startsWith('FIREBASE_')
  || name === KEY_VARIABLE || name === FILE_VARIABLE || INTEGRATION_KEYS.includes(name)
  || name === 'FIRESTORE_EMULATOR_HOST' || name === 'FIREBASE_AUTH_EMULATOR_HOST';

/** True when the project declares edge functions (a folder, or netlify.toml). */
export function hasEdgeFunctions(root) {
  if (existsSync(join(root, 'netlify', 'edge-functions'))) return true;
  try {
    return /^\s*\[\[edge_functions\]\]|edge_functions\s*=/m.test(readFileSync(join(root, 'netlify.toml'), 'utf8'));
  } catch {
    return false;
  }
}

/** The functions sticker QA calls: availability, and "view as" in the admin tools. */
export const STICKER_QA_FUNCTIONS = Object.freeze([
  'stickersConfig', 'adminGetUsers', 'adminStartImpersonation', 'adminGetImpersonationSession', 'adminEndImpersonation',
]);

/** A private temporary folder (0700) of links to those functions. Call remove() on exit. */
export function stickerFunctionsFolder(root, { dir = tmpdir() } = {}) {
  const folder = mkdtempSync(join(dir, 'staging-functions-'));
  chmodSync(folder, 0o700);
  try {
    for (const name of STICKER_QA_FUNCTIONS) {
      const source = join(root, 'netlify', 'functions', `${name}.js`);
      if (!existsSync(source)) throw new Error(`netlify/functions/${name}.js is missing.`);
      symlinkSync(source, join(folder, `${name}.js`));
    }
  } catch (err) {
    rmSync(folder, { recursive: true, force: true });
    throw err;
  }
  return { path: folder, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

/** The CLI arguments: `netlify dev --offline`, plus the switches asked for. */
export function devArgs({ noEdgeFunctions = false, functionsDir = null } = {}) {
  return [
    'netlify', 'dev', '--offline',
    ...(noEdgeFunctions ? ['--internal-disable-edge-functions'] : []),
    ...(functionsDir ? ['--functions', functionsDir] : []),
  ];
}

/**
 * { ok, problems, childEnv }. Pure: the checks' results come in, the app's
 * environment comes out.
 */
export function planDevRun({ fileEnv, credential, shellEnv = {}, checks = [], rest = false, noEdgeFunctions = false, edgeFunctionsDeclared = false }) {
  const problems = checks.filter((r) => !r.ok).map((r) => `${r.id}: ${r.message}`);
  if (!credential) problems.push(`credential: set ${KEY_VARIABLE} or ${FILE_VARIABLE} to the staging service-account key.`);
  if (noEdgeFunctions && edgeFunctionsDeclared) problems.push('edge-functions: this project declares edge functions; run without --no-edge-functions.');
  if (problems.length) return { ok: false, problems };
  const childEnv = {};
  for (const [name, value] of Object.entries(shellEnv)) if (!dropFromShell(name)) childEnv[name] = value;
  Object.assign(childEnv, withCredential(fileEnv, credential));
  if (rest) childEnv.FIRESTORE_PREFER_REST = 'true';
  return { ok: true, problems: [], childEnv };
}

function main() {
  const argv = process.argv.slice(2);
  const envArg = argv.find((a) => a.startsWith('--env='));
  if (!envArg) { console.error('Refused: pass --env=<path to the staging env file>.'); return 1; }
  const file = resolve(envArg.slice('--env='.length));
  let fileEnv;
  let credential;
  try {
    fileEnv = parseEnvFile(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Refused: could not read the env file (${err.code ?? 'error'}).`);
    return 1;
  }
  try {
    credential = readStagingCredential(process.env);
  } catch (err) {
    if (!(err instanceof CredentialRefusal)) throw err;
    console.error(`Refused: ${err.message}`);
    return 1;
  }
  const checks = [
    ...checkStagingEnv(withCredential(fileEnv, credential), {
      productionProjectId: process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? null,
      fileCommittable: committable(file),
      ...checkoutInputs(repoRoot()),
    }),
    ...checkCredential(fileEnv, credential),
  ];
  const noEdgeFunctions = argv.includes('--no-edge-functions');
  const plan = planDevRun({
    fileEnv, credential, shellEnv: process.env, checks, rest: argv.includes('--rest'),
    noEdgeFunctions, edgeFunctionsDeclared: hasEdgeFunctions(repoRoot()),
  });
  if (!plan.ok) {
    for (const p of plan.problems) console.error(`  ✗ ${p}`);
    console.error('\nRefused: the app was not started.');
    return 1;
  }
  const functions = argv.includes('--only-sticker-functions') ? stickerFunctionsFolder(repoRoot()) : null;
  console.log(`Preflight passed. Starting the app against ${fileEnv.VITE_FIREBASE_PROJECT_ID} (browser, functions and sign-in), credential from ${credential.source}${functions ? `, serving only: ${STICKER_QA_FUNCTIONS.join(', ')}` : ''}.`);
  const child = spawn('npx', devArgs({ noEdgeFunctions, functionsDir: functions?.path }), { cwd: repoRoot(), stdio: 'inherit', env: plan.childEnv });
  const stop = () => { functions?.remove(); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { child.kill(signal); stop(); process.exit(130); });
  child.on('exit', (code) => { stop(); process.exitCode = code ?? 1; });
  return undefined;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const code = main();
  if (code !== undefined) process.exitCode = code;
}
