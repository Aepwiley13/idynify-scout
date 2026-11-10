/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * Round-9 code review finding 5: decideAllocationEligibility permitted a different incoming
 * subscription whenever the on-file one simply wasn't "blocking" (e.g. canceled) — a weaker bar
 * than decideReconciliation's own replacement-authorization check (verified-newer + operation-
 * record provenance) for the SAME incoming subscription, computed independently in the same
 * transaction. That let allocation grant credits and set hasCompletedPayment: true in the exact
 * same commit where reconciliation rejected the identical subscription as an unauthorized
 * replacement. Fixed by having both consult the one shared replacement-authorization verdict.
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
  'stripe-webhook: allocation requires the same authorized replacement reconciliation does (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
  });

  it('an unauthorized older subscription replay against a canceled on-file subscription grants nothing and writes no allocation marker', async () => {
    await db.collection('users').doc('uid_alloc_replay').set({
      email: 'ar@example.test', stripeCustomerId: 'cus_replay', stripeSubscriptionId: 'sub_onfile_replay',
      hasCompletedPayment: true, subscriptionStatus: 'active',
    });

    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }),
      subscriptionsRetrieve: async (id) => {
        if (id === 'sub_onfile_replay') {
          return { id: 'sub_onfile_replay', customer: 'cus_replay', status: 'canceled', created: 3000000000 };
        }
        // The replayed/incoming subscription: OLDER than on-file, and carries no checkoutOperationId
        // at all (legacy — no provenance possible) — unauthorized on every axis.
        return {
          id: 'sub_incoming_replay', customer: 'cus_replay', status: 'active', created: 1000000000,
          current_period_start: 1000000000, current_period_end: 1003000000, cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
        };
      },
      listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
    };

    const event = {
      id: 'evt_alloc_replay', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_replay', customer: 'cus_replay', subscription: 'sub_incoming_replay', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid_alloc_replay', metadata: {},
        },
      },
    };

    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const doc = await db.collection('users').doc('uid_alloc_replay').get();
    // Neither allocation nor reconciliation acted on the unauthorized incoming subscription.
    expect(doc.data().stripeSubscriptionId).toBe('sub_onfile_replay'); // not switched
    expect(doc.data().credits).toBeUndefined(); // NOT granted — this is the bug this test catches

    const allocation = await db.collection('billingAllocations').doc('sub_incoming_replay').get();
    expect(allocation.exists).toBe(false); // no marker written for an unauthorized purchase

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    const flagged = ambiguous.docs.find((d) => d.data().reason === 'replacement_not_authorized');
    expect(flagged).toBeTruthy();
    // status: 'pending' is what makes this collection an actual reviewable queue — without it,
    // there'd be no way to tell "still needs a human" from "already handled" other than tracking
    // it externally. Only scripts/manualCreditRecovery.mjs ever moves a record to 'resolved'.
    expect(flagged.data().status).toBe('pending');
  });

  it('a fully authorized replacement (verified newer, provenance matches) DOES grant — allocation and reconciliation agree', async () => {
    await db.collection('users').doc('uid_alloc_ok').set({
      email: 'ok@example.test', stripeCustomerId: 'cus_ok', stripeSubscriptionId: 'sub_onfile_ok',
      hasCompletedPayment: true,
    });
    await db.collection('billingCheckoutOperations').doc('op_ok').set({
      uid: 'uid_alloc_ok', customerId: 'cus_ok', priceId: 'price_starter', createdAt: new Date().toISOString(),
    });

    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_alloc_ok' } }),
      subscriptionsRetrieve: async (id) => {
        if (id === 'sub_onfile_ok') {
          return { id: 'sub_onfile_ok', customer: 'cus_ok', status: 'canceled', created: 1000000000 };
        }
        return {
          id: 'sub_incoming_ok', customer: 'cus_ok', status: 'active', created: 3000000000,
          current_period_start: 3000000000, current_period_end: 3003000000, cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { checkoutOperationId: 'op_ok' },
        };
      },
      listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
    };

    const event = {
      id: 'evt_alloc_ok', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_ok', customer: 'cus_ok', subscription: 'sub_incoming_ok', payment_status: 'paid',
          created: 3000000000, metadata: { firebaseUID: 'uid_alloc_ok', checkoutOperationId: 'op_ok' },
        },
      },
    };

    await handler(fakeHttpEvent(event));
    const doc = await db.collection('users').doc('uid_alloc_ok').get();
    expect(doc.data().stripeSubscriptionId).toBe('sub_incoming_ok'); // switched
    expect(doc.data().credits.remaining).toBe(400); // granted
    const allocation = await db.collection('billingAllocations').doc('sub_incoming_ok').get();
    expect(allocation.exists).toBe(true);
  });
  },
);
