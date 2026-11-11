/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * Round-11 review finding: BILLING_LEDGER_EPOCH_UNIX only protects against purchases that
 * predate it. It does nothing for a purchase created AFTER the epoch whose webhook delivery was
 * actually handled by unhardened or rolled-back code during an incident — that code can grant
 * credits directly, with no billingAllocations marker at all, exactly like the pre-ledger
 * implementation this PR replaces. If hardened code then RESUMES with the SAME (stale, not
 * re-armed) epoch and the event is replayed — Stripe's own retry, or a manual resend — nothing
 * previously stopped it from granting a second time: the epoch check passes (the session predates
 * neither epoch), there is no marker to trip the idempotency guard, and the account's existing
 * state otherwise looks like an eligible first-ever grant.
 *
 * This is an ENFORCEABLE RUNTIME GATE, not an external advisory script: decideAllocationEligibility
 * (netlify/functions/stripe-webhook.js) now refuses whenever the account already shows a
 * completed grant for THIS SAME subscription with no marker — automatically, on every invocation,
 * with no operator action required first. It is scoped to the same subscriptionId specifically so
 * a genuine, separately-authorized replacement (a NEW subscription replacing an old dead one,
 * covered by stripeWebhookAllocationRequiresAuthorizedReplacement.test.js) is unaffected.
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
  'stripe-webhook: a rollback-window purchase replayed after hardened code resumes with its previous epoch must not grant again (run via: npm run test:billing-emulator)',
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
