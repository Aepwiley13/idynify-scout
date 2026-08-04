/**
 * BACKFILL: contacts.is_archived
 *
 * One-time migration for the data-integrity sprint.
 *
 * Problem:
 *   Every Scout contact write path built its document by hand and omitted
 *   `is_archived`. Eight read paths filter on it. Firestore does not match
 *   documents that lack a filtered field, so those contacts were invisible to
 *   quick search and to every people lens while showing up normally everywhere
 *   that does not filter on it.
 *
 *   The write paths are fixed as of this sprint. This script fixes the records
 *   already in the database.
 *
 * What this script does:
 *   For every users/{userId}/contacts/{contactId} that has no `is_archived`
 *   field, it infers the value from the record's own archival evidence:
 *
 *     is_archived: true   ← status === 'people_mode_archived', OR a truthy
 *                           `archived_at`. These were deliberately rejected;
 *                           the UI archived them but never wrote the boolean,
 *                           so they must stay out of search.
 *     is_archived: false  ← everything else.
 *
 *   It never overwrites an existing value. A contact already carrying
 *   `is_archived` — true or false — is skipped, so anything archived through
 *   Barry or the normal archive flow keeps the state it has.
 *
 *   Note that `archived_at: null` does NOT count as archived. The people
 *   schema initialises the field to null on unarchived records, so only a
 *   truthy timestamp is treated as evidence.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO RUN — in this order. Do not skip step 2.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   Step 0 — credentials (once per shell):
 *
 *     export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
 *     export FIREBASE_PROJECT_ID=<your-project-id>        # only if not auto-detected
 *
 *   Step 1 — DRY RUN. Reads only. Writes nothing. Prints how many documents
 *            would be updated, split by the value each would receive:
 *
 *     node scripts/backfillContactIsArchived.mjs --dry-run
 *
 *   Step 2 — REVIEW THE OUTPUT before going further. Check that:
 *              · "would set is_archived: true" matches roughly how many leads
 *                you remember rejecting. If it is implausibly large, stop —
 *                that many contacts are about to be hidden from search.
 *              · "would set is_archived: false" is the bulk of the workspace.
 *              · "already correct" plus the two above equals contacts scanned.
 *            Scoping to yourself first is the safest way to sanity-check:
 *
 *     node scripts/backfillContactIsArchived.mjs --dry-run --user-id=<your-uid>
 *
 *   Step 3 — LIVE RUN. Only after step 2 looks right:
 *
 *     node scripts/backfillContactIsArchived.mjs --user-id=<your-uid>   # one user first
 *     node scripts/backfillContactIsArchived.mjs                        # then everyone
 *
 *   Step 4 — VERIFY. Reports any contact still missing the field. Writes
 *            nothing. Expect "Every contact has is_archived.":
 *
 *     node scripts/backfillContactIsArchived.mjs --verify
 *
 * Flags:
 *   --dry-run          Scan and report only. No Firestore writes.
 *   --user-id=<uid>    Scope to a single user. Combines with the other flags.
 *   --verify           Verification pass: reports contacts still missing the
 *                      field. No writes.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS pointing at your service account JSON, OR a
 *   GCP environment with Application Default Credentials.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

// ── The rule ─────────────────────────────────────────────
//
// Exported and unit-tested (src/test/backfillArchivalRule.test.js). This one
// function decides which contacts disappear from search, so it is not left
// buried in a loop where the only way to check it is to run the migration.

/**
 * Should a contact with no `is_archived` field be backfilled as archived?
 *
 * @param   {Object}  data  The contact document.
 * @returns {boolean}
 */
export function inferIsArchived(data = {}) {
  // A left swipe in people mode. The UI archived them; the write recorded
  // status and archived_at but never the boolean.
  if (data.status === 'people_mode_archived') return true;

  // Any archival timestamp is evidence of the same thing from another path.
  // Truthiness matters: the people schema initialises archived_at to null on
  // records that are NOT archived, and Firestore returns that null back.
  if (data.archived_at) return true;

  return false;
}

// ── Parse CLI flags ───────────────────────────────────────

const args = process.argv.slice(2);

const IS_DRY_RUN  = args.includes('--dry-run');
const IS_VERIFY   = args.includes('--verify');
const USER_ID_ARG = args.find(a => a.startsWith('--user-id='));
const TARGET_USER = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;

const MODE = IS_VERIFY ? 'verify' : IS_DRY_RUN ? 'dry-run' : 'live';

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 450;

// ── Counters ─────────────────────────────────────────────

let totalUsers        = 0;
let totalContacts     = 0;
let totalPatchedTrue  = 0;
let totalPatchedFalse = 0;
let totalSkipped      = 0;
let totalMissing      = 0;   // verify mode: still missing

const archivedSamples = [];

// ── Core: process one user's contacts ────────────────────

async function processUser(db, userId) {
  const contactsRef = db.collection('users').doc(userId).collection('contacts');
  const snap = await contactsRef.get();
  if (snap.empty) return;

  let batch = db.batch();
  let opsInBatch = 0;

  for (const contactDoc of snap.docs) {
    totalContacts++;
    const data = contactDoc.data();
    const hasField = Object.prototype.hasOwnProperty.call(data, 'is_archived');

    if (IS_VERIFY) {
      if (!hasField) {
        totalMissing++;
        console.log(`  [MISSING] user=${userId} contact=${contactDoc.id} name=${data.name ?? '(none)'}`);
      } else {
        totalSkipped++;
      }
      continue;
    }

    if (hasField) {
      totalSkipped++;
      continue;
    }

    const value = inferIsArchived(data);

    if (value) {
      totalPatchedTrue++;
      if (archivedSamples.length < 20) {
        archivedSamples.push(
          `user=${userId} contact=${contactDoc.id} name=${data.name ?? '(none)'} status=${data.status ?? '(none)'}`
        );
      }
    } else {
      totalPatchedFalse++;
    }

    if (IS_DRY_RUN) {
      console.log(
        `  [WOULD SET ${String(value).padEnd(5)}] user=${userId} contact=${contactDoc.id} name=${data.name ?? '(none)'}`
      );
      continue;
    }

    batch.update(contactDoc.ref, { is_archived: value });
    opsInBatch++;

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (!IS_VERIFY && !IS_DRY_RUN && opsInBatch > 0) {
    await batch.commit();
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const appConfig = projectId ? { projectId } : {};

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const serviceAccount = JSON.parse(
        readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
      );
      initializeApp({ credential: cert(serviceAccount), ...appConfig });
    } else {
      initializeApp(appConfig);
    }
  }

  const db = getFirestore();

  console.log(`\n── backfillContactIsArchived — mode: ${MODE} ──`);
  if (TARGET_USER) console.log(`   scoped to user: ${TARGET_USER}`);
  if (MODE === 'dry-run') console.log('   NO WRITES WILL BE MADE\n');
  else console.log('');

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

  const verb = IS_DRY_RUN ? 'would set' : 'set';

  console.log('\n── Summary ──');
  console.log(`  mode:                       ${MODE}`);
  console.log(`  users scanned:              ${totalUsers}`);
  console.log(`  contacts scanned:           ${totalContacts}`);

  if (IS_VERIFY) {
    console.log(`  still missing is_archived:  ${totalMissing}`);
    console.log(`  already correct:            ${totalSkipped}`);
  } else {
    console.log(`  ${verb} is_archived: true    ${totalPatchedTrue}   (rejected — stay out of search)`);
    console.log(`  ${verb} is_archived: false   ${totalPatchedFalse}   (live contacts — searchable)`);
    console.log(`  already had the field:      ${totalSkipped}   (untouched)`);
    console.log(`  ────────────────────────────`);
    console.log(`  total documents ${IS_DRY_RUN ? 'to update' : 'updated'}:  ${totalPatchedTrue + totalPatchedFalse}`);
  }

  if (totalPatchedTrue > 0) {
    console.log(`\n  Contacts being archived (first ${Math.min(20, totalPatchedTrue)}):`);
    for (const sample of archivedSamples) console.log(`    ${sample}`);
    if (totalPatchedTrue > archivedSamples.length) {
      console.log(`    … and ${totalPatchedTrue - archivedSamples.length} more`);
    }
    console.log('\n  These will disappear from search. If that number looks wrong, stop here.');
  }

  if (IS_DRY_RUN) {
    console.log('\n  Nothing was written. Re-run without --dry-run once the numbers look right.');
  }
  if (IS_VERIFY && totalMissing === 0) {
    console.log('\n  ✅ Every contact has is_archived.');
  }
  console.log('');
}

// Only run when invoked directly, so the rule above can be imported by tests.
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
