/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * Round-9 code review finding 1: the collapsed subscription-lifecycle handler wrote
 * subscriptionStatus: 'canceled' without clearing hasCompletedPayment, so a canceled
 * subscription stopped revoking access (App.jsx still gates on that boolean). Deliberately
 * narrow fix: only the two terminal/dead statuses clear it, matching the original
 * customer.subscription.deleted behavior exactly — not a general entitlement-model rewrite,
 * which would silently decide the deferred failed-payment-grace question.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = { retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a) };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: cancellation revokes access (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    scenario.handlers = { customersRetrieve: async (id) => ({ id, metadata: {} }) };
  });

  it('customer.subscription.deleted clears hasCompletedPayment starting from true (restores original behavior)', async () => {
    await db.collection('users').doc('uid_cancel_1').set({
      email: 'cancel1@example.test', stripeCustomerId: 'cus_cancel', stripeSubscriptionId: 'sub_cancel',
      hasCompletedPayment: true, subscriptionStatus: 'active',
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_cancel', customer: 'cus_cancel', status: 'canceled', created: 2000000000,
      current_period_start: null, current_period_end: null, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_cancel_1' },
    });
    const event = {
      id: 'evt_cancel_1', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_cancel', customer: 'cus_cancel', status: 'canceled', created: 2000000000, metadata: { firebaseUID: 'uid_cancel_1' } } },
    };
    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const doc = await db.collection('users').doc('uid_cancel_1').get();
    expect(doc.data().hasCompletedPayment).toBe(false); // access revoked
    expect(doc.data().subscriptionStatus).toBe('canceled');
  });

  it('an incomplete_expired status also clears hasCompletedPayment', async () => {
    await db.collection('users').doc('uid_cancel_2').set({
      email: 'cancel2@example.test', stripeCustomerId: 'cus_cancel2', stripeSubscriptionId: 'sub_cancel2',
      hasCompletedPayment: true, subscriptionStatus: 'incomplete',
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_cancel2', customer: 'cus_cancel2', status: 'incomplete_expired', created: 2000000000,
      current_period_start: null, current_period_end: null, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_cancel_2' },
    });
    const event = {
      id: 'evt_cancel_2', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_cancel2', customer: 'cus_cancel2', status: 'incomplete_expired', created: 2000000000, metadata: { firebaseUID: 'uid_cancel_2' } } },
    };
    await handler(fakeHttpEvent(event));
    const doc = await db.collection('users').doc('uid_cancel_2').get();
    expect(doc.data().hasCompletedPayment).toBe(false);
  });

  it('a past_due update does NOT revoke access — that is a deliberately deferred grace-period decision, not this fix', async () => {
    await db.collection('users').doc('uid_cancel_3').set({
      email: 'cancel3@example.test', stripeCustomerId: 'cus_cancel3', stripeSubscriptionId: 'sub_cancel3',
      hasCompletedPayment: true, subscriptionStatus: 'active',
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_cancel3', customer: 'cus_cancel3', status: 'past_due', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_cancel_3' },
    });
    const event = {
      id: 'evt_cancel_3', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_cancel3', customer: 'cus_cancel3', status: 'past_due', created: 2000000000, metadata: { firebaseUID: 'uid_cancel_3' } } },
    };
    await handler(fakeHttpEvent(event));
    const doc = await db.collection('users').doc('uid_cancel_3').get();
    expect(doc.data().subscriptionStatus).toBe('past_due');
    expect(doc.data().hasCompletedPayment).toBe(true); // unchanged — matches the ORIGINAL code's behavior
  });
  },
);
