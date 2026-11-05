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
 *     (GOOGLE_APPLICATION_CREDENTIALS) belongs to it, not
 *     PRODUCTION_FIREBASE_PROJECT_ID.
 * It deploys firestore:rules only: no indexes, functions or hosting.
 * Dry run unless --apply: it prints the one command it would run.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/staging-service-account.json
 *   export STICKERS_STAGING_PROJECTS=<staging-id>
 *   export PRODUCTION_FIREBASE_PROJECT_ID=<production id>
 *   node scripts/staging/stagingRulesDeploy.mjs --env=/path/outside/repo/.env.staging --project=<staging-id>
 *   node scripts/staging/stagingRulesDeploy.mjs --env=/path/outside/repo/.env.staging --project=<staging-id> --apply
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { checkStagingEnv, parseEnvFile, committable, repoRoot } from './stagingPreflight.mjs';
import { checkStagingTarget, StagingRefusal } from './stickersStaging.mjs';

/** The deploy to run, or why not. Pure. */
export function planRulesDeploy({ env, project, credentialsProjectId = null, allowlist = '', productionProjectId = null, fileCommittable = false }) {
  const problems = [];
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

function main() {
  const argv = process.argv.slice(2);
  const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const apply = argv.includes('--apply');
  const envPath = value('env');
  if (!envPath) { console.error('Refused: pass --env=<path to the staging env file>.'); return 1; }
  let env;
  let credentialsProjectId = null;
  try {
    env = parseEnvFile(readFileSync(resolve(envPath), 'utf8'));
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credentialsProjectId = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).project_id ?? null;
    }
  } catch (err) {
    console.error(`Refused: could not read the env file or the credential (${err.code ?? err.name}).`);
    return 1;
  }
  const plan = planRulesDeploy({
    env,
    project: value('project'),
    credentialsProjectId,
    allowlist: process.env.STICKERS_STAGING_PROJECTS ?? '',
    productionProjectId: process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? null,
    fileCommittable: committable(resolve(envPath)),
  });
  if (!plan.ok) {
    for (const p of plan.problems) console.error(`  ✗ ${p}`);
    console.error('\nRefused: nothing was deployed.');
    return 1;
  }
  console.log(`Target: ${value('project')} (browser, functions, auth domain and rules all agree)`);
  console.log(`Command: ${plan.command.join(' ')}`);
  if (!apply) {
    console.log('\nDry run: nothing was deployed. Add --apply to deploy the rules to this staging project.');
    return 0;
  }
  const run = spawnSync(plan.command[0], plan.command.slice(1), { cwd: repoRoot(), stdio: 'inherit', env: process.env });
  return run.status ?? 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = main();
