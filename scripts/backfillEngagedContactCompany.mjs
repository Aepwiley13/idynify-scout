/**
 * BACKFILL: company_id on engaged contacts that have none.
 *
 * One-time repair for the contacts the Scout people-surface audit found
 * homeless. The write paths are fixed as of this sprint (LinkedInLinkSearch,
 * ManualContactForm, and the merge path in mergeIdentifiers); this script
 * repairs the records already in the database.
 *
 * THE PROBLEM
 * ───────────
 * Scout's two headline people counters measure different things:
 *
 *   Saved Companies "Total Contacts"  sums per-company counts over ACCEPTED
 *                                     companies. A contact with no company_id
 *                                     is skipped outright.
 *   People "Total Leads"              counts contacts that are neither
 *                                     archived nor engaged, because Scout mode
 *                                     is the unengaged queue by design.
 *
 * An ENGAGED contact with NO company is therefore counted by neither. It is
 * still reachable in Hunter mode — this is a reconciliation gap, not a
 * disappearance — but it has no home in the Scout surfaces.
 *
 * WHAT THIS SCRIPT DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ────────────────────────────────────────────────────────
 * Two repairs, both conservative:
 *
 *   1. LINK a company-less engaged contact to a company that ALREADY EXISTS
 *      and is ALREADY 'accepted', matched on an exact normalized name or an
 *      exact domain, and only when that match is unambiguous.
 *
 *   2. PROMOTE a 'pending' company to 'accepted' when an engaged, unarchived
 *      contact is already linked to it. A pending company is an un-swiped
 *      discovery card; engaging someone there is an acceptance of it in
 *      everything but the stored status. This mirrors what the write paths now
 *      do at save time.
 *
 * It does NOT create companies. A contact whose only signal is an email domain
 * with no matching company stays unlinked — inventing a company from a domain
 * label is a judgement the app makes at save time with the user present, not
 * something a migration should do retroactively to historical records. Those
 * contacts remain in Hunter mode, which is their documented home.
 *
 * It does NOT touch 'rejected', 'replaced' or 'archived' companies. Those are
 * decisions the user made, and a migration must not reverse them.
 *
 * It never overwrites a company_id that is already set.
 *
 * EFFECT ON THE COUNTERS — state this in any PR that runs it
 * ──────────────────────────────────────────────────────────
 * Both repairs increase Saved Companies "Total Contacts", because each moves a
 * contact into the set that counter sums over. Neither changes what either
 * counter MEANS, and neither changes People "Total Leads" — every contact
 * touched here is engaged, and so excluded from that counter either way.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO RUN — in this order. Do not skip step 2.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   Step 0 — credentials (once per shell):
 *
 *     export FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json
 *       (GOOGLE_APPLICATION_CREDENTIALS is also honoured.)
 *
 *   Step 1 — DRY RUN. Reads only. Writes nothing. Prints every proposed link
 *            and promotion, one line each, with the signal it matched on:
 *
 *     node scripts/backfillEngagedContactCompany.mjs --dry-run --user-id=<uid>
 *
 *   Step 2 — REVIEW EVERY LINE. This is the load-bearing step. Each line names
 *            a contact and the company it is about to be filed under. A wrong
 *            link is worse than no link: it attributes a real person to a
 *            company they do not work for, and every downstream surface — the
 *            company's contact list, Barry's context, exports — inherits it.
 *            Check each proposed company against the contact's email domain
 *            and title. If any line looks wrong, stop and narrow with
 *            --only=<contactId> rather than running the whole set.
 *
 *   Step 3 — LIVE RUN. Only after step 2:
 *
 *     node scripts/backfillEngagedContactCompany.mjs --user-id=<uid>
 *
 *   Step 4 — VERIFY. Writes nothing. Re-reports what remains unlinked and why:
 *
 *     node scripts/backfillEngagedContactCompany.mjs --verify --user-id=<uid>
 *
 * Flags:
 *   --dry-run            Scan and report only. No Firestore writes.
 *   --user-id=<uid>      Scope to one user. Omit to scan every user.
 *   --only=<id[,id...]>  Restrict to specific contact ids. Combines with the above.
 *   --verify             Report remaining unlinked engaged contacts. No writes.
 *   --no-promote         Skip repair 2 (pending-company promotion).
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

// ── The engagement vocabulary ────────────────────────────
//
// Copied from src/pages/Scout/AllLeads.jsx. These two sets are what "engaged"
// means to the People counter, and therefore what decides whether a
// company-less contact is invisible to both counters or merely to one.

const ENGAGED_HUNTER_STATUSES = new Set([
  'active_mission', 'awaiting_reply', 'engaged_pending', 'in_conversation', 'converted',
]);

const ENGAGED_CONTACT_STATUSES = new Set([
  'Engaged', 'Awaiting Reply', 'In Conversation', 'Dormant',
  'Active Mission', 'In Campaign', 'Mission Complete',
  'Active Customer', 'Past Customer', 'Partner', 'Network',
]);

// `people_mode_skipped` is NOT here. A skip defers someone to a later day —
// it is not a rejection, which is why `inferIsArchived` in the sibling
// backfill refuses to set is_archived for one. Dropping it changes nothing
// this script actually does: every skipped row carries a company_id (the skip
// write path always sets one), so it fails the `!data.company_id` gate in
// repair 1 and the `isEngaged` gate in repair 2 regardless. It is corrected
// so the exported, unit-tested rule stops asserting the opposite of what the
// product means.
const ARCHIVED_STATUSES = new Set(['people_mode_archived']);

export function isEngaged(contact = {}) {
  return ENGAGED_HUNTER_STATUSES.has(contact.hunter_status)
    || ENGAGED_CONTACT_STATUSES.has(contact.contact_status);
}

export function isArchived(contact = {}) {
  return contact.is_archived === true || ARCHIVED_STATUSES.has(contact.status ?? '');
}

// ── Matching rules ───────────────────────────────────────
//
// Exported and unit-tested (src/test/backfillEngagedCompanyRule.test.js).
// These decide which real person gets filed under which real company, so they
// are not left buried in a loop where the only way to check them is to run the
// migration against production.

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'zoho.com',
  'yandex.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]);

/** Collapse case and non-alphanumerics. Deliberately NOT fuzzy. */
export function normalizeName(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeDomain(value) {
  const host = String(value ?? '')
    .trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '');
  return host.includes('.') ? host : null;
}

export function workDomainFromEmail(email) {
  const at = String(email ?? '').trim().toLowerCase();
  if (!at.includes('@')) return null;
  const domain = normalizeDomain(at.slice(at.lastIndexOf('@') + 1));
  if (!domain) return null;
  return FREE_EMAIL_DOMAINS.has(domain) ? null : domain;
}

/**
 * Find the one accepted company this contact belongs to, or null.
 *
 * @param {Object} contact
 * @param {Array<{id: string, data: Object}>} companies  All of the user's companies.
 * @returns {{companyId: string, signal: string, companyName: string}|null}
 */
export function matchAcceptedCompany(contact, companies) {
  // Only 'accepted'. A pending company is an un-swiped card the user has not
  // decided on, and rejected/replaced/archived are decisions they made — a
  // backfill must not quietly overturn any of them.
  const accepted = companies.filter(c => c.data?.status === 'accepted');

  const name = contact.company_name ?? contact.company ?? null;
  const normName = normalizeName(name);
  if (normName) {
    const hits = accepted.filter(c => normalizeName(c.data.name) === normName);
    // Ambiguity is a refusal, not a coin flip. Two companies sharing a
    // normalized name means the workspace has a duplicate that a human needs
    // to merge; picking one would file the contact under a coin toss.
    if (hits.length === 1) {
      return { companyId: hits[0].id, signal: 'name', companyName: hits[0].data.name };
    }
    if (hits.length > 1) return null;
  }

  const domain = workDomainFromEmail(contact.email);
  if (domain) {
    const hits = accepted.filter((c) => {
      const d = c.data;
      return [d.domain, d.primary_domain, d.website_url, d.website]
        .some(v => v && normalizeDomain(v) === domain);
    });
    if (hits.length === 1) {
      return { companyId: hits[0].id, signal: 'domain', companyName: hits[0].data.name };
    }
  }

  return null;
}

// ── CLI ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes('--dry-run');
const IS_VERIFY = args.includes('--verify');
const NO_PROMOTE = args.includes('--no-promote');
const TARGET_USER = args.find(a => a.startsWith('--user-id='))?.split('=')[1] ?? null;
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',').filter(Boolean) ?? null;
const MODE = IS_VERIFY ? 'verify' : IS_DRY_RUN ? 'dry-run' : 'live';
const WRITES_ENABLED = MODE === 'live';

let linked = 0;
let promoted = 0;
let unlinkable = 0;
let scanned = 0;
const unlinkableRows = [];

// ── Firestore ────────────────────────────────────────────

function initAdmin() {
  if (getApps().length) return getFirestore();
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(path, 'utf8'))) });
  } else {
    initializeApp();
  }
  return getFirestore();
}

async function processUser(db, userId) {
  const [contactsSnap, companiesSnap] = await Promise.all([
    db.collection('users').doc(userId).collection('contacts').get(),
    db.collection('users').doc(userId).collection('companies').get(),
  ]);

  const companies = companiesSnap.docs.map(d => ({ id: d.id, data: d.data() ?? {} }));
  const companyById = new Map(companies.map(c => [c.id, c.data]));
  const contacts = contactsSnap.docs.map(d => ({ id: d.id, data: d.data() ?? {} }));

  // ── Repair 1: link company-less engaged contacts ──
  for (const { id, data } of contacts) {
    if (ONLY && !ONLY.includes(id)) continue;
    if (data.company_id) continue;            // never overwrite
    if (isArchived(data)) continue;           // FallBack is their home
    if (!isEngaged(data)) continue;           // still counted by People

    scanned++;
    const match = matchAcceptedCompany(data, companies);

    if (!match) {
      unlinkable++;
      const domain = workDomainFromEmail(data.email);
      unlinkableRows.push(
        `    ${id}  ${JSON.stringify(data.name ?? '')}  `
        + `company_name=${JSON.stringify(data.company_name ?? data.company ?? '')} `
        + `domain=${domain ?? '(none/personal)'}`
      );
      continue;
    }

    linked++;
    console.log(
      `  LINK  ${id}  ${JSON.stringify(data.name ?? '')}`
      + `  ->  ${match.companyId}  ${JSON.stringify(match.companyName)}  (on ${match.signal})`
    );

    if (WRITES_ENABLED) {
      await db.collection('users').doc(userId).collection('contacts').doc(id).update({
        company_id: match.companyId,
        // Written only when absent, for the same reason the link is: filling a
        // hole, never restating what the record already says.
        ...(data.company_name ? {} : { company_name: match.companyName }),
        company_linked_by: 'backfillEngagedContactCompany',
        company_linked_signal: match.signal,
        company_linked_at: new Date().toISOString(),
      });
    }
  }

  // ── Repair 2: promote pending companies that hold an engaged contact ──
  if (!NO_PROMOTE && !IS_VERIFY) {
    const pendingWithEngaged = new Map();
    for (const { id, data } of contacts) {
      if (ONLY && !ONLY.includes(id)) continue;
      if (!data.company_id || isArchived(data) || !isEngaged(data)) continue;
      if (companyById.get(data.company_id)?.status !== 'pending') continue;
      pendingWithEngaged.set(data.company_id, { contactId: id, contactName: data.name ?? '' });
    }

    for (const [companyId, who] of pendingWithEngaged) {
      promoted++;
      const company = companyById.get(companyId);
      console.log(
        `  PROMOTE  ${companyId}  ${JSON.stringify(company.name ?? '')}  pending -> accepted`
        + `  (engaged contact ${who.contactId} ${JSON.stringify(who.contactName)})`
      );

      if (WRITES_ENABLED) {
        await db.collection('users').doc(userId).collection('companies').doc(companyId).update({
          status: 'accepted',
          // SavedCompanies orders on saved_at || created_at || swipedAt, and a
          // discovery card carries only found_at. Without this the promoted
          // company sorts to the bottom of the list permanently.
          saved_at: company.saved_at ?? new Date().toISOString(),
          accepted_via: 'backfillEngagedContactCompany',
        });
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  const db = initAdmin();

  console.log(`\nmode: ${MODE}${WRITES_ENABLED ? '  ** WRITES ENABLED **' : '  (no writes)'}`);
  if (TARGET_USER) console.log(`user: ${TARGET_USER}`);
  if (ONLY) console.log(`only: ${ONLY.join(', ')}`);
  console.log('');

  const userIds = TARGET_USER
    ? [TARGET_USER]
    : (await db.collection('users').get()).docs.map(d => d.id);

  for (const userId of userIds) {
    await processUser(db, userId);
  }

  console.log('');
  console.log(`  engaged contacts with no company scanned : ${scanned}`);
  console.log(`  linked to an accepted company            : ${linked}`);
  if (!NO_PROMOTE && !IS_VERIFY) {
    console.log(`  pending companies promoted               : ${promoted}`);
  }
  console.log(`  left unlinked (no unambiguous match)     : ${unlinkable}`);

  if (unlinkableRows.length) {
    console.log('\n  Still unlinked — Hunter mode is their home:');
    unlinkableRows.forEach(r => console.log(r));
  }

  if (!WRITES_ENABLED) {
    console.log('\n  Nothing was written. Re-run without --dry-run/--verify to apply.');
  }
  console.log('');
}

// Only run when invoked directly, so the matching rules above can be imported
// by tests without the migration executing as a side effect of the import.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('\nBackfill failed:', err);
    process.exit(1);
  });
}
