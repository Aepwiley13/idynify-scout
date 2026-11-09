#!/usr/bin/env node
/**
 * STAGING ONLY: set the sticker rollout mode and the beta list (ADR-007) in an
 * isolated, non-production Firebase project, for manual QA.
 *
 * It writes two kinds of document and nothing else:
 *   feature_flags/stickers           { mode }
 *   sticker_enrollment/{uid}         { stage: 'beta' }   (or deletes it)
 *
 * It REFUSES to run unless the target is provably not production:
 *   - against the emulator (FIRESTORE_EMULATOR_HOST set): the project must be a
 *     "demo-" project, which cannot reach a real backend;
 *   - against a real project: --project must be listed in
 *     STICKERS_STAGING_PROJECTS, must look like a staging project ("staging"
 *     or "stg" in its id), must be the project the service account belongs
 *     to, and must not be PRODUCTION_FIREBASE_PROJECT_ID when that is set.
 *     The service account is STAGING_SERVICE_ACCOUNT_KEY (the key itself) or
 *     GOOGLE_APPLICATION_CREDENTIALS (a key file), never both
 *     (stagingCredentials.mjs); its key is never printed.
 * No project id is written into this file: the operator names the target, and
 * the guard checks it.
 *
 * Dry run by default: it prints what it would write. --apply writes it.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-service-account.json
 *   export STICKERS_STAGING_PROJECTS=<staging-project-id>
 *   node scripts/staging/stickersStaging.mjs --project=<staging-project-id> --mode=beta --enroll=<uid>
 *   node scripts/staging/stickersStaging.mjs --project=<staging-project-id> --mode=beta --enroll=<uid> --apply
 *
 * Flags: --project=<id> (required) · --mode=off|internal|beta|on · --enroll=<uid> (repeatable)
 *        --unenroll=<uid> (repeatable) · --apply
 */
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { STICKER_MODES, STICKER_ENROLLED_STAGE, STICKER_FLAG_PATH, STICKER_ENROLLMENT_COLLECTION } from '../../src/constants/stickersAccess.js';
import { readStagingCredential, CredentialRefusal, redactKeys } from './stagingCredentials.mjs';

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const MODES = Object.values(STICKER_MODES);

export class StagingRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagingRefusal';
  }
}

export function parseArgs(argv) {
  const args = { project: null, mode: null, enroll: [], unenroll: [], apply: false };
  for (const arg of argv) {
    if (arg.startsWith('--project=')) args.project = arg.slice('--project='.length);
    else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--enroll=')) args.enroll.push(arg.slice('--enroll='.length));
    else if (arg.startsWith('--unenroll=')) args.unenroll.push(arg.slice('--unenroll='.length));
    else if (arg === '--apply') args.apply = true;
    else throw new StagingRefusal(`Unknown argument: ${arg}`);
  }
  if (args.mode !== null && !MODES.includes(args.mode)) throw new StagingRefusal(`--mode must be one of ${MODES.join(', ')}.`);
  for (const uid of [...args.enroll, ...args.unenroll]) if (!UID.test(uid)) throw new StagingRefusal('Not a user id.');
  if (args.enroll.some((uid) => args.unenroll.includes(uid))) throw new StagingRefusal('A user cannot be enrolled and unenrolled at once.');
  if (args.mode === null && !args.enroll.length && !args.unenroll.length) throw new StagingRefusal('Nothing to do: pass --mode, --enroll or --unenroll.');
  return args;
}

/**
 * Is it safe to write rollout documents to this project? Throws StagingRefusal if not.
 * @param {object} input
 * @param {string|null} input.projectId              --project
 * @param {string|null} input.credentialsProjectId   project_id of the service account, if any
 * @param {string|null} input.emulatorHost           FIRESTORE_EMULATOR_HOST
 * @param {string} input.allowlist                   STICKERS_STAGING_PROJECTS (comma-separated)
 * @param {string|null} input.productionProjectId    PRODUCTION_FIREBASE_PROJECT_ID
 */
export function checkStagingTarget({ projectId, credentialsProjectId = null, emulatorHost = null, allowlist = '', productionProjectId = null }) {
  if (!projectId) throw new StagingRefusal('--project is required.');
  if (productionProjectId && projectId === productionProjectId) throw new StagingRefusal('That is the production project.');
  if (emulatorHost) {
    if (!projectId.startsWith('demo-')) throw new StagingRefusal('Against the emulator, use a "demo-" project.');
    return { target: 'emulator' };
  }
  const allowed = allowlist.split(',').map((p) => p.trim()).filter(Boolean);
  if (!allowed.includes(projectId)) throw new StagingRefusal('The project is not listed in STICKERS_STAGING_PROJECTS.');
  if (!/(staging|stg)/.test(projectId)) throw new StagingRefusal('The project id does not look like a staging project.');
  if (!credentialsProjectId) throw new StagingRefusal('A service-account key for the staging project is required (STAGING_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS).');
  if (credentialsProjectId !== projectId) throw new StagingRefusal('The service account belongs to a different project.');
  return { target: 'staging' };
}

/** The writes a run would make, as [path, data | null]. Only the two rollout collections. */
export function planWrites({ mode, enroll, unenroll }) {
  const writes = [];
  if (mode !== null) writes.push([`${STICKER_FLAG_PATH.collection}/${STICKER_FLAG_PATH.doc}`, { mode }]);
  for (const uid of enroll) writes.push([`${STICKER_ENROLLMENT_COLLECTION}/${uid}`, { stage: STICKER_ENROLLED_STAGE }]);
  for (const uid of unenroll) writes.push([`${STICKER_ENROLLMENT_COLLECTION}/${uid}`, null]);
  return writes;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    const credential = emulator ? null : readStagingCredential(process.env);
    const { target } = checkStagingTarget({
      projectId: args.project,
      credentialsProjectId: credential?.projectId ?? null,
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST ?? null,
      allowlist: process.env.STICKERS_STAGING_PROJECTS ?? '',
      productionProjectId: process.env.PRODUCTION_FIREBASE_PROJECT_ID ?? null,
    });
    const writes = planWrites(args);
    console.log(`Target: ${target} project ${args.project}`);
    for (const [path, data] of writes) console.log(`  ${data === null ? 'delete' : 'set   '} ${path}${data ? ` ${JSON.stringify(data)}` : ''}`);
    if (!args.apply) {
      console.log('\nDry run: nothing was written. Add --apply to write.');
      return 0;
    }
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    initializeApp(credential ? { credential: cert(credential.json), projectId: args.project } : { projectId: args.project });
    const db = getFirestore();
    // REST, not gRPC: works behind HTTPS proxies that do not carry gRPC. Same writes.
    if (!emulator) db.settings({ preferRest: true });
    for (const [path, data] of writes) {
      if (data === null) await db.doc(path).delete();
      else await db.doc(path).set(data);
    }
    console.log(`\nWrote ${writes.length} document(s).`);
    return 0;
  } catch (err) {
    const refused = err instanceof StagingRefusal || err instanceof CredentialRefusal;
    console.error(refused ? `Refused: ${err.message}` : `Failed: ${redactKeys(err?.message ?? err)}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().then((code) => { process.exitCode = code; });
