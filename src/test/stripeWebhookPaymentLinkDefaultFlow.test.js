/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. End-to-end fixture for the live, DEFAULT checkout path (round 7's biggest
 * finding): a Payment-Link-shaped checkout.session.completed — only client_reference_id, no
 * checkoutOperationId, a fresh Stripe-created customer — must still be granted credits normally.
 * Requiring the new flow's operation-record provenance for every grant would flag every ordinary
 * Payment Link purchase, which is the live default until VITE_STRIPE_CHECKOUT_MODE is
 * deliberately flipped.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = {
      retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a),
      list: async () => ({ data: [], has_more: false }),
    };
    checkout = { sessions: { listLineItems: (...a) => scenario.handlers.listLineItems(...a) } };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: the live Payment Link default flow is not broken by this PR (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }), // legacy customer — no firebaseUID metadata at all
      subscriptionsRetrieve: async (id) => ({
        id, customer: 'cus_legacy', status: 'active', created: 2000000000,
        current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_pro' } }] },
        metadata: {}, // no checkoutOperationId — Payment Links don't carry our server's metadata
      }),
      listLineItems: async () => ({ data: [{ price: { id: 'price_pro' } }] }),
    };
  });

  it('grants credits for a Payment-Link-shaped checkout with no operation record at all', async () => {
    await db.collection('users').doc('uid_payment_link').set({ email: 'pl@example.test' });

    const event = {
      id: 'evt_pl_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_pl_1', customer: 'cus_legacy', subscription: 'sub_pl_1', payment_status: 'paid',
          created: 2000000000,
          client_reference_id: 'uid_payment_link', // the ONLY identity signal a Payment Link gives us
          metadata: {}, // no firebaseUID, no checkoutOperationId
        },
      },
    };

    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const userDoc = await db.collection('users').doc('uid_payment_link').get();
    const data = userDoc.data();
    expect(data.hasCompletedPayment).toBe(true);
    expect(data.subscriptionTier).toBe('pro');
    expect(data.credits).toEqual({ total: 1250, used: 0, remaining: 1250, resetDate: expect.any(String) });
    expect(data.stripeSubscriptionId).toBe('sub_pl_1');

    const allocation = await db.collection('billingAllocations').doc('sub_pl_1').get();
    expect(allocation.exists).toBe(true);

    // Not flagged ambiguous — this is the whole point.
    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.map((d) => d.data().reason)).toEqual([]);
  });

  it('a Payment Link subscription later replacing a canceled one is flagged, not auto-switched (no provenance available)', async () => {
    await db.collection('users').doc('uid_pl2').set({
      email: 'pl2@example.test', stripeCustomerId: 'cus_legacy', stripeSubscriptionId: 'sub_old',
      hasCompletedPayment: true,
    });
    scenario.handlers.subscriptionsRetrieve = async (id) => {
      if (id === 'sub_old') return { id: 'sub_old', customer: 'cus_legacy', status: 'canceled', created: 1000000000 };
      return {
        id: 'sub_new', customer: 'cus_legacy', status: 'active', created: 2500000000,
        current_period_start: 2500000000, current_period_end: 2600000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_pro' } }] }, metadata: {},
      };
    };

    const event = {
      id: 'evt_pl_replace',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_new', customer: 'cus_legacy', status: 'active', created: 2500000000, metadata: {} } },
    };

    await handler(fakeHttpEvent(event));

    const userDoc = await db.collection('users').doc('uid_pl2').get();
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_old'); // not switched
    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'replacement_not_authorized')).toBe(true);
  });
  },
);
