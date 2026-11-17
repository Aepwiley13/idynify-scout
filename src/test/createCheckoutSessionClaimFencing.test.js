/* global process */
/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file's tests (the firebase-admin.js mock below avoids initializing
 * the real Admin SDK when no emulator is present). Concurrent checkout requests for the same uid
 * must not create two Stripe customers or two Stripe sessions.
 *
 * WHAT COUNTS AS A DUPLICATE. Stripe deduplicates by idempotency key: a repeated create with the
 * same key returns the object the first one created (or, while the first is still in flight, an
 * idempotency error the handler turns into 425). The handler can legitimately call create twice
 * for one claim: the second request finds the claim 'creating' and recovers it with the SAME
 * operationId, so the SAME key. Counting calls therefore failed about one run in ten in CI
 * (2 calls, 1 key, 1 operation record — measured over 60 emulator runs) while no second Stripe
 * object could exist. The fake below now behaves like Stripe on keys, and the test counts what
 * Stripe would actually create: one object per distinct key. A real duplicate — two claims, two
 * operationIds, two keys — still fails it. The scenario runs many times, so a race that only
 * shows up occasionally is caught here rather than by luck.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { FIRESTORE_EMULATOR_AVAILABLE, scenario } = vi.hoisted(() => ({
  FIRESTORE_EMULATOR_AVAILABLE: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  scenario: {
    verifyIdToken: null, stripeHandlers: {},
    customerCreateCalls: 0, sessionCreateCalls: 0,
    // What a real Stripe account would hold: one object per distinct idempotency key.
    customerKeys: new Set(), sessionKeys: new Set(),
    idempotent: new Map(), // key -> the object (or the in-flight promise) Stripe would return
  },
}));

/**
 * Stripe's idempotency, as the handler relies on it: the first create with a key makes the object;
 * a repeat with the same key gets that same object back, or — while the first is still in flight —
 * a StripeIdempotencyError (Stripe answers 409; the handler maps it to 425).
 */
async function idempotentCreate(kind, opts, make) {
  const key = opts?.idempotencyKey;
  if (!key) throw new Error(`${kind}.create called without an idempotency key`);
  scenario[kind === 'customers' ? 'customerKeys' : 'sessionKeys'].add(key);
  const known = scenario.idempotent.get(key);
  if (known?.inFlight) {
    const err = new Error('Keys for idempotent requests can only be used with the same parameters they were first used with, and only once the first request has completed.');
    err.type = 'StripeIdempotencyError';
    throw err;
  }
  if (known) return known.value;
  scenario.idempotent.set(key, { inFlight: true });
  await new Promise((r) => setTimeout(r, Math.random() * 15)); // a real request takes time
  const value = await make();
  scenario.idempotent.set(key, { inFlight: false, value });
  return value;
}

vi.mock('stripe', () => {
  class FakeStripe {
    customers = {
      create: async (params, opts) => { scenario.customerCreateCalls++; return idempotentCreate('customers', opts, () => scenario.stripeHandlers.customersCreate(params)); },
      retrieve: (...a) => scenario.stripeHandlers.customersRetrieve(...a),
    };
    subscriptions = { list: (...a) => scenario.stripeHandlers.subscriptionsList(...a) };
    checkout = {
      sessions: {
        create: async (params, opts) => { scenario.sessionCreateCalls++; return idempotentCreate('sessions', opts, () => scenario.stripeHandlers.sessionsCreate(params)); },
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
  const fakeAdmin = { auth: () => ({ verifyIdToken: (...a) => scenario.verifyIdToken(...a) }) };
  if (!FIRESTORE_EMULATOR_AVAILABLE) return { admin: fakeAdmin, db: null };
  const actual = await importOriginal();
  return { ...actual, admin: fakeAdmin };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'create-checkout-session: concurrent claims never create duplicate Stripe objects (run via: npm run test:billing-emulator)',
  () => {
  let db, handler;

  beforeAll(async () => {
    ({ db } = await import('../../netlify/functions/firebase-admin.js'));
    ({ handler } = await import('../../netlify/functions/create-checkout-session.js'));
  });

  async function wipe() {
    for (const coll of ['users', 'billingCheckoutOperations']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  }

  function postEvent(body) {
    return { httpMethod: 'POST', headers: { authorization: 'Bearer good-token', origin: 'https://idynify.com' }, body: JSON.stringify(body) };
  }

  async function reset() {
    await wipe();
    scenario.customerCreateCalls = 0;
    scenario.sessionCreateCalls = 0;
    scenario.customerKeys = new Set();
    scenario.sessionKeys = new Set();
    scenario.idempotent = new Map();
    scenario.verifyIdToken = async () => ({ uid: 'uid_fence_1' });
    scenario.stripeHandlers = {
      customersCreate: async () => ({ id: 'cus_fence_1', metadata: { firebaseUID: 'uid_fence_1' } }),
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_fence_1' } }),
      subscriptionsList: async () => ({ data: [], has_more: false }),
      sessionsCreate: async () => ({ id: 'cs_fence_1', url: 'https://checkout.stripe.com/cs_fence_1' }),
      sessionsRetrieve: async (id) => ({ id, status: 'open', url: 'https://checkout.stripe.com/cs_fence_1' }),
    };
    await db.collection('users').doc('uid_fence_1').set({ email: 'fence@example.test' });
  }

  beforeEach(reset);

  const ROUNDS = 5;

  it(`two concurrent requests for the same uid create exactly one customer and one session (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await reset();
      const [r1, r2] = await Promise.all([handler(postEvent({ tier: 'starter' })), handler(postEvent({ tier: 'starter' }))]);

      const statuses = [r1.statusCode, r2.statusCode];
      expect(statuses.every((s) => [200, 425].includes(s)), `round ${round}: ${statuses}`).toBe(true); // success or "retry shortly", never a silent duplicate

      // What Stripe would hold: one customer and one session, however many calls carried their key.
      expect(scenario.customerKeys.size, `round ${round}: distinct customer keys`).toBe(1);
      expect(scenario.sessionKeys.size, `round ${round}: distinct session keys`).toBeLessThanOrEqual(1);

      const opsSnap = await db.collection('billingCheckoutOperations').get();
      expect(opsSnap.docs, `round ${round}: operation records`).toHaveLength(1); // exactly one operation record, not two
      const [op] = opsSnap.docs;
      expect([...scenario.customerKeys], `round ${round}`).toEqual([`cust-create-${op.id}`]); // the key belongs to that one operation

      const user = (await db.collection('users').doc('uid_fence_1').get()).data();
      expect(user.stripeCustomerId, `round ${round}`).toBe('cus_fence_1');
    }
  }, 120000);

  it('a request that arrives while the first is creating the customer reuses that operation: one key, one customer', async () => {
    // The interleaving the random rounds above only hit now and then (about one CI run in ten):
    // the second request reads the claim while it is still 'creating'. Held open here, every time.
    let release;
    const gate = new Promise((r) => { release = r; });
    let entered;
    const insideCreate = new Promise((r) => { entered = r; });
    scenario.stripeHandlers.customersCreate = async () => { entered(); await gate; return { id: 'cus_fence_1', metadata: { firebaseUID: 'uid_fence_1' } }; };

    const first = handler(postEvent({ tier: 'starter' }));
    await insideCreate; // the first request's claim is committed as 'creating' and its create is in flight
    const second = await handler(postEvent({ tier: 'starter' }));
    release();
    const firstResult = await first;

    expect(firstResult.statusCode).toBe(200);
    expect(second.statusCode).toBe(425); // "checkout in progress": Stripe refused the repeated key while in flight
    expect(scenario.customerCreateCalls).toBe(2); // two calls…
    expect(scenario.customerKeys.size).toBe(1); // …one key, so one Stripe customer
    expect(scenario.sessionKeys.size).toBe(1);
    const opsSnap = await db.collection('billingCheckoutOperations').get();
    expect(opsSnap.docs).toHaveLength(1);
    expect([...scenario.customerKeys]).toEqual([`cust-create-${opsSnap.docs[0].id}`]);
  });

  it('two different operations would be two Stripe objects, and the fake counts them as two', async () => {
    // Guards the guard: if the handler ever minted a second operation (a second key), the
    // distinct-key count above would see it.
    await idempotentCreate('customers', { idempotencyKey: 'cust-create-a' }, async () => ({ id: 'cus_a' }));
    await idempotentCreate('customers', { idempotencyKey: 'cust-create-b' }, async () => ({ id: 'cus_b' }));
    expect(scenario.customerKeys.size).toBe(2);
    const again = await idempotentCreate('customers', { idempotencyKey: 'cust-create-a' }, async () => ({ id: 'cus_never' }));
    expect(again.id).toBe('cus_a'); // a repeated key returns the first object, as Stripe does
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
  },
);
