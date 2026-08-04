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
 *   For every users/{userId}/contacts/{contactId}:
 *     - If `is_archived` is missing → write `is_archived = false`
 *     - If `is_archived` already exists → skip, whatever its value
 *
 *   It never overwrites an existing value. A contact archived by the user
 *   stays archived; a contact archived through Barry (which writes
 *   `is_archived: true`) stays archived.
 *
 *   One exception is reported but NOT written: documents whose `status` is
 *   'people_mode_archived' were archived by a left-swipe that never set the
 *   boolean. Those are listed in the summary so you can decide whether to
 *   archive them for real — automatically flipping them to true here would be
 *   this script making a product decision.
 *
 * Usage:
 *
 *   Step 1 — Dry run (read only, no writes, see scope):
 *     node scripts/backfillContactIsArchived.mjs --dry-run
 *
 *   Step 2 — Single user (live write, then verify):
 *     node scripts/backfillContactIsArchived.mjs --user-id=<uid>
 *     node scripts/backfillContactIsArchived.mjs --user-id=<uid> --verify
 *
 *   Step 3 — Full run (all users, then verify):
 *     node scripts/backfillContactIsArchived.mjs
 *     node scripts/backfillContactIsArchived.mjs --verify
 *
 * Flags:
 *   --dry-run          Scan and report only. No Firestore writes.
 *   --user-id=<uid>    Scope to a single user.
 *   --verify           Verification pass: reports contacts still missing the
 *                      field. No writes.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS env var pointing to your service account
 *   JSON, OR a GCP environment with Application Default Credentials.
 *   Set FIREBASE_PROJECT_ID if not auto-detected.
 *
 * Run the dry run first and read the counts. If "missing" is zero, the data is
 * already clean and there is nothing to do.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// ── Parse CLI flags ───────────────────────────────────────

const args = process.argv.slice(2);

const IS_DRY_RUN  = args.includes('--dry-run');
const IS_VERIFY   = args.includes('--verify');
const USER_ID_ARG = args.find(a => a.startsWith('--user-id='));
const TARGET_USER = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID;

const MODE = IS_VERIFY ? 'verify' : IS_DRY_RUN ? 'dry-run' : 'live';

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 450;

// ── Init Firebase Admin ───────────────────────────────────

if (!getApps().length) {
  const appConfig = PROJECT_ID ? { projectId: PROJECT_ID } : {};

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

// ── Counters ─────────────────────────────────────────────

let totalUsers      = 0;
let totalContacts   = 0;
let totalPatched    = 0;
let totalSkipped    = 0;
let totalMissing    = 0;   // verify mode: still missing after the run
let totalSwipeArchived = 0;

const swipeArchivedSamples = [];

// ── Core: process one user's contacts ────────────────────

async function processUser(userId) {
  const contactsRef = db.collection('users').doc(userId).collection('contacts');
  const snap = await contactsRef.get();
  if (snap.empty) return;

  let batch = db.batch();
  let opsInBatch = 0;

  for (const contactDoc of snap.docs) {
    totalContacts++;
    const data = contactDoc.data();
    const hasField = Object.prototype.hasOwnProperty.call(data, 'is_archived');

    // Report-only: left-swiped leads that never got the boolean. Counted
    // whether or not this run writes anything, because the point is to
    // surface them for a human decision.
    if (!hasField && data.status === 'people_mode_archived') {
      totalSwipeArchived++;
      if (swipeArchivedSamples.length < 20) {
        swipeArchivedSamples.push(`user=${userId} contact=${contactDoc.id} name=${data.name ?? '(none)'}`);
      }
    }

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

    totalPatched++;

    if (IS_DRY_RUN) {
      console.log(`  [WOULD PATCH] user=${userId} contact=${contactDoc.id} name=${data.name ?? '(none)'}`);
      continue;
    }

    batch.update(contactDoc.ref, { is_archived: false });
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
  console.log(`\n── backfillContactIsArchived — mode: ${MODE} ──\n`);

  let userIds;
  if (TARGET_USER) {
    userIds = [TARGET_USER];
  } else {
    const usersSnap = await db.collection('users').get();
    userIds = usersSnap.docs.map(d => d.id);
  }

  for (const userId of userIds) {
    totalUsers++;
    await processUser(userId);
  }

  console.log('\n── Summary ──');
  console.log(`  mode:              ${MODE}`);
  console.log(`  users scanned:     ${totalUsers}`);
  console.log(`  contacts scanned:  ${totalContacts}`);
  if (IS_VERIFY) {
    console.log(`  still missing:     ${totalMissing}`);
    console.log(`  already correct:   ${totalSkipped}`);
  } else {
    console.log(`  ${IS_DRY_RUN ? 'would patch' : 'patched'}:       ${totalPatched}`);
    console.log(`  skipped (had it):  ${totalSkipped}`);
  }

  if (totalSwipeArchived > 0) {
    console.log(`\n  ⚠️  ${totalSwipeArchived} contact(s) have status 'people_mode_archived' but no is_archived.`);
    console.log('     They were set to is_archived: false like any other record — a left');
    console.log('     swipe archived them in the UI but never wrote the boolean. Decide');
    console.log('     whether they should be archived for real, then patch deliberately.');
    for (const sample of swipeArchivedSamples) console.log(`       ${sample}`);
    if (totalSwipeArchived > swipeArchivedSamples.length) {
      console.log(`       … and ${totalSwipeArchived - swipeArchivedSamples.length} more`);
    }
  }

  if (IS_VERIFY && totalMissing === 0) {
    console.log('\n  ✅ Every contact has is_archived.');
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Backfill failed:', err);
    process.exit(1);
  });
