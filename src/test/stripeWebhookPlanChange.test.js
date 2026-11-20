/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file (the pure decision is covered by planChangeDecision.test.js).
 *
 * W3: a plan change on the customer's existing subscription reaches the account through
 * customer.subscription.updated. The handler, the account lock, the event ledger and the
 * billingAllocations marker are the real ones.
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
  'stripe-webhook: plan changes on the existing subscription (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;
  const UID = 'uid_plan_1';

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  const live = { price: 'price_starter', periodStart: 2000000000, status: 'active' };
  const subscriptionNow = () => ({
    id: 'sub_plan', customer: 'cus_plan', status: live.status, created: 1999990000,
    current_period_start: live.periodStart, current_period_end: live.periodStart + 30 * 86400, cancel_at_period_end: false,
    items: { data: [{ id: 'si_plan', price: { id: live.price } }] }, metadata: { firebaseUID: UID },
  });
  const updated = (id) => handler(fakeHttpEvent({
    id, type: 'customer.subscription.updated',
    data: { object: { id: 'sub_plan', customer: 'cus_plan', status: live.status, created: 1999990000, metadata: { firebaseUID: UID } } },
  }));
  const account = async () => (await db.collection('users').doc(UID).get()).data();
  const markers = async () => (await db.collection('billingAllocations').get()).docs.filter((d) => d.data().kind === 'plan_change');

  beforeEach(async () => {
    await wipeBillingCollections();
    Object.assign(live, { price: 'price_starter', periodStart: 2000000000, status: 'active' });
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }),
      subscriptionsRetrieve: async () => subscriptionNow(),
    };
    await db.collection('users').doc(UID).set({
      email: 'plan@example.test', stripeCustomerId: 'cus_plan', stripeSubscriptionId: 'sub_plan',
      hasCompletedPayment: true, subscriptionStatus: 'active', subscriptionTier: 'starter',
      credits: { total: 400, used: 25, remaining: 375, resetDate: '2033-06-01T00:00:00.000Z' },
      tierLimits: { creditsPerMonth: 400 }, features: { mobilePhone: false },
      contactsMarker: 'untouched',
    });
  });

  it('Starter → Pro on the same subscription: Pro access and 850 credits, once', async () => {
    live.price = 'price_pro';
    expect((await updated('evt_up_1')).statusCode).toBe(200);
    const a = await account();
    expect(a.subscriptionTier).toBe('pro');
    expect(a.tierLimits.creditsPerMonth).toBe(1250);
    expect(a.features.mobilePhone).toBe(true);
    expect(a.credits).toEqual({ total: 1250, used: 25, remaining: 1225, resetDate: '2033-06-01T00:00:00.000Z' });
    expect(a.hasCompletedPayment).toBe(true);
    expect(a.stripeSubscriptionId).toBe('sub_plan');
    expect(a.contactsMarker).toBe('untouched');
    expect(await markers()).toHaveLength(1);
  });

  it('the same event redelivered, and a second event for the same change, grant nothing more', async () => {
    live.price = 'price_pro';
    await updated('evt_up_1');
    await updated('evt_up_1');
    await updated('evt_up_2');
    expect((await account()).credits.remaining).toBe(1225);
    expect(await markers()).toHaveLength(1);
  });

  it('switching back and forth within the period grants the extra credits once', async () => {
    live.price = 'price_pro';
    await updated('evt_a');
    live.price = 'price_starter';
    await updated('evt_b');
    expect((await account()).subscriptionTier).toBe('starter');
    expect((await account()).credits.remaining).toBe(1225); // nothing taken back
    live.price = 'price_pro';
    await updated('evt_c');
    const a = await account();
    expect(a.subscriptionTier).toBe('pro');
    expect(a.credits.remaining).toBe(1225);
    expect(await markers()).toHaveLength(1);
  });

  it('Pro → Starter: Starter limits, and no credits taken back', async () => {
    await db.collection('users').doc(UID).update({ subscriptionTier: 'pro', credits: { total: 1250, used: 0, remaining: 1250, resetDate: null } });
    live.price = 'price_starter';
    await updated('evt_down');
    const a = await account();
    expect(a.subscriptionTier).toBe('starter');
    expect(a.tierLimits.creditsPerMonth).toBe(400);
    expect(a.credits.remaining).toBe(1250);
    expect(await markers()).toHaveLength(0);
  });

  it('a Pro price on a subscription that is not live (past_due) changes no plan', async () => {
    live.price = 'price_pro';
    live.status = 'past_due';
    await updated('evt_pd');
    const a = await account();
    expect(a.subscriptionTier).toBe('starter');
    expect(a.credits.remaining).toBe(375);
    expect(await markers()).toHaveLength(0);
  });

  it('an account without paid access yet is left to checkout to grant', async () => {
    await db.collection('users').doc(UID).update({ hasCompletedPayment: false });
    live.price = 'price_pro';
    await updated('evt_unpaid');
    expect((await account()).subscriptionTier).toBe('starter');
    expect(await markers()).toHaveLength(0);
  });

  it('a later period: a new upgrade is a new grant', async () => {
    live.price = 'price_pro';
    await updated('evt_p1');
    live.price = 'price_starter';
    live.periodStart += 30 * 86400;
    await updated('evt_p2_down');
    live.price = 'price_pro';
    await updated('evt_p2_up');
    expect(await markers()).toHaveLength(2);
  });
  },
);
