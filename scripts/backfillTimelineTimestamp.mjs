/**
 * BACKFILL: timeline.createdAt → timeline.timestamp
 *
 * One-time migration for Squad Alpha.
 *
 * Problem:
 *   Pre-sprint timeline docs were written with `createdAt` only.
 *   All query-side code uses `orderBy('timestamp', 'desc')`.
 *   Docs missing `timestamp` fall out of timeline ordering.
 *
 * What this script does:
 *   For every users/{userId}/contacts/{contactId}/timeline/{eventId}:
 *     - If `timestamp` is missing AND `createdAt` exists → write `timestamp = createdAt`
 *     - If both are missing → write `timestamp = serverTimestamp()` (last resort, logs warning)
 *     - If `timestamp` already exists → skip (no-op)
 *
 * Usage:
 *
 *   Step 1 — Dry run (read only, no writes, see scope):
 *     node scripts/backfillTimelineTimestamp.mjs --dry-run
 *
 *   Step 2 — Single user (live write, then verify):
 *     node scripts/backfillTimelineTimestamp.mjs --user-id=<uid>
 *     node scripts/backfillTimelineTimestamp.mjs --user-id=<uid> --verify
 *
 *   Step 3 — Full run (all users, then verify):
 *     node scripts/backfillTimelineTimestamp.mjs
 *     node scripts/backfillTimelineTimestamp.mjs --verify
 *
 * Flags:
 *   --dry-run          Scan and report only. No Firestore writes.
 *   --user-id=<uid>    Scope to a single user (combine with --verify as needed).
 *   --verify           Verification pass: reports docs still missing timestamp. No writes.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS env var pointing to your service account JSON,
 *   OR a GCP environment with Application Default Credentials.
 *   Set FIREBASE_PROJECT_ID if not auto-detected.
 *
 * Squad Alpha — run once after deploy, confirm --verify shows zero missing, then
 * remove the `createdAt` dual-write from timelineLogger.js.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// ── Parse CLI flags ───────────────────────────────────────

const args = process.argv.slice(2);

const IS_DRY_RUN = args.includes('--dry-run');
const IS_VERIFY  = args.includes('--verify');
const USER_ID_ARG = args.find(a => a.startsWith('--user-id='));
const TARGET_USER = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID;

// Determine mode
const MODE = IS_VERIFY ? 'verify' : IS_DRY_RUN ? 'dry-run' : 'live';

// ── Init Firebase Admin ───────────────────────────────────

if (!getApps().length) {
  const appConfig = PROJECT_ID ? { projectId: PROJECT_ID } : {};

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const serviceAccount = JSON.parse(
      readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
    );
    initializeApp({ credential: cert(serviceAccount), ...appConfig });
  } else {
    // Application Default Credentials (GCP environment)
    initializeApp(appConfig);
  }
}

const db = getFirestore();

// ── Counters ─────────────────────────────────────────────

let totalUsers    = 0;
let totalContacts = 0;
let totalEvents   = 0;
let totalPatched  = 0;
let totalSkipped  = 0;
let totalMissing  = 0;   // verify mode: docs still missing timestamp
let totalWarnings = 0;

// ── Core: process one contact's timeline ─────────────────

async function processContact(userId, contactId) {
  const timelineRef = db
    .collection('users').doc(userId)
    .collection('contacts').doc(contactId)
    .collection('timeline');

  const snap = await timelineRef.get();
  if (snap.empty) return;

  const batch = db.batch();
  let batchHasWrites = false;

  for (const eventDoc of snap.docs) {
    totalEvents++;
    const data = eventDoc.data();

    // ── Verify mode ───────────────────────────────────────
    if (IS_VERIFY) {
      if (!data.timestamp) {
        totalMissing++;
        console.log(
          `  [MISSING] user=${userId} contact=${contactId} event=${eventDoc.id}` +
          ` createdAt=${data.createdAt ?? 'null'}`
        );
      } else {
        totalSkipped++;
      }
      continue;
    }

    // ── Write modes (live / dry-run) ──────────────────────
    if (data.timestamp) {
      totalSkipped++;
      continue;
    }

    let newTimestamp;

    if (data.createdAt) {
      newTimestamp = data.createdAt;
    } else {
      // No createdAt either — last resort
      console.warn(
        `  [WARN] No createdAt or timestamp — user=${userId} contact=${contactId}` +
        ` event=${eventDoc.id}. Setting timestamp=serverTimestamp().`
      );
      newTimestamp = FieldValue.serverTimestamp();
      totalWarnings++;
    }

    if (MODE === 'live') {
      batch.update(eventDoc.ref, { timestamp: newTimestamp });
      batchHasWrites = true;
    }

    totalPatched++;
  }

  if (MODE === 'live' && batchHasWrites) {
    await batch.commit();
  }
}

// ── Process one user ──────────────────────────────────────

async function processUser(userId) {
  totalUsers++;
  const contactsSnap = await db
    .collection('users').doc(userId)
    .collection('contacts')
    .get();

  if (contactsSnap.empty) return;

  const contactIds = contactsSnap.docs.map(d => d.id);
  totalContacts += contactIds.length;

  // Process contacts in chunks of 10
  const CHUNK_SIZE = 10;
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(cId => processContact(userId, cId)));
  }

  const userSummary = IS_VERIFY
    ? `contacts=${contactIds.length} missing=${totalMissing}`
    : `contacts=${contactIds.length} patched=${totalPatched} skipped=${totalSkipped}`;

  console.log(`  user=${userId} ${userSummary}`);
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  BACKFILL: timeline.createdAt → timeline.timestamp');

  const modeLabel = {
    'live':    '🔴 LIVE — writes enabled',
    'dry-run': '🟡 DRY RUN — no writes',
    'verify':  '🔵 VERIFY — checking for missing timestamps'
  }[MODE];

  console.log(`  Mode: ${modeLabel}`);
  if (TARGET_USER) console.log(`  Scope: user=${TARGET_USER}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  try {
    let userIds;

    if (TARGET_USER) {
      // Single user mode
      userIds = [TARGET_USER];
    } else {
      const usersSnap = await db.collection('users').get();
      if (usersSnap.empty) {
        console.log('  No users found. Nothing to process.');
        process.exit(0);
      }
      userIds = usersSnap.docs.map(d => d.id);
    }

    console.log(`  Found ${userIds.length} user(s). Scanning...\n`);

    for (const userId of userIds) {
      await processUser(userId);
    }

    // ── Summary ───────────────────────────────────────────
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log(`  Users:    ${totalUsers}`);
    console.log(`  Contacts: ${totalContacts}`);
    console.log(`  Events:   ${totalEvents}`);

    if (IS_VERIFY) {
      console.log(`  Missing:  ${totalMissing}`);
      console.log(`  OK:       ${totalSkipped}`);
      console.log('');

      if (totalMissing === 0) {
        console.log('  ✓ All timeline docs have a timestamp. Backfill is complete.');
        console.log('  ✓ Safe to remove createdAt dual-write from timelineLogger.js.');
      } else {
        console.log(`  ✗ ${totalMissing} doc(s) still missing timestamp.`);
        console.log('    Re-run without --verify to apply the patch.');
        process.exit(1);
      }
    } else {
      const appliedLabel = MODE === 'live'
        ? `${totalPatched} (written to Firestore)`
        : `${totalPatched} (dry run — no writes applied)`;

      console.log(`  Patched:  ${appliedLabel}`);
      console.log(`  Skipped:  ${totalSkipped} (already had timestamp)`);

      if (totalWarnings > 0) {
        console.log(`  Warnings: ${totalWarnings} (no createdAt found — investigate)`);
      }

      if (MODE === 'live' && totalPatched > 0) {
        console.log('');
        console.log('  Next: run with --verify to confirm zero missing timestamps.');
        console.log('  Then: remove createdAt dual-write from timelineLogger.js.');
      }

      if (MODE === 'dry-run') {
        console.log('');
        console.log('  Scope looks right? Run without --dry-run to apply.');
        if (TARGET_USER) {
          console.log(`  node scripts/backfillTimelineTimestamp.mjs --user-id=${TARGET_USER}`);
        } else {
          console.log('  node scripts/backfillTimelineTimestamp.mjs');
        }
      }
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n[FATAL]', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
