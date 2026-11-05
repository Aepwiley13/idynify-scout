#!/usr/bin/env node
/**
 * STAGING PREFLIGHT: is this environment file safe to run the app against for
 * manual sticker QA? (docs/contact-hub/STICKERS_STAGING_RUNBOOK.md §1–§3)
 *
 * It reads one env file (the one `netlify dev` will use) and checks the
 * runbook's isolation rules. It connects to nothing, writes nothing, and never
 * prints a secret: only variable NAMES and the project id appear in its output.
 *
 *   I1  a separate project: the id contains "staging" or "stg" and is not
 *       PRODUCTION_FIREBASE_PROJECT_ID (which must be set, so this can rule it out)
 *   I3  the service account (FIREBASE_CLIENT_EMAIL) belongs to that project, and
 *       the env file is not one git would commit
 *   I4  the browser (VITE_FIREBASE_*) and the functions (FIREBASE_PROJECT_ID)
 *       name the same project, and the auth domain is that project's
 *   I5  every integration key is empty: Gmail, Stripe, Apollo, LinkedIn,
 *       Barry, email, search and the env admin lists
 *   I6  nothing else feeds the app: this checkout is not linked to a Netlify
 *       site (`netlify dev` would inject that site's variables, which are
 *       production's) and has no root .env file Vite would load alongside
 *
 *   PRODUCTION_FIREBASE_PROJECT_ID=<production id> node scripts/staging/stagingPreflight.mjs --env=/path/outside/repo/.env.staging
 *   (optional) --checkout=<clone the app will run from>; default: this repository
 *
 * Exit 0 only when every check passes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import process from 'node:process';

export const FIREBASE_WEB_KEYS = Object.freeze([
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
]);
export const FIREBASE_SERVER_KEYS = Object.freeze(['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']);

/** Integrations stickers do not need; a staging run must not hold their keys (I5). */
export const INTEGRATION_KEYS = Object.freeze([
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PRO',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_CALENDAR_REDIRECT_URI',
  'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI',
  'APOLLO_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'OPS_ALERT_EMAIL',
  'GOOGLE_VISION_API_KEY', 'GOOGLE_PLACES_API_KEY', 'VITE_GOOGLE_PLACES_API_KEY',
  'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID', 'GOOGLE_CUSTOM_SEARCH_API_KEY', 'GOOGLE_CUSTOM_SEARCH_ENGINE_ID',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'VITE_CRISP_WEBSITE_ID',
  'ADMIN_USER_IDS', 'SUPER_ADMIN_USER_IDS',
]);

/** KEY=value lines; quotes stripped; comments and blanks ignored. Values are never printed. */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).trim().replace(/^export\s+/, '');
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * The checks, as [{ id, ok, message }]. Pure.
 * @param {object} env                       the parsed env file
 * @param {object} options
 * @param {string|null} options.productionProjectId
 * @param {boolean} options.fileCommittable  true when git would commit the env file
 * @param {boolean} options.linkedSite       true when this checkout is linked to a Netlify site
 * @param {string[]} options.rootEnvFiles     .env files in the checkout root that Vite would load
 */
export function checkStagingEnv(env, { productionProjectId = null, fileCommittable = false, linkedSite = false, rootEnvFiles = [] } = {}) {
  const results = [];
  const add = (id, ok, message) => results.push({ id, ok, message });
  const project = env.VITE_FIREBASE_PROJECT_ID ?? '';

  const missingWeb = FIREBASE_WEB_KEYS.filter((k) => !filled(env[k]));
  add('web-config', missingWeb.length === 0, missingWeb.length ? `Missing: ${missingWeb.join(', ')}.` : 'The six VITE_FIREBASE_* values are set.');
  const missingServer = FIREBASE_SERVER_KEYS.filter((k) => !filled(env[k]));
  add('server-config', missingServer.length === 0, missingServer.length ? `Missing: ${missingServer.join(', ')}.` : 'The functions have a project and a service account.');

  add('same-project', filled(project) && env.FIREBASE_PROJECT_ID === project,
    filled(project) && env.FIREBASE_PROJECT_ID === project
      ? `Browser and functions both use ${project}.`
      : 'VITE_FIREBASE_PROJECT_ID and FIREBASE_PROJECT_ID must name the same project.');
  add('looks-like-staging', /(staging|stg)/.test(project),
    /(staging|stg)/.test(project) ? 'The project id says staging.' : 'The project id must contain "staging" or "stg".');
  add('not-production', filled(productionProjectId) && project !== productionProjectId,
    !filled(productionProjectId)
      ? 'Set PRODUCTION_FIREBASE_PROJECT_ID so the production project can be ruled out.'
      : project === productionProjectId ? 'That is the production project.' : 'Not the production project.');

  const domain = env.VITE_FIREBASE_AUTH_DOMAIN ?? '';
  const domainOk = filled(project) && (domain === `${project}.firebaseapp.com` || domain === `${project}.web.app`);
  add('auth-domain', domainOk, domainOk ? 'The auth domain belongs to the project.' : 'VITE_FIREBASE_AUTH_DOMAIN must be <project>.firebaseapp.com (or .web.app).');

  const account = env.FIREBASE_CLIENT_EMAIL ?? '';
  const accountOk = filled(project) && account.endsWith(`@${project}.iam.gserviceaccount.com`);
  add('service-account', accountOk, accountOk ? 'The service account belongs to the project.' : 'FIREBASE_CLIENT_EMAIL must be a service account of this project.');
  const keyOk = /-----BEGIN (RSA )?PRIVATE KEY-----/.test(env.FIREBASE_PRIVATE_KEY ?? '');
  add('private-key', keyOk, keyOk ? 'FIREBASE_PRIVATE_KEY looks like a private key.' : 'FIREBASE_PRIVATE_KEY does not look like a private key.');

  const integrations = INTEGRATION_KEYS.filter((k) => filled(env[k]));
  if (env.VITE_STRIPE_ENABLED === 'true') integrations.push('VITE_STRIPE_ENABLED=true');
  add('no-integrations', integrations.length === 0,
    integrations.length ? `Leave these empty for staging: ${integrations.join(', ')}.` : 'No integration keys are set.');

  add('file-not-committable', !fileCommittable,
    fileCommittable ? 'This env file is inside the repository and not ignored: git could commit it. Move it outside the repo.' : 'Git would not commit this env file.');

  add('netlify-unlinked', !linkedSite,
    linkedSite ? 'This checkout is linked to a Netlify site (.netlify/state.json): `netlify dev` would inject that site\'s variables. Use an unlinked clone, or run `netlify unlink`.' : 'This checkout is not linked to a Netlify site.');
  add('no-root-env', rootEnvFiles.length === 0,
    rootEnvFiles.length ? `Vite would also load ${rootEnvFiles.join(', ')} from this checkout. Remove or move them before starting the app.` : 'No other .env file in this checkout.');
  return results;
}

/** The repository this script belongs to (worked out when asked, not at load). */
export function repoRoot() {
  return resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

/** .env files Vite loads in development, present in the checkout root. */
export const VITE_DEV_ENV_FILES = Object.freeze(['.env', '.env.local', '.env.development', '.env.development.local']);

/** What else would feed `netlify dev` from this checkout: { linkedSite, rootEnvFiles }. */
export function checkoutInputs(root = repoRoot()) {
  return {
    linkedSite: existsSync(join(root, '.netlify', 'state.json')),
    rootEnvFiles: VITE_DEV_ENV_FILES.filter((name) => existsSync(join(root, name))),
  };
}

/** True when the file is inside the repository and git would not ignore it. */
export function committable(file, root = repoRoot()) {
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', rel], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function main() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--env='));
  const checkoutArg = process.argv.slice(2).find((a) => a.startsWith('--checkout='));
  const checkout = checkoutArg ? resolve(checkoutArg.slice('--checkout='.length)) : repoRoot();
  if (!arg) {
    console.error('Refused: pass --env=<path to the staging env file>.');
    return 1;
  }
  const file = resolve(arg.slice('--env='.length));
  let env;
  try {
    env = parseEnvFile(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Refused: could not read the env file (${err.code ?? 'error'}).`);
    return 1;
  }
  const results = checkStagingEnv(env, {
    productionProjectId: process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? null,
    fileCommittable: committable(file),
    ...checkoutInputs(checkout),
  });
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(22)} ${r.message}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\nRefused: ${failed} check(s) failed. Do not start the app against this file.` : '\nPreflight passed. Start the app with `npx netlify dev --offline` from this checkout, then run the in-browser checks in runbook §2.');
  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = main();
