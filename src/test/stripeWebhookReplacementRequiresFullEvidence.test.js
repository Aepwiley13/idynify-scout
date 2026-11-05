/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. A subscription replacement (a different subscription id than what's on file)
 * requires EVERY condition — same customer, known price, verified newer, and
 * operation-record-backed provenance — not any one of them alone.
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

const ON_FILE_DEAD = { id: 'sub_onfile', customer: 'cus_r1', status: 'canceled', created: 1000000000 };

function incomingEvent(subscriptionOverrides = {}) {
  const subscription = {
    id: 'sub_incoming', customer: 'cus_r1', status: 'active', created: 2000000000,
    current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
    ...subscriptionOverrides,
  };
  return {
    event: { id: 'evt_r1', type: 'customer.subscription.created', data: { object: subscription } },
    subscription,
  };
}

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: replacement requires every piece of evidence together (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;
  let incomingSub;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    scenario.handlers = {
      customersRetrieve: async (id) => ({ id, metadata: {} }),
      subscriptionsRetrieve: async (id) => (id === 'sub_onfile' ? ON_FILE_DEAD : incomingSub),
    };
  });

  async function seedUser(overrides = {}) {
    await db.collection('users').doc('uid_r1').set({
      email: 'r1@example.test', stripeCustomerId: 'cus_r1', stripeSubscriptionId: 'sub_onfile', ...overrides,
    });
  }

  async function run(subscriptionOverrides) {
    const { event, subscription } = incomingEvent(subscriptionOverrides);
    incomingSub = subscription;
    scenario.handlers.subscriptionsRetrieve = async (id) => (id === 'sub_onfile' ? ON_FILE_DEAD : subscription);
    await handler(fakeHttpEvent(event));
    return db.collection('users').doc('uid_r1').get();
  }

  it('different customer blocks the switch even with provenance and a newer timestamp', async () => {
    await seedUser();
    await db.collection('billingCheckoutOperations').doc('op_r1').set({
      uid: 'uid_r1', customerId: 'cus_WRONG', priceId: 'price_starter', createdAt: new Date().toISOString(),
    });
    const userDoc = await run({ customer: 'cus_r1', metadata: { checkoutOperationId: 'op_r1' } });
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_onfile');
  });

  it('an unknown price blocks the switch', async () => {
    await seedUser();
    await db.collection('billingCheckoutOperations').doc('op_r1').set({
      uid: 'uid_r1', customerId: 'cus_r1', priceId: 'price_starter', createdAt: new Date().toISOString(),
    });
    const userDoc = await run({
      items: { data: [{ price: { id: 'price_unrelated_product' } }] },
      metadata: { checkoutOperationId: 'op_r1' },
    });
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_onfile');
  });

  it('missing provenance (no checkoutOperationId at all) blocks the switch, even newer and dead-on-file', async () => {
    await seedUser();
    const userDoc = await run({ metadata: {} });
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_onfile');
    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'replacement_not_authorized')).toBe(true);
  });

  it('a mismatched operation record (wrong uid) blocks the switch', async () => {
    await seedUser();
    await db.collection('billingCheckoutOperations').doc('op_r1').set({
      uid: 'someone_else', customerId: 'cus_r1', priceId: 'price_starter', createdAt: new Date().toISOString(),
    });
    const userDoc = await run({ metadata: { checkoutOperationId: 'op_r1' } });
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_onfile');
  });

  it('all conditions present together — the only case that actually switches', async () => {
    await seedUser();
    await db.collection('billingCheckoutOperations').doc('op_r1').set({
      uid: 'uid_r1', customerId: 'cus_r1', priceId: 'price_starter', createdAt: new Date().toISOString(),
    });
    const userDoc = await run({ metadata: { checkoutOperationId: 'op_r1' } });
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_incoming');
  });

  it('an on-file subscription that is still LIVE (not dead) blocks the switch even with full provenance', async () => {
    await seedUser();
    scenario.handlers.subscriptionsRetrieve = async (id) =>
      id === 'sub_onfile' ? { ...ON_FILE_DEAD, status: 'active' } : incomingSub;
    await db.collection('billingCheckoutOperations').doc('op_r1').set({
      uid: 'uid_r1', customerId: 'cus_r1', priceId: 'price_starter', createdAt: new Date().toISOString(),
    });
    const { event, subscription } = incomingEvent({ metadata: { checkoutOperationId: 'op_r1' } });
    incomingSub = subscription;
    await handler(fakeHttpEvent(event));
    const userDoc = await db.collection('users').doc('uid_r1').get();
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_onfile');
  });
  },
);
