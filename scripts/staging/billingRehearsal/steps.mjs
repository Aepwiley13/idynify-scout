/**
 * BILLING REHEARSAL — the steps. Each one drives the REAL webhook handler
 * (netlify/functions/stripe-webhook.js) or the REAL recovery transaction
 * (scripts/manualCreditRecovery.mjs: applyManualRecovery) and then reads Firestore to check
 * what was written. No billing logic lives here; this file only sets up inputs and compares
 * outcomes.
 *
 * A step returns a list of checks: [{ name, ok, detail }]. A step passes when every check is
 * ok. Steps run in order and later steps build on earlier ones (S9 recovers the account S1
 * flagged), so a run is only meaningful from S0 to the end, on a fresh run id.
 *
 * ctx: { db, handler, webhooks, store, ids, env, applyManualRecovery, errors, now }
 *   env      the process environment the handler reads (BILLING_LEDGER_EPOCH_UNIX is set here)
 *   errors   { AlreadyGrantedError, EvidenceValidationError } from manualCreditRecovery.mjs
 */
import { FIXTURE_PRICES, FIXTURE_WEBHOOK_SECRET } from './guard.mjs';
import { registerPurchase, checkoutCompletedEvent, subscriptionEvent, signedDelivery, tamperedDelivery } from './fixtures.mjs';
import { findRunDocs, deleteRunDocs } from './cleanup.mjs';

const EPOCH = 'BILLING_LEDGER_EPOCH_UNIX';
const STARTER = { total: 400, used: 0, remaining: 400 };
const PRO = { total: 1250, used: 0, remaining: 1250 };

/** JSON with object keys sorted: Firestore does not preserve the order a map was written in. */
export function canonical(value) {
  return JSON.stringify(value, (_key, v) => (
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  ));
}

function checker() {
  const checks = [];
  const same = (a, b) => canonical(a) === canonical(b);
  return {
    checks,
    ok(name, condition, detail = '') {
      checks.push({ name, ok: Boolean(condition), detail: condition ? '' : String(detail) });
    },
    eq(name, actual, expected) {
      const ok = same(actual, expected);
      checks.push({ name, ok, detail: ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` });
    },
  };
}

// ── Reading state ────────────────────────────────────────────────────────────────────────────

const userOf = async (ctx, slot) => (await ctx.db.collection('users').doc(ctx.ids.uid(slot)).get()).data();
const allocationOf = async (ctx, slot) => {
  const snap = await ctx.db.collection('billingAllocations').doc(ctx.ids.subscription(slot)).get();
  return snap.exists ? snap.data() : null;
};
const eventApplied = async (ctx, slot, label) =>
  (await ctx.db.collection('stripeWebhookEvents').doc(ctx.ids.event(slot, label)).get()).exists;
const flagsOf = async (ctx, slot) => {
  const snap = await ctx.db.collection('billingAmbiguousAccounts').where('uid', '==', ctx.ids.uid(slot)).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};
const parkedOf = async (ctx, slot) =>
  (await ctx.db.collection('stripeWebhookPendingEvents').doc(ctx.ids.customer(slot)).collection('events').get()).docs.map((d) => d.id);
const creditsOf = (user) => {
  const c = user?.credits;
  return c && typeof c === 'object' ? { total: c.total, used: c.used, remaining: c.remaining } : c ?? null;
};

// ── Driving the handler ──────────────────────────────────────────────────────────────────────

const deliver = (ctx, event) => ctx.handler(signedDelivery(ctx.webhooks, event, FIXTURE_WEBHOOK_SECRET));

async function seedUser(ctx, slot, extra = {}) {
  await ctx.db.collection('users').doc(ctx.ids.uid(slot)).set({
    email: `${slot}@rehearsal.invalid`, rehearsalRunId: ctx.ids.runId, createdAt: new Date().toISOString(),
    hasCompletedPayment: false, ...extra,
  });
}

const nowSeconds = (ctx) => Math.floor((ctx.now?.() ?? Date.now()) / 1000);

/** Makes a held account lock look older than the handler's 60-second stale window. */
async function ageLock(ctx, slot) {
  const ref = ctx.db.collection('users').doc(ctx.ids.uid(slot));
  const lock = (await ref.get()).data()?.billingLock;
  if (!lock) return false;
  await ref.set({ billingLock: { ...lock, acquiredAt: new Date(Date.now() - 61_000).toISOString() } }, { merge: true });
  return true;
}

// ── Steps ────────────────────────────────────────────────────────────────────────────────────

export const STEPS = [
  {
    id: 'S0',
    title: 'Clean start: this run id has no documents yet',
    async run(ctx) {
      const c = checker();
      const existing = await findRunDocs(ctx.db, ctx.ids.runId);
      c.eq('no documents exist for this run id', existing.map((d) => d.path), []);
      ctx.state = { original: { epoch: ctx.env[EPOCH] } };
      return c.checks;
    },
  },

  {
    id: 'S1',
    title: 'Epoch disabled: a paid checkout is flagged for review, nothing is granted',
    async run(ctx) {
      const c = checker();
      delete ctx.env[EPOCH];
      await seedUser(ctx, 'unset');
      registerPurchase(ctx.ids, 'unset', { created: nowSeconds(ctx) });

      const res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'unset'));
      c.eq('handler answers 200', res.statusCode, 200);

      const user = await userOf(ctx, 'unset');
      const flags = await flagsOf(ctx, 'unset');
      c.eq('exactly one review record', flags.length, 1);
      c.eq('reason is epoch_unset', flags[0]?.reason, 'epoch_unset');
      c.eq('record is pending', flags[0]?.status, 'pending');
      c.eq('no allocation marker', await allocationOf(ctx, 'unset'), null);
      c.ok('access not granted', user.hasCompletedPayment !== true, `hasCompletedPayment=${user.hasCompletedPayment}`);
      c.eq('no credits written', creditsOf(user), null);
      c.eq('subscription still bound to the account', user.stripeSubscriptionId, ctx.ids.subscription('unset'));
      c.ok('event recorded in the ledger', await eventApplied(ctx, 'unset', 'checkout'));
      c.eq('account lock released', user.billingLock ?? null, null);
      ctx.state.unsetFlagId = flags[0]?.id;
      return c.checks;
    },
  },

  {
    id: 'S2',
    title: 'Activation: with the epoch set, a new paid checkout is granted once, with a marker',
    async run(ctx) {
      const c = checker();
      const now = nowSeconds(ctx);
      ctx.state.epoch = now - 300;
      ctx.env[EPOCH] = String(ctx.state.epoch);

      for (const [slot, price, credits, tier] of [
        ['grant', FIXTURE_PRICES.STRIPE_PRICE_STARTER, STARTER, 'starter'],
        ['grantpro', FIXTURE_PRICES.STRIPE_PRICE_PRO, PRO, 'pro'],
      ]) {
        await seedUser(ctx, slot);
        registerPurchase(ctx.ids, slot, { created: now, price });
        const res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, slot));
        const user = await userOf(ctx, slot);
        const allocation = await allocationOf(ctx, slot);
        c.eq(`${tier}: handler answers 200`, res.statusCode, 200);
        c.eq(`${tier}: access granted`, user.hasCompletedPayment, true);
        c.eq(`${tier}: initial credits`, creditsOf(user), credits);
        c.eq(`${tier}: tier recorded`, user.subscriptionTier, tier);
        c.eq(`${tier}: allocation marker names the account and price`, { uid: allocation?.uid, priceId: allocation?.priceId }, { uid: ctx.ids.uid(slot), priceId: price });
        c.eq(`${tier}: nothing sent to review`, (await flagsOf(ctx, slot)).length, 0);
        c.ok(`${tier}: event recorded in the ledger`, await eventApplied(ctx, slot, 'checkout'));
        c.eq(`${tier}: account lock released`, user.billingLock ?? null, null);
      }
      return c.checks;
    },
  },

  {
    id: 'S3',
    title: 'Epoch boundary: a checkout created before the epoch is flagged, never granted',
    async run(ctx) {
      const c = checker();
      await seedUser(ctx, 'preepoch');
      registerPurchase(ctx.ids, 'preepoch', { created: ctx.state.epoch - 3600 });
      const res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'preepoch'));
      const user = await userOf(ctx, 'preepoch');
      const flags = await flagsOf(ctx, 'preepoch');
      c.eq('handler answers 200', res.statusCode, 200);
      c.eq('one review record, pre_epoch_no_marker, pending', flags.map((f) => [f.reason, f.status]), [['pre_epoch_no_marker', 'pending']]);
      c.eq('no allocation marker', await allocationOf(ctx, 'preepoch'), null);
      c.ok('access not granted', user.hasCompletedPayment !== true);
      c.eq('no credits written', creditsOf(user), null);
      return c.checks;
    },
  },

  {
    id: 'S4',
    title: 'Idempotency: replayed and repeated events never grant twice or reset usage',
    async run(ctx) {
      const c = checker();
      // Spend some credits first, so a second grant would be visible as a reset to 400/0.
      await ctx.db.collection('users').doc(ctx.ids.uid('grant')).update({ 'credits.used': 7, 'credits.remaining': 393 });
      const before = { user: await userOf(ctx, 'grant'), allocation: await allocationOf(ctx, 'grant') };
      const spent = { total: 400, used: 7, remaining: 393 };

      const unchanged = async (label) => {
        const user = await userOf(ctx, 'grant');
        const allocation = await allocationOf(ctx, 'grant');
        c.eq(`${label}: credits and usage unchanged`, creditsOf(user), spent);
        c.eq(`${label}: original grant time unchanged`, user.paymentCompletedAt, before.user.paymentCompletedAt);
        c.eq(`${label}: allocation marker unchanged`, allocation, before.allocation);
        c.eq(`${label}: nothing sent to review`, (await flagsOf(ctx, 'grant')).length, 0);
      };

      let res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'grant'));
      c.eq('same event redelivered: 200', res.statusCode, 200);
      await unchanged('same event redelivered');

      res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'grant', 'checkout2'));
      c.eq('new event, same checkout: 200', res.statusCode, 200);
      await unchanged('new event, same checkout');

      const updated = subscriptionEvent(ctx.ids, 'grant', 'customer.subscription.updated', 'subupdated');
      res = await deliver(ctx, updated);
      c.eq('subscription.updated: 200', res.statusCode, 200);
      await unchanged('subscription.updated');
      res = await deliver(ctx, updated);
      c.eq('subscription.updated redelivered: 200', res.statusCode, 200);
      await unchanged('subscription.updated redelivered');

      // Order independence: subscription.created arrives BEFORE the checkout. With no account
      // bound to the customer yet it is parked, then drained when the checkout lands.
      await seedUser(ctx, 'order');
      registerPurchase(ctx.ids, 'order', { created: nowSeconds(ctx) });
      const created = subscriptionEvent(ctx.ids, 'order', 'customer.subscription.created', 'subcreated');
      res = await deliver(ctx, created);
      c.eq('early subscription.created: 200', res.statusCode, 200);
      c.eq('early subscription.created is parked', await parkedOf(ctx, 'order'), [ctx.ids.event('order', 'subcreated')]);
      c.ok('early subscription.created grants nothing', (await userOf(ctx, 'order')).hasCompletedPayment !== true);

      res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'order'));
      c.eq('checkout after it: 200', res.statusCode, 200);
      c.eq('granted exactly once', creditsOf(await userOf(ctx, 'order')), STARTER);
      c.ok('allocation marker written', (await allocationOf(ctx, 'order')) !== null);
      c.eq('parked event drained', await parkedOf(ctx, 'order'), []);
      c.ok('drained event recorded in the ledger', await eventApplied(ctx, 'order', 'subcreated'));

      const orderBefore = await userOf(ctx, 'order');
      res = await deliver(ctx, created);
      c.eq('subscription.created redelivered: 200', res.statusCode, 200);
      const orderAfter = await userOf(ctx, 'order');
      c.eq('redelivery changes nothing', [creditsOf(orderAfter), orderAfter.paymentCompletedAt], [STARTER, orderBefore.paymentCompletedAt]);
      return c.checks;
    },
  },

  {
    id: 'S5',
    title: 'Rollback replay: an account the old handler already granted is not granted again',
    async run(ctx) {
      const c = checker();
      const now = nowSeconds(ctx);
      const oldCredits = { total: 400, used: 25, remaining: 375, resetDate: '2026-12-12T00:00:00.000Z' };
      // What the pre-ledger handler leaves behind: access and credits, and NO allocation marker.
      await seedUser(ctx, 'rollback', {
        stripeCustomerId: ctx.ids.customer('rollback'), stripeSubscriptionId: ctx.ids.subscription('rollback'),
        hasCompletedPayment: true, subscriptionTier: 'starter', credits: oldCredits,
      });
      registerPurchase(ctx.ids, 'rollback', { created: now });

      const res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'rollback'));
      const user = await userOf(ctx, 'rollback');
      const flags = await flagsOf(ctx, 'rollback');
      c.eq('handler answers 200', res.statusCode, 200);
      c.eq('credits and usage untouched', user.credits, oldCredits);
      c.eq('access unchanged', user.hasCompletedPayment, true);
      c.eq('no allocation marker written', await allocationOf(ctx, 'rollback'), null);
      c.eq('flagged for review', flags.map((f) => [f.reason, f.status]), [['already_shows_completed_payment_no_marker', 'pending']]);
      return c.checks;
    },
  },

  {
    id: 'S6',
    title: 'Signature: an altered or wrongly signed delivery is rejected and writes nothing',
    async run(ctx) {
      const c = checker();
      await seedUser(ctx, 'badsig');
      registerPurchase(ctx.ids, 'badsig', { created: nowSeconds(ctx) });
      const event = checkoutCompletedEvent(ctx.ids, 'badsig');
      const before = await userOf(ctx, 'badsig');

      const attempts = {
        'body altered after signing': tamperedDelivery(ctx.webhooks, event, FIXTURE_WEBHOOK_SECRET),
        'signed with a different secret': signedDelivery(ctx.webhooks, event, 'whsec_some_other_secret'),
        'no signature header': { httpMethod: 'POST', headers: {}, body: JSON.stringify(event) },
      };
      for (const [name, delivery] of Object.entries(attempts)) {
        const res = await ctx.handler(delivery);
        c.eq(`${name}: 400`, res.statusCode, 400);
      }
      c.eq('account untouched', await userOf(ctx, 'badsig'), before);
      c.ok('event not recorded', !(await eventApplied(ctx, 'badsig', 'checkout')));
      c.eq('no allocation marker', await allocationOf(ctx, 'badsig'), null);
      c.eq('nothing sent to review', (await flagsOf(ctx, 'badsig')).length, 0);
      return c.checks;
    },
  },

  {
    id: 'S7',
    title: 'Failure and recovery: a failed delivery is retryable, writes no grant, and applies once on redelivery',
    async run(ctx) {
      const c = checker();
      const nothingGranted = async (slot, label) => {
        const user = await userOf(ctx, slot);
        c.ok(`${label}: event not recorded as applied`, !(await eventApplied(ctx, slot, 'checkout')));
        c.eq(`${label}: no allocation marker`, await allocationOf(ctx, slot), null);
        c.ok(`${label}: access not granted`, user.hasCompletedPayment !== true);
        c.eq(`${label}: no credits written`, creditsOf(user), null);
      };
      const grantedOnce = async (slot, label) => {
        const user = await userOf(ctx, slot);
        c.eq(`${label}: credits granted once`, creditsOf(user), STARTER);
        c.ok(`${label}: allocation marker written`, (await allocationOf(ctx, slot)) !== null);
        c.ok(`${label}: event recorded as applied`, await eventApplied(ctx, slot, 'checkout'));
        c.eq(`${label}: account lock released`, user.billingLock ?? null, null);
        c.eq(`${label}: nothing sent to review`, (await flagsOf(ctx, slot)).length, 0);
      };

      // (a) Stripe cannot be reached while the handler holds the account lock.
      await seedUser(ctx, 'failure');
      registerPurchase(ctx.ids, 'failure', { created: nowSeconds(ctx) });
      const failing = checkoutCompletedEvent(ctx.ids, 'failure');
      ctx.store.failNext.set('subscriptions.retrieve', 1);
      let res = await deliver(ctx, failing);
      c.eq('Stripe outage: 500, so Stripe will redeliver', res.statusCode, 500);
      await nothingGranted('failure', 'Stripe outage');

      // The failed attempt leaves its lock in place. An immediate redelivery is refused, not
      // applied half-way; the lock expires on its own after 60 seconds.
      res = await deliver(ctx, failing);
      c.eq('immediate redelivery while the lock is fresh: 500', res.statusCode, 500);
      await nothingGranted('failure', 'immediate redelivery');

      c.ok('a lock was left to age out', await ageLock(ctx, 'failure'));
      res = await deliver(ctx, failing);
      c.eq('redelivery after the lock has aged out: 200', res.statusCode, 200);
      await grantedOnce('failure', 'after Stripe outage');
      res = await deliver(ctx, failing);
      c.eq('one more redelivery: 200', res.statusCode, 200);
      await grantedOnce('failure', 'one more redelivery');

      // (b) The lock is taken by another worker between this worker's Stripe read and its commit.
      await seedUser(ctx, 'lockloss');
      registerPurchase(ctx.ids, 'lockloss', { created: nowSeconds(ctx) });
      const contested = checkoutCompletedEvent(ctx.ids, 'lockloss');
      ctx.store.hooks['subscriptions.retrieve'] = async () => {
        await ctx.db.collection('users').doc(ctx.ids.uid('lockloss')).set(
          { billingLock: { operationId: 'rehearsal-other-worker', acquiredAt: new Date().toISOString() } }, { merge: true },
        );
      };
      res = await deliver(ctx, contested);
      c.eq('lock lost before commit: 500', res.statusCode, 500);
      await nothingGranted('lockloss', 'lock lost');

      await ageLock(ctx, 'lockloss');
      res = await deliver(ctx, contested);
      c.eq('redelivery once the other worker is gone: 200', res.statusCode, 200);
      await grantedOnce('lockloss', 'after lock loss');
      return c.checks;
    },
  },

  {
    id: 'S8',
    title: 'Identity mismatch: conflicting account ids are queued for review and neither account changes',
    async run(ctx) {
      const c = checker();
      await seedUser(ctx, 'ida');
      await seedUser(ctx, 'idb');
      const before = { ida: await userOf(ctx, 'ida'), idb: await userOf(ctx, 'idb') };
      // client_reference_id says one account, session metadata says another.
      registerPurchase(ctx.ids, 'ida', { created: nowSeconds(ctx), sessionMetadata: { firebaseUID: ctx.ids.uid('idb') } });

      const res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'ida'));
      c.eq('handler answers 200', res.statusCode, 200);
      // The record is filed under the first identity the handler read: session metadata.
      const flags = await flagsOf(ctx, 'idb');
      c.eq('one review record, identity_mismatch, pending', flags.map((f) => [f.reason, f.status]), [['identity_mismatch', 'pending']]);
      c.eq('record lists both ids', flags[0]?.details?.candidates, [ctx.ids.uid('idb'), ctx.ids.uid('ida')]);
      c.eq('nothing filed under the other account', (await flagsOf(ctx, 'ida')).length, 0);
      c.eq('first account untouched', await userOf(ctx, 'ida'), before.ida);
      c.eq('second account untouched', await userOf(ctx, 'idb'), before.idb);
      c.eq('no allocation marker', await allocationOf(ctx, 'ida'), null);
      c.ok('event recorded in the ledger', await eventApplied(ctx, 'ida', 'checkout'));
      return c.checks;
    },
  },

  {
    id: 'S9',
    title: 'Manual recovery: refuses weak evidence, dry run writes nothing, grants once, resolves the review record',
    async run(ctx) {
      const c = checker();
      const { AlreadyGrantedError, EvidenceValidationError } = ctx.errors;
      // The recovery tool is handed the same fixture Stripe client the handler used.
      const stripe = ctx.newStripeClient();
      const args = {
        uid: ctx.ids.uid('unset'), subscriptionId: ctx.ids.subscription('unset'), priceId: FIXTURE_PRICES.STRIPE_PRICE_STARTER,
        evidenceStripeSessionId: ctx.ids.session('unset'), evidenceNote: 'Billing rehearsal: account flagged epoch_unset in S1.',
        ambiguousAccountDocId: ctx.state.unsetFlagId, operator: 'billing-rehearsal',
      };
      const state = async () => ({
        credits: creditsOf(await userOf(ctx, 'unset')),
        access: (await userOf(ctx, 'unset')).hasCompletedPayment,
        allocation: await allocationOf(ctx, 'unset'),
        flag: (await flagsOf(ctx, 'unset')).map((f) => f.status),
      });
      const untouched = { credits: null, access: false, allocation: null, flag: ['pending'] };
      const outcome = async (run) => {
        try {
          return { result: await run() };
        } catch (error) {
          return { error };
        }
      };

      // A Payment Link customer carries no metadata.firebaseUID. The tool must refuse.
      let out = await outcome(() => ctx.applyManualRecovery(ctx.db, stripe, args));
      c.ok('refused without positive proof of ownership', out.error instanceof EvidenceValidationError, out.error?.message ?? 'no error thrown');
      c.eq('refusal wrote nothing', await state(), untouched);

      // The operator records ownership on the Stripe customer (here: on the fixture).
      ctx.store.customers.get(ctx.ids.customer('unset')).metadata.firebaseUID = ctx.ids.uid('unset');

      out = await outcome(() => ctx.applyManualRecovery(ctx.db, stripe, { ...args, dryRun: true }));
      c.eq('dry run reports it would apply', [out.result?.dryRun, out.result?.applied], [true, false]);
      c.eq('dry run wrote nothing', await state(), untouched);

      out = await outcome(() => ctx.applyManualRecovery(ctx.db, stripe, args));
      c.eq('recovery applied', out.result?.applied, true);
      const after = await state();
      c.eq('credits granted', after.credits, STARTER);
      c.eq('access granted', after.access, true);
      c.eq('marker records a manual recovery for this account', [after.allocation?.uid, after.allocation?.recoveredManually], [args.uid, true]);
      c.eq('review record resolved', after.flag, ['resolved']);

      out = await outcome(() => ctx.applyManualRecovery(ctx.db, stripe, args));
      // Either refusal is correct. In practice the tool's pre-check sees the account already
      // shows a completed payment and refuses there (EvidenceValidationError), before its
      // transaction would refuse on the marker (AlreadyGrantedError).
      c.ok(
        'second run refused',
        out.error instanceof AlreadyGrantedError || out.error instanceof EvidenceValidationError,
        out.error?.message ?? 'no error thrown',
      );
      ctx.state.secondRecoveryRefusal = out.error?.constructor?.name ?? null;
      c.eq('second run changed nothing', await state(), after);

      // The original Stripe event is resent after the manual grant, with the epoch active.
      const res = await deliver(ctx, checkoutCompletedEvent(ctx.ids, 'unset', 'checkout2'));
      c.eq('original checkout resent: 200', res.statusCode, 200);
      c.eq('resend after manual grant changes nothing', await state(), after);
      return c.checks;
    },
  },

  {
    id: 'S10',
    title: 'Clean-up: every document this run created is removed, and nothing else',
    async run(ctx) {
      const c = checker();
      if (ctx.state?.original) {
        if (ctx.state.original.epoch === undefined) delete ctx.env[EPOCH];
        else ctx.env[EPOCH] = ctx.state.original.epoch;
      }
      const planned = await deleteRunDocs(ctx.db, ctx.ids.runId, { dryRun: true });
      c.ok('the run left documents to remove', planned.wouldDelete.length > 0);
      if (ctx.keepData) {
        c.ok('data kept on request (clean up later with --cleanup-only)', true);
        ctx.state.cleanup = { kept: planned.wouldDelete };
        return c.checks;
      }
      const done = await deleteRunDocs(ctx.db, ctx.ids.runId);
      c.eq('deleted exactly what the dry run listed', done.deleted, planned.wouldDelete);
      c.eq('no documents remain for this run', done.remaining, 0);
      ctx.state.cleanup = { deleted: done.deleted };
      return c.checks;
    },
  },
];

export const STEP_IDS = STEPS.map((s) => s.id);

/**
 * Runs steps one at a time and FAILS FAST. Steps build on each other, so after the first
 * failure nothing else is run: every later step, clean-up included, is reported as skipped
 * and the run's documents stay in place as evidence.
 *
 * A step fails if any check is not ok, if it returns no checks, or if it throws (the error is
 * recorded as a failed check instead of being lost).
 *
 * run(step, ctx) -> { skipped: true } | { skipped: false, pass, checks, failed }
 */
export function createStepRunner() {
  const results = [];
  let halted = null;
  return {
    results,
    /** The id of the first failed step, or null. */
    get halted() {
      return halted;
    },
    async run(step, ctx) {
      if (halted) return { skipped: true };
      let checks;
      try {
        checks = await step.run(ctx);
      } catch (err) {
        checks = [{ name: 'step ran to completion', ok: false, detail: `${err?.name ?? 'Error'}: ${err?.message ?? err}` }];
      }
      if (!Array.isArray(checks) || checks.length === 0) {
        checks = [{ name: 'step produced at least one check', ok: false, detail: 'the step returned no checks' }];
      }
      const failed = checks.filter((check) => !check.ok);
      const pass = failed.length === 0;
      results.push({ id: step.id, title: step.title, pass, checks });
      if (!pass) halted = step.id;
      return { skipped: false, pass, checks, failed };
    },
  };
}

