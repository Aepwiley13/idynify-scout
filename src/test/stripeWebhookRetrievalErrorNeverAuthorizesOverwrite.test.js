/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. A Stripe retrieval error while checking the on-file subscription must never
 * be read as "the on-file subscription doesn't exist" — that would silently authorize an
 * overwrite on the same grounds as a genuinely dead subscription.
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
  'stripe-webhook: a retrieval error never authorizes an overwrite (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
  });

  it('returns a retryable 500, writes nothing, and does not mark the event applied', async () => {
    await db.collection('users').doc('uid_err').set({
      email: 'e@example.test', stripeCustomerId: 'cus_err', stripeSubscriptionId: 'sub_onfile_err',
    });
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }),
      subscriptionsRetrieve: async (id) => {
        if (id === 'sub_onfile_err') throw new Error('network error retrieving on-file subscription');
        return {
          id: 'sub_new_err', customer: 'cus_err', status: 'active', created: 3000000000,
          current_period_start: 3000000000, current_period_end: 3003000000, cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
        };
      },
      listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
    };

    const event = {
      id: 'evt_err_1', type: 'customer.subscription.created',
      data: { object: { id: 'sub_new_err', customer: 'cus_err', status: 'active', created: 3000000000, metadata: {} } },
    };

    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(500); // retryable — Stripe should redeliver

    const userDoc = await db.collection('users').doc('uid_err').get();
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_onfile_err'); // unchanged

    const eventDoc = await db.collection('stripeWebhookEvents').doc('evt_err_1').get();
    expect(eventDoc.exists).toBe(false); // NOT marked applied — stays retryable

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs).toHaveLength(0); // a bare retrieval error isn't durably logged either —
                                             // it's exactly what Stripe's own redelivery resolves
  });
  },
);
