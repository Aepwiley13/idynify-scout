/**
 * Runs against a REAL Firestore emulator with real transactions. Ownership (customer identity)
 * and product validity are checked UNCONDITIONALLY on every reconciliation path — a first-ever
 * binding and a same-subscription update, not only the replacement branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = { retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a) };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

const { db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js');
const { handler } = await import('../../netlify/functions/stripe-webhook.js');

beforeEach(async () => {
  await wipeBillingCollections();
});

describe('stripe-webhook: ownership validated on every path, not only the replacement branch', () => {
  it('a first-ever binding with a customer that mismatches an ALREADY-recorded one is rejected', async () => {
    await db.collection('users').doc('uid_own1').set({ email: 'o1@example.test', stripeCustomerId: 'cus_already_on_file' });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_own1', customer: 'cus_DIFFERENT', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_own1' },
    });

    const event = {
      id: 'evt_own1', type: 'customer.subscription.created',
      data: { object: { id: 'sub_own1', customer: 'cus_DIFFERENT', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_own1' } } },
    };
    await handler(fakeHttpEvent(event));

    const userDoc = await db.collection('users').doc('uid_own1').get();
    expect(userDoc.data().stripeSubscriptionId).toBeUndefined(); // not bound — rejected
    expect(userDoc.data().stripeCustomerId).toBe('cus_already_on_file'); // not overwritten

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'customer_mismatch')).toBe(true);
  });

  it('a genuinely first-ever binding (no customer on file yet) succeeds', async () => {
    await db.collection('users').doc('uid_own2').set({ email: 'o2@example.test' });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_own2', customer: 'cus_fresh', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_own2' },
    });

    const event = {
      id: 'evt_own2', type: 'customer.subscription.created',
      data: { object: { id: 'sub_own2', customer: 'cus_fresh', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_own2' } } },
    };
    await handler(fakeHttpEvent(event));
    const userDoc = await db.collection('users').doc('uid_own2').get();
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_own2');
    expect(userDoc.data().stripeCustomerId).toBe('cus_fresh');
  });

  it('an update to the SAME subscription id is still rejected if the customer no longer matches', async () => {
    await db.collection('users').doc('uid_own3').set({
      email: 'o3@example.test', stripeCustomerId: 'cus_correct', stripeSubscriptionId: 'sub_own3',
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_own3', customer: 'cus_tampered', status: 'past_due', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_own3' },
    });

    const event = {
      id: 'evt_own3', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_own3', customer: 'cus_tampered', status: 'past_due', created: 2000000000, metadata: { firebaseUID: 'uid_own3' } } },
    };
    await handler(fakeHttpEvent(event));

    const userDoc = await db.collection('users').doc('uid_own3').get();
    expect(userDoc.data().subscriptionStatus).toBeUndefined(); // the update was rejected, not applied
    expect(userDoc.data().stripeCustomerId).toBe('cus_correct');
  });

  it('an unknown price blocks even a first-ever binding', async () => {
    await db.collection('users').doc('uid_own4').set({ email: 'o4@example.test' });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_own4', customer: 'cus_fresh4', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_not_ours' } }] }, metadata: { firebaseUID: 'uid_own4' },
    });
    const event = {
      id: 'evt_own4', type: 'customer.subscription.created',
      data: { object: { id: 'sub_own4', customer: 'cus_fresh4', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_own4' } } },
    };
    await handler(fakeHttpEvent(event));
    const userDoc = await db.collection('users').doc('uid_own4').get();
    expect(userDoc.data().stripeSubscriptionId).toBeUndefined();
  });
});
