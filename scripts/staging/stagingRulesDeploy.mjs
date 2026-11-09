#!/usr/bin/env node
/**
 * STAGING ONLY: deploy firestore.rules to the staging project the app's env
 * file names, and nowhere else (docs/contact-hub/STICKERS_STAGING_RUNBOOK.md §3.4).
 *
 * The browser, the functions, sign-in and the rules must all use one
 * non-production project. This takes that project from the env file
 * `netlify dev` runs with, and refuses unless:
 *   - the env file passes every stagingPreflight.mjs check (same project for
 *     browser, functions and auth domain; staging id; not production; no
 *     integration keys; not committable);
 *   - --project repeats the env file's project;
 *   - the target passes the rollout tool's guard (stickersStaging.mjs): listed
 *     in STICKERS_STAGING_PROJECTS, looks like staging, the deploy credential
 *     belongs to it, not PRODUCTION_FIREBASE_PROJECT_ID.
 * The credential is STAGING_SERVICE_ACCOUNT_KEY (the key itself, for a cloud
 * session) or GOOGLE_APPLICATION_CREDENTIALS (a key file), never both
 * (stagingCredentials.mjs). An inline key is handed to firebase-tools as a
 * private temporary file that is deleted as soon as it exits; nothing prints it.
 * It deploys firestore:rules only: no indexes, functions or hosting.
 * The rules are the ones committed at HEAD: it names the commit, and refuses
 * a firestore.rules with uncommitted changes unless --allow-modified-rules
 * (only for the QA plan's lockdown drill, which deploys a deliberate variant).
 * Three steps, each explicit:
 *   (default)   dry run: prints the one command it would run, contacts nothing
 *   --validate  firebase-tools `--dry-run` against the staging project: checks
 *               the credential, the permissions and the rules, deploys nothing
 *   --apply     deploys
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/staging-service-account.json
 *   export STICKERS_STAGING_PROJECTS=<staging-id>
 *   export PRODUCTION_FIREBASE_PROJECT_ID=<production id>
 *   node scripts/staging/stagingRulesDeploy.mjs --env=/path/outside/repo/.env.staging --project=<staging-id>
 *   node scripts/staging/stagingRulesDeploy.mjs --env=/path/outside/repo/.env.staging --project=<staging-id> --validate
 *   node scripts/staging/stagingRulesDeploy.mjs --env=/path/outside/repo/.env.staging --project=<staging-id> --apply
 *   (lockdown drill only) … --allow-modified-rules --apply
 */
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { checkStagingEnv, parseEnvFile, committable, repoRoot } from './stagingPreflight.mjs';
import { checkStagingTarget, StagingRefusal } from './stickersStaging.mjs';
import {
  readStagingCredential, withCredential, checkCredential, temporaryKeyFile, describe, CredentialRefusal, KEY_VARIABLE, FILE_VARIABLE,
} from './stagingCredentials.mjs';

/** The deploy to run, or why not. Pure. */
export function planRulesDeploy({
  env, project, credentialsProjectId = null, allowlist = '', productionProjectId = null, fileCommittable = false,
  rulesModified = false, allowModifiedRules = false, extraChecks = [],
}) {
  const problems = extraChecks.filter((r) => !r.ok).map((r) => `${r.id}: ${r.message}`);
  if (rulesModified && !allowModifiedRules) {
    problems.push('firestore.rules has uncommitted changes. Deploy committed rules, or pass --allow-modified-rules for the lockdown drill.');
  }
  for (const r of checkStagingEnv(env, { productionProjectId, fileCommittable })) {
    if (!r.ok) problems.push(`${r.id}: ${r.message}`);
  }
  if (!project) problems.push('--project is required.');
  else if (project !== env.FIREBASE_PROJECT_ID) problems.push('--project must be the project the env file names (FIREBASE_PROJECT_ID).');
  if (project) {
    try {
      checkStagingTarget({ projectId: project, credentialsProjectId, allowlist, productionProjectId });
    } catch (err) {
      if (!(err instanceof StagingRefusal)) throw err;
      problems.push(err.message);
    }
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, command: ['npx', '--yes', 'firebase-tools@15', 'deploy', '--only', 'firestore:rules', '--project', project, '--non-interactive'] };
}

/** { commit, modified }: the HEAD commit, and whether firestore.rules differs from it. */
export function rulesProvenance(root = repoRoot()) {
  try {
    const commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const diff = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', 'firestore.rules'], { encoding: 'utf8' }).trim();
    return { commit, modified: diff !== '' };
  } catch {
    return { commit: null, modified: true };
  }
}

function main() {
  const argv = process.argv.slice(2);
  const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const apply = argv.includes('--apply');
  const validate = argv.includes('--validate');
  if (apply && validate) { console.error('Refused: pass --validate or --apply, not both.'); return 1; }
  const allowModifiedRules = argv.includes('--allow-modified-rules');
  const envPath = value('env');
  if (!envPath) { console.error('Refused: pass --env=<path to the staging env file>.'); return 1; }
  let env;
  let credential = null;
  try {
    env = parseEnvFile(readFileSync(resolve(envPath), 'utf8'));
  } catch (err) {
    console.error(`Refused: could not read the env file (${err.code ?? err.name}).`);
    return 1;
  }
  try {
    credential = readStagingCredential(process.env);
  } catch (err) {
    if (!(err instanceof CredentialRefusal)) throw err;
    console.error(`Refused: ${err.message}`);
    return 1;
  }
  const provenance = rulesProvenance();
  const plan = planRulesDeploy({
    env: withCredential(env, credential),
    project: value('project'),
    credentialsProjectId: credential?.projectId ?? null,
    extraChecks: checkCredential(env, credential),
    allowlist: process.env.STICKERS_STAGING_PROJECTS ?? '',
    productionProjectId: process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? null,
    fileCommittable: committable(resolve(envPath)),
    rulesModified: provenance.modified,
    allowModifiedRules,
  });
  if (!plan.ok) {
    for (const p of plan.problems) console.error(`  ✗ ${p}`);
    console.error('\nRefused: nothing was deployed.');
    return 1;
  }
  console.log(`Target: ${value('project')} (browser, functions, auth domain and rules all agree)`);
  console.log(`Rules:  firestore.rules at ${provenance.commit ?? 'an unknown commit'}${provenance.modified ? ' WITH LOCAL CHANGES (lockdown drill)' : ''}`);
  console.log(`Credential: ${describe(credential)}, a service account of ${credential.projectId}`);
  const command = validate ? [...plan.command, '--dry-run'] : plan.command;
  console.log(`Command: ${command.join(' ')}`);
  if (!apply && !validate) {
    console.log('\nDry run: nothing was contacted or deployed. Next: --validate (checks against the staging project, deploys nothing), then --apply.');
    return 0;
  }
  // The child gets a credential FILE, never the inline key variable.
  const key = credential.source === KEY_VARIABLE ? temporaryKeyFile(credential) : null;
  // An empty firebase-tools config: firebase-tools prefers an account signed in
  // with `firebase login` (or FIREBASE_TOKEN) over GOOGLE_APPLICATION_CREDENTIALS,
  // which on a laptop would deploy as the owner instead of the staging account.
  const firebaseConfig = mkdtempSync(join(tmpdir(), 'staging-firebase-config-'));
  chmodSync(firebaseConfig, 0o700);
  const childEnv = { ...process.env, [FILE_VARIABLE]: key ? key.path : credential.path, XDG_CONFIG_HOME: firebaseConfig };
  delete childEnv[KEY_VARIABLE];
  delete childEnv.FIREBASE_TOKEN;
  const cleanUp = () => { key?.remove(); rmSync(firebaseConfig, { recursive: true, force: true }); };
  // Ctrl-C, SIGTERM or SIGHUP still clean up (only SIGKILL cannot).
  const onSignal = () => { cleanUp(); process.exit(130); };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.once(signal, onSignal);
  try {
    const run = spawnSync(command[0], command.slice(1), { cwd: repoRoot(), stdio: 'inherit', env: childEnv });
    if (validate && run.status === 0) console.log('\nValidated against the staging project: nothing was deployed. Add --apply to deploy.');
    return run.status ?? 1;
  } finally {
    cleanUp();
    for (const signal of signals) process.removeListener(signal, onSignal);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = main();
