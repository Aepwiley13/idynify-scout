/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file's tests: the firebase-admin.js mock below conditionally avoids initializing
 * the real Admin SDK when no emulator is present (initializing it with no emulator and no real
 * service-account credentials throws at mock-setup time, before any test or skip logic runs).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { FIRESTORE_EMULATOR_AVAILABLE, scenario } = vi.hoisted(() => ({
  FIRESTORE_EMULATOR_AVAILABLE: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  scenario: { verifyIdToken: null, stripeHandlers: {} },
}));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = {
      create: (...a) => scenario.stripeHandlers.customersCreate(...a),
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
  'create-checkout-session: authentication (run via: npm run test:billing-emulator)',
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

  function postEvent(body, { token = 'good-token', origin = 'https://idynify.com' } = {}) {
    return {
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${token}`, origin },
      body: JSON.stringify(body),
    };
  }

  beforeEach(async () => {
    await wipe();
    scenario.verifyIdToken = async (token) => {
      if (token !== 'good-token') throw new Error('invalid token');
      return { uid: 'uid_checkout_1' };
    };
    scenario.stripeHandlers = {
      customersCreate: async (params) => ({ id: 'cus_new_1', metadata: params.metadata }),
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_checkout_1' } }),
      subscriptionsList: async () => ({ data: [], has_more: false }),
      sessionsCreate: async (params) => ({ id: 'cs_new_1', url: 'https://checkout.stripe.com/cs_new_1' }),
    };
  });

  it('rejects a missing token before any Stripe call', async () => {
    const result = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ tier: 'starter' }) });
    expect(result.statusCode).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const result = await handler(postEvent({ tier: 'starter' }, { token: 'bad-token' }));
    expect(result.statusCode).toBe(401);
  });

  it('uses the token-derived uid, ignoring any uid supplied in the body', async () => {
    await db.collection('users').doc('uid_checkout_1').set({ email: 'c1@example.test' });
    const result = await handler(postEvent({ tier: 'starter', uid: 'someone-else', userId: 'someone-else' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.url).toBe('https://checkout.stripe.com/cs_new_1');

    const opsSnap = await db.collection('billingCheckoutOperations').get();
    expect(opsSnap.docs[0].data().uid).toBe('uid_checkout_1'); // never "someone-else"
  });

  describe('duplicate-subscription / recovery policy', () => {
    it('blocks with already_subscribed for an active on-file subscription', async () => {
      await db.collection('users').doc('uid_checkout_1').set({
        email: 'c1@example.test', subscriptionStatus: 'active', hasCompletedPayment: true,
      });
      const result = await handler(postEvent({ tier: 'pro' }));
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toBe('already_subscribed');
    });

    it('blocks with subscription_needs_recovery for an incomplete on-file subscription', async () => {
      await db.collection('users').doc('uid_checkout_1').set({ email: 'c1@example.test', subscriptionStatus: 'incomplete' });
      const result = await handler(postEvent({ tier: 'pro' }));
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toBe('subscription_needs_recovery');
    });

    it('a canceled on-file subscription does not block a fresh checkout', async () => {
      await db.collection('users').doc('uid_checkout_1').set({ email: 'c1@example.test', subscriptionStatus: 'canceled' });
      const result = await handler(postEvent({ tier: 'pro' }));
      expect(result.statusCode).toBe(200);
    });
  });
  },
);
