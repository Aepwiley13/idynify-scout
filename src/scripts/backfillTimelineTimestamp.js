/**
 * BACKFILL: Timeline Document timestamp Field
 * Operation People First — Alpha Required Fix
 *
 * PROBLEM:
 *   Pre-sprint timeline documents were written with only `createdAt` (Firestore Timestamp).
 *   Post-sprint code (both Alpha's engagementHistoryLogger.js and Beta's PersistentEngageBar)
 *   queries timeline events using orderBy('timestamp', 'desc').
 *   Documents missing the `timestamp` field do not appear in these ordered queries,
 *   causing broken ordering and missing history for any contact with pre-sprint engagement.
 *
 * FIX:
 *   For every timeline document that has `createdAt` but no `timestamp`,
 *   write `timestamp = createdAt`. This is a copy — not a new value.
 *   No existing data changes. Only the missing field is added.
 *
 * SAFETY:
 *   - Read-only detection first: --dry-run flag logs what WOULD be updated without writing
 *   - Only writes documents that are missing `timestamp`
 *   - Writes `timestamp = createdAt` — never modifies `createdAt`
 *   - Batched writes (499 max per batch, Firestore limit)
 *   - Progress logged to console at each batch
 *   - Safe to re-run: idempotent (skips docs that already have `timestamp`)
 *
 * CREDENTIAL PRIORITY (checked in order):
 *   1. FIREBASE_SERVICE_ACCOUNT_PATH  — path to service account JSON file
 *   2. GOOGLE_APPLICATION_CREDENTIALS — same, standard GCP env var name
 *   3. FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + FIREBASE_PROJECT_ID
 *      — inline env vars (used in Netlify and local .env)
 *   4. Application Default Credentials — works in GCP/Cloud Run/Cloud Functions
 *
 * LOCAL SETUP (add to .env or export before running):
 *   FIREBASE_PROJECT_ID=your_project_id
 *   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your_project.iam.gserviceaccount.com
 *   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *
 * USAGE:
 *   # Load .env then run (requires dotenv: npm install -g dotenv-cli)
 *   dotenv -- node src/scripts/backfillTimelineTimestamp.js --dry-run
 *   dotenv -- node src/scripts/backfillTimelineTimestamp.js --user-id=abc123
 *   dotenv -- node src/scripts/backfillTimelineTimestamp.js --user-id=abc123 --verify
 *   dotenv -- node src/scripts/backfillTimelineTimestamp.js
 *   dotenv -- node src/scripts/backfillTimelineTimestamp.js --verify
 *
 *   # OR export vars manually:
 *   export FIREBASE_PROJECT_ID=xxx
 *   export FIREBASE_CLIENT_EMAIL=xxx
 *   export FIREBASE_PRIVATE_KEY="xxx"
 *   node src/scripts/backfillTimelineTimestamp.js --dry-run
 *
 * ESTIMATED RUNTIME:
 *   ~1 second per 100 timeline documents (rate-limited by Firestore batch writes)
 *   For 10,000 documents across all users: ~2 minutes
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Config ────────────────────────────────────────────────

const BATCH_SIZE = 499;           // Firestore max is 500 — stay safe
const LOG_EVERY_N_DOCS = 100;     // Progress log interval
const TIMELINE_SUBCOLLECTION = 'timeline';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TARGET_USER_ID = args.find(a => a.startsWith('--user-id='))?.split('=')[1] || null;

// ── Firebase Admin Init ───────────────────────────────────

function initFirebase() {
  if (admin.apps.length > 0) return admin.firestore();

  // Credential resolution — four strategies, in priority order
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountPath) {
    // Strategy 1 & 2: JSON file path
    const serviceAccount = JSON.parse(readFileSync(resolve(serviceAccountPath), 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });

  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    // Strategy 3: Inline env vars (Netlify / local .env pattern)
    // FIREBASE_PRIVATE_KEY may have literal \n from .env — normalize to real newlines
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      }),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

  } else if (process.env.FIREBASE_PROJECT_ID) {
    // Strategy 4: Application Default Credentials (GCP, Cloud Run, Cloud Functions)
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

  } else {
    // No credentials found — fail clearly before touching any data
    console.error('\n[ERROR] No Firebase credentials found.');
    console.error('Set one of the following before running:');
    console.error('  FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccount.json');
    console.error('  FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + FIREBASE_PROJECT_ID');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json\n');
    process.exit(1);
  }

  return admin.firestore();
}

// ── Core Backfill Logic ───────────────────────────────────

/**
 * Main backfill function.
 * Scans all users (or a specific user) and backfills timeline documents.
 */
async function runBackfill() {
  const db = initFirebase();

  const mode = DRY_RUN ? '[DRY RUN]' : '[LIVE]';
  console.log(`\n${mode} Timeline timestamp backfill starting`);
  console.log(`${mode} Target user: ${TARGET_USER_ID || 'ALL USERS'}`);
  console.log('─'.repeat(60));

  // ── Preflight: verify DB connection before touching anything ──
  console.log(`${mode} Preflight: verifying Firestore connection...`);
  try {
    await db.collection('users').limit(1).get();
    console.log(`${mode} Preflight: Firestore connection OK\n`);
  } catch (err) {
    console.error(`\n[ERROR] Firestore connection failed: ${err.message}`);
    console.error('Check your credentials and project ID, then retry.\n');
    process.exit(1);
  }

  if (!DRY_RUN && !TARGET_USER_ID) {
    // Require explicit acknowledgment before full live run
    console.log('[WARNING] This is a full LIVE run across ALL users.');
    console.log('[WARNING] Run with --dry-run first to confirm scope.');
    console.log('[WARNING] Run with --user-id=<id> to test on one user first.');
    console.log('[WARNING] Proceeding in 3 seconds — Ctrl+C to abort...\n');
    await new Promise(r => setTimeout(r, 3000));
  }

  let totalUsersScanned = 0;
  let totalContactsScanned = 0;
  let totalTimelineDocsScanned = 0;
  let totalDocsNeedingBackfill = 0;
  let totalDocsBackfilled = 0;
  let totalErrors = 0;

  // Get user list
  const usersQuery = TARGET_USER_ID
    ? db.collection('users').where(admin.firestore.FieldPath.documentId(), '==', TARGET_USER_ID)
    : db.collection('users');

  const usersSnapshot = await usersQuery.get();
  totalUsersScanned = usersSnapshot.size;

  console.log(`${mode} Found ${totalUsersScanned} user(s) to process\n`);

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    console.log(`${mode} Processing user: ${userId}`);

    // Get all contacts for this user
    const contactsSnapshot = await db
      .collection('users').doc(userId)
      .collection('contacts')
      .get();

    totalContactsScanned += contactsSnapshot.size;

    for (const contactDoc of contactsSnapshot.docs) {
      const contactId = contactDoc.id;

      // Get all timeline docs for this contact
      const timelineSnapshot = await db
        .collection('users').doc(userId)
        .collection('contacts').doc(contactId)
        .collection(TIMELINE_SUBCOLLECTION)
        .get();

      if (timelineSnapshot.empty) continue;

      totalTimelineDocsScanned += timelineSnapshot.size;

      // Identify docs that need backfill
      const toBackfill = [];
      for (const timelineDoc of timelineSnapshot.docs) {
        const data = timelineDoc.data();

        // Skip if already has timestamp
        if (data.timestamp !== undefined && data.timestamp !== null) continue;

        // Skip if missing createdAt (nothing to copy from)
        if (!data.createdAt) {
          console.warn(
            `  WARN: Timeline doc missing both createdAt and timestamp:` +
            ` users/${userId}/contacts/${contactId}/timeline/${timelineDoc.id}`
          );
          continue;
        }

        toBackfill.push({ ref: timelineDoc.ref, createdAt: data.createdAt });
      }

      totalDocsNeedingBackfill += toBackfill.length;

      if (toBackfill.length === 0) continue;

      if (DRY_RUN) {
        console.log(
          `  [DRY RUN] Would backfill ${toBackfill.length} docs` +
          ` for contact ${contactId}`
        );
        continue;
      }

      // Write in batches
      let batchCount = 0;
      for (let i = 0; i < toBackfill.length; i += BATCH_SIZE) {
        const chunk = toBackfill.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const { ref, createdAt } of chunk) {
          // ONLY add timestamp = createdAt — never touch existing fields
          batch.update(ref, { timestamp: createdAt });
        }

        try {
          await batch.commit();
          totalDocsBackfilled += chunk.length;
          batchCount++;

          if (totalDocsBackfilled % LOG_EVERY_N_DOCS === 0) {
            console.log(`  Progress: ${totalDocsBackfilled} docs backfilled so far...`);
          }
        } catch (err) {
          console.error(`  ERROR: Batch ${batchCount} failed for contact ${contactId}:`, err.message);
          totalErrors += chunk.length;
        }
      }
    }

    console.log(`  Done: ${userId}`);
  }

  // ── Summary ────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log(`${mode} BACKFILL COMPLETE`);
  console.log('─'.repeat(60));
  console.log(`  Users scanned:          ${totalUsersScanned}`);
  console.log(`  Contacts scanned:       ${totalContactsScanned}`);
  console.log(`  Timeline docs scanned:  ${totalTimelineDocsScanned}`);
  console.log(`  Docs needing backfill:  ${totalDocsNeedingBackfill}`);

  if (DRY_RUN) {
    console.log(`  Would have backfilled:  ${totalDocsNeedingBackfill}`);
    console.log('\n  Run without --dry-run to apply the backfill.');
  } else {
    console.log(`  Docs backfilled:        ${totalDocsBackfilled}`);
    console.log(`  Errors:                 ${totalErrors}`);

    if (totalErrors > 0) {
      console.log('\n  WARNING: Some documents failed to update. Re-run to retry.');
      process.exitCode = 1;
    } else {
      console.log('\n  All done. Timeline ordering is restored.');
    }
  }
}

// ── Verify Backfill ───────────────────────────────────────

/**
 * Spot-check verification.
 * Loads a sample of timeline documents and confirms timestamp is present.
 * Run after backfill to confirm it worked.
 *
 * Usage: node src/scripts/backfillTimelineTimestamp.js --verify --user-id=abc123
 */
async function runVerification() {
  const db = initFirebase();
  console.log('\n[VERIFY] Checking sample of timeline documents...\n');

  const userId = TARGET_USER_ID;
  if (!userId) {
    console.error('--verify requires --user-id');
    process.exit(1);
  }

  const contactsSnapshot = await db
    .collection('users').doc(userId)
    .collection('contacts')
    .limit(5)
    .get();

  let docsChecked = 0;
  let docsMissingTimestamp = 0;

  for (const contactDoc of contactsSnapshot.docs) {
    const timelineSnapshot = await db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactDoc.id)
      .collection(TIMELINE_SUBCOLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();

    for (const doc of timelineSnapshot.docs) {
      docsChecked++;
      const data = doc.data();
      if (!data.timestamp) {
        docsMissingTimestamp++;
        console.warn(`  MISSING timestamp: users/${userId}/contacts/${contactDoc.id}/timeline/${doc.id}`);
      }
    }
  }

  console.log(`\n[VERIFY] Checked ${docsChecked} docs across ${contactsSnapshot.size} contacts`);
  if (docsMissingTimestamp === 0) {
    console.log('[VERIFY] PASS — All checked docs have timestamp field');
  } else {
    console.log(`[VERIFY] FAIL — ${docsMissingTimestamp} docs still missing timestamp. Re-run backfill.`);
    process.exitCode = 1;
  }
}

// ── Entry Point ───────────────────────────────────────────

const VERIFY_MODE = args.includes('--verify');

if (VERIFY_MODE) {
  runVerification().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
  });
} else {
  runBackfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
