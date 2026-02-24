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
 *     - If both are missing → write `timestamp = Firestore.now()` (last resort, logs a warning)
 *     - If `timestamp` already exists → skip (no-op)
 *
 * Usage:
 *   Dry run (safe, no writes):
 *     node scripts/backfillTimelineTimestamp.mjs
 *
 *   Live run (writes to Firestore):
 *     node scripts/backfillTimelineTimestamp.mjs --live
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS env var must point to your service account JSON,
 *   OR the script must run in a GCP environment with Application Default Credentials.
 *
 *   Set FIREBASE_PROJECT_ID to your project ID if not auto-detected.
 *
 * Output:
 *   Logs a summary line per user. Final line shows total docs scanned / patched / skipped.
 *   Exits 0 on success, 1 on fatal error.
 *
 * Squad Alpha — run once after deploy, confirm zero mismatches, then remove `createdAt`
 * dual-write from timelineLogger.js (see the Squad Alpha action note in that file).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Config ───────────────────────────────────────────────

const IS_LIVE = process.argv.includes('--live');
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

// ── Init ─────────────────────────────────────────────────

if (!getApps().length) {
  const appConfig = PROJECT_ID ? { projectId: PROJECT_ID } : {};

  // Use GOOGLE_APPLICATION_CREDENTIALS if set (service account JSON path),
  // otherwise fall back to Application Default Credentials.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const serviceAccount = JSON.parse(
      await import('fs').then(fs =>
        fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
      )
    );
    initializeApp({ credential: cert(serviceAccount), ...appConfig });
  } else {
    initializeApp(appConfig);
  }
}

const db = getFirestore();

// ── Counters ─────────────────────────────────────────────

let totalUsers = 0;
let totalContacts = 0;
let totalEvents = 0;
let totalPatched = 0;
let totalSkipped = 0;
let totalWarnings = 0;

// ── Core logic ───────────────────────────────────────────

/**
 * Process all timeline events for a single contact.
 */
async function backfillContact(userId, contactId) {
  const timelineRef = db.collection('users').doc(userId)
    .collection('contacts').doc(contactId)
    .collection('timeline');

  const snap = await timelineRef.get();
  if (snap.empty) return;

  const batch = db.batch();
  let batchHasWrites = false;

  for (const eventDoc of snap.docs) {
    totalEvents++;
    const data = eventDoc.data();

    // Already has timestamp — nothing to do
    if (data.timestamp) {
      totalSkipped++;
      continue;
    }

    let newTimestamp;

    if (data.createdAt) {
      // Canonical backfill: copy createdAt → timestamp
      newTimestamp = data.createdAt;
    } else {
      // Both missing — last resort, set to server time
      // This means we have no record of when the event occurred.
      // Log a warning so Alpha can investigate.
      console.warn(
        `[WARN] No createdAt or timestamp on event ${eventDoc.id} ` +
        `(user=${userId}, contact=${contactId}). Setting timestamp=now.`
      );
      newTimestamp = FieldValue.serverTimestamp();
      totalWarnings++;
    }

    if (IS_LIVE) {
      batch.update(eventDoc.ref, { timestamp: newTimestamp });
      batchHasWrites = true;
    }

    totalPatched++;
  }

  if (IS_LIVE && batchHasWrites) {
    await batch.commit();
  }
}

/**
 * Process all contacts for a single user.
 */
async function backfillUser(userId) {
  totalUsers++;
  const contactsRef = db.collection('users').doc(userId).collection('contacts');
  const contactsSnap = await contactsRef.get();

  if (contactsSnap.empty) return;

  const contactIds = contactsSnap.docs.map(d => d.id);
  totalContacts += contactIds.length;

  // Process contacts in chunks of 10 to avoid overwhelming Firestore
  const CHUNK_SIZE = 10;
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(cId => backfillContact(userId, cId)));
  }

  console.log(
    `  user=${userId} contacts=${contactIds.length} ` +
    `events=${totalEvents} patched=${totalPatched} skipped=${totalSkipped}`
  );
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  BACKFILL: timeline.createdAt → timeline.timestamp');
  console.log(`  Mode: ${IS_LIVE ? '🔴 LIVE (writes enabled)' : '🟡 DRY RUN (no writes)'}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  if (!IS_LIVE) {
    console.log('  Pass --live to apply changes.\n');
  }

  try {
    const usersSnap = await db.collection('users').get();

    if (usersSnap.empty) {
      console.log('  No users found. Nothing to backfill.');
      process.exit(0);
    }

    const userIds = usersSnap.docs.map(d => d.id);
    console.log(`  Found ${userIds.length} user(s). Scanning timeline events...\n`);

    // Process users sequentially to keep log output readable
    for (const userId of userIds) {
      await backfillUser(userId);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log(`  Users:    ${totalUsers}`);
    console.log(`  Contacts: ${totalContacts}`);
    console.log(`  Events:   ${totalEvents}`);
    console.log(`  Patched:  ${totalPatched}${IS_LIVE ? '' : ' (dry run — no writes applied)'}`);
    console.log(`  Skipped:  ${totalSkipped} (already had timestamp)`);
    if (totalWarnings > 0) {
      console.log(`  Warnings: ${totalWarnings} (events with no createdAt — investigate)`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    if (IS_LIVE && totalPatched > 0) {
      console.log('  ✓ Backfill complete. Verify with a spot-check query:');
      console.log('    db.collectionGroup("timeline").where("timestamp", "==", null).limit(5).get()');
      console.log('');
      console.log('  Next: remove dual-write of `createdAt` from timelineLogger.js');
      console.log('  (search for "Squad Alpha: remove createdAt")');
      console.log('');
    }

    process.exit(0);

  } catch (error) {
    console.error('\n[FATAL] Backfill failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
