/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * BILLING_LEDGER_EPOCH_UNIX only protects against purchases that predate it. It does nothing for
 * a purchase created AFTER the epoch whose webhook delivery was actually handled by unhardened
 * or rolled-back code during an incident — that code can grant credits directly, with no
 * billingAllocations marker at all, exactly like the pre-ledger implementation this PR replaces.
 * If hardened code then RESUMES with the SAME (stale, not re-armed) epoch and the event is
 * replayed — Stripe's own retry, or a manual resend — nothing previously stopped it from
 * granting a second time: the epoch check passes, there is no marker, and the account's existing
 * state otherwise looks like an eligible first-ever grant.
 *
 * Correction: these are narrow, specific CONSISTENCY GUARDS inside decideAllocationEligibility
 * (netlify/functions/stripe-webhook.js) — not a "runtime allocation gate" in the sense of
 * controlling whether automatic allocation is active at all. That question is still answered
 * only by BILLING_LEDGER_EPOCH_UNIX read directly from process.env; see
 * docs/BILLING_CUTOVER_RUNBOOK.md for the deployment procedure that actually governs it.
 *
 *   1. already_shows_completed_payment_no_marker — the account still shows a completed grant for
 *      THIS SAME subscription, no marker. Covered by the first test below.
 *   2. subscription_dead_no_marker — checks the subscription's OWN current status (fetched
 *      fresh from Stripe), not a locally-resettable account flag. This exists because (1) is
 *      trivially defeated by the very next legitimate lifecycle event: if the subscription is
 *      later, correctly, canceled, hardened reconciliation clears hasCompletedPayment
 *      (buildNormalizedFields) — so (1) no longer fires — and a stale/replayed
 *      checkout.session.completed for the ORIGINAL purchase would then sail through with nothing
 *      to stop it. Covered by the second test below: old-code grant → cancellation (through the
 *      real handler) clears the flag → the original checkout event replays with still no marker
 *      → must not grant again, and must not disturb the already-correct canceled/revoked state.
 *
 * Both are scoped to the SAME subscriptionId only, so neither interferes with: a genuine
 * replacement by a different, new subscription (third test below, and
 * stripeWebhookAllocationRequiresAuthorizedReplacement.test.js), or the legitimate
 * order-independence case where subscription.created binds stripeSubscriptionId first and
 * checkout.session.completed grants second for a freshly-active subscription that was never
 * previously granted (stripeWebhookAllocationOrderIndependence.test.js — unaffected by either
 * guard, since neither hasCompletedPayment nor a dead status is ever true for a fresh signup).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = { retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a) };
    checkout = { sessions: { listLineItems: (...a) => scenario.handlers.listLineItems(...a) } };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: rollback-window replay consistency guards (narrow, not a cutover/activation gate — run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
  });

  it('old/unhardened code already granted this exact subscription during a rollback window; replaying the event after hardened code resumes (same, stale epoch, no re-arm) does not grant again', async () => {
    // Simulates exactly what pre-ledger code used to do: write hasCompletedPayment + credits +
    // stripeSubscriptionId directly, with no billingAllocations marker, because that marker
    // didn't exist in the code that was live during the rollback.
    await db.collection('users').doc('uid_rollback_replay').set({
      email: 'rb@example.test',
      stripeCustomerId: 'cus_rollback_replay',
      stripeSubscriptionId: 'sub_rollback_replay',
      hasCompletedPayment: true,
      subscriptionTier: 'starter',
      credits: { total: 400, used: 0, remaining: 400, resetDate: '2026-12-01T00:00:00.000Z' },
    });

    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_rollback_replay' } }),
      subscriptionsRetrieve: async (id) => ({
        id, customer: 'cus_rollback_replay', status: 'active',
        // Created well AFTER the default test epoch (1000000000, from billingTestUtils.js) —
        // this purchase is squarely "post-epoch" by the only check that previously existed.
        created: 2000000000,
        current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
      }),
      listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
    };

    // Hardened code resumes with its PREVIOUS epoch (the default test env, unchanged — no
    // re-arm happened) and the same event is replayed/redelivered.
    const event = {
      id: 'evt_rollback_replay', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_rollback_replay', customer: 'cus_rollback_replay', subscription: 'sub_rollback_replay',
          payment_status: 'paid', created: 2000000000,
          client_reference_id: 'uid_rollback_replay', metadata: {},
        },
      },
    };

    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const doc = await db.collection('users').doc('uid_rollback_replay').get();
    // Exactly what old code wrote, untouched — not re-granted, not doubled, not reset.
    expect(doc.data().credits).toEqual({ total: 400, used: 0, remaining: 400, resetDate: '2026-12-01T00:00:00.000Z' });
    expect(doc.data().hasCompletedPayment).toBe(true);

    const allocation = await db.collection('billingAllocations').doc('sub_rollback_replay').get();
    expect(allocation.exists).toBe(false); // this replay still writes no marker — it was refused, not granted

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    const flagged = ambiguous.docs.find((d) => d.data().reason === 'already_shows_completed_payment_no_marker');
    expect(flagged).toBeTruthy();
    expect(flagged.data().status).toBe('pending');
    expect(flagged.data().uid).toBe('uid_rollback_replay');
  });

  it('old-code grant, then a legitimate cancellation clears hasCompletedPayment, then the ORIGINAL checkout event replays with still no marker: must not grant again, must preserve the already-correct revoked state', async () => {
    // Step 1: old/unhardened code already granted this purchase directly — same shape as the
    // first test above, no billingAllocations marker.
    await db.collection('users').doc('uid_cancel_replay').set({
      email: 'cr@example.test',
      stripeCustomerId: 'cus_cancel_replay',
      stripeSubscriptionId: 'sub_cancel_replay',
      hasCompletedPayment: true,
      subscriptionStatus: 'active',
      credits: { total: 400, used: 0, remaining: 400, resetDate: '2026-12-01T00:00:00.000Z' },
    });

    // The subscription is now canceled in Stripe — and stays canceled for every subsequent
    // query, including the later replay below, since that is simply its current, real state.
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_cancel_replay' } }),
      subscriptionsRetrieve: async () => ({
        id: 'sub_cancel_replay', customer: 'cus_cancel_replay', status: 'canceled', created: 2000000000,
        current_period_start: null, current_period_end: null, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_cancel_replay' },
      }),
      listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
    };

    // Step 2: hardened code is live and correctly processes the REAL cancellation — through the
    // actual handler, not faked — which clears hasCompletedPayment (this is exactly what defeats
    // guard #1 on its own; see file header).
    const cancelEvent = {
      id: 'evt_cancel_replay_deleted', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_cancel_replay', customer: 'cus_cancel_replay', status: 'canceled', created: 2000000000, metadata: { firebaseUID: 'uid_cancel_replay' } } },
    };
    const cancelResult = await handler(fakeHttpEvent(cancelEvent));
    expect(cancelResult.statusCode).toBe(200);

    const afterCancel = await db.collection('users').doc('uid_cancel_replay').get();
    expect(afterCancel.data().hasCompletedPayment).toBe(false); // correctly revoked
    expect(afterCancel.data().credits).toEqual({ total: 400, used: 0, remaining: 400, resetDate: '2026-12-01T00:00:00.000Z' }); // untouched by cancellation itself

    // Step 3: the ORIGINAL checkout.session.completed for this same purchase finally replays —
    // late redelivery, or a manual resend — arriving AFTER the cancellation. Still no marker.
    const replayEvent = {
      id: 'evt_cancel_replay_checkout', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_cancel_replay', customer: 'cus_cancel_replay', subscription: 'sub_cancel_replay',
          payment_status: 'paid', created: 2000000000,
          client_reference_id: 'uid_cancel_replay', metadata: {},
        },
      },
    };
    const replayResult = await handler(fakeHttpEvent(replayEvent));
    expect(replayResult.statusCode).toBe(200);

    const final = await db.collection('users').doc('uid_cancel_replay').get();
    // The already-correct revoked state is completely preserved — not re-granted, not reset.
    expect(final.data().hasCompletedPayment).toBe(false);
    expect(final.data().credits).toEqual({ total: 400, used: 0, remaining: 400, resetDate: '2026-12-01T00:00:00.000Z' });

    const allocation = await db.collection('billingAllocations').doc('sub_cancel_replay').get();
    expect(allocation.exists).toBe(false); // refused, not granted — still no marker

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    const flagged = ambiguous.docs.find((d) => d.data().reason === 'subscription_dead_no_marker');
    expect(flagged).toBeTruthy();
    expect(flagged.data().status).toBe('pending');
    expect(flagged.data().uid).toBe('uid_cancel_replay');
  });

  it('does not interfere with a genuinely NEW subscription for an account that already has hasCompletedPayment true under a DIFFERENT, dead subscription', async () => {
    // Same starting shape as the rollback case (hasCompletedPayment already true) — but this
    // time the incoming subscriptionId is NOT the one already on file, so this is the ordinary,
    // separately-authorized replacement path, not the rollback-replay gate.
    await db.collection('users').doc('uid_rollback_contrast').set({
      email: 'rbc@example.test', stripeCustomerId: 'cus_rollback_contrast', stripeSubscriptionId: 'sub_dead_onfile',
      hasCompletedPayment: true, credits: { total: 400, used: 50, remaining: 350, resetDate: '2026-12-01T00:00:00.000Z' },
    });
    await db.collection('billingCheckoutOperations').doc('op_rollback_contrast').set({
      uid: 'uid_rollback_contrast', customerId: 'cus_rollback_contrast', priceId: 'price_pro', createdAt: new Date().toISOString(),
    });

    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_rollback_contrast' } }),
      subscriptionsRetrieve: async (id) => {
        if (id === 'sub_dead_onfile') {
          return { id: 'sub_dead_onfile', customer: 'cus_rollback_contrast', status: 'canceled', created: 1000000000 };
        }
        return {
          id: 'sub_new_legit', customer: 'cus_rollback_contrast', status: 'active', created: 3000000000,
          current_period_start: 3000000000, current_period_end: 3003000000, cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_pro' } }] }, metadata: { checkoutOperationId: 'op_rollback_contrast' },
        };
      },
      listLineItems: async () => ({ data: [{ price: { id: 'price_pro' } }] }),
    };

    const event = {
      id: 'evt_rollback_contrast', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_rollback_contrast', customer: 'cus_rollback_contrast', subscription: 'sub_new_legit', payment_status: 'paid',
          created: 3000000000, metadata: { firebaseUID: 'uid_rollback_contrast', checkoutOperationId: 'op_rollback_contrast' },
        },
      },
    };

    await handler(fakeHttpEvent(event));
    const doc = await db.collection('users').doc('uid_rollback_contrast').get();
    expect(doc.data().stripeSubscriptionId).toBe('sub_new_legit'); // switched — the new-gate check never fires for a different subscriptionId
    expect(doc.data().credits.total).toBe(1250); // pro tier granted
    const allocation = await db.collection('billingAllocations').doc('sub_new_legit').get();
    expect(allocation.exists).toBe(true);
  });
  },
);
