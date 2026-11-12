/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file.
 *
 * Round-10 code review finding: `customerId`/`sessionId` on the operation record, and
 * `stripeCustomerId` on the user doc, were written with bare `.update()` calls right after a
 * successful Stripe call — no re-check that this invocation's claim (`operationId`) was still the
 * one the account was tracking. An obsolete worker — paused mid-flight against Stripe while a
 * newer claim took over the account — could still bind its stale result onto the account,
 * including `stripeCustomerId`, which had no ownership check of its own at all. Fixed with
 * `bindIfFenced`, which re-reads `pendingCheckout` in the same transaction as the write and
 * refuses to write anything if a different `operationId` is now current.
 *
 * Both tests pause a worker right after its Stripe call succeeds but before it binds the result,
 * swap in a newer claim out from under it, release it, and prove: the binding write never lands
 * (on either the operation record or the user doc), and the request is rejected rather than
 * silently succeeding with a stale result.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

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
    checkout = {
      sessions: {
        create: (...a) => scenario.stripeHandlers.sessionsCreate(...a),
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
  'create-checkout-session: customer/operation binding writes are fenced against an obsolete worker (run via: npm run test:billing-emulator)',
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
  }, 30000);

  // This emulator instance is shared across every test FILE in one `test:billing-emulator` run,
  // not just across the tests within this file. A doc this file leaves behind in
  // billingCheckoutOperations after its own last test would otherwise leak into whichever test
  // file runs next in the same process — several of them (e.g.
  // createCheckoutSessionUncertainOutcomeAndFencing.test.js) only wipe `users` in their own
  // beforeEach, trusting the collection to already be empty.
  afterAll(async () => {
    await wipe();
  }, 30000);

  /**
   * Waits for `conditionFn()` to become truthy, polling rather than sleeping a fixed amount — this
   * box runs under enough load that a fixed delay can elapse before the handler has actually
   * reached the gated Stripe call, letting the "steal" write land too early and silently resolve
   * a different (wrong) claim instead of exercising the fencing path this test is for.
   */
  async function waitUntil(conditionFn, { timeoutMs = 5000, intervalMs = 10 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (!conditionFn()) {
      if (Date.now() > deadline) throw new Error('waitUntil: condition never became true');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  it('customer-creation binding: an obsolete worker cannot stamp stripeCustomerId after a newer claim has taken over', async () => {
    scenario.verifyIdToken = async () => ({ uid: 'uid_bindfence_1' });
    const userRef = db.collection('users').doc('uid_bindfence_1');
    await userRef.set({ email: 'bindfence1@example.test', pendingCheckout: { status: 'creating', operationId: 'op_old' } });

    const opRef = db.collection('billingCheckoutOperations').doc('op_old');
    await opRef.set({
      uid: 'uid_bindfence_1', tier: 'starter', priceId: 'price_starter',
      successUrl: 'https://idynify.com/checkout/success', cancelUrl: 'https://idynify.com/checkout/cancel',
      createdAt: new Date().toISOString(), customerId: null, sessionId: null, subscriptionId: null,
    });

    let releaseCreate;
    let enteredCustomersCreate = false;
    const gate = new Promise((resolve) => { releaseCreate = resolve; });
    scenario.stripeHandlers = {
      customersCreate: async () => { enteredCustomersCreate = true; await gate; return { id: 'cus_from_obsolete_worker' }; },
      sessionsCreate: async () => { throw new Error('should not be reached — fenced out before session creation'); },
      subscriptionsList: async () => ({ data: [], has_more: false }),
    };

    const resultPromise = handler(postEvent({ tier: 'starter' })); // recovers op_old, calls customers.create, blocks on the gate
    await waitUntil(() => enteredCustomersCreate); // deterministic: the claim was resolved to op_old before we steal it

    // A newer, legitimate claim has since taken over the account — simulating what a fresh
    // request (after op_old was abandoned and recovered under a new operationId) would write.
    await userRef.set({
      pendingCheckout: { status: 'open', operationId: 'op_new', sessionUrl: 'https://checkout.stripe.com/op_new_session' },
    }, { merge: true });

    releaseCreate();
    const result = await resultPromise;

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('checkout_operation_superseded');

    const userDoc = await userRef.get();
    expect(userDoc.data().stripeCustomerId).toBeUndefined(); // never bound by the obsolete worker
    expect(userDoc.data().pendingCheckout.operationId).toBe('op_new'); // the live claim is untouched

    const opDoc = await opRef.get();
    expect(opDoc.data().customerId).toBeNull(); // op_old's own record was never bound either
  }, 15000);

  it('session-creation binding: an obsolete worker cannot bind a sessionId after a newer claim has taken over', async () => {
    scenario.verifyIdToken = async () => ({ uid: 'uid_bindfence_2' });
    const userRef = db.collection('users').doc('uid_bindfence_2');
    await userRef.set({
      email: 'bindfence2@example.test', stripeCustomerId: 'cus_known_2',
      pendingCheckout: { status: 'creating', operationId: 'op_old_2' },
    });

    const opRef = db.collection('billingCheckoutOperations').doc('op_old_2');
    await opRef.set({
      uid: 'uid_bindfence_2', tier: 'starter', priceId: 'price_starter',
      successUrl: 'https://idynify.com/checkout/success', cancelUrl: 'https://idynify.com/checkout/cancel',
      createdAt: new Date().toISOString(), customerId: 'cus_known_2', sessionId: null, subscriptionId: null,
    });

    let releaseCreate;
    let enteredSessionsCreate = false;
    const gate = new Promise((resolve) => { releaseCreate = resolve; });
    scenario.stripeHandlers = {
      customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_bindfence_2' } }),
      subscriptionsList: async () => ({ data: [], has_more: false }),
      sessionsCreate: async () => { enteredSessionsCreate = true; await gate; return { id: 'cs_from_obsolete_worker', url: 'https://checkout.stripe.com/obsolete' }; },
    };

    const resultPromise = handler(postEvent({ tier: 'starter' })); // customerId already known, proceeds straight to session creation
    await waitUntil(() => enteredSessionsCreate); // deterministic: the claim was resolved to op_old_2 before we steal it

    await userRef.set({
      pendingCheckout: { status: 'open', operationId: 'op_new_2', sessionUrl: 'https://checkout.stripe.com/op_new_2_session' },
    }, { merge: true });

    releaseCreate();
    const result = await resultPromise;

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('checkout_operation_superseded');

    const opDoc = await opRef.get();
    expect(opDoc.data().sessionId).toBeNull(); // never bound by the obsolete worker

    const userDoc = await userRef.get();
    expect(userDoc.data().pendingCheckout.operationId).toBe('op_new_2');
    expect(userDoc.data().pendingCheckout.sessionUrl).toBe('https://checkout.stripe.com/op_new_2_session'); // untouched
  }, 15000);
  },
);
