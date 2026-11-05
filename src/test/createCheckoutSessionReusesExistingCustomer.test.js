/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * Round-9 code review finding 2: a fresh checkout operation always initialized customerId: null,
 * so customer resolution called customers.create instead of first reusing the user's existing,
 * already-verified stripeCustomerId. The subsequent duplicate-subscription listing then checked
 * the brand-new (empty) customer and never found subscriptions on the original one.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { FIRESTORE_EMULATOR_AVAILABLE, scenario } = vi.hoisted(() => ({
  FIRESTORE_EMULATOR_AVAILABLE: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  scenario: { verifyIdToken: null, stripeHandlers: {}, customerCreateCalls: 0 },
}));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = {
      create: async (...a) => { scenario.customerCreateCalls++; return scenario.stripeHandlers.customersCreate(...a); },
      retrieve: (...a) => scenario.stripeHandlers.customersRetrieve(...a),
    };
    subscriptions = { list: (...a) => scenario.stripeHandlers.subscriptionsList(...a) };
    checkout = { sessions: { create: (...a) => scenario.stripeHandlers.sessionsCreate(...a) } };
  }
  return { default: FakeStripe };
});

process.env.FIREBASE_PROJECT_ID ||= 'demo-billing-tests';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake';
process.env.STRIPE_PRICE_STARTER ||= 'price_starter';
process.env.STRIPE_PRICE_PRO ||= 'price_pro';

vi.mock('../../netlify/functions/firebase-admin.js', async (importOriginal) => {
  const fakeAdmin = { auth: () => ({ verifyIdToken: (...a) => scenario.verifyIdToken(...a) }) };
  if (!FIRESTORE_EMULATOR_AVAILABLE) return { admin: fakeAdmin, db: null };
  const actual = await importOriginal();
  return { ...actual, admin: fakeAdmin };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'create-checkout-session: reuses an existing customer instead of creating a second one (run via: npm run test:billing-emulator)',
  () => {
  let db, handler;

  beforeAll(async () => {
    ({ db } = await import('../../netlify/functions/firebase-admin.js'));
    ({ handler } = await import('../../netlify/functions/create-checkout-session.js'));
  });

  async function wipe() {
    for (const coll of ['users', 'billingCheckoutOperations', 'billingAmbiguousAccounts']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }

  function postEvent(body) {
    return { httpMethod: 'POST', headers: { authorization: 'Bearer good-token', origin: 'https://idynify.com' }, body: JSON.stringify(body) };
  }

  beforeEach(async () => {
    await wipe();
    scenario.customerCreateCalls = 0;
    scenario.verifyIdToken = async () => ({ uid: 'uid_reuse_1' });
    scenario.stripeHandlers = {
      customersCreate: async () => { throw new Error('customers.create should not be called — an existing customer should be reused'); },
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_reuse_1' } }),
      subscriptionsList: async () => ({ data: [], has_more: false }),
      sessionsCreate: async (params) => ({ id: 'cs_reuse_1', url: 'https://checkout.stripe.com/cs_reuse_1' }),
    };
  });

  it('a fresh checkout for a user with an existing stripeCustomerId reuses it — no second customer created', async () => {
    await db.collection('users').doc('uid_reuse_1').set({ email: 'reuse1@example.test', stripeCustomerId: 'cus_existing_1' });

    const result = await handler(postEvent({ tier: 'starter' }));
    expect(result.statusCode).toBe(200);
    expect(scenario.customerCreateCalls).toBe(0);

    const opsSnap = await db.collection('billingCheckoutOperations').get();
    expect(opsSnap.docs).toHaveLength(1);
    expect(opsSnap.docs[0].data().customerId).toBe('cus_existing_1'); // seeded, not null
  });

  it('an existing customer with a stale/missing mirrored status and a blocking Stripe subscription is still caught', async () => {
    // The Firestore mirror never got a subscriptionStatus written (stale/missing) — only the
    // direct-from-Stripe pagination check can catch this, and it only works if it's checking the
    // RIGHT (existing) customer, not a freshly-created empty one.
    await db.collection('users').doc('uid_reuse_1').set({ email: 'reuse1@example.test', stripeCustomerId: 'cus_existing_1' });
    scenario.stripeHandlers.subscriptionsList = async () => ({
      data: [{ id: 'sub_blocking', status: 'active' }], has_more: false,
    });

    const result = await handler(postEvent({ tier: 'starter' }));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('already_subscribed');
    expect(scenario.customerCreateCalls).toBe(0); // never created a second (empty) customer to check instead

    const opsSnap = await db.collection('billingCheckoutOperations').get();
    expect(opsSnap.docs[0].data().customerId).toBe('cus_existing_1'); // the check ran against the real customer
  });
  },
);
