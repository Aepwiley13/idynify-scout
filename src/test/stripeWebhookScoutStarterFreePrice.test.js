/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file.
 *
 * The Stripe export surfaced an active $0/month "Scout Starter" subscription on
 * price_1T3UsqJEdYAFEzC36VCvIZ90 — a real, live subscriber outside the original two-price
 * allowlist (STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO). Before this fix, isKnownIdynifyPrice()
 * rejected it everywhere, which meant EVERY webhook event for that subscriber — including
 * customer.subscription.deleted — got flagged unknown_price instead of applied, so their
 * cancellation would never have revoked anything (nothing to revoke was ever granted in the
 * first place, but more importantly no event for them would ever reconcile cleanly at all).
 *
 * The fix adds STRIPE_PRICE_SCOUT_STARTER_FREE to knownPriceIds() (reconciliation — lifecycle
 * events apply normally) while deliberately KEEPING it out of creditGrantingPriceIds() (never
 * grants credits, never sets hasCompletedPayment, regardless of the product being named
 * "Starter"). These two tests prove the two behaviors are now independently correct:
 *
 *   1. A lifecycle event (subscription update/cancellation) for this price reconciles normally
 *      — not flagged unknown_price — and a cancellation still correctly clears
 *      hasCompletedPayment if it was ever (wrongly) true.
 *   2. A checkout/allocation attempt against this price never grants credits and never sets
 *      hasCompletedPayment, and — because this is expected, understood behavior, not an
 *      anomaly — writes nothing to billingAmbiguousAccounts either.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: the $0/month Scout Starter price reconciles normally but never grants credits (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;
  // Matches the default STRIPE_PRICE_SCOUT_STARTER_FREE set in helpers/billingTestUtils.js — a
  // literal here, not a process.env read, because this describe body runs during collection,
  // before beforeAll has imported billingTestUtils.js and set the env var (same reason every
  // other file in this suite hardcodes 'price_starter'/'price_pro' rather than reading them back
  // from process.env).
  const FREE_PRICE = 'price_scout_starter_free';

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    scenario.handlers = { customersRetrieve: async (id) => ({ id, metadata: {} }) };
  });

  it('a lifecycle update for the $0 Scout Starter price reconciles normally, not flagged unknown_price', async () => {
    await db.collection('users').doc('uid_free_1').set({
      email: 'free1@example.test', stripeCustomerId: 'cus_free_1', stripeSubscriptionId: 'sub_free_1',
      hasCompletedPayment: false, subscriptionStatus: 'active',
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_free_1', customer: 'cus_free_1', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: FREE_PRICE } }] }, metadata: { firebaseUID: 'uid_free_1' },
    });
    const event = {
      id: 'evt_free_1', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_free_1', customer: 'cus_free_1', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_free_1' } } },
    };
    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const doc = await db.collection('users').doc('uid_free_1').get();
    expect(doc.data().subscriptionStatus).toBe('active'); // reconciled, not skipped
    expect(doc.data().stripeSubscriptionId).toBe('sub_free_1');

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'unknown_price')).toBe(false);
  });

  it('cancelling the $0 Scout Starter subscription still clears hasCompletedPayment if it was ever true', async () => {
    await db.collection('users').doc('uid_free_2').set({
      email: 'free2@example.test', stripeCustomerId: 'cus_free_2', stripeSubscriptionId: 'sub_free_2',
      hasCompletedPayment: true, subscriptionStatus: 'active', // simulates a prior manual/legacy grant
    });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_free_2', customer: 'cus_free_2', status: 'canceled', created: 2000000000,
      current_period_start: null, current_period_end: null, cancel_at_period_end: false,
      items: { data: [{ price: { id: FREE_PRICE } }] }, metadata: { firebaseUID: 'uid_free_2' },
    });
    const event = {
      id: 'evt_free_2', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_free_2', customer: 'cus_free_2', status: 'canceled', created: 2000000000, metadata: { firebaseUID: 'uid_free_2' } } },
    };
    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const doc = await db.collection('users').doc('uid_free_2').get();
    expect(doc.data().hasCompletedPayment).toBe(false); // revoked, same as any other recognized price
    expect(doc.data().subscriptionStatus).toBe('canceled');
  });

  it('a checkout for the $0 Scout Starter price never grants credits and is not flagged ambiguous', async () => {
    await db.collection('users').doc('uid_free_3').set({ email: 'free3@example.test' });
    scenario.handlers.customersRetrieve = async (id) => ({ id, metadata: { firebaseUID: 'uid_free_3' } });
    scenario.handlers.listLineItems = async () => ({ data: [{ price: { id: FREE_PRICE } }] });
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_free_3', customer: 'cus_free_3', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: FREE_PRICE } }] }, metadata: {},
    });

    const event = {
      id: 'evt_free_3', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_free_3', customer: 'cus_free_3', subscription: 'sub_free_3', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid_free_3', metadata: {},
        },
      },
    };
    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const doc = await db.collection('users').doc('uid_free_3').get();
    expect(doc.data().hasCompletedPayment).toBeUndefined(); // never inferred paid from the product name
    expect(doc.data().credits).toBeUndefined(); // no allocation

    const allocation = await db.collection('billingAllocations').doc('sub_free_3').get();
    expect(allocation.exists).toBe(false); // no grant marker — nothing was granted

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs).toHaveLength(0); // expected, understood behavior — nothing for a human to review

    // Reconciliation still ran and bound the subscription normally, independent of allocation.
    expect(doc.data().stripeSubscriptionId).toBe('sub_free_3');
  });
  },
);
