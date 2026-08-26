#!/usr/bin/env node
/**
 * MEASURE: identity resolution exposure
 *
 * READ-ONLY. This script writes nothing, ever. There is no --live flag and no
 * code path that mutates a document. That is deliberate: this is the EVIDENCE
 * for Gate 2 Phase 2's tuning decisions, not a remediation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS SEPARATELY FROM detectDuplicateContacts.mjs
 *
 * That script answers "how many duplicates already exist?" — it groups records
 * that ALREADY collide. This one answers a different and, for Gate 2, more
 * decisive question:
 *
 *     HOW MANY RECORDS ARE EXPOSED TO INCORRECT RESOLUTION IN FUTURE?
 *
 * A contact with an email resolves on hierarchy step 2 — an indexed equality
 * query, exact, cheap, correct at any workspace size. A contact with only a
 * name and a company is reachable ONLY through the bounded fallback scan, and
 * only if it happens to fall inside that scan's window. Those two records look
 * identical in a duplicate report and are nothing alike in risk.
 *
 * Missing `*_normalized` fields are NOT reported here as a problem to fix.
 * `mergeIdentifiers` fills them in on every touch, so a record nobody touches
 * is a record nobody resolves against. Coverage is reported as context only,
 * and it is explicitly NOT an argument for a backfill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT USES THE PRODUCT'S OWN DEFINITION OF AN IDENTIFIER
 *
 * `extractIdentifiers` is imported from src/utils/identityNormalization.js —
 * the exact module src/services/contactIdentityService.js uses at write time.
 * A measurement that normalized differently would count records as safe that
 * the resolver cannot match, and would look authoritative while doing it.
 * Sharing the module is the only way the two cannot drift.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FIVE BUCKETS ARE MUTUALLY EXCLUSIVE
 *
 * Every contact lands in exactly one, ordered by the strongest signal it
 * carries. They sum to the contact count, and a test asserts that they do.
 * Overlapping buckets would let one record be counted as both safe and
 * exposed, which is how a measurement stops being usable as evidence.
 *
 *   authoritative     email OR apollo_person_id   → hierarchy steps 2–3
 *   linkedin_only     no authoritative, has LinkedIn
 *   phone_only        no authoritative, no LinkedIn, has phone
 *   name_company_only weak signal only            → hierarchy step 6, ASKS
 *   unresolvable      nothing at all              → always creates
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUTHORITATIVE COLLISIONS — the Gate 2 Phase 2f gate
 *
 * Gate 2 changes `findBy`'s silent `docs[0]` pick into a fail-closed refusal
 * when one authoritative identifier maps to two records. That is correct, and
 * it is user-visible: a workspace already carrying such collisions will start
 * seeing refusals where it previously saw a silent, possibly-wrong pick.
 *
 * The authorization for Phase 2 says to STOP and report if that proves
 * materially disruptive. This script produces the number that decides it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
 *   export FIREBASE_PROJECT_ID=<project-id>          # only if not auto-detected
 *
 *   node scripts/measureIdentityExposure.mjs                   # every workspace
 *   node scripts/measureIdentityExposure.mjs --user-id=<uid>   # one workspace
 *   node scripts/measureIdentityExposure.mjs --json            # machine-readable
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
import { extractIdentifiers } from '../src/utils/identityNormalization.js';

// ── CLI ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const USER_ID_ARG = args.find(a => a.startsWith('--user-id='));
const TARGET_USER = USER_ID_ARG ? USER_ID_ARG.split('=')[1] : null;
const AS_JSON = args.includes('--json');
const LIMIT_ARG = args.find(a => a.startsWith('--limit='));
const READ_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null;

/** Suppressed entirely in --json mode so stdout stays parseable. */
function say(...parts) {
  if (!AS_JSON) console.log(...parts);
}

// ── Constants mirrored from the resolver ─────────────────

/**
 * The fallback scan's bound, mirrored from
 * src/services/contactIdentityService.js (`export const SCAN_WINDOW = 200`).
 *
 * Duplicated rather than imported because that module pulls in the Firestore
 * WEB SDK and cannot load under Node with the Admin SDK — the same constraint
 * that produced src/utils/identityNormalization.js. A test asserts the two
 * values match by reading the service's source, so the copy cannot drift
 * silently.
 */
export const SCAN_WINDOW = 200;

// ── The buckets, strongest signal first ──────────────────

/**
 * Ordered. The first bucket whose `test` passes claims the contact, which is
 * what makes them mutually exclusive.
 */
export const BUCKETS = [
  {
    id: 'authoritative',
    label: 'Authoritative (email or Apollo id)',
    exposed: false,
    test: (ids) => Boolean(ids.email || ids.apolloPersonId),
    note: 'Resolves on an indexed equality query. Correct at any workspace size.',
  },
  {
    id: 'linkedin_only',
    label: 'LinkedIn only',
    exposed: true,
    test: (ids) => Boolean(ids.linkedinUrl),
    note: 'No authoritative id. Reachable via linkedin_url_normalized, else only through the bounded scan.',
  },
  {
    id: 'phone_only',
    label: 'Phone only',
    exposed: true,
    test: (ids) => Boolean(ids.phone),
    note: 'No authoritative id, no LinkedIn. Reachable via phone_normalized, else only through the bounded scan.',
  },
  {
    id: 'name_company_only',
    label: 'Name + company only',
    exposed: true,
    test: (ids) => Boolean(ids.name && (ids.company || ids.companyId)),
    note: 'WEAK. Hierarchy step 6 flags rather than merges, and Barry ASKS rather than creating.',
  },
  {
    id: 'unresolvable',
    label: 'No identity signal at all',
    exposed: true,
    test: () => true,
    note: 'Carries nothing the resolver can match on. Every encounter creates a new record.',
  },
];

/** Which bucket a contact belongs to. Exactly one, always. */
export function bucketFor(ids) {
  for (const b of BUCKETS) {
    if (b.test(ids)) return b.id;
  }
  // Unreachable — the last bucket's test is unconditional. Kept so a future
  // edit that removes that property fails loudly rather than returning
  // undefined and silently dropping records out of the totals.
  throw new Error('bucketFor: no bucket matched — the terminal bucket is no longer unconditional');
}

// ── Per-workspace analysis ───────────────────────────────

/**
 * Measure one workspace.
 *
 * Pure: takes contacts, returns counts. No Firestore, so the tests can
 * exercise it against a synthetic corpus without a database.
 *
 * @param {string} userId
 * @param {object[]} contacts  documents as {id, ...data}
 * @param {{scanWindow?: number}} [options]
 */
export function analyzeExposure(userId, contacts, { scanWindow = SCAN_WINDOW } = {}) {
  const buckets = Object.fromEntries(BUCKETS.map(b => [b.id, 0]));

  // Authoritative identifier → how many records carry it. A key with two or
  // more records is what Phase 2f will start refusing.
  const emailOwners = new Map();
  const apolloOwners = new Map();

  let normalizedEmail = 0;
  let normalizedLinkedin = 0;
  let normalizedPhone = 0;
  let flaggedForReview = 0;

  // Records the resolver can reach ONLY through the bounded fallback scan.
  //
  // This is the distinction that decides whether SCAN_WINDOW matters. A
  // LinkedIn-only record carrying `linkedin_url_normalized` resolves on an
  // indexed equality query and never touches the window — it is exposed in the
  // sense of having no authoritative id, but it is not at risk. One WITHOUT
  // that field is reachable only by scanning, and in a workspace larger than
  // the window it may be unreachable altogether.
  //
  // Counting the two together would say the window is load-bearing when it may
  // not be, which is exactly the kind of number that justifies the wrong work.
  const scanDependent = {
    linkedin: 0,      // exposed on LinkedIn, no linkedin_url_normalized
    phone: 0,         // exposed on phone, no phone_normalized
    name_company: 0,  // step 6 always filters the window
    // Authoritative, but reachable only by scanning: no email_normalized AND a
    // raw email that is not already lowercase, so findByEmail's two equality
    // queries both miss. (Apollo-id records are never scan-dependent — that
    // query is exact on a single field.)
    email: 0,
  };

  for (const contact of contacts) {
    const ids = extractIdentifiers(contact);
    const bucket = bucketFor(ids);
    buckets[bucket] += 1;

    if (bucket === 'linkedin_only' && !contact.linkedin_url_normalized) {
      scanDependent.linkedin += 1;
    }
    if (bucket === 'phone_only' && !contact.phone_normalized) {
      scanDependent.phone += 1;
    }
    if (bucket === 'name_company_only') {
      scanDependent.name_company += 1;
    }
    if (bucket === 'authoritative' && ids.email && !contact.email_normalized) {
      const raw = contact.email ?? contact.work_email ?? contact.email_address ?? '';
      if (String(raw).trim() !== ids.email) scanDependent.email += 1;
    }

    if (ids.email) emailOwners.set(ids.email, (emailOwners.get(ids.email) ?? 0) + 1);
    if (ids.apolloPersonId) {
      apolloOwners.set(ids.apolloPersonId, (apolloOwners.get(ids.apolloPersonId) ?? 0) + 1);
    }

    if (contact.email_normalized) normalizedEmail += 1;
    if (contact.linkedin_url_normalized) normalizedLinkedin += 1;
    if (contact.phone_normalized) normalizedPhone += 1;
    if (contact.identity_review_required) flaggedForReview += 1;
  }

  const collisions = (owners) => {
    let keys = 0;
    let records = 0;
    for (const n of owners.values()) {
      if (n < 2) continue;
      keys += 1;
      records += n;
    }
    return { keys, records };
  };

  const contactsScanned = contacts.length;
  const exposed = BUCKETS
    .filter(b => b.exposed)
    .reduce((n, b) => n + buckets[b.id], 0);

  return {
    userId,
    contactsScanned,
    // The headline number the authorization asked for: no email AND no Apollo
    // id. Equal to the sum of every exposed bucket, by construction.
    noAuthoritativeId: exposed,
    buckets,
    // A workspace larger than the scan window is one where the fallback cannot
    // see the whole workspace. Its exposed records are the ones genuinely at
    // risk of a missed match — reported as a population, never as a
    // probability, because the window's contents are ordered by document id
    // and a per-record estimate would be a fiction.
    overScanWindow: contactsScanned > scanWindow,
    exposedBeyondScanWindow: contactsScanned > scanWindow ? exposed : 0,
    collisions: {
      email: collisions(emailOwners),
      apollo_person_id: collisions(apolloOwners),
    },
    normalizedFieldCoverage: {
      email: normalizedEmail,
      linkedin: normalizedLinkedin,
      phone: normalizedPhone,
    },
    scanDependent,
    scanDependentTotal:
      scanDependent.linkedin + scanDependent.phone + scanDependent.name_company + scanDependent.email,
    flaggedForReview,
  };
}

// ── Reporting ────────────────────────────────────────────

function reportWorkspace(ws) {
  say('');
  say(`── workspace ${ws.userId} ──`);
  say(`   contacts scanned:        ${ws.contactsScanned}${ws.overScanWindow ? `   ⚠ OVER SCAN WINDOW (${SCAN_WINDOW})` : ''}`);

  for (const b of BUCKETS) {
    const n = ws.buckets[b.id];
    if (n === 0) continue;
    const marker = b.exposed ? ' ⚠' : '  ';
    say(`   ${marker} ${b.label.padEnd(36)} ${String(n).padStart(6)}`);
  }

  const c = ws.collisions;
  if (c.email.keys > 0 || c.apollo_person_id.keys > 0) {
    say('');
    say(`   ⚠ authoritative collisions — these will FAIL CLOSED after Gate 2 Phase 2f:`);
    if (c.email.keys > 0) {
      say(`        email:            ${c.email.keys} address(es) across ${c.email.records} records`);
    }
    if (c.apollo_person_id.keys > 0) {
      say(`        apollo_person_id: ${c.apollo_person_id.keys} id(s) across ${c.apollo_person_id.records} records`);
    }
  }
}

// ── Totals ───────────────────────────────────────────────

export function totalsFor(workspaces) {
  const totals = {
    workspaces: workspaces.length,
    workspacesOverScanWindow: 0,
    contacts: 0,
    noAuthoritativeId: 0,
    exposedBeyondScanWindow: 0,
    buckets: Object.fromEntries(BUCKETS.map(b => [b.id, 0])),
    collisions: {
      email: { keys: 0, records: 0 },
      apollo_person_id: { keys: 0, records: 0 },
    },
    normalizedFieldCoverage: { email: 0, linkedin: 0, phone: 0 },
    scanDependent: { linkedin: 0, phone: 0, name_company: 0, email: 0 },
    scanDependentTotal: 0,
    flaggedForReview: 0,
  };

  for (const ws of workspaces) {
    totals.contacts += ws.contactsScanned;
    totals.noAuthoritativeId += ws.noAuthoritativeId;
    totals.exposedBeyondScanWindow += ws.exposedBeyondScanWindow;
    if (ws.overScanWindow) totals.workspacesOverScanWindow += 1;
    totals.flaggedForReview += ws.flaggedForReview;
    for (const b of BUCKETS) totals.buckets[b.id] += ws.buckets[b.id];
    for (const key of ['email', 'apollo_person_id']) {
      totals.collisions[key].keys += ws.collisions[key].keys;
      totals.collisions[key].records += ws.collisions[key].records;
    }
    for (const key of ['email', 'linkedin', 'phone']) {
      totals.normalizedFieldCoverage[key] += ws.normalizedFieldCoverage[key];
    }
    for (const key of ['linkedin', 'phone', 'name_company', 'email']) {
      totals.scanDependent[key] += ws.scanDependent[key];
    }
    totals.scanDependentTotal += ws.scanDependentTotal;
  }

  return totals;
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

  say('');
  say('── measureIdentityExposure — READ ONLY, nothing is written ──');
  if (TARGET_USER) say(`   scoped to workspace: ${TARGET_USER}`);

  const userIds = TARGET_USER
    ? [TARGET_USER]
    : (await db.collection('users').get()).docs.map(d => d.id);

  const workspaces = [];

  for (const userId of userIds) {
    let ref = db.collection('users').doc(userId).collection('contacts');
    if (READ_LIMIT) ref = ref.limit(READ_LIMIT);
    const snap = await ref.get();
    if (snap.empty) continue;

    const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ws = analyzeExposure(userId, contacts);
    workspaces.push(ws);
    reportWorkspace(ws);
  }

  const totals = totalsFor(workspaces);

  if (AS_JSON) {
    console.log(JSON.stringify({ scanWindow: SCAN_WINDOW, totals, workspaces }, null, 2));
    return;
  }

  const bar = '─'.repeat(72);
  say('');
  say(bar);
  say('Summary — Gate 2 identity exposure');
  say(bar);
  say(`  workspaces scanned:            ${totals.workspaces}`);
  say(`  workspaces over scan window:   ${totals.workspacesOverScanWindow}   (> ${SCAN_WINDOW} contacts)`);
  say(`  contacts scanned:              ${totals.contacts}`);
  say('');
  say('  By strongest available signal (mutually exclusive):');
  for (const b of BUCKETS) {
    const tag = b.exposed ? 'EXPOSED' : 'safe';
    say(`    ${b.label.padEnd(36)} ${String(totals.buckets[b.id]).padStart(7)}   [${tag}]`);
  }
  say('');
  say(`  No authoritative identifier:   ${totals.noAuthoritativeId}`);
  say(`    …of those, in a workspace larger than the scan window: ${totals.exposedBeyondScanWindow}`);
  say('');
  say('  Authoritative collisions (Gate 2 Phase 2f will refuse these):');
  say(`    email:             ${totals.collisions.email.keys} address(es) across ${totals.collisions.email.records} records`);
  say(`    apollo_person_id:  ${totals.collisions.apollo_person_id.keys} id(s) across ${totals.collisions.apollo_person_id.records} records`);
  say('');
  say('  Normalized field coverage (context only — NOT a backfill argument):');
  say(`    email_normalized:        ${totals.normalizedFieldCoverage.email}`);
  say(`    linkedin_url_normalized: ${totals.normalizedFieldCoverage.linkedin}`);
  say(`    phone_normalized:        ${totals.normalizedFieldCoverage.phone}`);
  say(`  already review-flagged:    ${totals.flaggedForReview}`);
  say('');
  say('  Reachable ONLY through the bounded fallback scan — the SCAN_WINDOW gate:');
  say(`    LinkedIn, no normalized field:  ${totals.scanDependent.linkedin}`);
  say(`    phone, no normalized field:     ${totals.scanDependent.phone}`);
  say(`    name + company (always scans):  ${totals.scanDependent.name_company}`);
  say(`    email, unnormalized + mixed case: ${totals.scanDependent.email}`);
  say(`    TOTAL scan-dependent:           ${totals.scanDependentTotal}`);
  say('');
  say('  Read this as: the EXPOSED rows are records the resolver can only reach');
  say('  through the bounded fallback scan. In a workspace larger than the');
  say('  window, some of them are unreachable and a future encounter will');
  say('  create a duplicate. That population — not missing normalized fields —');
  say('  is the only evidence that would justify a targeted backfill.');
  say('');
  say('  Nothing was written. This script has no write path.');
  say('');
}

// Only run when invoked directly. Importing this module — which the tests do,
// to exercise analyzeExposure without a database — must not open a Firestore
// connection or read a service-account file.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('\n✗ measureIdentityExposure failed:', err);
    process.exit(1);
  });
}
