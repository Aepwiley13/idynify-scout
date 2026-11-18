/**
 * The pure parts of the Free → Scout end-to-end test (freeToScout.mjs): arguments, the CSV of
 * five people, which requests cost money, and the before/after comparison of the account.
 * No browser, no network, no Firebase. Tested by src/test/freeToScoutJourney.test.js.
 */
import { randomBytes } from 'node:crypto';

export class JourneyRefusal extends Error {}

/** Five valid people, as in the W2 import tests. */
export const FIVE_PEOPLE_CSV = [
  'First Name,Last Name,Email,Phone,Company,Title',
  'Ana,Lopez,ana.lopez@e2e.example.test,801-555-0101,Acme,CEO',
  'Ben,Okafor,ben.okafor@e2e.example.test,801-555-0102,Globex,CTO',
  'Cara,Singh,cara.singh@e2e.example.test,,Initech,Designer',
  'Dev,Patel,dev.patel@e2e.example.test,801-555-0104,,Engineer',
  'Eve,Martin,eve.martin@e2e.example.test,801-555-0105,Umbrella,',
].join('\n');

/** The person the journey organizes, upgrades from and enriches. */
export const FOCUS_PERSON = 'Ana Lopez';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * --base      the app, served locally by stagingDev.mjs (default http://localhost:8888). Only a
 *             local address is accepted: this test signs up and pays, and must never run against
 *             a deployed site.
 * --email     the new account's address (default: a fresh e2e address each run)
 * --headed    show the browser (needed to finish payment by hand if Stripe's page changes)
 * --with-pro  then upgrade Starter → Pro in Settings (W3)
 * --skip-my-card  run without the My Card step (until the Contact Hub team's My Card is merged)
 * --out       where to write the JSON report (default: the system temp directory)
 */
export function parseE2eArgs(argv, { now = Date.now(), tmp = '/tmp' } = {}) {
  const args = {
    base: 'http://localhost:8888', email: null, password: null, headed: false, withPro: false, skipMyCard: false, out: null,
  };
  for (const a of argv) {
    if (a.startsWith('--base=')) args.base = a.slice(7);
    else if (a.startsWith('--email=')) args.email = a.slice(8);
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--headed') args.headed = true;
    else if (a === '--with-pro') args.withPro = true;
    else if (a === '--skip-my-card') args.skipMyCard = true;
    else throw new JourneyRefusal(`Unknown argument: ${a}`);
  }
  let url;
  try {
    url = new URL(args.base);
  } catch {
    throw new JourneyRefusal('--base must be a URL.');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new JourneyRefusal(`--base must be the local staging app (localhost), not ${url.hostname}. This test signs up and pays.`);
  }
  args.base = url.origin;
  args.email ??= `idynify-e2e-${now}@e2e.example.test`;
  args.password = `E2e-${randomBytes(9).toString('base64url')}!9`;
  args.out ??= `${tmp}/idynify-e2e-${now}.json`;
  return args;
}

/** Netlify functions that cost money (Apollo or Claude). A Free account must make none of these. */
const PAID_FUNCTION = /\/\.netlify\/functions\/(enrichContact|enrichCompany|searchPeople|barryEnrich|findContact|findContactByLinkedInUrl|find-contact-by-email|captureLinkedIn|search-companies|search-companies-manual|captureExtract|analyze-website|crawl-website-contacts|barry[A-Za-z-]*|generate-[A-Za-z0-9-]+)(\?|$)/;

export function isPaidRequest(url) {
  try {
    return PAID_FUNCTION.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const filled = (v) => !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Fields the upgrade itself may change on users/{uid}. */
export const BILLING_FIELDS = new Set([
  'hasCompletedPayment', 'paymentCompletedAt', 'subscriptionTier', 'subscriptionStatus', 'selectedTier', 'status',
  'credits', 'monthlyCredits', 'tierLimits', 'features', 'billingCycleDate', 'stripeCustomerId', 'stripeSubscriptionId',
  'currentPeriodStart', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'pauseCollection', 'pendingCheckout', 'billingLock', 'lastRenewalAt',
]);

/** Collections under users/{uid} the server writes as part of billing and metering. */
export const BILLING_COLLECTIONS = new Set(['creditCharges', 'creditTransactions', 'creditUsage']);

/**
 * Compares two snapshots of an account: { [docPath]: data }, paths relative to users/{uid}
 * ('' is the account document itself). Returns a list of problems; empty means nothing the
 * customer made was lost or changed.
 *
 *   - no document may disappear;
 *   - the account document may change only in BILLING_FIELDS;
 *   - billing and metering records may appear;
 *   - the enriched person may gain values only in fields that were empty before;
 *   - every other document (people, stickers, notes, the card, anything else) is unchanged.
 * Documents that appear elsewhere are reported, so nothing unexpected passes silently.
 */
export function compareAccount(before, after, { enrichedContactPath = null } = {}) {
  const problems = [];
  for (const path of Object.keys(before)) {
    if (!(path in after)) problems.push({ path, problem: 'deleted' });
  }
  for (const [path, data] of Object.entries(after)) {
    const top = path.split('/')[0];
    if (!(path in before)) {
      if (!BILLING_COLLECTIONS.has(top)) problems.push({ path, problem: 'unexpected new document' });
      continue;
    }
    const old = before[path];
    const keys = new Set([...Object.keys(old ?? {}), ...Object.keys(data ?? {})]);
    for (const key of keys) {
      if (same(old?.[key], data?.[key])) continue;
      if (path === '' && BILLING_FIELDS.has(key)) continue;
      if (BILLING_COLLECTIONS.has(top)) continue;
      if (path === enrichedContactPath && !filled(old?.[key])) continue;
      problems.push({ path: path || '(account)', field: key, problem: filled(old?.[key]) ? 'changed' : 'added outside enrichment' });
    }
  }
  return problems;
}

/** One line per step for the console, and whether the journey passed. Pure. */
export function summarize(steps) {
  const lines = steps.map((s) => `${s.status === 'pass' ? '✓' : s.status === 'pending' ? '…' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  const failed = steps.filter((s) => s.status === 'fail');
  const pending = steps.filter((s) => s.status === 'pending');
  return { lines, passed: failed.length === 0 && pending.length === 0, complete: pending.length === 0, failed: failed.length };
}
