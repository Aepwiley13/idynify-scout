#!/usr/bin/env node
/**
 * STAGING + STRIPE TEST MODE ONLY, READ-ONLY: one account's billing state, checked.
 *
 * For the staging validation in docs/billing/STAGING_VALIDATION_RUNBOOK.md. After each
 * scenario it prints what the app, the webhook and Stripe now hold for one test account, and
 * whether that is consistent: one live subscription at most, paid access matching Stripe, the
 * plan's credits, one grant per subscription, nothing waiting in the review queue, no stuck
 * checkout. The operator compares that with the scenario's expected result.
 *
 * It never writes, anywhere. It reads:
 *   staging Firestore  users/{uid}, and the uid's billingAllocations, billingAmbiguousAccounts
 *                      and billingCheckoutOperations
 *   Stripe test mode   the account's customer, its subscriptions and its recent Checkout Sessions
 *
 * Refusals, before anything is contacted:
 *   - any project but the pinned staging project, with the staging rehearsal's own checks
 *     (billingRehearsal/guard.mjs), and again against the live SDK before the first read;
 *   - a STRIPE_SECRET_KEY that is not a test-mode key (stripeTestMode.mjs). Without a key it reads
 *     Firestore only. Any Stripe object with livemode: true stops it.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/staging-credential.json
 *   export PRODUCTION_FIREBASE_PROJECT_ID=<production id>
 *   read -rs STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY        # test-mode key, hidden prompt
 *   node scripts/staging/billingAccountSnapshot.mjs --email=<test account email>
 *   node scripts/staging/billingAccountSnapshot.mjs --uid=<uid> [--json]
 *
 * Exit 0 when every check passes, 2 when one fails, 1 when it could not run.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { readStagingCredential, withCredential, CredentialRefusal } from './stagingCredentials.mjs';
import { STAGING_PROJECT, CONFIRM_VARIABLE, RehearsalRefusal, resolveTarget, assertClientProject, readClientProject } from './billingRehearsal/guard.mjs';
import { stripeKeyMode } from './stripeTestMode.mjs';

const PLAN_CREDITS = Object.freeze({ starter: 400, pro: 1250 });
const DEAD = new Set(['canceled', 'incomplete_expired']);
const PAYING = new Set(['active', 'trialing', 'past_due']);

export class SnapshotRefusal extends Error {}

/** Throws unless every Stripe object read is a test-mode object. */
export function assertTestMode(objects) {
  for (const o of objects) {
    if (o && o.livemode === true) throw new SnapshotRefusal('Stripe returned a LIVE-mode object. Stopped: this tool reads test mode only.');
  }
}

/**
 * The account's state and its consistency checks. Pure.
 * @param {object} input { user, allocations, ambiguous, operations, stripe: { customer, subscriptions, sessions } | null }
 */
export function summarizeAccount({ user, allocations = [], ambiguous = [], operations = [], stripe = null }) {
  const paid = user?.hasCompletedPayment === true;
  const tier = paid ? (user?.subscriptionTier === 'pro' ? 'pro' : 'starter') : null;
  const plan = paid ? tier : 'free';
  const live = (stripe?.subscriptions ?? []).filter((s) => !DEAD.has(s.status));
  const paying = live.filter((s) => PAYING.has(s.status));
  const pendingReviews = ambiguous.filter((a) => a.status === 'pending');
  const credits = user?.credits;

  const checks = [];
  const add = (id, ok, message) => checks.push({ id, ok, message });

  if (stripe) {
    add('one-live-subscription', live.length <= 1,
      live.length <= 1 ? `${live.length} live subscription(s) in Stripe.` : `${live.length} live subscriptions in Stripe for one customer: a DUPLICATE.`);
    add('paid-access-matches-stripe', paid === (paying.length > 0),
      paid === (paying.length > 0)
        ? `Paid access ${paid ? 'on' : 'off'}, matching Stripe.`
        : `Paid access is ${paid ? 'on' : 'off'} but Stripe has ${paying.length} paying subscription(s).`);
    if (user?.stripeCustomerId && stripe.customer) {
      add('customer-bound', stripe.customer.id === user.stripeCustomerId, `Account customer ${user.stripeCustomerId}.`);
    }
  }
  if (paid) {
    const expected = PLAN_CREDITS[tier];
    const total = typeof credits === 'object' ? credits?.total : null;
    add('plan-credits', total === expected, total === expected ? `${tier}: ${expected} credits.` : `${tier} should grant ${expected} credits; the account shows ${total ?? 'none'}.`);
    const grant = allocations.find((a) => a.id === user?.stripeSubscriptionId);
    add('granted-once', Boolean(grant), grant ? `One grant for ${user.stripeSubscriptionId}.` : `No grant marker for ${user?.stripeSubscriptionId ?? 'the subscription'}.`);
  } else {
    add('free-has-no-paid-fields', !(credits && typeof credits === 'object' && credits.total > 0 && user?.subscriptionStatus === 'active'),
      'No paid access and no active subscription on the account.');
  }
  add('no-pending-review', pendingReviews.length === 0,
    pendingReviews.length === 0 ? 'Nothing waiting in billingAmbiguousAccounts.' : `${pendingReviews.length} pending review record(s): ${pendingReviews.map((a) => a.reason).join(', ')}.`);
  const claim = user?.pendingCheckout?.status ?? null;
  add('no-stuck-checkout', !['creating', 'needs_reconciliation', 'failed'].includes(claim),
    claim ? `Checkout claim: ${claim}.` : 'No checkout claim.');

  return {
    plan,
    account: {
      hasCompletedPayment: paid, subscriptionTier: user?.subscriptionTier ?? null, subscriptionStatus: user?.subscriptionStatus ?? null,
      cancelAtPeriodEnd: user?.cancelAtPeriodEnd ?? null, currentPeriodEnd: user?.currentPeriodEnd ?? null,
      stripeCustomerId: user?.stripeCustomerId ?? null, stripeSubscriptionId: user?.stripeSubscriptionId ?? null,
      credits: credits ?? null, pendingCheckout: claim,
    },
    // kind: 'checkout' for the first grant; 'plan_change' (W3) and 'renewal' (W4b) for the others.
    grants: allocations.map((a) => ({ subscription: a.id, kind: a.kind ?? 'checkout', priceId: a.priceId ?? null, credits: a.credits ?? null, grantedAt: a.grantedAt ?? null })),
    reviews: ambiguous.map((a) => ({ reason: a.reason, status: a.status })),
    operations: operations.length,
    stripe: stripe ? {
      subscriptions: (stripe.subscriptions ?? []).map((s) => ({ id: s.id, status: s.status, price: s.items?.data?.[0]?.price?.id ?? null, cancelAtPeriodEnd: s.cancel_at_period_end ?? null })),
      sessions: (stripe.sessions ?? []).map((s) => ({ id: s.id, status: s.status, paymentStatus: s.payment_status })),
    } : null,
    checks,
  };
}

export function parseArgs(argv) {
  const args = { uid: null, email: null, json: false };
  for (const a of argv) {
    if (a.startsWith('--uid=')) args.uid = a.slice(6);
    else if (a.startsWith('--email=')) args.email = a.slice(8);
    else if (a === '--json') args.json = true;
    else throw new SnapshotRefusal(`Unknown argument: ${a.split('=')[0]}`);
  }
  if (!args.uid === !args.email) throw new SnapshotRefusal('Pass exactly one of --uid=<uid> or --email=<email>.');
  return args;
}

/** The checks before anything is contacted. Returns the env the Admin SDK is loaded with. */
export function planSnapshot(shellEnv, credential) {
  const key = shellEnv.STRIPE_SECRET_KEY;
  if (key) {
    const mode = stripeKeyMode(key);
    if (mode === 'live') throw new SnapshotRefusal('STRIPE_SECRET_KEY is a LIVE key. This tool reads test mode only. Nothing was contacted.');
    if (mode !== 'test') throw new SnapshotRefusal('STRIPE_SECRET_KEY must be a test-mode key (sk_test_ or rk_test_). Nothing was contacted.');
  }
  if (shellEnv.FIRESTORE_EMULATOR_HOST) throw new SnapshotRefusal('FIRESTORE_EMULATOR_HOST is set. This tool reads the staging project.');
  const env = { ...withCredential({ FIREBASE_PROJECT_ID: STAGING_PROJECT }, credential), PRODUCTION_FIREBASE_PROJECT_ID: shellEnv.PRODUCTION_FIREBASE_PROJECT_ID };
  if (credential?.kind === 'short-lived') env.FIREBASE_ADMIN_CREDENTIALS = 'application-default';
  // The rehearsal's own project checks. It only ever reads, so the write confirmation those
  // checks also require is supplied for this evaluation only.
  const target = resolveTarget({ ...env, [CONFIRM_VARIABLE]: STAGING_PROJECT }, { credential });
  if (target.mode !== 'staging') throw new SnapshotRefusal('Did not resolve to the staging project.');
  return { env, target, stripeKey: key ?? null };
}

export async function readFirestore(db, uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const byUid = async (coll) => (await db.collection(coll).where('uid', '==', uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    user: userSnap.exists ? userSnap.data() : null,
    allocations: await byUid('billingAllocations'),
    ambiguous: await byUid('billingAmbiguousAccounts'),
    operations: await byUid('billingCheckoutOperations'),
  };
}

export async function readStripe(stripe, customerId) {
  if (!customerId) return { customer: null, subscriptions: [], sessions: [] };
  const customer = await stripe.customers.retrieve(customerId);
  const subscriptions = (await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })).data ?? [];
  const sessions = (await stripe.checkout.sessions.list({ customer: customerId, limit: 10 })).data ?? [];
  assertTestMode([customer, ...subscriptions, ...sessions]);
  return { customer, subscriptions, sessions };
}

function print(summary, { json }) {
  if (json) { console.log(JSON.stringify(summary, null, 2)); return; }
  console.log(`Plan: ${summary.plan}`);
  console.log(`Account: ${JSON.stringify(summary.account)}`);
  console.log(`Grants: ${summary.grants.length ? summary.grants.map((g) => `${g.kind} ${g.subscription}${g.credits != null ? ` (+${g.credits})` : ''}`).join(', ') : 'none'}`);
  if (summary.stripe) {
    console.log(`Stripe subscriptions: ${summary.stripe.subscriptions.map((s) => `${s.id} ${s.status}`).join(', ') || 'none'}`);
    console.log(`Stripe checkout sessions: ${summary.stripe.sessions.map((s) => `${s.id} ${s.status}/${s.paymentStatus}`).join(', ') || 'none'}`);
  } else {
    console.log('Stripe: not read (no STRIPE_SECRET_KEY in this shell).');
  }
  for (const c of summary.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(28)} ${c.message}`);
}

async function main() {
  let args;
  let plan;
  try {
    args = parseArgs(process.argv.slice(2));
    plan = planSnapshot(process.env, readStagingCredential(process.env));
  } catch (err) {
    if (err instanceof SnapshotRefusal || err instanceof RehearsalRefusal || err instanceof CredentialRefusal) {
      console.error(`Refused: ${err.message}`);
      return 1;
    }
    throw err;
  }
  for (const [name, value] of Object.entries(plan.env)) if (value !== undefined) process.env[name] = value;
  const { db, admin } = await import('../../netlify/functions/firebase-admin.js');
  const { getApp } = await import('firebase-admin/app');
  assertClientProject(plan.target, readClientProject(db, getApp()));

  const uid = args.uid ?? (await admin.auth().getUserByEmail(args.email)).uid;
  const firestore = await readFirestore(db, uid);
  let stripe = null;
  if (plan.stripeKey) {
    const { default: Stripe } = await import('stripe');
    stripe = await readStripe(new Stripe(plan.stripeKey), firestore.user?.stripeCustomerId ?? null);
  }
  const summary = summarizeAccount({ ...firestore, stripe });
  console.log(`Account ${uid} on ${STAGING_PROJECT}${plan.stripeKey ? ', Stripe test mode' : ''}. Read-only.`);
  print(summary, args);
  return summary.checks.every((c) => c.ok) ? 0 : 2;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`Failed: ${err?.name ?? 'error'}: ${err?.message ?? ''}`.trim());
    process.exitCode = 1;
  });
}
