#!/usr/bin/env node
/**
 * Manual credit recovery — the only thing allowed to grant credits for a purchase this PR's
 * automated webhook path refused to (a pre-epoch/epoch-unset purchase, a rollback-window
 * purchase, or anything else flagged into billingAmbiguousAccounts). This is deliberately a
 * SEPARATE tool from the webhook, never invoked automatically, and requires a human to supply
 * purchase-specific evidence on every run — it will not run without it.
 *
 * ── Evidence is an approval record, not a substitute for validation ───────────────────────────
 *
 * The CLI's required --evidence-stripe-session-id/--evidence-note arguments used to be the
 * ENTIRE gate: whatever an operator typed was trusted at face value and just stored alongside the
 * grant. That's backwards. An operator's claim that "this is believed to be a genuine purchase"
 * is a record of WHO approved the recovery and WHY — it has never, by itself, proven the claim is
 * true. verifyPurchaseAgainstStripe() below independently re-derives the facts from Stripe itself
 * before any write happens:
 *   - priceId must be a recognized, CREDIT-GRANTING Idynify price — rejects both a totally
 *     unknown price and a known-but-free one (e.g. the $0/month Scout Starter price).
 *   - POSITIVE account ownership, not merely "no stated contradiction": the Stripe customer's own
 *     metadata.firebaseUID must equal --uid. This is a materially stronger check than comparing
 *     against the account's OWN stripeCustomerId field, which may simply be unset (nothing in
 *     Firestore to contradict an operator's claim with) — the webhook path (stripe-webhook.js
 *     6c) gets its identity from a verified Firebase ID token or session metadata; manual
 *     recovery has no such independent identity source unless it asks Stripe directly, which is
 *     what this check does.
 *   - the subscription's actual purchased price must match the claimed --price-id — rejects a
 *     mismatched purchase record (the operator claiming a different price than what was bought).
 *   - the subscription must not be canceled/incomplete_expired — never restores access for a
 *     subscription that is not currently in force.
 *   - PAYMENT must be independently confirmed, not assumed from status alone. When the evidence
 *     is a checkout session (cs_...), its own payment_status must be "paid". When the evidence is
 *     the subscription id itself (sub_..., the legacy-Payment-Link case with no checkout session
 *     to point at), the subscription's own latest invoice must be "paid" — an unpaid, open, or
 *     uncollectible invoice means no payment was ever actually confirmed, however plausible the
 *     operator's note reads.
 *   - the account must not already have a DIFFERENT subscription on file — granting for this one
 *     would overwrite that unrelated subscription's balance and usage, not just add to it.
 *   - the account must not already show a completed grant or recorded usage for THIS SAME
 *     subscription (hasCompletedPayment already true, or an object-shaped credits.used > 0) —
 *     if it does, something already applied this purchase through a different path (or the data
 *     is otherwise inconsistent), and overwriting would reset real usage history. That needs
 *     human review, not an automatic overwrite — this script preserves what's already there and
 *     refuses instead.
 *   - the evidence pointer itself must independently resolve to a real Stripe object that
 *     actually supports this grant (a checkout session for this exact subscription, paid; or the
 *     subscription id itself, with its own payment independently confirmed as above) — an
 *     operator typing ANY string into --evidence-stripe-session-id is never sufficient on its own.
 * Any failure throws EvidenceValidationError and nothing is written — not even the ambiguous-
 * account record is touched.
 *
 * TRANSACTIONAL + IDEMPOTENT, not just "checked before running":
 *   - The existence check for billingAllocations/{subscriptionId} and every write happen inside
 *     ONE Firestore transaction. Running this script twice for the same subscriptionId — by
 *     mistake, or because two people ran it concurrently — commits the grant at most once; the
 *     second run's transaction sees the marker the first run just wrote and refuses, atomically.
 *     This is not "check the report, then act" — a report is just visibility, never a guard
 *     (do not treat scripts/reconcileBillingSubscriptions.mjs's output as if running it, or
 *     reading it, prevented anything). The guard is this transaction's own read-then-write.
 *   - If an ambiguousAccountDocId is given, that record is read inside the SAME transaction and
 *     marked 'resolved' in the SAME commit as the grant — so the credit write and the
 *     review-queue update can never land independently of each other.
 *   - The "different subscription already on file" check runs BOTH before the transaction (fast
 *     failure against the Stripe-verified facts) AND again inside it against a fresh read — the
 *     Firestore-only re-check closes the race where a concurrent webhook grant binds a different
 *     subscription to this account in between the two.
 *
 * Reuses creditGrantFields() from netlify/functions/utils/creditGrantFields.js — the exact same
 * function the automated webhook path uses — so a manual grant is byte-for-byte what an
 * automated one would have produced, never a hand-rolled approximation.
 *
 * This writes to Firestore. It needs a WRITE-capable service account key, not the read-only one
 * used for verification/reconciliation elsewhere in this project — do not point
 * FIREBASE_SERVICE_ACCOUNT_PATH at the read-only key; every write will fail with
 * PERMISSION_DENIED, which is a safe failure, not a usage error to work around. It also needs a
 * real STRIPE_SECRET_KEY to independently verify the purchase — this tool cannot run on claimed
 * evidence alone.
 *
 * USAGE
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/write-capable-key.json \
 *   STRIPE_SECRET_KEY=sk_live_... \
 *     node scripts/manualCreditRecovery.mjs \
 *       --uid <firebase-uid> \
 *       --subscription-id <sub_...> \
 *       --price-id <price_...> \
 *       --evidence-stripe-session-id <cs_...|sub_...> \
 *       --evidence-note "<why this is believed to be a genuine, never-granted purchase>" \
 *       [--ambiguous-account-doc-id <doc id from billingAmbiguousAccounts>] \
 *       [--operator "<name doing the recovery>"] \
 *       [--dry-run]
 *
 * Exit codes: 0 applied (or dry-run would apply); 2 already granted (idempotent no-op, not an
 * error); 1 did not run at all (missing evidence, bad arguments, failed Stripe validation, or a
 * Firestore/auth error).
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';
import { creditGrantFields } from '../netlify/functions/utils/creditGrantFields.js';
import { isKnownIdynifyPrice, isCreditGrantingPrice } from '../netlify/functions/utils/billingPrices.js';

export class UsageError extends Error {}
export class AlreadyGrantedError extends Error {}
export class EvidenceValidationError extends Error {}

export const USAGE = `Usage: FIREBASE_SERVICE_ACCOUNT_PATH=<write-capable key> STRIPE_SECRET_KEY=<key> node scripts/manualCreditRecovery.mjs \\
  --uid <firebase-uid> --subscription-id <sub_...> --price-id <price_...> \\
  --evidence-stripe-session-id <cs_...|sub_...> --evidence-note "<why this is genuine>" \\
  [--ambiguous-account-doc-id <id>] [--operator "<name>"] [--dry-run]
`;

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = argv[i + 1];
    i++;
  }
  const required = ['uid', 'subscriptionId', 'priceId', 'evidenceStripeSessionId', 'evidenceNote'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new UsageError(`Missing required evidence/identification arguments: ${missing.join(', ')}\n\n${USAGE}`);
  }
  return args;
}

/**
 * Independently re-derives the purchase facts from Stripe — never trusts the CLI arguments at
 * face value. Runs BEFORE any Firestore transaction starts (mirrors stripe-webhook.js's own
 * "Stripe reads needed to decide, Firestore reads/writes in the transaction" split), so a bad
 * argument fails fast without ever touching Firestore. See file header for what each check is
 * for. Returns the verified subscription on success.
 */
export async function verifyPurchaseAgainstStripe({ stripe, userData, uid, subscriptionId, priceId, evidenceStripeSessionId }) {
  if (!isKnownIdynifyPrice(priceId)) {
    throw new EvidenceValidationError(`priceId ${priceId} is not a recognized Idynify price — refusing to grant an unknown price`);
  }
  if (!isCreditGrantingPrice(priceId)) {
    throw new EvidenceValidationError(`priceId ${priceId} is a known Idynify price but does not grant credits (e.g. a free price) — refusing`);
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    throw new EvidenceValidationError(`could not retrieve subscription ${subscriptionId} from Stripe: ${err.message}`);
  }

  // Positive ownership, not merely "no stated contradiction". userData.stripeCustomerId being
  // unset proves nothing either way — it's simply absent, not a cleared contradiction. The
  // Stripe customer's OWN metadata is the independent identity source here, mirroring how the
  // webhook path (stripe-webhook.js 6c) cross-checks customer.metadata.firebaseUID.
  let customer;
  try {
    customer = await stripe.customers.retrieve(subscription.customer);
  } catch (err) {
    throw new EvidenceValidationError(`could not retrieve Stripe customer ${subscription.customer} for subscription ${subscriptionId}: ${err.message}`);
  }
  if (customer.metadata?.firebaseUID !== uid) {
    throw new EvidenceValidationError(
      `Stripe customer ${subscription.customer} has metadata.firebaseUID "${customer.metadata?.firebaseUID ?? 'unset'}", not "${uid}" — refusing without positive proof of account ownership (missing customer binding)`
    );
  }
  if (userData.stripeCustomerId && subscription.customer !== userData.stripeCustomerId) {
    throw new EvidenceValidationError(
      `subscription ${subscriptionId} belongs to Stripe customer ${subscription.customer}, but users/${uid} is recorded under ${userData.stripeCustomerId} — refusing (mismatched account)`
    );
  }

  const actualPriceIds = (subscription.items?.data ?? []).map((item) => item.price?.id);
  if (!actualPriceIds.includes(priceId)) {
    throw new EvidenceValidationError(
      `subscription ${subscriptionId} does not actually carry price ${priceId} (has: ${actualPriceIds.join(', ') || 'none'}) — refusing (mismatched purchase record)`
    );
  }

  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    throw new EvidenceValidationError(`subscription ${subscriptionId} is ${subscription.status} — refusing to restore access for a canceled subscription`);
  }

  if (userData.stripeSubscriptionId && userData.stripeSubscriptionId !== subscriptionId) {
    throw new EvidenceValidationError(
      `users/${uid} already has a different subscription (${userData.stripeSubscriptionId}) on file — granting credits for ${subscriptionId} would overwrite that unrelated balance and usage. Resolve the correct target manually.`
    );
  }

  // Preserve existing balance and usage: if this account already shows a completed grant or
  // recorded usage for THIS SAME subscription, something already applied this purchase through
  // another path (or the data is otherwise inconsistent) — overwriting would reset real usage
  // history. That needs human review, not an automatic overwrite.
  if (userData.stripeSubscriptionId === subscriptionId) {
    const hasObjectUsage = userData.credits && typeof userData.credits === 'object' && userData.credits.used > 0;
    if (userData.hasCompletedPayment === true || hasObjectUsage) {
      throw new EvidenceValidationError(
        `users/${uid} already shows ${userData.hasCompletedPayment === true ? 'a completed payment' : 'recorded usage'} for subscription ${subscriptionId} with no billingAllocations marker — refusing to overwrite existing balance and usage; this needs human review`
      );
    }
  }

  // The evidence pointer itself must independently check out — never trusted just because an
  // operator supplied one. --evidence-stripe-session-id is documented as <cs_...|sub_...>.
  // Either form must also independently confirm PAYMENT, not just existence.
  if (evidenceStripeSessionId.startsWith('cs_')) {
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(evidenceStripeSessionId);
    } catch (err) {
      throw new EvidenceValidationError(`could not retrieve checkout session ${evidenceStripeSessionId} from Stripe: ${err.message}`);
    }
    if (session.subscription !== subscriptionId) {
      throw new EvidenceValidationError(
        `evidence checkout session ${evidenceStripeSessionId} points at subscription ${session.subscription ?? 'none'}, not ${subscriptionId} — the evidence does not actually support this grant`
      );
    }
    if (session.payment_status !== 'paid') {
      throw new EvidenceValidationError(`evidence checkout session ${evidenceStripeSessionId} has payment_status "${session.payment_status}", not "paid"`);
    }
  } else if (evidenceStripeSessionId === subscriptionId) {
    // No checkout session to point at (the legacy Payment Link case) — the subscription's own
    // latest invoice is the only remaining source of independent payment confirmation. The
    // subscription's status alone is not enough: 'active' can occur mid-cycle with the CURRENT
    // invoice still open/unpaid, so the invoice itself must say "paid", not merely "not canceled".
    if (!subscription.latest_invoice) {
      throw new EvidenceValidationError(`subscription ${subscriptionId} has no latest_invoice to confirm payment against — refusing unpaid subscription-id evidence`);
    }
    let invoice;
    try {
      invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
    } catch (err) {
      throw new EvidenceValidationError(`could not retrieve invoice ${subscription.latest_invoice} for subscription ${subscriptionId}: ${err.message}`);
    }
    if (invoice.status !== 'paid') {
      throw new EvidenceValidationError(
        `subscription ${subscriptionId}'s latest invoice has status "${invoice.status}", not "paid" — refusing unpaid subscription-id evidence`
      );
    }
  } else {
    throw new EvidenceValidationError(
      `--evidence-stripe-session-id ${evidenceStripeSessionId} is neither a checkout session for ${subscriptionId} nor the subscription id itself — the evidence does not point at this purchase`
    );
  }

  return subscription;
}

/**
 * The transactional core. `db` and `stripe` are injected (never imported at module scope) so this
 * is testable against the Firestore emulator and a fake Stripe client without needing real
 * credentials, and so the CLI entrypoint below is the only place that ever touches a real
 * service-account connection or a real Stripe key.
 */
export async function applyManualRecovery(db, stripe, args) {
  const { uid, subscriptionId, priceId, evidenceStripeSessionId, evidenceNote, ambiguousAccountDocId, operator, dryRun } = args;

  const preUserSnap = await db.collection('users').doc(uid).get();
  if (!preUserSnap.exists) throw new UsageError(`users/${uid} does not exist`);

  // Independent Stripe verification happens BEFORE the transaction — see
  // verifyPurchaseAgainstStripe for what it checks and why. A failure here never touches
  // Firestore at all, not even to read further.
  await verifyPurchaseAgainstStripe({ stripe, userData: preUserSnap.data(), uid, subscriptionId, priceId, evidenceStripeSessionId });

  return db.runTransaction(async (tx) => {
    // ── READ PHASE ──────────────────────────────────────────────────────────────────────────
    const allocRef = db.collection('billingAllocations').doc(subscriptionId);
    const allocSnap = await tx.get(allocRef);
    if (allocSnap.exists) {
      throw new AlreadyGrantedError(
        `billingAllocations/${subscriptionId} already exists (granted at ${allocSnap.data()?.grantedAt}) — refusing to grant again. This is the idempotency guard, not an error to bypass.`
      );
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new UsageError(`users/${uid} does not exist`);

    // Re-check against a FRESH read, inside the transaction — closes the gap between the
    // Stripe pre-check above and this commit (e.g. a concurrent webhook grant binding a
    // different subscription to this account in between). No new Stripe call is needed: the
    // Stripe-side facts (customer, price, status) don't change within this window; only
    // Firestore's own state can race here.
    const userData = userSnap.data();
    if (userData.stripeSubscriptionId && userData.stripeSubscriptionId !== subscriptionId) {
      throw new EvidenceValidationError(
        `users/${uid} now has a different subscription (${userData.stripeSubscriptionId}) on file — aborting to avoid overwriting its balance and usage`
      );
    }
    if (userData.stripeSubscriptionId === subscriptionId) {
      const hasObjectUsage = userData.credits && typeof userData.credits === 'object' && userData.credits.used > 0;
      if (userData.hasCompletedPayment === true || hasObjectUsage) {
        throw new EvidenceValidationError(
          `users/${uid} now shows ${userData.hasCompletedPayment === true ? 'a completed payment' : 'recorded usage'} for subscription ${subscriptionId} — aborting to avoid overwriting existing balance and usage`
        );
      }
    }

    let ambiguousRef = null;
    let ambiguousSnap = null;
    if (ambiguousAccountDocId) {
      ambiguousRef = db.collection('billingAmbiguousAccounts').doc(ambiguousAccountDocId);
      ambiguousSnap = await tx.get(ambiguousRef);
      if (!ambiguousSnap.exists) throw new UsageError(`billingAmbiguousAccounts/${ambiguousAccountDocId} does not exist`);
    }

    // ── DECIDE PHASE (pure) ─────────────────────────────────────────────────────────────────
    const { fields } = creditGrantFields(priceId);
    const grantedAt = new Date().toISOString();
    const allocationData = {
      uid, priceId, grantedAt,
      recoveredManually: true,
      evidence: { stripeSessionId: evidenceStripeSessionId, note: evidenceNote, operator: operator ?? null },
    };

    if (dryRun) {
      return { applied: false, dryRun: true, wouldWrite: { user: fields, allocation: allocationData } };
    }

    // ── WRITE PHASE ─────────────────────────────────────────────────────────────────────────
    tx.update(userRef, fields);
    tx.set(allocRef, allocationData);
    if (ambiguousRef) {
      tx.update(ambiguousRef, {
        status: 'resolved', resolvedAt: grantedAt, resolvedBy: operator ?? null, resolutionNote: evidenceNote,
      });
    }

    return { applied: true, dryRun: false, grantedAt };
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) { console.error(err.message); process.exit(1); }
    throw err;
  }

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH is required: a WRITE-capable service-account key.');
    process.exit(1);
  }
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error('STRIPE_SECRET_KEY is required: this tool independently verifies the purchase against Stripe, it does not run on claimed evidence alone.');
    process.exit(1);
  }
  let key;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH could not be read as a service-account key.');
    process.exit(1);
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { default: Stripe } = await import('stripe');
  initializeApp({ credential: cert(key) });
  const db = getFirestore();
  const stripe = new Stripe(stripeSecretKey);

  try {
    const result = await applyManualRecovery(db, stripe, args);
    if (result.dryRun) {
      console.log('DRY RUN — nothing written. Would write:');
      console.log(JSON.stringify(result.wouldWrite, null, 2));
      process.exit(0);
    }
    console.log(`Applied. billingAllocations/${args.subscriptionId} created at ${result.grantedAt}.`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AlreadyGrantedError) {
      console.log(err.message);
      process.exit(2); // idempotent no-op, not a failure
    }
    if (err instanceof UsageError || err instanceof EvidenceValidationError) { console.error(err.message); process.exit(1); }
    console.error('Recovery transaction failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
