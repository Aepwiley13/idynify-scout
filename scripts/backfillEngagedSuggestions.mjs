/**
 * BACKFILL: contacts stuck at record_status 'suggested' while engaged
 *
 * One-time migration for the Scout people-surface audit (2026-09-15).
 *
 * Problem:
 *   Auto-discovery stamps `status: 'suggested'` and, until this sprint, no
 *   write path ever cleared it. So a contact could be emailed, enrolled in a
 *   cadence, given an active mission and be mid-conversation while still
 *   carrying the marker that says "discovery surfaced this, the user has not
 *   kept it yet".
 *
 *   That mattered because the two Scout people surfaces filter on different
 *   dimensions and a row could fall out of both at once:
 *
 *     Saved Companies "Total Contacts"  excluded status === 'suggested'
 *     People "Total Leads"              excludes engaged contacts
 *
 *   A contact that was BOTH was excluded by each for opposite reasons and
 *   counted in neither. In workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2 that was 27
 *   contacts, and it made six accepted companies report "0 contacts" while
 *   their people were mid-conversation — which then pushed those companies
 *   into the "needs contacts" prompt list.
 *
 *   Both halves are fixed in code as of this sprint:
 *     · the write paths promote on engagement (statusModel.engagementPromotionFields,
 *       wired into contactStateMachine and the Netlify send paths), and
 *     · Saved Companies now reads through the compatibility helpers, so the
 *       rows already written are COUNTED CORRECTLY WITHOUT THIS SCRIPT.
 *
 *   This script is therefore hygiene, not a fix: it makes the stored rows
 *   agree with what the readers already conclude, so that a future reader
 *   written against the raw `status` field cannot reintroduce the bug.
 *
 * What this script does:
 *   For every users/{userId}/contacts/{contactId} that is BOTH
 *   record_status 'suggested' AND engaged, it applies exactly the patch the
 *   runtime would have applied at engagement time:
 *
 *     record_status:              'active'
 *     record_status_promoted_at:  <now>
 *     record_status_promoted_by:  'backfill_engaged_suggestion'
 *     status:                     'active'   ← only when `status` is literally
 *                                              'suggested'; see below.
 *
 *   The decision is NOT reimplemented here. It imports the same
 *   `engagementPromotionFields` the application uses, so the migration cannot
 *   drift from the runtime, and the rule is already unit-tested in
 *   src/test/engagementPromotion.test.js.
 *
 *   Deliberately NOT touched:
 *     · Archived or rejected records — but MIND THE PRECEDENCE, because it
 *       is the opposite of what it looks like. `readRecordStatus` checks
 *       `record_status` BEFORE `is_archived`, so `is_archived: true` does
 *       NOT win: an archived row whose `record_status` is still the stale
 *       'suggested' it was stamped with at creation reads back as
 *       'suggested'. The audited workspace has 7 such rows.
 *
 *       They are excluded below by an explicit archive check rather than by
 *       `readRecordStatus`, because engaging someone the user archived must
 *       never silently undo the archive — and that guarantee has to be
 *       enforced, not left resting on those rows also happening to be
 *       unengaged today. An archived + stale-'suggested' + engaged row
 *       would otherwise be promoted to 'active' and un-archived.
 *     · The legacy `status` field when it holds an Apollo enrichment marker
 *       ('pending_enrichment', 'enrichment_failed', …). That is real state
 *       nothing else records, and clobbering it would lose it.
 *     · Unengaged suggestions. A discovery suggestion nobody has touched is
 *       still a suggestion and must keep saying so.
 *     · Every other status dimension. contact_status, hunter_status and stage
 *       are left exactly as they are — this migration moves ONE dimension.
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
 *   Step 1 — DRY RUN. This is the DEFAULT: with no flags the script reads
 *            only and writes nothing. It prints every document it would
 *            change and what it would set.
 *
 *     node scripts/backfillEngagedSuggestions.mjs
 *     node scripts/backfillEngagedSuggestions.mjs --user-id=<uid>   # one workspace
 *
 *   Step 2 — REVIEW THE OUTPUT before going further. Check that:
 *              · every listed contact really has been engaged — it should have
 *                a contact_status/hunter_status the summary prints, and most
 *                should have a last_sent_at or an active_mission_id.
 *              · "would promote" is a plausible number. For the audited
 *                workspace it is 27. If it is wildly larger, stop: something
 *                is classifying unengaged suggestions as engaged.
 *              · "left alone" is the bulk of the workspace.
 *
 *   Step 3 — LIVE RUN. Requires the explicit --live flag. Only after step 2.
 *
 *     node scripts/backfillEngagedSuggestions.mjs --live --user-id=<uid>   # one first
 *     node scripts/backfillEngagedSuggestions.mjs --live                   # then everyone
 *
 *   Step 4 — VERIFY. Reports any contact still both suggested and engaged.
 *            Writes nothing. Expect "No contact is both suggested and engaged."
 *
 *     node scripts/backfillEngagedSuggestions.mjs --verify
 *
 * NOTE ON THE DEFAULT — this differs from backfillContactIsArchived.mjs, whose
 * default is a live run and which needs --dry-run to be safe. Here the safe
 * mode is the default and writing requires --live, because this migration
 * rewrites a field that already carries meaning rather than filling in a field
 * that was absent. `--dry-run` is still accepted, and still means what it says.
 *
 * Flags:
 *   --live             Actually write. Without it the script only reports.
 *   --dry-run          Explicit no-write mode. This is already the default.
 *   --user-id=<uid>    Scope to a single user. Combines with the other flags.
 *   --verify           Verification pass: reports contacts still in the
 *                      contradictory state. No writes.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS pointing at your service account JSON, OR a
 *   GCP environment with Application Default Credentials.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

import {
  RECORD_STATUS,
  readRecordStatus,
  isEngagedRecord,
  hasArchiveSignal,
  engagementPromotionFields,
} from '../src/constants/statusModel.js';

// ── The rule ─────────────────────────────────────────────
//
// Both halves come from the application's own status model. Nothing about
// what 'suggested' or 'engaged' means is restated here, because a migration
// that disagrees with the runtime is worse than no migration at all.

/**
 * Re-exported so this script's predicates can be imported and tested as one
 * unit. The definition lives in the status model with every other status
 * question, per the rule above — a migration that disagrees with the runtime
 * is worse than no migration at all, and the runtime now enforces the same
 * archive guarantee at the write path (`engagementPromotionFields`).
 */
export { hasArchiveSignal };

/**
 * Is this contact in the contradictory state the audit found?
 *
 * @param   {Object}  data  The contact document.
 * @returns {boolean}
 */
export function isEngagedSuggestion(data = {}) {
  // Checked first, and deliberately not folded into the expression below:
  // an archive is a decision the user made, and no amount of engagement
  // evidence may overturn it here.
  if (hasArchiveSignal(data)) return false;
  return readRecordStatus(data) === RECORD_STATUS.SUGGESTED && isEngagedRecord(data);
}

const PROMOTION_REASON = 'backfill_engaged_suggestion';

// ── Parse CLI flags ───────────────────────────────────────

const args = process.argv.slice(2);

const IS_LIVE     = args.includes('--live');
const IS_VERIFY   = args.includes('--verify');
const USER_ID_ARG = args.find(a => a.startsWith('--user-id='));
const TARGET_USER = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;

// Dry run is the default. --live is the only thing that turns writes on, and
// --verify never writes regardless.
const MODE = IS_VERIFY ? 'verify' : IS_LIVE ? 'live' : 'dry-run';

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 450;

// ── Counters ─────────────────────────────────────────────

let totalUsers      = 0;
let totalContacts   = 0;
let totalPromoted   = 0;
let totalSkipped    = 0;
let totalRemaining  = 0;   // verify mode
let totalLegacyKept = 0;   // promoted, but `status` left alone (enrichment marker)

const samples = [];

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

    if (!isEngagedSuggestion(data)) {
      totalSkipped++;
      continue;
    }

    if (IS_VERIFY) {
      totalRemaining++;
      console.log(
        `  [STILL CONTRADICTORY] user=${userId} contact=${contactDoc.id} ` +
        `name=${data.name ?? '(none)'} status=${data.status ?? '(none)'} ` +
        `contact_status=${data.contact_status ?? '(none)'}`
      );
      continue;
    }

    const patch = engagementPromotionFields(data, { reason: PROMOTION_REASON });

    // Defensive: the helper returns {} for anything it declines to promote.
    // isEngagedSuggestion should already have excluded those, so an empty
    // patch here means the two disagree and the record must be left alone.
    if (Object.keys(patch).length === 0) {
      totalSkipped++;
      continue;
    }

    totalPromoted++;
    if (!Object.prototype.hasOwnProperty.call(patch, 'status')) totalLegacyKept++;

    if (samples.length < 30) {
      samples.push(
        `user=${userId} contact=${contactDoc.id} name=${data.name ?? '(none)'}\n` +
        `        was: status=${data.status ?? '(none)'} record_status=${data.record_status ?? '(none)'}\n` +
        `        engaged by: contact_status=${data.contact_status ?? '(none)'} ` +
        `hunter_status=${data.hunter_status ?? '(none)'} ` +
        `last_sent_at=${data.last_sent_at ?? '(none)'} ` +
        `active_mission_id=${data.active_mission_id ?? '(none)'}\n` +
        `        sets: ${JSON.stringify(patch)}`
      );
    }

    if (!IS_LIVE) continue;

    batch.update(contactDoc.ref, patch);
    opsInBatch++;

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (IS_LIVE && opsInBatch > 0) {
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

  console.log(`\n── backfillEngagedSuggestions — mode: ${MODE} ──`);
  if (TARGET_USER) console.log(`   scoped to user: ${TARGET_USER}`);
  if (MODE === 'dry-run') console.log('   NO WRITES WILL BE MADE — pass --live to write\n');
  else if (MODE === 'verify') console.log('   read-only verification pass\n');
  else console.log('   *** LIVE — THIS WILL WRITE TO FIRESTORE ***\n');

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

  console.log('\n── Summary ──');
  console.log(`  mode:                       ${MODE}`);
  console.log(`  users scanned:              ${totalUsers}`);
  console.log(`  contacts scanned:           ${totalContacts}`);

  if (IS_VERIFY) {
    console.log(`  still suggested + engaged:  ${totalRemaining}`);
    console.log(`  consistent:                 ${totalSkipped}`);
    console.log(
      totalRemaining === 0
        ? '\n  No contact is both suggested and engaged.'
        : `\n  ${totalRemaining} contact(s) still contradictory — rerun with --live.`
    );
  } else {
    const verb = IS_LIVE ? 'promoted' : 'would promote';
    console.log(`  ${verb} to record_status active:  ${totalPromoted}`);
    console.log(`  left alone:                 ${totalSkipped}`);
    if (totalLegacyKept > 0) {
      console.log(
        `  of those promoted, ${totalLegacyKept} kept their legacy \`status\` ` +
        `(an Apollo enrichment marker, not 'suggested')`
      );
    }

    if (samples.length > 0) {
      console.log(`\n  Documents ${IS_LIVE ? 'changed' : 'that would change'} ` +
                  `(first ${samples.length} of ${totalPromoted}):`);
      for (const s of samples) console.log(`    ${s}`);
      if (totalPromoted > samples.length) {
        console.log(`    … and ${totalPromoted - samples.length} more`);
      }
    }

    if (!IS_LIVE && totalPromoted > 0) {
      console.log('\n  Nothing was written. Review the list above, then rerun with --live.');
    }
  }

  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n[backfillEngagedSuggestions] FAILED:', err);
    process.exit(1);
  });
