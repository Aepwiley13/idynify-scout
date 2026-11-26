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
 *   (optional) --only-billing-functions
 *                       the billing runbook and the Free → Scout journey
 *                       (docs/billing/STAGING_VALIDATION_RUNBOOK.md): serve only
 *                       BILLING_JOURNEY_FUNCTIONS, the same way, and skip the
 *                       edge-function runtime (as --no-edge-functions, with its
 *                       refusal). Without this, every request on :8888 waits for
 *                       all ~124 functions to finish bundling (minutes) and for the
 *                       edge runtime's download. Also: Vite on its own port
 *                       (BILLING_VITE_PORT, strict, so it never drifts), the ports
 *                       checked first (stagingPorts.mjs: this checkout's leftovers are
 *                       stopped, anything else is named and refused), the app in its
 *                       own process group so stopping the launcher stops all of it,
 *                       and, once it answers, one line from the readiness check: GET /,
 *                       every function, unauthenticated signup/checkout/webhook calls
 *                       refused as they should be, and the app rendered in Chromium.
 *   (optional) --apollo-mock
 *                       start the local Apollo stand-in (apolloMock.mjs, 127.0.0.1 only) and
 *                       point the functions at it with its fixed key. For the end-to-end test.
 *   (optional) --billing
 *                       a billing run (docs/billing/STRIPE_TEST_MODE.md): the env
 *                       file may hold Stripe in TEST MODE ONLY, checked by
 *                       stripeTestMode.mjs. Stripe variables are still never
 *                       taken from the shell, so the env file is the only source.
 *   (optional) --gmail
 *                       a Gmail QA run (docs/gmail/STAGING_GMAIL_OAUTH_CLIENT.md): the env
 *                       file may hold the dedicated staging Google OAuth client and nothing
 *                       else new (gmailStagingMode.mjs). PRODUCTION_GOOGLE_CLIENT_ID must be
 *                       in the shell so production's client is refused. Port 8888 is claimed
 *                       first, because Google returns to exactly
 *                       http://localhost:8888/.netlify/functions/gmail-oauth-callback. Every
 *                       function is served unless --only-gmail-functions is also given.
 *                       Not with --billing or --only-billing-functions.
 *   (optional) --only-gmail-functions
 *                       with --gmail only: serve just GMAIL_QA_FUNCTIONS (the Gmail QA
 *                       checklist's functions and the few the screens call while testing),
 *                       the same way as --only-sticker-functions, and skip the edge runtime
 *                       (as --no-edge-functions). Bundling all ~130 functions can take most of
 *                       an hour on a busy machine, and every page waits for it.
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
import { startApolloMock, APOLLO_MOCK_KEY, DEFAULT_APOLLO_MOCK_PORT } from './apolloMock.mjs';
import { claimPorts, BILLING_VITE_PORT } from './stagingPorts.mjs';
import { browserCheck } from './stagingBrowser.mjs';
import {
  readStagingCredential, withCredential, checkCredential, CredentialRefusal, KEY_VARIABLE, FILE_VARIABLE,
} from './stagingCredentials.mjs';
import { dropFromShellForGmail, PRODUCTION_CLIENT_VARIABLE } from './gmailStagingMode.mjs';

/** Shell variables the app must never inherit. */
export const dropFromShell = (name) => name.startsWith('VITE_') || name.startsWith('FIREBASE_')
  || name.startsWith('STRIPE_') || name.startsWith('BILLING_')
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

/**
 * The functions the billing runbook and the Free → Scout journey call. Everything else answers
 * 404 in --only-billing-functions; the journey's report lists any function the page asked for
 * and did not get, so a missing one cannot pass unseen.
 */
export const BILLING_JOURNEY_FUNCTIONS = Object.freeze([
  'send-welcome-email', // sign up (best effort; staging has no email key, so nothing is sent)
  'stickersConfig', // Contact Hub stickers
  'create-checkout-session', // Upgrade to Scout
  'stripe-webhook', // payment, plan change and renewal events (stripe listen forwards here)
  'change-plan', // Starter → Pro
  'create-portal-session', // Manage billing
  'barryEnrich', // Enrich contact in Scout (Apollo stand-in)
  'barryGenerateContext', // asked for when a Scout person opens; staging has no Claude key
]);

/**
 * The functions Gmail QA (CH-GMAIL-001) calls with --gmail --only-gmail-functions: connect,
 * callback and disconnect; every send path on the checklist; thread view and reply checks; Barry's
 * approve-and-send; and the few that the signup, Contact Hub, shell and template screens call
 * while testing. Everything else answers 404.
 */
export const GMAIL_QA_FUNCTIONS = Object.freeze([
  'gmail-oauth-init', 'gmail-oauth-callback', 'gmail-disconnect',
  'gmail-send-quick', 'gmail-send', 'gmail-send-wave',
  'gmail-get-thread', 'gmail-poll-replies', 'check-replies', 'barry-approve-send',
  'send-welcome-email', // sign up (staging has no email key, so nothing is sent)
  'stickersConfig', // Contact Hub asks for sticker availability on load
  'adminGetImpersonationSession', // the app shell checks for a "view as" session
  'get-templates', 'save-template', // template send regression
]);

/** A private temporary folder (0700) of links to the named functions. Call remove() on exit. */
export function functionsFolder(root, names, { dir = tmpdir() } = {}) {
  const folder = mkdtempSync(join(dir, 'staging-functions-'));
  chmodSync(folder, 0o700);
  try {
    for (const name of names) {
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

export const stickerFunctionsFolder = (root, options) => functionsFolder(root, STICKER_QA_FUNCTIONS, options);

/**
 * Unauthenticated calls each of these must refuse: proof that its code loads and runs (a missing
 * Stripe setting, for example, answers 500), with nothing written and nothing contacted. Signup
 * and checkout refuse without a token (401), the webhook without a Stripe signature (400).
 */
export const BILLING_ENDPOINT_CHECKS = Object.freeze([
  { label: 'signup', name: 'send-welcome-email' },
  { label: 'checkout', name: 'create-checkout-session' },
  { label: 'webhook', name: 'stripe-webhook' },
]);

const refusedAsExpected = (status) => status !== null && status >= 400 && status < 500 && status !== 404;

/**
 * Waits until the app answers GET / with 200, then asks each function for OPTIONS (a CORS
 * preflight: no body, no token, nothing written; 404 means the CLI does not serve it), then makes
 * the endpoint checks above. Returns { ok, ms, status, functions: [{ name, status }],
 * endpoints: [{ label, name, status }] }.
 */
export async function probeReady({ base = 'http://localhost:8888', functions = [], endpoints = [], fetchImpl = fetch, timeoutMs = 180_000, intervalMs = 1_000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), stopped = () => false } = {}) {
  const started = now();
  let status = null;
  while (now() - started < timeoutMs && !stopped()) {
    try {
      status = (await fetchImpl(`${base}/`, { signal: AbortSignal.timeout(10_000) })).status;
      if (status === 200) break;
    } catch {
      status = null;
    }
    await sleep(intervalMs);
  }
  if (status !== 200) return { ok: false, ms: now() - started, status, functions: [], endpoints: [] };
  const ask = async (name, init) => {
    try {
      return (await fetchImpl(`${base}/.netlify/functions/${name}`, { ...init, signal: AbortSignal.timeout(30_000) })).status;
    } catch {
      return null;
    }
  };
  const answers = [];
  for (const name of functions) answers.push({ name, status: await ask(name, { method: 'OPTIONS' }) });
  const refusals = [];
  for (const { label, name } of endpoints) {
    refusals.push({ label, name, status: await ask(name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) });
  }
  const ok = answers.every((a) => a.status !== null && a.status !== 404) && refusals.every((e) => refusedAsExpected(e.status));
  return { ok, ms: now() - started, status, functions: answers, endpoints: refusals };
}

/** The one line the launcher prints once the checks are done. Pure. `browser` is browserCheck's result. */
export function readyLine(result, browser = null, base = 'http://localhost:8888') {
  if (result.status !== 200) return `✗ ${base} did not answer 200 within ${Math.round(result.ms / 1000)} s (last: ${result.status ?? 'no answer'}).`;
  const missing = result.functions.filter((f) => f.status === null || f.status === 404).map((f) => f.name);
  const endpoints = result.endpoints ?? [];
  const wrong = endpoints.filter((e) => !refusedAsExpected(e.status));
  const parts = [`${base} answered 200 after ${Math.round(result.ms / 1000)} s`, `${result.functions.length - missing.length} of ${result.functions.length} functions answer`];
  if (endpoints.length) parts.push(`${endpoints.map((e) => `${e.label} ${e.status ?? 'no answer'}`).join(', ')} (unauthenticated calls refused)`);
  if (browser) parts.push(browser.ok ? `the app renders in Chromium (${Math.round(browser.ms / 1000)} s)` : 'the app does not render in Chromium');
  const faults = [
    ...(missing.length ? [`not answering: ${missing.join(', ')}`] : []),
    ...wrong.map((e) => `${e.label} (${e.name}) answered ${e.status ?? 'nothing'}, expected a refusal`),
    ...(browser && !browser.ok ? browser.problems : []),
  ];
  return faults.length ? `✗ ${parts.join('; ')}. ${faults.join('; ')}.` : `✓ ${parts.join('; ')}. Ready.`;
}

/** The CLI arguments: `netlify dev --offline`, plus the switches asked for. */
export function devArgs({ noEdgeFunctions = false, functionsDir = null, vitePort = null } = {}) {
  return [
    'netlify', 'dev', '--offline',
    ...(noEdgeFunctions ? ['--internal-disable-edge-functions'] : []),
    ...(functionsDir ? ['--functions', functionsDir] : []),
    // Vite on a port of its own, strict: if it cannot have it, it stops instead of moving to the
    // next port while netlify dev keeps proxying to whatever holds this one.
    ...(vitePort ? ['--target-port', String(vitePort), '--command', `npm run dev -- --port ${vitePort} --strictPort`] : []),
  ];
}

/**
 * { ok, problems, childEnv }. Pure: the checks' results come in, the app's
 * environment comes out.
 */
export function planDevRun({ fileEnv, credential, shellEnv = {}, checks = [], rest = false, noEdgeFunctions = false, edgeFunctionsDeclared = false, apolloMockUrl = null, gmail = false }) {
  const problems = checks.filter((r) => !r.ok).map((r) => `${r.id}: ${r.message}`);
  if (!credential) problems.push(`credential: set ${KEY_VARIABLE} or ${FILE_VARIABLE} to the staging service-account key.`);
  if (noEdgeFunctions && edgeFunctionsDeclared) problems.push('edge-functions: this project declares edge functions; run without --no-edge-functions.');
  if (problems.length) return { ok: false, problems };
  const childEnv = {};
  // A Gmail run also drops the shell's Gmail switches, so the Google client, the ingestion mode
  // and Contact Hub's Gmail client can only come from the checked env file.
  for (const [name, value] of Object.entries(shellEnv)) {
    if (!dropFromShell(name) && !(gmail && dropFromShellForGmail(name))) childEnv[name] = value;
  }
  Object.assign(childEnv, withCredential(fileEnv, credential));
  if (rest) childEnv.FIRESTORE_PREFER_REST = 'true';
  // --apollo-mock: the functions talk to the local stand-in (apolloMock.mjs) with its fixed,
  // non-secret key. A real Apollo key is never passed: the env file may not hold one (I5) and
  // the shell's is dropped above.
  if (apolloMockUrl) {
    childEnv.APOLLO_API_KEY = APOLLO_MOCK_KEY;
    childEnv.APOLLO_MOCK_URL = apolloMockUrl;
  }
  return { ok: true, problems: [], childEnv };
}

async function main() {
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
  const billing = argv.includes('--billing');
  const gmail = argv.includes('--gmail');
  if (gmail && (billing || argv.includes('--only-billing-functions') || argv.includes('--only-sticker-functions'))) {
    console.error('Refused: --gmail runs alone. Do not combine it with --billing, --only-billing-functions or --only-sticker-functions.');
    return 1;
  }
  const onlyGmail = argv.includes('--only-gmail-functions');
  if (onlyGmail && !gmail) {
    console.error('Refused: --only-gmail-functions is for a Gmail run; add --gmail.');
    return 1;
  }
  const checks = [
    ...checkStagingEnv(withCredential(fileEnv, credential), {
      productionProjectId: process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? null,
      fileCommittable: committable(file),
      billing,
      gmail,
      productionGoogleClientId: process.env[PRODUCTION_CLIENT_VARIABLE] ?? null,
      ...checkoutInputs(repoRoot()),
    }),
    ...checkCredential(fileEnv, credential),
  ];
  const onlyBilling = argv.includes('--only-billing-functions');
  if (onlyBilling && argv.includes('--only-sticker-functions')) {
    console.error('Refused: use --only-billing-functions or --only-sticker-functions, not both.');
    return 1;
  }
  const noEdgeFunctions = onlyBilling || onlyGmail || argv.includes('--no-edge-functions');
  const wantsMock = argv.includes('--apollo-mock');
  if (onlyBilling) {
    // Refuse on the preflight before stopping anything; then make the ports this run's own.
    const early = planDevRun({ fileEnv, credential, checks, noEdgeFunctions, edgeFunctionsDeclared: hasEdgeFunctions(repoRoot()) });
    if (early.ok) {
      const ports = await claimPorts([8888, BILLING_VITE_PORT, ...(wantsMock ? [DEFAULT_APOLLO_MOCK_PORT] : [])], repoRoot());
      for (const line of ports.stopped) console.log(`  · ${line}`);
      if (!ports.ok) {
        for (const p of ports.problems) console.error(`  ✗ ${p}`);
        console.error('\nRefused: the app was not started, so it cannot be proxied to a server this launcher did not start.');
        return 1;
      }
    }
  }
  if (gmail) {
    // Google returns to :8888 and nowhere else, so this launcher must be what answers there.
    const early = planDevRun({ fileEnv, credential, checks, gmail, noEdgeFunctions, edgeFunctionsDeclared: hasEdgeFunctions(repoRoot()) });
    if (early.ok) {
      const ports = await claimPorts([8888], repoRoot());
      for (const line of ports.stopped) console.log(`  · ${line}`);
      if (!ports.ok) {
        for (const p of ports.problems) console.error(`  ✗ ${p}`);
        console.error('\nRefused: port 8888 is not free, and Google would return the Gmail callback to whatever holds it.');
        return 1;
      }
    }
  }
  const apolloMock = wantsMock ? await startApolloMock({ port: DEFAULT_APOLLO_MOCK_PORT }) : null;
  const plan = planDevRun({
    fileEnv, credential, shellEnv: process.env, checks, rest: argv.includes('--rest'),
    noEdgeFunctions, edgeFunctionsDeclared: hasEdgeFunctions(repoRoot()), apolloMockUrl: apolloMock?.url ?? null, gmail,
  });
  if (!plan.ok) {
    await apolloMock?.close();
    for (const p of plan.problems) console.error(`  ✗ ${p}`);
    console.error('\nRefused: the app was not started.');
    return 1;
  }
  const served = onlyBilling ? BILLING_JOURNEY_FUNCTIONS
    : onlyGmail ? GMAIL_QA_FUNCTIONS
      : argv.includes('--only-sticker-functions') ? STICKER_QA_FUNCTIONS : null;
  let functions = null;
  try {
    functions = served ? functionsFolder(repoRoot(), served) : null;
  } catch (err) {
    await apolloMock?.close();
    console.error(`Refused: ${err.message} This mode needs the integration branch (STAGING_VALIDATION_RUNBOOK.md Part 1).`);
    return 1;
  }
  console.log(`Preflight passed. Starting the app against ${fileEnv.VITE_FIREBASE_PROJECT_ID} (browser, functions and sign-in)${billing ? ', Stripe in test mode' : ''}${gmail ? ', Gmail OAuth with the staging client (open http://localhost:8888)' : ''}${apolloMock ? `, Apollo stand-in at ${apolloMock.url}` : ''}, credential from ${credential.source}${served ? `, serving only: ${served.join(', ')}` : ''}${noEdgeFunctions ? ', edge runtime off' : ''}.`);
  // Billing runs: the CLI, npm and Vite in a process group of their own, stopped together, so no
  // Vite or netlify is left holding a port for the next run. No stdin: a background group that
  // reads the terminal is suspended.
  const child = spawn('npx', devArgs({ noEdgeFunctions, functionsDir: functions?.path, vitePort: onlyBilling ? BILLING_VITE_PORT : null }), {
    cwd: repoRoot(), env: plan.childEnv, ...(onlyBilling ? { stdio: ['ignore', 'inherit', 'inherit'], detached: true } : { stdio: 'inherit' }),
  });
  let exited = false;
  if (onlyBilling) {
    probeReady({ functions: BILLING_JOURNEY_FUNCTIONS, endpoints: BILLING_ENDPOINT_CHECKS, stopped: () => exited })
      .then(async (result) => (result.status === 200 && !exited ? { result, browser: await browserCheck() } : { result, browser: null }))
      .then(({ result, browser }) => { if (!exited) console.log(`\n${readyLine(result, browser)}\n`); });
  }
  const stop = () => { functions?.remove(); apolloMock?.close(); };
  const signalApp = (signal) => {
    try {
      if (onlyBilling) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* already stopped */ }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { signalApp(signal); stop(); process.exit(130); });
  child.on('exit', (code) => { exited = true; if (onlyBilling) signalApp('SIGTERM'); stop(); process.exitCode = code ?? 1; });
  return undefined;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const code = await main();
  if (code !== undefined) process.exitCode = code;
}
