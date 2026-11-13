#!/usr/bin/env node
/**
 * STAGING ONLY: rehearse the billing ledger cutover against the staging Firebase project.
 *
 * It drives the real webhook handler (netlify/functions/stripe-webhook.js) and the real
 * manual-recovery transaction (scripts/manualCreditRecovery.mjs) through the cutover's
 * states: epoch disabled, activation, the epoch boundary, replays, a rollback-window replay,
 * bad signatures, failed deliveries, identity mismatches and manual recovery. The steps and
 * their pass criteria are in scripts/staging/billingRehearsal/steps.mjs.
 *
 * What it never does:
 *   - contact Stripe. Events are fixtures signed locally; the Stripe client is a fixture.
 *     No Stripe key, test or live, is read or needed, and a live key in the shell is refused.
 *   - touch any project but the pinned staging project (billingRehearsal/guard.mjs), with a
 *     credential that belongs to that project. A personal login is refused.
 *   - touch a document it did not create. Every document is under an id carrying the run id,
 *     and clean-up deletes by enumeration, each path checked first.
 *   - deploy rules, or change any function. Deploy staging rules with stagingRulesDeploy.mjs.
 *
 * Three modes, each explicit:
 *   (default)       dry run: checks the environment and prints what a run would do. Contacts
 *                   nothing and writes nothing.
 *   --apply --confirm-project=<staging project id>
 *                   runs the rehearsal. Writes the run's documents, checks them, deletes them.
 *   --cleanup-only --run-id=<id> [--apply --confirm-project=<staging project id>]
 *                   removes what an interrupted run left. Without --apply it lists the
 *                   documents it would look for and contacts nothing.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/staging-credential.json
 *   export PRODUCTION_FIREBASE_PROJECT_ID=<production id>
 *   node scripts/staging/billingRehearsal.mjs
 *   node scripts/staging/billingRehearsal.mjs --apply --confirm-project=<staging id>
 *   (optional) --run-id=<6-24 lowercase letters/digits>   default: a new one
 *   (optional) --keep-data   leave the run's documents in place for inspection
 *
 * Exit 0 only when every check (dry run) or every step (run) passes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import process from 'node:process';
import { repoRoot, checkoutInputs, INTEGRATION_KEYS } from './stagingPreflight.mjs';
import { readStagingCredential, describe, CredentialRefusal, KEY_VARIABLE, FILE_VARIABLE, ADC_MODE } from './stagingCredentials.mjs';
import {
  STAGING_PROJECT, FIXTURE_STRIPE_KEY, FIXTURE_WEBHOOK_SECRET, FIXTURE_PRICES, PROJECT_VARIABLES, REHEARSAL_COLLECTIONS,
  MODE_VARIABLE, CONFIRM_VARIABLE, RUN_ID_VARIABLE, KEEP_VARIABLE, REPORT_VARIABLE,
  RehearsalRefusal, resolveTarget, assertClientProject, readClientProject, assertStripeFixturesOnly, assertRunId, newRunId,
} from './billingRehearsal/guard.mjs';
import { SLOTS, EVENT_LABELS, idsFor } from './billingRehearsal/fixtures.mjs';
import { STEPS } from './billingRehearsal/steps.mjs';

export function parseArgs(argv) {
  const args = { apply: false, cleanupOnly: false, keepData: false, confirmProject: null, runId: null };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a === '--cleanup-only') args.cleanupOnly = true;
    else if (a === '--keep-data') args.keepData = true;
    else if (a.startsWith('--confirm-project=')) args.confirmProject = a.slice('--confirm-project='.length);
    else if (a.startsWith('--run-id=')) args.runId = a.slice('--run-id='.length);
    else throw new RehearsalRefusal(`Unknown argument: ${a.split('=')[0]}`);
  }
  return args;
}

/** Shell variables the run must never inherit: any project, credential, emulator or integration setting. */
export const dropFromShell = (name) => name.startsWith('VITE_') || name.startsWith('FIREBASE_') || name.startsWith('STRIPE_')
  || name.startsWith('BILLING_') || PROJECT_VARIABLES.includes(name) || INTEGRATION_KEYS.includes(name)
  || name === KEY_VARIABLE || name === FILE_VARIABLE || name === 'FIRESTORE_EMULATOR_HOST' || name === 'FIREBASE_AUTH_EMULATOR_HOST';

/**
 * The environment a run would get, or why there will be no run. Pure.
 * Returns { problems: [string], env, runId, mode: 'dry-run' | 'run' | 'cleanup' | 'cleanup-dry-run' }.
 */
export function planRehearsal({ args, shellEnv = {}, credential = null, checkout = { linkedSite: false, rootEnvFiles: [] }, makeRunId = newRunId }) {
  const problems = [];
  const refuse = (fn) => {
    try {
      return fn();
    } catch (err) {
      if (!(err instanceof RehearsalRefusal)) throw err;
      problems.push(err.message);
      return null;
    }
  };

  if (args.cleanupOnly && !args.runId) problems.push('--cleanup-only needs --run-id=<the interrupted run>.');
  if (args.cleanupOnly && args.keepData) problems.push('--keep-data makes no sense with --cleanup-only.');
  const runId = refuse(() => assertRunId(args.runId ?? makeRunId()));

  if (shellEnv[KEY_VARIABLE]) {
    problems.push(`Use ${FILE_VARIABLE} for the rehearsal, not ${KEY_VARIABLE}: the credential stays in a file outside the repository.`);
  }
  if (shellEnv.FIRESTORE_EMULATOR_HOST) {
    problems.push('FIRESTORE_EMULATOR_HOST is set. This tool is for the staging project; the emulator run is `npm run test:billing-emulator`.');
  }
  if (checkout.linkedSite) problems.push('This checkout is linked to a Netlify site (.netlify/state.json). Run the rehearsal from an unlinked checkout.');
  if (checkout.rootEnvFiles.length) problems.push(`Remove these files from the repository root first: ${checkout.rootEnvFiles.join(', ')}.`);
  refuse(() => assertStripeFixturesOnly(shellEnv, { strict: false }));
  if (args.confirmProject !== null && args.confirmProject !== STAGING_PROJECT) {
    problems.push('--confirm-project does not name the staging project.');
  }
  if (args.apply && args.confirmProject === null) problems.push('--apply needs --confirm-project=<the staging project id>.');

  const env = {};
  for (const [name, value] of Object.entries(shellEnv)) {
    if (!dropFromShell(name)) env[name] = value;
  }
  Object.assign(env, {
    FIREBASE_PROJECT_ID: STAGING_PROJECT,
    FIREBASE_ADMIN_CREDENTIALS: ADC_MODE,
    STRIPE_SECRET_KEY: FIXTURE_STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: FIXTURE_WEBHOOK_SECRET,
    ...FIXTURE_PRICES,
    [MODE_VARIABLE]: 'staging',
    // The confirmation is the operator's own, or absent. It is never filled in for them.
    ...(args.confirmProject !== null ? { [CONFIRM_VARIABLE]: args.confirmProject } : {}),
    ...(runId ? { [RUN_ID_VARIABLE]: runId } : {}),
    ...(args.keepData ? { [KEEP_VARIABLE]: '1' } : {}),
    ...(credential?.path ? { [FILE_VARIABLE]: credential.path } : {}),
  });
  if (shellEnv.PRODUCTION_FIREBASE_PROJECT_ID) env.PRODUCTION_FIREBASE_PROJECT_ID = shellEnv.PRODUCTION_FIREBASE_PROJECT_ID;

  // The same check the run itself repeats before it imports the Firestore client. In a dry
  // run the confirmation is not required yet, so it is supplied for this evaluation only.
  refuse(() => resolveTarget(args.apply ? env : { ...env, [CONFIRM_VARIABLE]: STAGING_PROJECT }, { credential }));
  refuse(() => assertStripeFixturesOnly(env));

  const mode = args.cleanupOnly ? (args.apply ? 'cleanup' : 'cleanup-dry-run') : (args.apply ? 'run' : 'dry-run');
  return { problems, env, runId, mode };
}

/** What a run will create, derived from the run id alone. */
export function describeRun(runId) {
  const ids = idsFor(runId);
  return {
    users: SLOTS.map((slot) => `users/${ids.uid(slot)}`),
    collections: [...REHEARSAL_COLLECTIONS],
    eventIds: SLOTS.length * EVENT_LABELS.length,
    steps: STEPS.map((s) => `${s.id}  ${s.title}`),
  };
}

function printPlan(plan, credential) {
  const run = describeRun(plan.runId);
  console.log(`Target project:  ${STAGING_PROJECT}`);
  console.log(`Credential:      ${describe(credential)}, for ${credential.projectId}`);
  console.log('Stripe:          fixture client and locally signed events only. No Stripe account is contacted.');
  console.log(`Run id:          ${plan.runId}`);
  console.log(`Writes only to:  ${run.collections.join(', ')}`);
  console.log(`Synthetic users: ${run.users.length} (${run.users[0]} …)`);
  console.log('Steps:');
  for (const line of run.steps) console.log(`  ${line}`);
}

function runVitest(plan) {
  const root = repoRoot();
  const dir = mkdtempSync(join(tmpdir(), 'billing-rehearsal-'));
  const reportPath = join(dir, 'report.json');
  try {
    const config = fileURLToPath(new URL('./billingRehearsal/vitest.config.mjs', import.meta.url));
    const result = spawnSync('npx', ['vitest', 'run', '--config', config], {
      cwd: root, env: { ...plan.env, [REPORT_VARIABLE]: reportPath }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    });
    let report = null;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      report = null;
    }
    return { status: result.status, report, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printReport(report) {
  for (const step of report.steps) {
    console.log(`${step.pass ? 'PASS' : 'FAIL'}  ${step.id}  ${step.title}`);
    for (const check of step.checks.filter((c) => !c.ok)) console.log(`        ✗ ${check.name}: ${check.detail}`);
  }
  const ran = report.steps.length;
  const passed = report.steps.filter((s) => s.pass).length;
  console.log(`\n${passed}/${STEPS.length} steps passed (${ran} ran) on ${report.projectId}, run id ${report.runId}.`);
  if (report.cleanup?.deleted) console.log(`Clean-up removed ${report.cleanup.deleted.length} documents.`);
  if (report.cleanup?.kept) console.log(`Data kept on request: ${report.cleanup.kept.length} documents. Remove with --cleanup-only --run-id=${report.runId}.`);
  if (report.safetyNetCleanup) console.log(`The run stopped early; the safety net ${report.safetyNetCleanup.error ? `could not clean up (${report.safetyNetCleanup.error})` : `removed ${report.safetyNetCleanup.deleted.length} documents`}.`);
  return ran === STEPS.length && passed === STEPS.length;
}

async function cleanup(plan) {
  for (const [name, value] of Object.entries(plan.env)) process.env[name] = value;
  for (const name of Object.keys(process.env)) {
    if (!(name in plan.env)) delete process.env[name];
  }
  // The same two checks a run makes, in the same order: the environment, then the live SDK.
  const target = resolveTarget(process.env, { credential: readStagingCredential(process.env) });
  if (target.mode !== 'staging') throw new RehearsalRefusal('Clean-up did not resolve to the staging project.');
  const { db } = await import('../../netlify/functions/firebase-admin.js');
  const { getApp } = await import('firebase-admin/app');
  assertClientProject(target, readClientProject(db, getApp()));
  const { deleteRunDocs } = await import('./billingRehearsal/cleanup.mjs');
  const done = await deleteRunDocs(db, plan.runId);
  console.log(`Removed ${done.deleted.length} documents for run ${plan.runId}; ${done.remaining} remain.`);
  for (const path of done.deleted) console.log(`  ${path}`);
  return done.remaining === 0;
}

async function main() {
  let args;
  let credential = null;
  const problems = [];
  try {
    args = parseArgs(process.argv.slice(2));
    credential = readStagingCredential(process.env);
  } catch (err) {
    if (!(err instanceof RehearsalRefusal) && !(err instanceof CredentialRefusal)) throw err;
    console.error(`REFUSED: ${err.message}`);
    process.exit(1);
  }
  const plan = planRehearsal({ args, shellEnv: process.env, credential, checkout: checkoutInputs(repoRoot()) });
  problems.push(...plan.problems);
  if (problems.length) {
    console.error('REFUSED. Nothing was contacted and nothing was written.');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (plan.mode === 'dry-run') {
    printPlan(plan, credential);
    console.log('\nDRY RUN: nothing was contacted and nothing was written.');
    console.log(`To run it: add --apply --confirm-project=<the staging project id> (and --run-id=${plan.runId} to keep this id).`);
    process.exit(0);
  }
  if (plan.mode === 'cleanup-dry-run') {
    const run = describeRun(plan.runId);
    console.log(`Would look for and remove run ${plan.runId}'s documents in ${STAGING_PROJECT}: ${run.users.length} users, their allocation markers,`);
    console.log(`up to ${run.eventIds} event-ledger entries, parked events and review records. Nothing else is read or deleted.`);
    console.log('\nDRY RUN: nothing was contacted and nothing was written. Add --apply --confirm-project=<the staging project id> to remove them.');
    process.exit(0);
  }
  if (plan.mode === 'cleanup') process.exit((await cleanup(plan)) ? 0 : 1);

  printPlan(plan, credential);
  console.log('\nRunning…\n');
  const { status, report, output } = runVitest(plan);
  if (!report) {
    console.error('The run produced no report. Its output follows.\n');
    console.error(output);
    console.error(`\nIf it wrote anything, remove it with: --cleanup-only --run-id=${plan.runId} --apply --confirm-project=<the staging project id>`);
    process.exit(1);
  }
  if (report.steps.length === 0) {
    console.error('No step ran: the run refused or failed during start-up. Its output follows.\n');
    console.error(output);
  }
  const allPassed = printReport(report);
  process.exit(allPassed && status === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof RehearsalRefusal || err instanceof CredentialRefusal ? `REFUSED: ${err.message}` : err);
    process.exit(1);
  });
}
