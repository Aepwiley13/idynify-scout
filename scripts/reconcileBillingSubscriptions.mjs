/**
 * Billing reconciliation report — billing hardening PR 1.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  READ-ONLY. Reports; never repairs. It writes nothing, anywhere — not to ║
 * ║  Firestore, not to Stripe. Any correction this report calls for is a     ║
 * ║  separate, explicitly approved, human decision — never automated here.   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * For every account that looks like a paying customer, diffs what Firestore
 * believes against what Stripe actually reports, and flags what this PR's
 * webhook hardening can't resolve on its own:
 *
 *   - hasCompletedPayment / a stripeCustomerId with no stripeSubscriptionId at all
 *     (AMBIGUOUS — can't verify against Stripe)
 *   - a Stripe customer with more than one non-canceled subscription
 *     (AMBIGUOUS — the exact duplicate-subscription risk this PR prevents going
 *      forward, but can't retroactively resolve by itself)
 *   - Firestore's mirrored status/period/cancellation fields disagreeing with
 *     Stripe's live subscription object
 *   - accounts still on the legacy numeric `credits` shape (listed, not fixed)
 *   - anything the hardened webhook has already written to
 *     `billingAmbiguousAccounts`, cross-referenced by uid
 *
 * USAGE
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/read-only-key.json \
 *   STRIPE_SECRET_KEY=sk_... \
 *     node scripts/reconcileBillingSubscriptions.mjs [--json]
 *
 * The Firestore key must belong to a service account with read-only access
 * (roles/datastore.viewer) — this script never calls .set/.update/.delete.
 * The Stripe key only ever makes read (retrieve/list) calls.
 *
 * EXIT CODES
 *   0  completed; nothing flagged
 *   2  completed; one or more accounts flagged for manual review
 *   1  did not complete (bad arguments, credentials, or an API error)
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';

class UsageError extends Error {}

export const USAGE =
  'Usage: FIREBASE_SERVICE_ACCOUNT_PATH=<read-only key> STRIPE_SECRET_KEY=sk_... ' +
  'node scripts/reconcileBillingSubscriptions.mjs [--json]\n';

async function connectFirestore(env) {
  const keyPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    throw new UsageError('FIREBASE_SERVICE_ACCOUNT_PATH is required: a key for a service account with read-only Firestore access (roles/datastore.viewer)');
  }
  let key;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    throw new UsageError('FIREBASE_SERVICE_ACCOUNT_PATH could not be read as a service-account key');
  }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(key), projectId: key.project_id }, `billing-reconcile-${Date.now()}`);
  return getFirestore(app);
}

async function connectStripe(env) {
  if (!env.STRIPE_SECRET_KEY) throw new UsageError('STRIPE_SECRET_KEY is required (read-only use — only retrieve/list calls are made)');
  const Stripe = (await import('stripe')).default;
  return new Stripe(env.STRIPE_SECRET_KEY);
}

async function listAllSubscriptionsForCustomer(stripe, customerId) {
  const all = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100, starting_after: startingAfter });
    all.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return all;
}

/** Pure — no I/O. Given one user doc's data and (if fetched) the live Stripe state, decides what to report. */
export function diffAccount(userDoc, stripeState) {
  const { uid, data } = userDoc;
  const findings = [];

  const looksLikePayingCustomer = data.hasCompletedPayment === true || Boolean(data.stripeCustomerId);
  if (!looksLikePayingCustomer) return findings;

  if (!data.stripeCustomerId || !data.stripeSubscriptionId) {
    findings.push({ uid, severity: 'AMBIGUOUS', reason: 'missing_stripe_ids', detail: { stripeCustomerId: data.stripeCustomerId ?? null, stripeSubscriptionId: data.stripeSubscriptionId ?? null } });
    return findings; // nothing further to diff without IDs
  }

  if (typeof data.credits === 'number') {
    findings.push({ uid, severity: 'INFO', reason: 'legacy_numeric_credits', detail: { credits: data.credits } });
  }

  if (!stripeState) return findings; // Stripe lookup failed/skipped — already noted by the caller

  const { subscription, allSubscriptionsForCustomer } = stripeState;

  const liveCount = allSubscriptionsForCustomer.filter((s) => !['canceled', 'incomplete_expired'].includes(s.status)).length;
  if (liveCount > 1) {
    findings.push({
      uid, severity: 'AMBIGUOUS', reason: 'multiple_live_subscriptions',
      detail: { customerId: data.stripeCustomerId, liveSubscriptionIds: allSubscriptionsForCustomer.filter((s) => !['canceled', 'incomplete_expired'].includes(s.status)).map((s) => s.id) },
    });
  }

  if (!subscription) {
    findings.push({ uid, severity: 'AMBIGUOUS', reason: 'on_file_subscription_not_found_in_stripe', detail: { stripeSubscriptionId: data.stripeSubscriptionId } });
    return findings;
  }

  if (subscription.status !== data.subscriptionStatus) {
    findings.push({ uid, severity: 'MISMATCH', reason: 'status_drift', detail: { firestore: data.subscriptionStatus ?? null, stripe: subscription.status } });
  }
  const stripeCancelAtPeriodEnd = subscription.cancel_at_period_end === true;
  if (stripeCancelAtPeriodEnd !== (data.cancelAtPeriodEnd === true)) {
    findings.push({ uid, severity: 'MISMATCH', reason: 'cancel_at_period_end_drift', detail: { firestore: data.cancelAtPeriodEnd ?? null, stripe: stripeCancelAtPeriodEnd } });
  }
  const stripePeriodEnd = subscription.current_period_end != null ? new Date(subscription.current_period_end * 1000).toISOString() : null;
  if (stripePeriodEnd && data.currentPeriodEnd && stripePeriodEnd !== data.currentPeriodEnd) {
    findings.push({ uid, severity: 'MISMATCH', reason: 'current_period_end_drift', detail: { firestore: data.currentPeriodEnd, stripe: stripePeriodEnd } });
  }
  if (!data.currentPeriodEnd) {
    findings.push({ uid, severity: 'INFO', reason: 'no_period_dates_on_file', detail: {} });
  }

  return findings;
}

async function run(env, { json } = {}) {
  const db = await connectFirestore(env);
  const stripe = await connectStripe(env);

  const usersSnap = await db.collection('users').select(
    'hasCompletedPayment', 'stripeCustomerId', 'stripeSubscriptionId', 'subscriptionStatus',
    'cancelAtPeriodEnd', 'currentPeriodEnd', 'credits'
  ).get();

  const findings = [];
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const looksLikePayingCustomer = data.hasCompletedPayment === true || Boolean(data.stripeCustomerId);
    if (!looksLikePayingCustomer) continue;

    let stripeState = null;
    if (data.stripeCustomerId && data.stripeSubscriptionId) {
      try {
        const [subscription, allSubscriptionsForCustomer] = await Promise.all([
          stripe.subscriptions.retrieve(data.stripeSubscriptionId).catch(() => null),
          listAllSubscriptionsForCustomer(stripe, data.stripeCustomerId),
        ]);
        stripeState = { subscription, allSubscriptionsForCustomer };
      } catch (err) {
        findings.push({ uid: doc.id, severity: 'ERROR', reason: 'stripe_lookup_failed', detail: { message: err.message } });
        continue;
      }
    }
    findings.push(...diffAccount({ uid: doc.id, data }, stripeState));
  }

  // Cross-reference anything the hardened webhook has already flagged.
  const ambiguousSnap = await db.collection('billingAmbiguousAccounts').get();
  const alreadyFlaggedByWebhook = ambiguousSnap.docs.map((d) => d.data());

  const report = {
    generatedAt: new Date().toISOString(),
    accountsScanned: usersSnap.size,
    findings,
    alreadyFlaggedByWebhook,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Scanned ${report.accountsScanned} user documents.\n`);
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.uid}  ${f.reason}  ${JSON.stringify(f.detail)}`);
    }
    console.log(`\n${findings.length} finding(s). ${alreadyFlaggedByWebhook.length} record(s) already in billingAmbiguousAccounts.`);
  }

  return findings.some((f) => f.severity === 'AMBIGUOUS' || f.severity === 'MISMATCH' || f.severity === 'ERROR') ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = process.argv.includes('--json');
  run(process.env, { json })
    .then((code) => process.exit(code))
    .catch((err) => {
      if (err instanceof UsageError) {
        console.error(err.message + '\n\n' + USAGE);
        process.exit(1);
      }
      console.error(err);
      process.exit(1);
    });
}
