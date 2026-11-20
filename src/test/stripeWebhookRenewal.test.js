/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file (the pure decision is covered by renewalDecision.test.js).
 *
 * W4b: invoice.paid for a renewal resets the plan's monthly allowance, once per invoice, through
 * the real handler, account lock, event ledger and billingAllocations marker.
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
  'stripe-webhook: monthly renewal on invoice.paid (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;
  const UID = 'uid_renew_1';

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  const live = { price: 'price_starter', status: 'active' };
  const PERIOD_END = 2_002_592_000;
  const subscriptionNow = () => ({
    id: 'sub_renew', customer: 'cus_renew', status: live.status, created: 1999990000,
    current_period_start: 2_000_000_000, current_period_end: PERIOD_END, cancel_at_period_end: false,
    items: { data: [{ id: 'si_r', price: { id: live.price } }] }, metadata: { firebaseUID: UID },
  });
  const paid = (eventId, invoice) => handler(fakeHttpEvent({
    id: eventId, type: 'invoice.paid',
    data: { object: { id: 'in_1', billing_reason: 'subscription_cycle', created: 2_000_000_100, subscription: 'sub_renew', customer: 'cus_renew', ...invoice } },
  }));
  const account = async () => (await db.collection('users').doc(UID).get()).data();
  const markers = async () => (await db.collection('billingAllocations').get()).docs.filter((d) => d.data().kind === 'renewal');
  const flags = async () => (await db.collection('billingAmbiguousAccounts').get()).docs.map((d) => d.data().reason);

  beforeEach(async () => {
    await wipeBillingCollections();
    Object.assign(live, { price: 'price_starter', status: 'active' });
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }),
      subscriptionsRetrieve: async () => subscriptionNow(),
    };
    await db.collection('users').doc(UID).set({
      email: 'renew@example.test', stripeCustomerId: 'cus_renew', stripeSubscriptionId: 'sub_renew',
      hasCompletedPayment: true, subscriptionStatus: 'active', subscriptionTier: 'starter',
      credits: { total: 400, used: 390, remaining: 10, resetDate: '2033-05-01T00:00:00.000Z' },
      contactsMarker: 'untouched',
    });
  });

  it("a paid renewal resets Starter's allowance once, and nothing else on the account", async () => {
    expect((await paid('evt_r1')).statusCode).toBe(200);
    const a = await account();
    expect(a.credits).toEqual({ total: 400, used: 0, remaining: 400, resetDate: new Date(PERIOD_END * 1000).toISOString() });
    expect(a.hasCompletedPayment).toBe(true);
    expect(a.contactsMarker).toBe('untouched');
    expect(a.billingLock).toBeNull();
    expect(await markers()).toHaveLength(1);
  });

  it('the same event redelivered, or another event for the same invoice, grants nothing more', async () => {
    await paid('evt_r1');
    await db.collection('users').doc(UID).update({ 'credits.used': 50, 'credits.remaining': 350 });
    await paid('evt_r1');
    await paid('evt_r1_again');
    expect((await account()).credits.remaining).toBe(350);
    expect(await markers()).toHaveLength(1);
  });

  it('the next month\'s invoice is a new renewal', async () => {
    await paid('evt_r1');
    await db.collection('users').doc(UID).update({ 'credits.used': 400, 'credits.remaining': 0 });
    await paid('evt_r2', { id: 'in_2', created: 2_002_592_100 });
    expect((await account()).credits.remaining).toBe(400);
    expect(await markers()).toHaveLength(2);
  });

  it('Pro renews at 1,250', async () => {
    live.price = 'price_pro';
    await db.collection('users').doc(UID).update({ subscriptionTier: 'pro' });
    await paid('evt_pro');
    expect((await account()).credits.total).toBe(1250);
  });

  it('the first invoice and a plan change\'s proration invoice are not renewals', async () => {
    await paid('evt_create', { billing_reason: 'subscription_create' });
    await paid('evt_update', { id: 'in_u', billing_reason: 'subscription_update' });
    expect((await account()).credits.remaining).toBe(10);
    expect(await markers()).toHaveLength(0);
  });

  it('the newer payload shape (invoice.parent.subscription_details) works the same', async () => {
    await paid('evt_clover', { subscription: undefined, parent: { subscription_details: { subscription: 'sub_renew' } } });
    expect((await account()).credits.remaining).toBe(400);
  });

  it('a subscription that is not live is not renewed; one that is not on file is flagged', async () => {
    live.status = 'past_due';
    await paid('evt_pd');
    expect((await account()).credits.remaining).toBe(10);
    live.status = 'active';
    await db.collection('users').doc(UID).update({ stripeSubscriptionId: 'sub_other' });
    await paid('evt_other', { id: 'in_o' });
    expect((await account()).credits.remaining).toBe(10);
    expect(await flags()).toContain('renewal_not_subscription_on_file');
  });
  },
);
