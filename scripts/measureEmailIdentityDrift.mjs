#!/usr/bin/env node
/**
 * MEASURE: email identity drift
 *
 * READ-ONLY. This script writes nothing, ever. There is no --live flag and no
 * code path that changes a document. It is the evidence for whether a
 * backfill is needed after the email identity consistency fix, not the
 * backfill. Running one is a separate, approved decision.
 *
 * WHAT IT MEASURES
 *
 * A contact's email lives in three fields that must agree
 * (src/utils/contactEmails.js): emails[], email (= emails[0].value) and
 * email_normalized (= normalizeEmail(email)). Before the fix, profile edits
 * wrote the first two and not the third. For each workspace this counts the
 * contacts in each drift class (emailIdentityDrift, the same function the
 * tests pin), and two consequences for the identity engine:
 *
 *   missed_by_current_address   the resolver's indexed lookups cannot find
 *                               this contact by the address it has now; only
 *                               the bounded fallback scan can, so in a large
 *                               workspace the next import of this person
 *                               creates a duplicate
 *   matched_by_old_address      email_normalized still names an address the
 *                               contact no longer has, so that address keeps
 *                               resolving to this contact
 *
 * PRIVACY. Counts and contact IDs only (at most 20 sample IDs per class). No
 * address, name or other field value is printed, in either output mode.
 *
 * USAGE
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
 *   export FIREBASE_PROJECT_ID=<project-id>          # only if not auto-detected
 *
 *   node scripts/measureEmailIdentityDrift.mjs                   # every workspace
 *   node scripts/measureEmailIdentityDrift.mjs --user-id=<uid>   # one workspace
 *   node scripts/measureEmailIdentityDrift.mjs --json            # machine-readable
 *
 * Flags:
 *   --user-id=<uid>  Scope to a single workspace.
 *   --json           Emit JSON only. Nothing else goes to stdout.
 *   --limit=<n>      Cap contacts read per workspace (default: no cap).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { normalizeEmail } from '../src/utils/identityNormalization.js';
import { emailIdentityDrift, EMAIL_DRIFT } from '../src/utils/contactEmails.js';

export const SAMPLE_IDS = 20;
export const DRIFT_CODES = Object.freeze(Object.values(EMAIL_DRIFT));

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Can the resolver's two indexed email lookups (email_normalized, then email,
 * both at the normalized value) find this contact by its current address?
 * The current address is `email`, or the first entry of emails[] when a
 * contact has the list but no `email` (the old ContactInfo path).
 */
export function indexedLookupFinds(contact) {
  const listed = Array.isArray(contact.emails) ? contact.emails.map((e) => text(e?.value)).find(Boolean) : '';
  const address = normalizeEmail(text(contact.email) || listed || '');
  if (!address) return true; // no address: nothing to find it by
  return contact.email_normalized === address || contact.email === address;
}

/** One workspace's drift, as counts and sample contact IDs. */
export function analyzeEmailDrift(userId, contacts) {
  const byCode = Object.fromEntries(DRIFT_CODES.map((code) => [code, { count: 0, sample: [] }]));
  const consequences = {
    missed_by_current_address: { count: 0, sample: [] },
    matched_by_old_address: { count: 0, sample: [] },
  };
  const add = (bucket, id) => {
    bucket.count += 1;
    if (bucket.sample.length < SAMPLE_IDS) bucket.sample.push(id);
  };
  let drifted = 0;
  let withSecondary = 0;
  for (const contact of contacts) {
    const codes = emailIdentityDrift(contact);
    if (codes.length) drifted += 1;
    for (const code of codes) add(byCode[code], contact.id);
    if (!indexedLookupFinds(contact)) add(consequences.missed_by_current_address, contact.id);
    if (codes.includes(EMAIL_DRIFT.NORMALIZED_STALE) || codes.includes(EMAIL_DRIFT.NORMALIZED_WITHOUT_EMAIL)) {
      add(consequences.matched_by_old_address, contact.id);
    }
    const entries = Array.isArray(contact.emails) ? contact.emails.filter((e) => text(e?.value)) : [];
    if (entries.length > 1) withSecondary += 1;
  }
  return { userId, contacts: contacts.length, drifted, withSecondaryAddresses: withSecondary, byCode, consequences };
}

/** Totals across workspaces (counts only). */
export function totalsFor(workspaces) {
  const totals = {
    workspaces: workspaces.length,
    contacts: 0,
    drifted: 0,
    withSecondaryAddresses: 0,
    byCode: Object.fromEntries(DRIFT_CODES.map((code) => [code, 0])),
    consequences: { missed_by_current_address: 0, matched_by_old_address: 0 },
  };
  for (const ws of workspaces) {
    totals.contacts += ws.contacts;
    totals.drifted += ws.drifted;
    totals.withSecondaryAddresses += ws.withSecondaryAddresses;
    for (const code of DRIFT_CODES) totals.byCode[code] += ws.byCode[code].count;
    for (const key of Object.keys(totals.consequences)) totals.consequences[key] += ws.consequences[key].count;
  }
  return totals;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const userArg = args.find((a) => a.startsWith('--user-id='));
  const targetUser = userArg ? userArg.split('=')[1] : null;
  const asJson = args.includes('--json');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const readLimit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const say = (...parts) => { if (!asJson) console.log(...parts); };

  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const appConfig = projectId ? { projectId } : {};
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))), ...appConfig });
    } else {
      initializeApp(appConfig);
    }
  }
  const db = getFirestore();

  say('');
  say('── measureEmailIdentityDrift — READ ONLY, nothing is written ──');
  const userIds = targetUser ? [targetUser] : (await db.collection('users').get()).docs.map((d) => d.id);
  const workspaces = [];
  for (const userId of userIds) {
    let ref = db.collection('users').doc(userId).collection('contacts');
    if (readLimit) ref = ref.limit(readLimit);
    const snap = await ref.get();
    if (snap.empty) continue;
    workspaces.push(analyzeEmailDrift(userId, snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }
  const totals = totalsFor(workspaces);

  if (asJson) {
    console.log(JSON.stringify({ totals, workspaces }, null, 2));
    return;
  }
  say(`  workspaces: ${totals.workspaces} · contacts: ${totals.contacts} · drifted: ${totals.drifted}`);
  for (const code of DRIFT_CODES) say(`    ${code.padEnd(26)} ${String(totals.byCode[code]).padStart(7)}`);
  say(`  missed by their current address (indexed lookups): ${totals.consequences.missed_by_current_address}`);
  say(`  still matched by an address they no longer have:   ${totals.consequences.matched_by_old_address}`);
  say(`  contacts with more than one address (secondary not matched today): ${totals.withSecondaryAddresses}`);
  say('');
  say('  Nothing was written. This script has no write path.');
}

// Only when run directly: importing it (the tests do) must not open Firestore.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('\n✗ measureEmailIdentityDrift failed:', err?.message ?? err);
    process.exit(1);
  });
}
