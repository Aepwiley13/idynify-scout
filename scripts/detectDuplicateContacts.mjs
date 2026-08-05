#!/usr/bin/env node
/**
 * DETECT: duplicate contacts
 *
 * READ-ONLY. This script writes nothing, ever. There is no --live flag, no
 * merge logic and no way to make it change a document. That is deliberate:
 * this is the INPUT to the dedup sprint, not the dedup sprint.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY REPORT BEFORE MERGING
 *
 * Merging two contacts destroys one of them. Which fields survive, which
 * timeline wins, what happens to two divergent Barry memories — those are
 * product decisions, and none of them can be made sensibly without knowing
 * the shape of the problem first. How many duplicates are there? Are they
 * mostly exact email collisions (safe, mechanical) or mostly name+company
 * near-misses (unsafe, needs a human)? Does one workspace have 4 and another
 * 4,000?
 *
 * The canonical-identity sprint stopped NEW duplicates from being created.
 * This counts the ones already there.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT USES THE PRODUCT'S OWN DEFINITION OF "SAME PERSON"
 *
 * Normalization is imported from src/utils/identityNormalization.js — the
 * exact module src/services/contactIdentityService.js uses at write time. A
 * report that normalized differently would flag pairs the product would not
 * have merged and miss ones it would, while looking authoritative. Sharing the
 * module is the only way the two can't drift.
 *
 * Groups are reported per the locked hierarchy:
 *
 *   email             exact, after lowercase + trim        SAFE to merge
 *   apollo_person_id  exact                                SAFE to merge
 *   linkedin_url      exact, after normalization           SAFE to merge
 *   name + company    loose (case/whitespace collapsed)    NEEDS A HUMAN
 *
 * The last one is reported SEPARATELY and must stay that way. "John Smith at
 * Acme" matches a second John Smith at Acme, and they may be two people.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
 *   export FIREBASE_PROJECT_ID=<your-project-id>        # only if not auto-detected
 *
 *   node scripts/detectDuplicateContacts.mjs                       # every workspace
 *   node scripts/detectDuplicateContacts.mjs --user-id=<uid>       # one workspace
 *   node scripts/detectDuplicateContacts.mjs --verbose             # list every group
 *   node scripts/detectDuplicateContacts.mjs --json > dupes.json   # machine-readable
 *
 * Flags:
 *   --user-id=<uid>  Scope to a single workspace.
 *   --verbose        Print every duplicate group, not just the summary and samples.
 *   --json           Emit JSON only. Nothing else goes to stdout.
 *   --limit=<n>      Cap contacts read per workspace (default: no cap).
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS pointing at your service account JSON, OR a
 *   GCP environment with Application Default Credentials.
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
const VERBOSE = args.includes('--verbose');
const AS_JSON = args.includes('--json');
const LIMIT_ARG = args.find(a => a.startsWith('--limit='));
const READ_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null;

/** Suppressed entirely in --json mode so stdout stays parseable. */
function say(...parts) {
  if (!AS_JSON) console.log(...parts);
}

// ── The signals, in hierarchy order ──────────────────────

/**
 * Each signal turns a contact into a grouping key, or null if the contact
 * carries nothing for that signal. `safe` marks the ones an automated merge
 * could act on; name+company is the one that cannot.
 */
const SIGNALS = [
  {
    id: 'email',
    label: 'Email',
    safe: true,
    key: (ids) => ids.email,
    note: 'Exact match after lowercase + trim. The primary dedup signal.',
  },
  {
    id: 'apollo_person_id',
    label: 'Apollo person ID',
    safe: true,
    key: (ids) => ids.apolloPersonId,
    note: 'Exact match. Same Apollo person imported through two paths.',
  },
  {
    id: 'linkedin_url',
    label: 'LinkedIn URL',
    safe: true,
    key: (ids) => ids.linkedinUrl,
    note: 'Exact match after stripping scheme, www., query and trailing slash.',
  },
  {
    id: 'phone',
    label: 'Phone',
    safe: true,
    key: (ids) => ids.phone,
    note: 'Exact match on digits. No country code is inferred.',
  },
  {
    id: 'name_company',
    label: 'Name + company',
    safe: false,
    key: (ids) => (ids.name && (ids.company || ids.companyId)
      ? `${ids.name}|${ids.companyId ?? ids.company}`
      : null),
    note: 'WEAK. Two people can share a name at one company. Never auto-merge these.',
  },
];

// ── Per-workspace analysis ───────────────────────────────

function describe(contact) {
  return {
    id: contact.id,
    name: contact.name ?? null,
    email: contact.email ?? null,
    company: contact.company_name ?? contact.company ?? null,
    source: contact.source ?? contact.addedFrom ?? null,
    created: contact.addedAt ?? contact.saved_at ?? contact.discovered_at ?? null,
    stage: contact.stage ?? null,
    // Does this record predate the sprint that started writing normalized
    // identifiers? A workspace full of these is one where the resolver has
    // been leaning on the fallback scan rather than on indexed queries.
    normalized: Boolean(contact.email_normalized || contact.linkedin_url_normalized || contact.phone_normalized),
  };
}

export function analyzeWorkspace(userId, contacts) {
  const result = {
    userId,
    contactsScanned: contacts.length,
    normalizedRecords: 0,
    flaggedForReview: 0,
    signals: {},
    /** Contacts appearing in at least one SAFE group — the real merge count. */
    duplicateContactIds: new Set(),
  };

  const identified = contacts.map(c => {
    const ids = extractIdentifiers(c);
    if (c.email_normalized || c.linkedin_url_normalized || c.phone_normalized) {
      result.normalizedRecords += 1;
    }
    if (c.identity_review_required) result.flaggedForReview += 1;
    return { contact: c, ids };
  });

  for (const signal of SIGNALS) {
    const buckets = new Map();

    for (const { contact, ids } of identified) {
      const key = signal.key(ids);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(contact);
    }

    const groups = [];
    for (const [key, members] of buckets) {
      if (members.length < 2) continue;
      groups.push({ key, members: members.map(describe) });
      if (signal.safe) {
        // Every member but one is redundant — that is the number of documents
        // a merge would eliminate, and it is the number worth quoting.
        for (const m of members) result.duplicateContactIds.add(m.id);
      }
    }

    groups.sort((a, b) => b.members.length - a.members.length);

    result.signals[signal.id] = {
      label: signal.label,
      safe: signal.safe,
      note: signal.note,
      groupCount: groups.length,
      // Documents that would disappear if each group collapsed to one record.
      redundantRecords: groups.reduce((n, g) => n + g.members.length - 1, 0),
      groups,
    };
  }

  result.duplicateContacts = result.duplicateContactIds.size;
  delete result.duplicateContactIds;
  return result;
}

// ── Reporting ────────────────────────────────────────────

function reportWorkspace(ws) {
  say('');
  say(`── workspace ${ws.userId} ──`);
  say(`   contacts scanned:        ${ws.contactsScanned}`);
  say(`   with normalized ids:     ${ws.normalizedRecords}  (written since the canonical-identity sprint)`);
  if (ws.flaggedForReview > 0) {
    say(`   already flagged:         ${ws.flaggedForReview}  (identity_review_required — created despite a weak match)`);
  }

  for (const signal of SIGNALS) {
    const s = ws.signals[signal.id];
    if (s.groupCount === 0) continue;

    const marker = s.safe ? '' : '   ⚠ NEEDS A HUMAN';
    say('');
    say(`   ${s.label}: ${s.groupCount} group${s.groupCount === 1 ? '' : 's'}, ` +
        `${s.redundantRecords} redundant record${s.redundantRecords === 1 ? '' : 's'}${marker}`);
    say(`      ${s.note}`);

    const shown = VERBOSE ? s.groups : s.groups.slice(0, 3);
    for (const g of shown) {
      say(`      · ${g.key}  (${g.members.length} records)`);
      for (const m of g.members) {
        const bits = [m.id, m.name ?? '(no name)', m.company ?? '(no company)', m.source ?? '(no source)'];
        say(`          ${bits.join('  ·  ')}`);
      }
    }
    if (!VERBOSE && s.groups.length > shown.length) {
      say(`      … and ${s.groups.length - shown.length} more group(s). Re-run with --verbose.`);
    }
  }

  if (ws.duplicateContacts === 0 && ws.signals.name_company.groupCount === 0) {
    say('   No duplicates detected.');
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

  say('');
  say('── detectDuplicateContacts — READ ONLY, nothing is written ──');
  if (TARGET_USER) say(`   scoped to workspace: ${TARGET_USER}`);

  let userIds;
  if (TARGET_USER) {
    userIds = [TARGET_USER];
  } else {
    const usersSnap = await db.collection('users').get();
    userIds = usersSnap.docs.map(d => d.id);
  }

  const workspaces = [];

  for (const userId of userIds) {
    let ref = db.collection('users').doc(userId).collection('contacts');
    if (READ_LIMIT) ref = ref.limit(READ_LIMIT);
    const snap = await ref.get();
    if (snap.empty) continue;

    const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ws = analyzeWorkspace(userId, contacts);
    workspaces.push(ws);
    reportWorkspace(ws);
  }

  // ── Totals ──
  const totals = {
    workspaces: workspaces.length,
    contactsScanned: 0,
    normalizedRecords: 0,
    flaggedForReview: 0,
    duplicateContacts: 0,
    bySignal: {},
  };

  for (const signal of SIGNALS) {
    totals.bySignal[signal.id] = { label: signal.label, safe: signal.safe, groupCount: 0, redundantRecords: 0 };
  }

  for (const ws of workspaces) {
    totals.contactsScanned += ws.contactsScanned;
    totals.normalizedRecords += ws.normalizedRecords;
    totals.flaggedForReview += ws.flaggedForReview;
    totals.duplicateContacts += ws.duplicateContacts;
    for (const signal of SIGNALS) {
      totals.bySignal[signal.id].groupCount += ws.signals[signal.id].groupCount;
      totals.bySignal[signal.id].redundantRecords += ws.signals[signal.id].redundantRecords;
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ totals, workspaces }, null, 2));
    return;
  }

  const bar = '─'.repeat(72);
  say('');
  say(bar);
  say('Summary — input for the dedup sprint');
  say(bar);
  say(`  workspaces scanned:        ${totals.workspaces}`);
  say(`  contacts scanned:          ${totals.contactsScanned}`);
  say(`  with normalized ids:       ${totals.normalizedRecords}`);
  say(`  already review-flagged:    ${totals.flaggedForReview}`);
  say('');
  say('  By signal:');
  for (const signal of SIGNALS) {
    const t = totals.bySignal[signal.id];
    const tag = t.safe ? 'mechanical' : 'NEEDS A HUMAN';
    say(`    ${t.label.padEnd(18)} ${String(t.groupCount).padStart(6)} groups  ` +
        `${String(t.redundantRecords).padStart(6)} redundant   [${tag}]`);
  }
  say('');
  say(`  Contacts involved in at least one SAFE duplicate group: ${totals.duplicateContacts}`);
  say('');
  say('  Read this as: the SAFE rows above can be merged mechanically by the');
  say('  dedup sprint. The name+company row cannot — two people can share a');
  say('  name at one company, and merging them destroys one of their histories.');
  say('');
  say('  Nothing was written. This script has no write path.');
  say('');
}

// Only run when invoked directly. Importing this module — which the tests do,
// to exercise analyzeWorkspace without a database — must not open a Firestore
// connection or read a service-account file.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('\n✗ detectDuplicateContacts failed:', err);
    process.exit(1);
  });
}

export { SIGNALS };
