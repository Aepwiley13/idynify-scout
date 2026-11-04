/** Runs against a REAL Firestore emulator — see package.json's `test:billing-emulator` script. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js');
const { handler } = await import('../../netlify/functions/stripe-webhook.js');

beforeEach(async () => {
  await wipeBillingCollections();
  scenario.handlers = {
    customersRetrieve: async (id) => ({ id, metadata: {} }),
    subscriptionsRetrieve: async (id) => ({
      id, customer: 'cus_1', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] },
    }),
    listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
  };
});

describe('stripe-webhook: idempotency ledger', () => {
  it('applies a duplicate checkout.session.completed delivery exactly once', async () => {
    await db.collection('users').doc('uid1').set({ email: 'a@example.test' });

    const event = {
      id: 'evt_dup_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid1', metadata: {},
        },
      },
    };

    const r1 = await handler(fakeHttpEvent(event));
    expect(r1.statusCode).toBe(200);
    const r2 = await handler(fakeHttpEvent(event)); // exact redelivery, same event.id
    expect(r2.statusCode).toBe(200);

    const userDoc = await db.collection('users').doc('uid1').get();
    expect(userDoc.data().credits.remaining).toBe(400); // granted once, not twice

    const allocation = await db.collection('billingAllocations').doc('sub_1').get();
    expect(allocation.exists).toBe(true);

    const eventDoc = await db.collection('stripeWebhookEvents').doc('evt_dup_1').get();
    expect(eventDoc.exists).toBe(true);
  });

  it('applies a duplicate customer.subscription.updated delivery exactly once', async () => {
    await db.collection('users').doc('uid1').set({ email: 'a@example.test', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });

    const event = {
      id: 'evt_dup_2',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', created: 1500000000 } },
    };
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_1', customer: 'cus_1', status: 'past_due', created: 1500000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] },
    });

    await handler(fakeHttpEvent(event));
    await handler(fakeHttpEvent(event));

    const userDoc = await db.collection('users').doc('uid1').get();
    expect(userDoc.data().subscriptionStatus).toBe('past_due');
    const eventDoc = await db.collection('stripeWebhookEvents').doc('evt_dup_2').get();
    expect(eventDoc.exists).toBe(true);
  });
});
