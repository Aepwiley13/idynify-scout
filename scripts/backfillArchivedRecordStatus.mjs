#!/usr/bin/env node
/**
 * backfillArchivedRecordStatus — repair rows that are archived but do not say so.
 *
 * WHAT IS BROKEN
 * ──────────────
 * `readRecordStatus` checks `record_status` BEFORE `is_archived`. Scout creates
 * contacts stamped `record_status: 'suggested'`, and until the archive
 * write-path fix the archive paths wrote only `is_archived` and a legacy
 * `status`. So an archived row kept reading back as a live suggestion:
 *
 *   { status: 'people_mode_archived', is_archived: true, record_status: 'suggested' }
 *     readRecordStatus  ->  'suggested'   ← the stale field wins
 *
 * The audited workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2 holds 7 such rows.
 *
 * WHAT ALREADY PROTECTS THEM — AND WHY THIS IS STILL WORTH DOING
 * ──────────────────────────────────────────────────────────────
 * PR #640 made `engagementPromotionFields` refuse to promote anything carrying
 * an archive signal, so nothing acts on these rows any more: they cannot be
 * silently un-archived by a send. This migration is therefore NOT urgent, and
 * it is not a fix for an active incident.
 *
 * It is worth doing because the rows are still internally contradictory, and
 * every reader that consults `record_status` without also consulting
 * `hasArchiveSignal` will get the wrong answer from them. The guard makes the
 * contradiction harmless at one call site. This removes the contradiction.
 *
 * THE RULE, AND WHAT IT DELIBERATELY DOES NOT DO
 * ──────────────────────────────────────────────
 * Repairs exactly one class: a row that HAS an archive signal and whose
 * `record_status` is present and says something else. It sets
 * `record_status: 'archived'` and nothing else.
 *
 *   · It never UN-archives. Every write moves a row toward archived, never
 *     away from it. A backfill that could restore a contact the user archived
 *     is a backfill that can undo a user's decision, and no dry run makes that
 *     safe to automate.
 *
 *   · It does not touch `relationship_status` or `stage`. Archiving changes
 *     the record lifecycle only — an archived customer in Basecamp is still a
 *     customer, and still in Basecamp. (This is the same reason the write-path
 *     fix writes `record_status` explicitly rather than calling
 *     `createStatusFields`, which would reset both.)
 *
 *   · It does not touch the legacy `status` field. That field also carries
 *     Apollo enrichment markers ('pending_enrichment', …) which say nothing
 *     about whether a record counts, and clobbering one would lose real state.
 *
 *   · It leaves rows that have NO `record_status` at all alone. Those already
 *     read correctly — `readRecordStatus` falls through to `is_archived` and
 *     the legacy vocabulary and returns 'archived'. There is no contradiction
 *     to repair, so writing to them would be churn, not a fix. They are
 *     counted and reported so the number is visible rather than assumed.
 *
 * IT ALSO REPORTS A SECOND CLASS IT WILL NOT REPAIR
 * ─────────────────────────────────────────────────
 * Rows that read as archived but carry no `is_archived: true` — measured
 * fleet-wide as 134, and every one of them has the boolean ABSENT rather than
 * false. None has `restored_at`. So these are not contacts stuck after a
 * restore; they are legacy rows written before any Scout path set
 * `is_archived` at all (the gap PR #510 closed).
 *
 * They are NOT contradictory: `readRecordStatus` resolves them to 'archived'
 * correctly through the legacy vocabulary, and `hasArchiveSignal` sees them.
 * Nothing about them is wrong for this migration to fix. They matter only to
 * Firestore queries shaped `where('is_archived','==',false)`, which an absent
 * field does not match — and that is exactly what
 * `scripts/backfillContactIsArchived.mjs` already exists to repair.
 *
 * They are counted here for visibility and pointed at that script. If a row
 * ever shows up with `is_archived: false` EXPLICITLY, that would be a genuine
 * stuck-after-restore case and a human should look at it — the report calls
 * that out separately.
 *
 * USAGE
 * ─────
 *   Dry run is the DEFAULT. A live run needs --live, explicitly.
 *
 *     node scripts/backfillArchivedRecordStatus.mjs
 *     node scripts/backfillArchivedRecordStatus.mjs --user-id=<uid>
 *     node scripts/backfillArchivedRecordStatus.mjs --live
 *
 *   Credentials — GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT_PATH)
 *   pointing at a service-account JSON, or ambient application default creds:
 *
 *     GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json \
 *       node scripts/backfillArchivedRecordStatus.mjs
 *
 *   Run from the project root so firebase-admin resolves from node_modules.
 *
 *   NOTE ON THE READ-ONLY KEY: the service-account key used to audit this
 *   workspace has Firestore READ scope only. A --live run with it dies on the
 *   first write with gRPC code 7 ('Missing or insufficient permissions'),
 *   before committing anything — the failure is clean and nothing is partially
 *   applied. The live pass needs a key with write scope.
 *
 * FLAGS
 *   --live             Actually write. Without it, nothing is written.
 *   --dry-run          Explicit no-write mode. Already the default.
 *   --user-id=<uid>    Restrict to one user. Otherwise every user is scanned.
 *   --verify           Re-scan and report how many contradictions remain.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

import {
  RECORD_STATUS,
  readRecordStatus,
  hasArchiveSignal,
} from '../src/constants/statusModel.js';

// ── The rule ─────────────────────────────────────────────
//
// Both halves come from the application's own status model — `hasArchiveSignal`
// and `readRecordStatus` are imported, not restated, because a migration that
// disagrees with the runtime is worse than no migration at all.

/**
 * Is this row archived while its `record_status` claims otherwise?
 *
 * Requires `record_status` to be PRESENT. A row without it already reads as
 * archived through the fallback chain and has nothing to repair.
 *
 * @param   {Object}  data  The contact document.
 * @returns {boolean}
 */
export function needsArchivedStamp(data = {}) {
  if (!hasArchiveSignal(data)) return false;
  if (data.record_status === undefined || data.record_status === null) return false;
  return data.record_status !== RECORD_STATUS.ARCHIVED;
}

/**
 * Reads as archived, but carries no `is_archived: true`.
 *
 * Reported, never repaired. Measured fleet-wide these are all MISSING the
 * boolean rather than holding false — legacy rows from before any write path
 * set it. They read correctly and belong to backfillContactIsArchived.mjs.
 *
 * @param   {Object}  data  The contact document.
 * @returns {boolean}
 */
export function archivedWithoutBooleanFlag(data = {}) {
  if (data.is_archived === true) return false;
  return readRecordStatus(data) === RECORD_STATUS.ARCHIVED;
}

/**
 * The genuinely suspicious shape: `is_archived: false` written EXPLICITLY on a
 * row that still reads as archived. That is a contact a restore failed to
 * release, and a human should decide what it should be.
 *
 * Zero found fleet-wide as of the first run. Separated from the class above so
 * that if one ever appears it is not lost among 134 benign legacy rows.
 *
 * @param   {Object}  data  The contact document.
 * @returns {boolean}
 */
export function stuckAfterRestore(data = {}) {
  if (data.is_archived !== false) return false;
  return readRecordStatus(data) === RECORD_STATUS.ARCHIVED;
}

/**
 * Archived, and correctly silent about it — no `record_status` field at all.
 *
 * Counted for visibility. Deliberately not written to.
 *
 * @param   {Object}  data  The contact document.
 * @returns {boolean}
 */
export function archivedWithNoRecordStatus(data = {}) {
  if (!hasArchiveSignal(data)) return false;
  return data.record_status === undefined || data.record_status === null;
}

// ── Parse CLI flags ───────────────────────────────────────

const args = process.argv.slice(2);

const IS_LIVE     = args.includes('--live');
const IS_VERIFY   = args.includes('--verify');
const USER_ID_ARG = args.find(a => a.startsWith('--user-id='));
const TARGET_USER = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;

// Dry run is the default. --live is the only thing that turns writes on, so
// forgetting a flag can never write; it can only fail to.
const MODE = IS_VERIFY ? 'verify' : IS_LIVE ? 'live' : 'dry-run';

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 450;

// ── Counters ─────────────────────────────────────────────

let totalUsers        = 0;
let totalContacts     = 0;
let totalToRepair     = 0;
let totalNoRecordStat = 0;
let totalNoBoolean    = 0;
let totalStuck        = 0;
let totalAlreadyRight = 0;

const repairSamples = [];
const stuckSamples = [];

/** Keep a small, quotable sample rather than dumping every document. */
function sample(into, userId, docId, data) {
  if (into.length >= 10) return;
  into.push({
    user: userId,
    id: docId,
    status: data.status ?? null,
    is_archived: data.is_archived ?? null,
    record_status: data.record_status ?? null,
    reads_as: readRecordStatus(data),
  });
}

// ── Core: process one user's contacts ────────────────────

async function processUser(db, userId) {
  const contactsRef = db.collection('users').doc(userId).collection('contacts');
  const snap = await contactsRef.get();
  if (snap.empty) return;

  let batch = db.batch();
  let opsInBatch = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    totalContacts++;

    if (stuckAfterRestore(data)) {
      totalStuck++;
      sample(stuckSamples, userId, docSnap.id, data);
      continue;
    }

    if (archivedWithoutBooleanFlag(data)) {
      totalNoBoolean++;
      // Reported only. Belongs to backfillContactIsArchived.mjs.
      continue;
    }

    if (archivedWithNoRecordStatus(data)) {
      totalNoRecordStat++;
      continue;
    }

    if (!needsArchivedStamp(data)) {
      if (hasArchiveSignal(data)) totalAlreadyRight++;
      continue;
    }

    totalToRepair++;
    sample(repairSamples, userId, docSnap.id, data);

    if (MODE === 'live') {
      // The lifecycle field and nothing else. See the header for why
      // createStatusFields is not used here.
      batch.update(docSnap.ref, { record_status: RECORD_STATUS.ARCHIVED });
      opsInBatch++;

      if (opsInBatch >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
  }

  if (MODE === 'live' && opsInBatch > 0) {
    await batch.commit();
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const appConfig = projectId ? { projectId } : {};
    const keyPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (keyPath) {
      const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
      initializeApp({ credential: cert(serviceAccount), ...appConfig });
    } else {
      initializeApp(appConfig);
    }
  }

  const db = getFirestore();

  console.log(`\n── backfillArchivedRecordStatus — mode: ${MODE} ──`);
  if (TARGET_USER) console.log(`   scoped to user: ${TARGET_USER}`);
  if (MODE !== 'live') console.log('   NO WRITES WILL BE MADE — pass --live to write');
  console.log('');

  let userIds;
  if (TARGET_USER) {
    userIds = [TARGET_USER];
  } else {
    const usersSnap = await db.collection('users').get();
    userIds = usersSnap.docs.map(d => d.id);
  }

  for (const userId of userIds) {
    totalUsers++;
    await processUser(db, userId);
  }

  const verb = MODE === 'live' ? 'set' : 'would set';

  console.log('── Results ───────────────────────────────────');
  console.log(`  users scanned:                        ${totalUsers}`);
  console.log(`  contacts scanned:                     ${totalContacts}`);
  console.log('');
  console.log(`  ${verb} record_status: 'archived'      ${totalToRepair}   (archived, but said otherwise)`);
  console.log(`  already correct:                      ${totalAlreadyRight}   (archived and said so)`);
  console.log(`  archived, no record_status field:     ${totalNoRecordStat}   (reads correctly — left alone)`);
  console.log('');
  console.log(`  archived, is_archived flag absent:    ${totalNoBoolean}   (reads correctly — see backfillContactIsArchived.mjs)`);
  console.log(`  ⚠ is_archived FALSE but reads archived: ${totalStuck}   (stuck after a restore — needs a human)`);

  if (repairSamples.length) {
    console.log('\n── Sample of rows to repair ──────────────────');
    for (const s of repairSamples) {
      console.log(`  ${s.id}  status=${s.status}  is_archived=${s.is_archived}  record_status=${s.record_status}  reads_as=${s.reads_as}`);
    }
  }

  if (stuckSamples.length) {
    console.log('\n── Stuck after a restore (NOT repaired) ──────');
    console.log('   is_archived was explicitly set false, yet the row still reads');
    console.log('   archived. Deciding one should be active is a human call.');
    for (const s of stuckSamples) {
      console.log(`  ${s.id}  status=${s.status}  is_archived=${s.is_archived}  record_status=${s.record_status}  reads_as=${s.reads_as}`);
    }
  }

  if (MODE === 'dry-run') {
    console.log('\n  Nothing was written. Re-run with --live once the numbers look right.');
  }
  if (MODE === 'verify') {
    console.log(`\n  ${totalToRepair === 0 ? '✅ No contradictions remain.' : `⚠ ${totalToRepair} contradictions still present.`}`);
  }
  console.log('');
}

// Only run when invoked directly, so the rules above can be imported by tests.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n❌ Backfill failed:', err);
      process.exit(1);
    });
}
