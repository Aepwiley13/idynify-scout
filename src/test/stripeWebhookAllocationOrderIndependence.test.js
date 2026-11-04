/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. Regression test for the round-7/8 bug: binding (subscription-identity
 * reconciliation) must never imply allocation (the one-time credit grant). A metadata-bearing
 * customer.subscription.created can legitimately bind stripeSubscriptionId BEFORE
 * checkout.session.completed arrives — that must not cause the later checkout-completion event
 * to skip granting credits.
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

const SUBSCRIPTION = {
  id: 'sub_order_1', customer: 'cus_order_1', status: 'active', created: 2000000000,
  current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
  items: { data: [{ price: { id: 'price_starter' } }] },
  metadata: { firebaseUID: 'uid_order_1', checkoutOperationId: 'op_order_1' },
};

const subscriptionCreatedEvent = {
  id: 'evt_sub_created', type: 'customer.subscription.created',
  data: { object: SUBSCRIPTION },
};

function checkoutCompletedEvent() {
  return {
    id: 'evt_checkout_completed', type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_order_1', customer: 'cus_order_1', subscription: 'sub_order_1', payment_status: 'paid',
        created: 2000000000, metadata: { firebaseUID: 'uid_order_1', checkoutOperationId: 'op_order_1' },
      },
    },
  };
}

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: binding never implies allocation (run via: npm run test:billing-emulator)',
  () => {
    let db, wipeBillingCollections, fakeHttpEvent, handler;

    beforeAll(async () => {
      ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
      ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
    });

    beforeEach(async () => {
      await wipeBillingCollections();
      scenario.handlers = {
        customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_order_1' } }),
        subscriptionsRetrieve: async () => SUBSCRIPTION,
        listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
      };
      await db.collection('users').doc('uid_order_1').set({ email: 'o@example.test' });
      await db.collection('billingCheckoutOperations').doc('op_order_1').set({
        uid: 'uid_order_1', tier: 'starter', priceId: 'price_starter', customerId: 'cus_order_1',
        sessionId: null, subscriptionId: null, createdAt: new Date().toISOString(),
      });
    });

    it('subscription.created binds first, checkout.session.completed grants credits second — exactly once', async () => {
      await handler(fakeHttpEvent(subscriptionCreatedEvent));

      let userDoc = await db.collection('users').doc('uid_order_1').get();
      expect(userDoc.data().stripeSubscriptionId).toBe('sub_order_1'); // bound
      expect(userDoc.data().credits).toBeUndefined(); // NOT granted yet — binding is not allocation

      await handler(fakeHttpEvent(checkoutCompletedEvent()));

      userDoc = await db.collection('users').doc('uid_order_1').get();
      expect(userDoc.data().credits.remaining).toBe(400); // granted exactly once, now

      const allocation = await db.collection('billingAllocations').doc('sub_order_1').get();
      expect(allocation.exists).toBe(true);
    });

    it('checkout.session.completed first, subscription.created second — same result, no double grant', async () => {
      await handler(fakeHttpEvent(checkoutCompletedEvent()));
      let userDoc = await db.collection('users').doc('uid_order_1').get();
      expect(userDoc.data().credits.remaining).toBe(400);

      await handler(fakeHttpEvent(subscriptionCreatedEvent));
      userDoc = await db.collection('users').doc('uid_order_1').get();
      expect(userDoc.data().credits.remaining).toBe(400); // unchanged — not re-granted
    });
  },
);
