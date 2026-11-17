/* global process */
/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * Billing Phase 1b. After a checkout session finished — paid ('complete') or abandoned
 * ('expired') — the account's pendingCheckout claim stayed 'open' forever, so its next checkout
 * replayed the finished session instead of starting a new one. That broke the two journeys the
 * Free plan depends on: buying again after cancelling, and buying after abandoning a checkout.
 *
 * A finished claim is now closed and replaced by a fresh one. What must NOT change: an open
 * session is still reused, and a second subscription is still refused when one is live.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { FIRESTORE_EMULATOR_AVAILABLE, scenario } = vi.hoisted(() => ({
  FIRESTORE_EMULATOR_AVAILABLE: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  scenario: { verifyIdToken: null, stripeHandlers: {}, sessionCreates: [] },
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
        create: async (params, opts) => { scenario.sessionCreates.push({ params, opts }); return scenario.stripeHandlers.sessionsCreate(params, opts); },
        retrieve: (...a) => scenario.stripeHandlers.sessionsRetrieve(...a),
        list: (...a) => scenario.stripeHandlers.sessionsList(...a),
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

const UID = 'uid_finished_1';
const OLD_OP = 'op_old_1';
const OLD_SESSION = 'cs_old_1';

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'create-checkout-session: a finished claim is replaced, an open one is reused (run via: npm run test:billing-emulator)',
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

    const post = (body) => ({ httpMethod: 'POST', headers: { authorization: 'Bearer good-token', origin: 'https://idynify.com' }, body: JSON.stringify(body) });

    /** An account whose earlier checkout left an 'open' claim behind, as production does today. */
    async function seedFinishedEarlierCheckout(userFields = {}) {
      await db.collection('users').doc(UID).set({
        email: 'finished@example.test', stripeCustomerId: 'cus_1',
        pendingCheckout: { status: 'open', operationId: OLD_OP, sessionUrl: 'https://checkout.stripe.com/old', claimedAt: '2026-10-01T00:00:00.000Z' },
        ...userFields,
      });
      await db.collection('billingCheckoutOperations').doc(OLD_OP).set({
        uid: UID, tier: 'starter', priceId: 'price_starter', customerId: 'cus_1', sessionId: OLD_SESSION, subscriptionId: 'sub_old_1',
        successUrl: 'https://idynify.com/checkout/success', cancelUrl: 'https://idynify.com/checkout/cancel',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
    }

    beforeEach(async () => {
      await wipe();
      scenario.sessionCreates = [];
      scenario.verifyIdToken = async () => ({ uid: UID });
      scenario.stripeHandlers = {
        customersCreate: async () => { throw new Error('customers.create must not be called: the account has a customer'); },
        customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: UID } }),
        subscriptionsList: async () => ({ data: [{ id: 'sub_old_1', status: 'canceled' }], has_more: false }),
        sessionsCreate: async () => ({ id: 'cs_new_1', url: 'https://checkout.stripe.com/new' }),
        sessionsRetrieve: async () => ({ id: OLD_SESSION, status: 'complete', url: null }),
        sessionsList: async () => { throw new Error('sessions.list must not be called for a fresh claim'); },
      };
    });

    it('resubscribing after a cancellation: the completed claim is closed and a new session is created', async () => {
      await seedFinishedEarlierCheckout({ subscriptionStatus: 'canceled', hasCompletedPayment: false });

      const result = await handler(post({ tier: 'pro' }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).url).toBe('https://checkout.stripe.com/new');

      expect(scenario.sessionCreates).toHaveLength(1);
      const { params, opts } = scenario.sessionCreates[0];
      expect(params.customer).toBe('cus_1'); // the existing customer, never a second one
      expect(params.line_items).toEqual([{ price: 'price_pro', quantity: 1 }]);
      const newOp = params.metadata.checkoutOperationId;
      expect(newOp).not.toBe(OLD_OP);
      expect(opts.idempotencyKey).toBe(`checkout-session-${newOp}`);

      const user = (await db.collection('users').doc(UID).get()).data();
      expect(user.pendingCheckout.status).toBe('open');
      expect(user.pendingCheckout.operationId).toBe(newOp);
      // The earlier operation record is kept as it was, for provenance.
      expect((await db.collection('billingCheckoutOperations').doc(OLD_OP).get()).data().sessionId).toBe(OLD_SESSION);
    });

    it('after an abandoned (expired) checkout, a new session is created', async () => {
      await seedFinishedEarlierCheckout();
      scenario.stripeHandlers.sessionsRetrieve = async () => ({ id: OLD_SESSION, status: 'expired', url: null });
      scenario.stripeHandlers.subscriptionsList = async () => ({ data: [], has_more: false });

      const result = await handler(post({ tier: 'starter' }));
      expect(result.statusCode).toBe(200);
      expect(scenario.sessionCreates).toHaveLength(1);
      expect(scenario.sessionCreates[0].params.metadata.checkoutOperationId).not.toBe(OLD_OP);
    });

    it('a completed checkout whose subscription is still live: refused, no new session', async () => {
      // The webhook has not mirrored the new subscription yet, so the account looks unsubscribed.
      // Stripe's own list of the customer's subscriptions is what catches it.
      await seedFinishedEarlierCheckout();
      scenario.stripeHandlers.subscriptionsList = async () => ({ data: [{ id: 'sub_old_1', status: 'active' }], has_more: false });

      const result = await handler(post({ tier: 'starter' }));
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toBe('already_subscribed');
      expect(scenario.sessionCreates).toHaveLength(0);
    });

    it('a subscriber per the account mirror: refused before any claim is touched', async () => {
      await seedFinishedEarlierCheckout({ subscriptionStatus: 'active', hasCompletedPayment: true });

      const result = await handler(post({ tier: 'pro' }));
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toBe('already_subscribed');
      expect(scenario.sessionCreates).toHaveLength(0);
      expect((await db.collection('users').doc(UID).get()).data().pendingCheckout.operationId).toBe(OLD_OP);
    });

    it('an open session is still reused: same URL, nothing created, claim unchanged', async () => {
      await seedFinishedEarlierCheckout();
      scenario.stripeHandlers.sessionsRetrieve = async () => ({ id: OLD_SESSION, status: 'open', url: 'https://checkout.stripe.com/old' });

      const result = await handler(post({ tier: 'starter' }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).url).toBe('https://checkout.stripe.com/old');
      expect(scenario.sessionCreates).toHaveLength(0);
      expect((await db.collection('users').doc(UID).get()).data().pendingCheckout).toMatchObject({ status: 'open', operationId: OLD_OP });
    });

    it('a claim that is no longer the open one is not closed', async () => {
      await seedFinishedEarlierCheckout();
      const { __internal } = await import('../../netlify/functions/create-checkout-session.js');
      const userRef = db.collection('users').doc(UID);
      expect(await __internal.closeFinishedClaim(userRef, 'op_someone_else', 'complete')).toEqual({ fenced: true });
      expect((await userRef.get()).data().pendingCheckout).toMatchObject({ status: 'open', operationId: OLD_OP });
      expect(await __internal.closeFinishedClaim(userRef, OLD_OP, 'complete')).toEqual({ fenced: false });
      expect((await userRef.get()).data().pendingCheckout).toMatchObject({ status: 'completed', operationId: OLD_OP });
    });
  },
);
