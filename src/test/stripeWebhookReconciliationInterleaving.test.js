/**
 * Runs against a REAL Firestore emulator with real transactions — this is the one explicitly
 * asked for: mocked transaction callbacks cannot prove concurrency/fencing behavior, only that
 * the code calls the right function. Two genuinely concurrent webhook deliveries for the SAME
 * subscription must not corrupt the final state — Firestore's own optimistic concurrency control
 * (every write inside runTransaction, including the live Stripe re-fetch, is redone in full on
 * contention) is what this test actually exercises.
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

describe('stripe-webhook: real concurrent reconciliation for the same subscription', () => {
  it('two concurrent delivery for two different events on the same subscription both land cleanly, not corrupted', async () => {
    await db.collection('users').doc('uid_race').set({
      email: 'race@example.test', stripeCustomerId: 'cus_race', stripeSubscriptionId: 'sub_race',
    });

    // Every retrieve call sees the SAME, current truth — simulating "by the time either commits,
    // this is what Stripe considers current." Two different, non-duplicate events race to apply it.
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_race', customer: 'cus_race', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_race' },
    });

    const eventA = {
      id: 'evt_race_a', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_race', customer: 'cus_race', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_race' } } },
    };
    const eventB = {
      id: 'evt_race_b', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_race', customer: 'cus_race', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_race' } } },
    };

    const [resultA, resultB] = await Promise.all([
      handler(fakeHttpEvent(eventA)),
      handler(fakeHttpEvent(eventB)),
    ]);
    expect(resultA.statusCode).toBe(200);
    expect(resultB.statusCode).toBe(200);

    const userDoc = await db.collection('users').doc('uid_race').get();
    expect(userDoc.data().subscriptionStatus).toBe('active');
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_race');

    // Both genuinely distinct events get marked applied — concurrency didn't drop either one.
    const [a, b] = await Promise.all([
      db.collection('stripeWebhookEvents').doc('evt_race_a').get(),
      db.collection('stripeWebhookEvents').doc('evt_race_b').get(),
    ]);
    expect(a.exists).toBe(true);
    expect(b.exists).toBe(true);
  });

  it('twenty concurrent deliveries for the same subscription converge without error or corruption', async () => {
    await db.collection('users').doc('uid_race2').set({
      email: 'race2@example.test', stripeCustomerId: 'cus_race2', stripeSubscriptionId: 'sub_race2',
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_race2', customer: 'cus_race2', status: 'past_due', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_race2' },
    });

    const events = Array.from({ length: 20 }, (_, i) => ({
      id: `evt_race2_${i}`, type: 'customer.subscription.updated',
      data: { object: { id: 'sub_race2', customer: 'cus_race2', status: 'past_due', created: 2000000000, metadata: { firebaseUID: 'uid_race2' } } },
    }));

    const results = await Promise.all(events.map((e) => handler(fakeHttpEvent(e))));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);

    const userDoc = await db.collection('users').doc('uid_race2').get();
    expect(userDoc.data().subscriptionStatus).toBe('past_due');

    const ledgerDocs = await Promise.all(events.map((e) => db.collection('stripeWebhookEvents').doc(e.id).get()));
    expect(ledgerDocs.every((d) => d.exists)).toBe(true);
  });
});
