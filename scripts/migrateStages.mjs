/**
 * MIGRATION: Contact Stage Field Backfill
 *
 * One-time migration for the Contact Profile — Brigade/Stage System Overhaul.
 *
 * What this script does:
 *   For every users/{userId}/contacts/{contactId}:
 *     - Maps existing Brigade / person_type to the new `stage` field:
 *         brigade === 'customers'      → stage = 'basecamp',  stage_source = 'auto'
 *         brigade === 'past_customers' → stage = 'fallback',  stage_source = 'auto'
 *         brigade === 'leads'          → stage = 'scout',     stage_source = 'auto'
 *         person_type === 'customer'   → stage = 'basecamp',  stage_source = 'auto'
 *         person_type === 'past_customer' → stage = 'fallback', stage_source = 'auto'
 *         person_type === 'lead'       → stage = 'scout',     stage_source = 'auto'
 *         (all others)                 → skip — stage left null
 *     - If `stage` already exists on the document → skip (respects prior manual overrides)
 *
 * Usage:
 *
 *   Step 1 — Dry run (no writes, see scope):
 *     node scripts/migrateStages.mjs --dry-run
 *
 *   Step 2 — Single user (live write, then verify):
 *     node scripts/migrateStages.mjs --user-id=<uid>
 *     node scripts/migrateStages.mjs --user-id=<uid> --verify
 *
 *   Step 3 — Full run (all users, then verify):
 *     node scripts/migrateStages.mjs
 *     node scripts/migrateStages.mjs --verify
 *
 * Flags:
 *   --dry-run          Scan and report only. No Firestore writes.
 *   --user-id=<uid>    Scope to a single user (combine with --verify as needed).
 *   --verify           Verification pass: reports contacts still missing stage. No writes.
 *   --force            Re-run even on contacts that already have stage set (use with caution).
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS env var pointing to your service account JSON,
 *   OR a GCP environment with Application Default Credentials.
 *   Set FIREBASE_PROJECT_ID if not auto-detected.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// ── Parse CLI flags ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const IS_DRY_RUN   = args.includes('--dry-run');
const IS_VERIFY    = args.includes('--verify');
const IS_FORCE     = args.includes('--force');
const USER_ID_ARG  = args.find(a => a.startsWith('--user-id='));
const TARGET_USER  = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;
const PROJECT_ID   = process.env.FIREBASE_PROJECT_ID;

const MODE = IS_VERIFY ? 'verify' : IS_DRY_RUN ? 'dry-run' : 'live';

// ── Init Firebase Admin ───────────────────────────────────────────────────────

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

// ── Stage derivation logic ────────────────────────────────────────────────────

/**
 * Determine the stage to assign based on the contact document.
 * Brigade values take priority over person_type where available.
 *
 * @param {Object} data - Firestore contact document data
 * @returns {string|null} stage ID, or null if no mapping applies
 */
function deriveStage(data) {
  const brigade     = data.brigade;
  const personType  = data.person_type;

  // Brigade-based mapping (old BrigadeSelector IDs)
  if (brigade === 'customers')      return 'basecamp';
  if (brigade === 'past_customers') return 'fallback';
  if (brigade === 'leads')          return 'scout';

  // person_type fallback
  if (personType === 'customer')      return 'basecamp';
  if (personType === 'past_customer') return 'fallback';
  if (personType === 'lead')          return 'scout';

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const stats = {
  usersScanned:   0,
  contactsScanned: 0,
  contactsUpdated: 0,
  contactsSkipped: 0,
  contactsMissing: 0,  // verify mode: contacts without stage after migration
  errors:         0,
};

async function processUser(userId) {
  const contactsRef = db.collection('users').doc(userId).collection('contacts');
  const snapshot = await contactsRef.get();

  for (const contactDoc of snapshot.docs) {
    stats.contactsScanned++;
    const data = contactDoc.data();

    // Verify mode — just count docs missing stage
    if (IS_VERIFY) {
      if (!data.stage) {
        stats.contactsMissing++;
        console.log(`  [MISSING] users/${userId}/contacts/${contactDoc.id} — person_type=${data.person_type} brigade=${data.brigade}`);
      }
      continue;
    }

    // Skip if already has a stage (unless --force)
    if (data.stage && !IS_FORCE) {
      stats.contactsSkipped++;
      continue;
    }

    const newStage = deriveStage(data);

    if (!newStage) {
      // No mapping applies — leave stage null, skip
      stats.contactsSkipped++;
      continue;
    }

    const updatePayload = {
      stage:        newStage,
      stage_source: 'auto',
      updated_at:   new Date().toISOString(),
    };

    if (IS_DRY_RUN) {
      console.log(`  [DRY-RUN] Would set users/${userId}/contacts/${contactDoc.id} → stage=${newStage}`);
      stats.contactsUpdated++;
      continue;
    }

    try {
      await contactDoc.ref.update(updatePayload);
      stats.contactsUpdated++;
      console.log(`  [UPDATED] users/${userId}/contacts/${contactDoc.id} → stage=${newStage}`);
    } catch (err) {
      stats.errors++;
      console.error(`  [ERROR]   users/${userId}/contacts/${contactDoc.id}:`, err.message);
    }
  }
}

async function run() {
  const label = MODE === 'verify' ? 'VERIFY' : MODE === 'dry-run' ? 'DRY RUN' : 'LIVE';
  console.log(`\n══════════════════════════════════════════════`);
  console.log(` migrateStages.mjs — ${label}`);
  if (TARGET_USER) console.log(` Scoped to user: ${TARGET_USER}`);
  if (IS_FORCE && !IS_DRY_RUN && !IS_VERIFY) console.log(` --force: will overwrite existing stage values`);
  console.log(`══════════════════════════════════════════════\n`);

  if (TARGET_USER) {
    stats.usersScanned++;
    await processUser(TARGET_USER);
  } else {
    const usersSnapshot = await db.collection('users').get();
    for (const userDoc of usersSnapshot.docs) {
      stats.usersScanned++;
      console.log(`\nProcessing user: ${userDoc.id}`);
      await processUser(userDoc.id);
    }
  }

  console.log(`\n══════════════════════════════════════════════`);
  console.log(` Results`);
  console.log(`──────────────────────────────────────────────`);
  console.log(` Users scanned:    ${stats.usersScanned}`);
  console.log(` Contacts scanned: ${stats.contactsScanned}`);

  if (IS_VERIFY) {
    console.log(` Contacts missing stage: ${stats.contactsMissing}`);
    if (stats.contactsMissing === 0) {
      console.log(` ✓ All contacts have a stage value — migration complete.`);
    } else {
      console.log(` ✗ ${stats.contactsMissing} contacts still missing stage — re-run the migration.`);
    }
  } else {
    console.log(` Contacts updated: ${stats.contactsUpdated}`);
    console.log(` Contacts skipped: ${stats.contactsSkipped}`);
    console.log(` Errors:           ${stats.errors}`);
    if (IS_DRY_RUN) {
      console.log(`\n Dry run complete. Run without --dry-run to apply changes.`);
    } else {
      console.log(`\n Migration complete. Run with --verify to confirm.`);
    }
  }
  console.log(`══════════════════════════════════════════════\n`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
