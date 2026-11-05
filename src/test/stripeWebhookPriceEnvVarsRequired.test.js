/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * STRIPE_PRICE_STARTER/STRIPE_PRICE_PRO are not only needed for the new checkout path — they are
 * a hard dependency of the webhook hardening itself, for the ALREADY-LIVE Payment Link flow.
 * `isKnownIdynifyPrice()` is called unconditionally in both the allocation-eligibility check and
 * the reconciliation check, for every event regardless of path; if the env vars are unset,
 * `knownPriceIds()` is empty and `isKnownIdynifyPrice()` always returns false — so a
 * Payment-Link-shaped purchase (which has no other way to prove its price is one of ours) is
 * flagged `unknown_price` and granted nothing, and a legacy subscription's status update is
 * flagged `unknown_price` and never applied, instead of silently succeeding.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

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
  'stripe-webhook: STRIPE_PRICE_STARTER/PRO are required by the LIVE Payment Link flow, not only the new checkout path (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;
  let savedStarter, savedPro;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    savedStarter = process.env.STRIPE_PRICE_STARTER;
    savedPro = process.env.STRIPE_PRICE_PRO;
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }),
      subscriptionsRetrieve: async (id) => ({
        id, customer: 'cus_noprice', status: 'active', created: 2000000000,
        current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
      }),
      listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
    };
  });

  afterEach(() => {
    process.env.STRIPE_PRICE_STARTER = savedStarter;
    process.env.STRIPE_PRICE_PRO = savedPro;
  });

  it('with the price env vars unset, a Payment-Link-shaped purchase is NOT granted — flagged unknown_price instead', async () => {
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_PRO;

    await db.collection('users').doc('uid_noprice1').set({ email: 'np1@example.test' });
    const event = {
      id: 'evt_noprice_1', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_noprice_1', customer: 'cus_noprice', subscription: 'sub_noprice_1', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid_noprice1', metadata: {},
        },
      },
    };
    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200); // the webhook itself doesn't crash — it flags instead

    const userDoc = await db.collection('users').doc('uid_noprice1').get();
    expect(userDoc.data().credits).toBeUndefined(); // NOT granted

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'unknown_price')).toBe(true);
  });

  it('with the price env vars unset, an existing legacy subscription\'s status update is also rejected, not just new grants', async () => {
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_PRO;

    await db.collection('users').doc('uid_noprice2').set({
      email: 'np2@example.test', stripeCustomerId: 'cus_noprice', stripeSubscriptionId: 'sub_noprice_2',
      hasCompletedPayment: true, subscriptionStatus: 'active',
    });
    const event = {
      id: 'evt_noprice_2', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_noprice_2', customer: 'cus_noprice', status: 'past_due', created: 2000000000, metadata: {} } },
    };
    scenario.handlers.subscriptionsRetrieve = async () => ({
      id: 'sub_noprice_2', customer: 'cus_noprice', status: 'past_due', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
    });

    await handler(fakeHttpEvent(event));

    const userDoc = await db.collection('users').doc('uid_noprice2').get();
    // The status update is silently REJECTED — the account still shows 'active' when Stripe
    // actually reports 'past_due'. This is the real-world consequence of deploying without
    // these env vars: existing customers' billing state stops updating entirely.
    expect(userDoc.data().subscriptionStatus).toBe('active');

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'unknown_price')).toBe(true);
  });

  it('once the price env vars are set correctly, the identical Payment-Link purchase grants normally', async () => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_PRO = 'price_pro';

    await db.collection('users').doc('uid_withprice').set({ email: 'wp@example.test' });
    const event = {
      id: 'evt_withprice_1', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_withprice_1', customer: 'cus_noprice', subscription: 'sub_withprice_1', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid_withprice', metadata: {},
        },
      },
    };
    await handler(fakeHttpEvent(event));
    const userDoc = await db.collection('users').doc('uid_withprice').get();
    expect(userDoc.data().credits.remaining).toBe(400);
  });
  },
);
