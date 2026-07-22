#!/usr/bin/env node
/**
 * FIX 1 — READ-ONLY QA VERIFICATION SCRIPT
 *
 * Verifies the Firestore write surface produced by a Fix 1 sequence send
 * (SequencePanel.jsx → executeSendAction). READ-ONLY: this script only reads
 * from Firestore. It never writes, never sends email, never mutates anything.
 *
 * USAGE:
 *   node scripts/qa-fix1-verify.mjs \
 *     --uid <userId> --contact <contactId> --mission <missionId> \
 *     [--minutes 10] [--since 2026-07-22T15:00:00Z] [--mode sent|failed]
 *
 *   --uid       (required) the authenticated user's uid (owner of the contact)
 *   --contact   (required) contactId used in the test send
 *   --mission   (required) missionId of the sequence the step belongs to
 *   --minutes   (optional) look-back window in minutes for "this send"   [default 10]
 *   --since     (optional) explicit ISO cutoff; overrides --minutes
 *   --mode      (optional) 'sent'   → assert the full successful-send surface [default]
 *                          'failed' → assert the failed-send surface (step did NOT advance)
 *
 * CREDENTIALS (one of):
 *   - FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY   (service account, matches netlify funcs)
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account json
 *
 * EXIT CODES: 0 = all checks passed | 1 = one or more checks failed | 2 = setup/usage error
 *
 * NOT CHECKED HERE (human-verified, by design):
 *   - Email actually arrived in the recipient's real inbox
 *   - Success/failure banner rendered in the UI
 */

import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ── args ────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    if (a.includes('=')) { const [k, v] = a.replace(/^--/, '').split('='); out[k] = v; }
    else { out[key] = argv[i + 1]; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const uid = args.uid, contactId = args.contact, missionId = args.mission;
const mode = args.mode || 'sent';

if (!uid || !contactId || !missionId) {
  console.error('ERROR: --uid, --contact, and --mission are all required.\n');
  console.error('  node scripts/qa-fix1-verify.mjs --uid <uid> --contact <cid> --mission <mid> [--minutes 10] [--mode sent|failed]');
  process.exit(2);
}
if (!['sent', 'failed'].includes(mode)) {
  console.error(`ERROR: --mode must be 'sent' or 'failed' (got '${mode}').`);
  process.exit(2);
}

const sinceMs = args.since
  ? Date.parse(args.since)
  : Date.now() - (Number(args.minutes || 10) * 60 * 1000);
if (Number.isNaN(sinceMs)) { console.error('ERROR: --since is not a valid ISO date.'); process.exit(2); }

// ── firebase admin (read-only usage) ────────────────────
function initAdmin() {
  if (getApps().length) return;
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, GOOGLE_APPLICATION_CREDENTIALS } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  } else if (GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
  } else {
    console.error('ERROR: no Firebase Admin credentials found.');
    console.error('Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(2);
  }
}

// ── helpers ─────────────────────────────────────────────
// Normalize a timestamp (Firestore Timestamp | ISO string | Date) to millis.
function toMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();          // Firestore Timestamp
  if (typeof t === 'object' && typeof t._seconds === 'number') return t._seconds * 1000;
  const p = Date.parse(t);                                            // ISO string
  return Number.isNaN(p) ? 0 : p;
}
function inWindow(t) { return toMillis(t) >= sinceMs; }

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail || '' }); }

// ── main ────────────────────────────────────────────────
async function main() {
  initAdmin();
  const db = getFirestore();

  const contactRef = db.collection('users').doc(uid).collection('contacts').doc(contactId);
  const missionRef = db.collection('users').doc(uid).collection('missions').doc(missionId);

  // --- pull timeline (filter to window) ---
  const tlSnap = await contactRef.collection('timeline').get();
  const events = tlSnap.docs
    .map(d => d.data())
    .filter(e => inWindow(e.timestamp || e.createdAt));
  const countType = (t) => events.filter(e => e.type === t).length;

  const nMessageSent = countType('message_sent');
  const nStatusChanged = countType('contact_status_changed');
  const nStepSent = countType('sequence_step_sent');

  // --- pull contact doc ---
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) {
    console.error(`ERROR: contact users/${uid}/contacts/${contactId} does not exist.`);
    process.exit(2);
  }
  const contact = contactSnap.data();
  const activityLog = Array.isArray(contact.activity_log) ? contact.activity_log : [];
  const recentSendActivity = activityLog.filter(
    e => inWindow(e.timestamp) && (e.type === 'email_sent' || e.channel === 'email')
  );

  // --- pull mission doc + locate this contact ---
  const missionSnap = await missionRef.get();
  if (!missionSnap.exists) {
    console.error(`ERROR: mission users/${uid}/missions/${missionId} does not exist.`);
    process.exit(2);
  }
  const mission = missionSnap.data();
  const mContact = (mission.contacts || []).find(c => c.contactId === contactId);
  const stepHistory = mContact && Array.isArray(mContact.stepHistory) ? mContact.stepHistory : [];
  const sentStep = stepHistory.find(h => h.action === 'sent' && inWindow(h.sentAt));

  // --- pull email_logs (single-field query; filter rest in memory to avoid composite index) ---
  const elSnap = await db.collection('email_logs').where('contactId', '==', contactId).get();
  const emailLogs = elSnap.docs
    .map(d => d.data())
    .filter(e => e.userId === uid && e.source === 'quick_engage' && inWindow(e.sentAt));

  // ── assertions ─────────────────────────────────────────
  if (mode === 'sent') {
    // Timeline four-doc set (membership, not order)
    check('timeline: message_sent present',            nMessageSent >= 1, `found ${nMessageSent}`);
    check('timeline: sequence_step_sent present',      nStepSent >= 1,    `found ${nStepSent}`);
    check('timeline: 2x contact_status_changed',       nStatusChanged >= 2, `found ${nStatusChanged} (evidence of the two awaiting-reply writes)`);
    // Contact status field
    check('contact_status == awaiting_reply',          contact.contact_status === 'awaiting_reply', `is '${contact.contact_status}'`);
    check('contact_status_updated_at in window',       inWindow(contact.contact_status_updated_at), `${contact.contact_status_updated_at}`);
    // activity_log + last_contacted
    check('activity_log: email send entry in window',  recentSendActivity.length >= 1, `found ${recentSendActivity.length}`);
    check('last_contacted updated in window',          inWindow(contact.last_contacted), `${contact.last_contacted}`);
    // Mission doc
    check('mission: stepHistory entry action=sent',    !!sentStep, sentStep ? `sentAt ${sentStep.sentAt}` : 'no sent step in window');
    check("mission: sequenceStatus == awaiting_outcome", mContact && mContact.sequenceStatus === 'awaiting_outcome', mContact ? `is '${mContact.sequenceStatus}'` : 'contact not in mission');
    check('mission: lastTouchDate in window',          mContact && inWindow(mContact.lastTouchDate), mContact ? `${mContact.lastTouchDate}` : 'n/a');
    // email_logs
    check("email_logs: one doc source='quick_engage'", emailLogs.length >= 1, `found ${emailLogs.length}`);
  } else {
    // FAILED send: the step must NOT have advanced. No send-surface writes in window.
    check('FAILED: no sequence_step_sent written',     nStepSent === 0, `found ${nStepSent} (expected 0)`);
    check('FAILED: no message_sent written',           nMessageSent === 0, `found ${nMessageSent} (expected 0)`);
    check('FAILED: no sent stepHistory entry in window', !sentStep, sentStep ? `unexpectedly found sentAt ${sentStep.sentAt}` : 'none (correct)');
    check('FAILED: no email_logs doc in window',       emailLogs.length === 0, `found ${emailLogs.length} (expected 0)`);
  }

  // ── report ─────────────────────────────────────────────
  const pad = Math.max(...results.map(r => r.name.length));
  console.log(`\nFIX 1 QA — mode=${mode}  window=since ${new Date(sinceMs).toISOString()}`);
  console.log(`  user=${uid}  contact=${contactId}  mission=${missionId}\n`);
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  console.log(`\n  ${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
  console.log('  (Not checked here — verify by hand: email arrived in real inbox; UI banner rendered.)\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('Unexpected error:', err); process.exit(2); });
