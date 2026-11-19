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
 * --expect-metering  the app runs with CREDIT_METERING=on (staging only, mocked Apollo): enriching
 *             must charge credits exactly once. Without it, metering is expected off: enriching
 *             works and charges nothing
 * --out       where to write the JSON report (default: the system temp directory)
 */
export function parseE2eArgs(argv, { now = Date.now(), tmp = '/tmp' } = {}) {
  const args = {
    base: 'http://localhost:8888', email: null, password: null, headed: false, withPro: false, skipMyCard: false, expectMetering: false, out: null,
  };
  for (const a of argv) {
    if (a.startsWith('--base=')) args.base = a.slice(7);
    else if (a.startsWith('--email=')) args.email = a.slice(8);
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--headed') args.headed = true;
    else if (a === '--with-pro') args.withPro = true;
    else if (a === '--skip-my-card') args.skipMyCard = true;
    else if (a === '--expect-metering') args.expectMetering = true;
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

/** The function a /.netlify/functions/<name> URL calls, or null. */
export function functionName(url) {
  try {
    return new URL(url).pathname.match(/^\/\.netlify\/functions\/([^/?]+)/)?.[1] ?? null;
  } catch {
    return null;
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
 * Records the app itself creates under users/{uid} once paid features are on: the Barry panel
 * starts a session (barry_sessions/{id}) when it appears and keeps its conversation
 * (barryConversations/missionControl). They are not customer data, so they may appear and
 * change; they may not disappear, and nothing else may change because of them.
 */
export const APP_RECORD_COLLECTIONS = new Set(['barry_sessions', 'barryConversations']);

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
      if (!BILLING_COLLECTIONS.has(top) && !APP_RECORD_COLLECTIONS.has(top)) problems.push({ path, problem: 'unexpected new document' });
      continue;
    }
    const old = before[path];
    const keys = new Set([...Object.keys(old ?? {}), ...Object.keys(data ?? {})]);
    for (const key of keys) {
      if (same(old?.[key], data?.[key])) continue;
      if (path === '' && BILLING_FIELDS.has(key)) continue;
      if (BILLING_COLLECTIONS.has(top) || APP_RECORD_COLLECTIONS.has(top)) continue;
      if (path === enrichedContactPath && !filled(old?.[key])) continue;
      problems.push({ path: path || '(account)', field: key, problem: filled(old?.[key]) ? 'changed' : 'added outside enrichment' });
    }
  }
  return problems;
}

/**
 * The Scout contact page for one contact, anchored to the app's origin: /contact/<id>, optionally
 * with a query. Not /scout/contact/<id> (the side panel, which has no Enrich button in its
 * header), and not any other host. Pure.
 */
export function contactPageUrlPattern(base, contactId) {
  const origin = new URL(base).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${origin}/contact/${encodeURIComponent(contactId)}/?(\\?.*)?$`);
}

/** The app records (APP_RECORD_COLLECTIONS) that appeared between two snapshots, for the report. Pure. */
export function appRecordsAdded(before, after) {
  return Object.keys(after).filter((path) => !(path in before) && APP_RECORD_COLLECTIONS.has(path.split('/')[0])).sort();
}

/** Apollo stand-in calls made since `baseline` (the count when the journey started). Pure. */
export function callsSince(calls, baseline) {
  return calls.slice(Math.max(0, baseline));
}

/**
 * What step 4b does with the sticker part, from the app's own stickersConfig answer
 * ({ status, body } or null). Pure.
 *   do       the server offers stickers to this account: add one; a failure is a FAIL
 *   pending  the server says stickers are not offered (the staging rollout setting): not a pass
 *   fail     no answer, an error, or an answer that cannot be read: the state is unknown
 */
export function stickerStepPlan(answer) {
  if (!answer) return { action: 'fail', reason: 'The app received no stickersConfig answer, so whether stickers are offered is unknown.' };
  if (answer.status !== 200) return { action: 'fail', reason: `stickersConfig answered ${answer.status}.` };
  const body = answer.body;
  if (!body || typeof body.enabled !== 'boolean') return { action: 'fail', reason: 'stickersConfig answered 200 without an enabled flag.' };
  if (body.readOnly === true) return { action: 'fail', reason: 'stickersConfig says read-only, which only an admin viewing as someone gets.' };
  if (body.enabled) return { action: 'do' };
  return { action: 'pending', reason: `stickers are not offered to this account on staging (stickersConfig: enabled false, mode ${body.mode ?? 'unknown'}); the note was still checked` };
}

const PLAN_CREDITS = Object.freeze({ starter: 400, pro: 1250 });
const NOT_LIVE = new Set(['canceled', 'incomplete_expired']);

/**
 * Everything that must hold after Starter → Pro, from billingAccountSnapshot's summary and the
 * Starter state step 7 recorded ({ subscriptionId, price, creditsTotal }). Returns problems;
 * empty means the upgrade is right. Pure.
 */
export function verifyProUpgrade({ starter, summary }) {
  const problems = [];
  const account = summary?.account ?? {};
  const subs = summary?.stripe?.subscriptions ?? [];
  const live = subs.filter((s) => !NOT_LIVE.has(s.status));
  const grants = summary?.grants ?? [];
  if (!starter?.subscriptionId) problems.push('No Starter subscription was recorded before the upgrade.');
  if (starter?.creditsTotal !== PLAN_CREDITS.starter) problems.push(`Starter showed ${starter?.creditsTotal ?? 'no'} credits before the upgrade, not ${PLAN_CREDITS.starter}.`);
  if (account.stripeSubscriptionId !== starter?.subscriptionId) problems.push(`The account's subscription is ${account.stripeSubscriptionId ?? 'none'}, not ${starter?.subscriptionId}: a second subscription.`);
  if (live.length !== 1) problems.push(`Stripe has ${live.length} live subscriptions for this customer, not exactly one.`);
  const sub = live[0];
  if (sub && sub.id !== starter?.subscriptionId) problems.push(`The live subscription is ${sub.id}, not ${starter?.subscriptionId}.`);
  if (sub && sub.status !== 'active') problems.push(`The subscription is ${sub.status}, not active.`);
  if (sub && sub.price === starter?.price) problems.push('The subscription is still on the Starter price.');
  if (summary?.plan !== 'pro' || account.subscriptionTier !== 'pro') problems.push(`The account is ${account.subscriptionTier ?? summary?.plan ?? 'unknown'}, not pro.`);
  if (account.subscriptionStatus !== 'active') problems.push(`The account's subscription status is ${account.subscriptionStatus ?? 'unset'}, not active.`);
  const total = typeof account.credits === 'object' && account.credits ? account.credits.total : null;
  if (total !== PLAN_CREDITS.pro) problems.push(`Credits total ${total ?? 'none'}, not ${PLAN_CREDITS.pro}.`);
  const checkout = grants.filter((g) => g.kind === 'checkout');
  const planChange = grants.filter((g) => g.kind === 'plan_change');
  const others = grants.filter((g) => g.kind !== 'checkout' && g.kind !== 'plan_change');
  if (checkout.length !== 1) problems.push(`${checkout.length} checkout grants, not exactly one.`);
  else if (checkout[0].subscription !== starter?.subscriptionId || checkout[0].priceId !== starter?.price) problems.push('The checkout grant is not the 400-credit Starter grant on this subscription.');
  if (planChange.length !== 1) problems.push(`${planChange.length} plan-change grants, not exactly one.`);
  else {
    if (planChange[0].credits !== PLAN_CREDITS.pro - PLAN_CREDITS.starter) problems.push(`The plan-change grant is ${planChange[0].credits ?? 'no'} credits, not ${PLAN_CREDITS.pro - PLAN_CREDITS.starter}.`);
    if (sub && planChange[0].priceId !== sub.price) problems.push('The plan-change grant is not for the Pro price on the subscription.');
  }
  if (others.length) problems.push(`Unexpected grants: ${others.map((g) => g.kind).join(', ')}.`);
  const failing = (summary?.checks ?? []).filter((c) => !c.ok);
  if (failing.length) problems.push(`Billing checks failing: ${failing.map((c) => c.id).join(', ')}.`);
  return problems;
}

/**
 * One line per step, and the verdict. Pure.
 *   PASS        every step ran and passed
 *   FAIL        a step failed; the journey stopped there, so later steps did not run
 *   INCOMPLETE  nothing failed, but at least one step is pending: NOT a pass
 */
export function summarize(steps) {
  const lines = steps.map((s) => `${s.status === 'pass' ? '✓' : s.status === 'pending' ? '…' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  const failed = steps.filter((s) => s.status === 'fail');
  const pending = steps.filter((s) => s.status === 'pending');
  const verdict = failed.length ? 'FAIL' : pending.length ? 'INCOMPLETE' : 'PASS';
  const result = verdict === 'FAIL'
    ? `Result: FAIL — stopped at "${failed[0].name}"; the steps after it did not run.`
    : verdict === 'INCOMPLETE'
      ? `Result: INCOMPLETE — nothing failed, but not a pass: pending ${pending.map((s) => `"${s.name}"`).join(', ')}.`
      : 'Result: PASS — every step ran and passed.';
  return { lines, verdict, result, passed: verdict === 'PASS', complete: pending.length === 0, failed: failed.length, pending: pending.map((s) => s.name) };
}
