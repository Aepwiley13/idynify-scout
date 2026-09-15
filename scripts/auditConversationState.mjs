/**
 * auditConversationState — READ-ONLY census of contact.conversationState.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS SCRIPT PERFORMS NO WRITES.                                         ║
 * ║                                                                          ║
 * ║  It calls only .get() and .count().get(). There is no set(), update(),   ║
 * ║  add(), delete(), or runTransaction() anywhere in this file. Verify by   ║
 * ║  reading it — it is short on purpose.                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY THIS EXISTS (Gate 3 audit, Step 5 precondition)
 * ───────────────────────────────────────────────────
 * `conversationState` is a twelve-value WORKFLOW vocabulary. An intermediate
 * Gate 3 commit (3a0202b) briefly wrote a three-value RELATIONSHIP vocabulary
 * into that same field. The shipped code (9b4ab1d) is correct, but it preserves
 * any state it does not recognize: resolveInboundTransition() echoes an unknown
 * value back, the writer then omits the key, and the contact is pinned there
 * permanently — never reaching `user_action_required`, so never surfacing in
 * usePendingReplies, barryOrientationBrief, or HunterContactDrawer.
 *
 * That should be zero contacts: 3a0202b was never deployed live, and dry_run
 * does not write mirrors. This script converts that assumption into a number.
 *
 * USAGE
 *   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
 *     node scripts/auditConversationState.mjs
 *
 * Add --json for machine-readable output. Exit code is 0 when the census is
 * clean, 2 when any invalid value is found, 1 on error — so CI can gate on it.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONVERSATION_STATES } from '../src/types/conversationState.js';

const JSON_OUT = process.argv.includes('--json');

/** The three values the defective commit could have written. */
const RELATIONSHIP_VOCABULARY = ['no_contact', 'awaiting_reply', 'in_conversation'];

const VALID = new Set(Object.values(CONVERSATION_STATES));

function initDb() {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY'
    );
  }
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  return { db: getFirestore(), projectId: FIREBASE_PROJECT_ID };
}

/**
 * Pass 1 — the targeted question, answered with a server-side aggregation.
 *
 * `count()` bills a fraction of a document read and returns no document data,
 * so this is the cheapest possible way to ask "did the defect ever land?".
 * Requires the collection-group index on `contacts.conversationState`.
 */
async function targetedCount(db) {
  const snap = await db
    .collectionGroup('contacts')
    .where('conversationState', 'in', RELATIONSHIP_VOCABULARY)
    .count()
    .get();
  return snap.data().count;
}

/**
 * Pass 2 — the complete census, projected to one field.
 *
 * `select()` returns documents carrying only `conversationState`, which keeps
 * a full sweep affordable and means no contact PII is read into this process.
 * Catches any invalid value, not just the three from the known defect.
 */
async function fullCensus(db) {
  const snap = await db
    .collectionGroup('contacts')
    .select('conversationState')
    .get();

  const histogram = new Map();
  const invalid = [];

  for (const doc of snap.docs) {
    const value = doc.get('conversationState');
    const key = value === undefined ? '(unset)' : String(value);
    histogram.set(key, (histogram.get(key) || 0) + 1);

    // `undefined` is legitimate — a contact that has never been in a
    // conversation. Only a PRESENT value outside the vocabulary is a defect.
    if (value !== undefined && value !== null && !VALID.has(value)) {
      invalid.push({ path: doc.ref.path, value });
    }
  }

  return { total: snap.size, histogram, invalid };
}

async function main() {
  const { db, projectId } = initDb();

  const targeted = await targetedCount(db);
  const { total, histogram, invalid } = await fullCensus(db);

  const report = {
    projectId,
    scannedAt: new Date().toISOString(),
    contactsScanned: total,
    relationshipVocabularyHits: targeted,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 50),
    histogram: Object.fromEntries([...histogram].sort((a, b) => b[1] - a[1])),
    clean: invalid.length === 0 && targeted === 0,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nconversationState census — project ${projectId}`);
    console.log(`scanned ${total} contacts at ${report.scannedAt}\n`);
    console.log('  value                        count');
    console.log('  ' + '-'.repeat(40));
    for (const [k, v] of [...histogram].sort((a, b) => b[1] - a[1])) {
      const flag = k !== '(unset)' && !VALID.has(k) ? '  <-- INVALID' : '';
      console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}${flag}`);
    }
    console.log(`\n  relationship-vocabulary hits : ${targeted}`);
    console.log(`  total invalid values         : ${invalid.length}`);
    for (const row of invalid.slice(0, 50)) {
      console.log(`    ${row.path}  = ${JSON.stringify(row.value)}`);
    }
    if (invalid.length > 50) console.log(`    ... and ${invalid.length - 50} more`);
    console.log(`\n  RESULT: ${report.clean ? 'CLEAN — no remediation needed' : 'INVALID VALUES PRESENT — remediate before Step 5'}\n`);
  }

  process.exit(report.clean ? 0 : 2);
}

main().catch((err) => {
  console.error('[auditConversationState] failed:', err.message);
  if (/index/i.test(err.message)) {
    console.error(
      '\nA collection-group index is required. Deploy:\n' +
      '  collectionGroup: contacts, field: conversationState (ASC)\n'
    );
  }
  process.exit(1);
});
