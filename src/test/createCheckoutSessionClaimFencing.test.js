/**
 * Runs against a REAL Firestore emulator with real transactions — concurrent checkout requests
 * for the same uid must not create two Stripe customers or two Stripe sessions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scenario = vi.hoisted(() => ({ verifyIdToken: null, stripeHandlers: {}, customerCreateCalls: 0, sessionCreateCalls: 0 }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = {
      create: async (...a) => { scenario.customerCreateCalls++; return scenario.stripeHandlers.customersCreate(...a); },
      retrieve: (...a) => scenario.stripeHandlers.customersRetrieve(...a),
    };
    subscriptions = { list: (...a) => scenario.stripeHandlers.subscriptionsList(...a) };
    checkout = {
      sessions: {
        create: async (...a) => { scenario.sessionCreateCalls++; return scenario.stripeHandlers.sessionsCreate(...a); },
        retrieve: (...a) => scenario.stripeHandlers.sessionsRetrieve(...a),
      },
    };
  }
  return { default: FakeStripe };
});

process.env.FIREBASE_PROJECT_ID ||= 'demo-billing-tests';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake';
process.env.STRIPE_PRICE_STARTER ||= 'price_starter';
process.env.STRIPE_PRICE_PRO ||= 'price_pro';

vi.mock('../../netlify/functions/firebase-admin.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, admin: { auth: () => ({ verifyIdToken: (...a) => scenario.verifyIdToken(...a) }) } };
});

const { db } = await import('../../netlify/functions/firebase-admin.js');
const { handler } = await import('../../netlify/functions/create-checkout-session.js');

async function wipe() {
  for (const coll of ['users', 'billingCheckoutOperations']) {
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
  scenario.sessionCreateCalls = 0;
  scenario.verifyIdToken = async () => ({ uid: 'uid_fence_1' });
  scenario.stripeHandlers = {
    customersCreate: async () => ({ id: 'cus_fence_1', metadata: { firebaseUID: 'uid_fence_1' } }),
    customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_fence_1' } }),
    subscriptionsList: async () => ({ data: [], has_more: false }),
    sessionsCreate: async () => ({ id: 'cs_fence_1', url: 'https://checkout.stripe.com/cs_fence_1' }),
    sessionsRetrieve: async (id) => ({ id, status: 'open', url: 'https://checkout.stripe.com/cs_fence_1' }),
  };
  await db.collection('users').doc('uid_fence_1').set({ email: 'fence@example.test' });
});

describe('create-checkout-session: concurrent claims never create duplicate Stripe objects', () => {
  it('two concurrent requests for the same uid create exactly one customer and one session', async () => {
    const [r1, r2] = await Promise.all([handler(postEvent({ tier: 'starter' })), handler(postEvent({ tier: 'starter' }))]);

    const statuses = [r1.statusCode, r2.statusCode];
    expect(statuses.every((s) => [200, 425].includes(s))).toBe(true); // success or "retry shortly", never a silent duplicate

    expect(scenario.customerCreateCalls).toBeLessThanOrEqual(1);
    expect(scenario.sessionCreateCalls).toBeLessThanOrEqual(1);

    const opsSnap = await db.collection('billingCheckoutOperations').get();
    expect(opsSnap.docs).toHaveLength(1); // exactly one operation record, not two
  });

  it('a second request after the first fully completes reuses the open session, not a new one', async () => {
    const r1 = await handler(postEvent({ tier: 'starter' }));
    expect(r1.statusCode).toBe(200);
    const url1 = JSON.parse(r1.body).url;

    const r2 = await handler(postEvent({ tier: 'starter' }));
    expect(r2.statusCode).toBe(200);
    const url2 = JSON.parse(r2.body).url;

    expect(url2).toBe(url1);
    expect(scenario.sessionCreateCalls).toBe(1); // not called again
  });
});
