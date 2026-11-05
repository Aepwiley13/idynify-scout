/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file.
 *
 * Round-9 code review finding 3: pendingCheckout writes for completion/failure weren't fenced on
 * operationId, so an old invocation could clobber or clear a newer claim; and an UNCERTAIN
 * creation outcome (expired idempotency window, nothing found on exact-match recovery) was
 * marked 'failed', which the claim-acquisition logic treats the same as "no claim at all" — so
 * the very next request could mint a fresh operation and risk duplicating Stripe objects
 * alongside one that might already exist from the stuck attempt. Fixed with a distinct
 * 'needs_reconciliation' terminal state that blocks fresh claims permanently (until a human
 * clears it), and a fenced write helper used for every pendingCheckout transition.
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
  'create-checkout-session: uncertain outcomes stay blocked, claims are fenced (run via: npm run test:billing-emulator)',
  () => {
  let db, handler, setPendingCheckoutIfFenced;

  beforeAll(async () => {
    ({ db } = await import('../../netlify/functions/firebase-admin.js'));
    const mod = await import('../../netlify/functions/create-checkout-session.js');
    handler = mod.handler;
    setPendingCheckoutIfFenced = mod.__internal.setPendingCheckoutIfFenced;
  });

  async function wipe() {
    const snap = await db.collection('users').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }

  function postEvent(body) {
    return { httpMethod: 'POST', headers: { authorization: 'Bearer good-token', origin: 'https://idynify.com' }, body: JSON.stringify(body) };
  }

  beforeEach(async () => {
    await wipe();
    scenario.verifyIdToken = async () => ({ uid: 'uid_uncertain_1' });
    scenario.stripeHandlers = {
      customersCreate: async () => { throw new Error('should not be called once blocked'); },
      sessionsCreate: async () => { throw new Error('should not be called once blocked'); },
    };
  });

  it('a repeated request after an uncertain outcome stays blocked — never mints a fresh operation', async () => {
    const userRef = db.collection('users').doc('uid_uncertain_1');
    await userRef.set({
      email: 'u1@example.test',
      pendingCheckout: { status: 'needs_reconciliation', operationId: 'op_stuck_1' },
    });

    const result1 = await handler(postEvent({ tier: 'starter' }));
    expect(result1.statusCode).toBe(409);
    expect(JSON.parse(result1.body).error).toBe('checkout_needs_manual_reconciliation');

    const result2 = await handler(postEvent({ tier: 'starter' })); // repeated
    expect(result2.statusCode).toBe(409);
    expect(JSON.parse(result2.body).error).toBe('checkout_needs_manual_reconciliation');

    const opsSnap = await db.collection('billingCheckoutOperations').get();
    expect(opsSnap.docs).toHaveLength(0); // no fresh operation was ever minted

    const doc = await userRef.get();
    expect(doc.data().pendingCheckout.operationId).toBe('op_stuck_1'); // untouched
  });

  it('an old invocation can never overwrite a newer claim — fenced on operationId', async () => {
    const userRef = db.collection('users').doc('uid_uncertain_2');
    // Simulate: operation A was claimed, then abandoned; a genuinely new attempt established
    // operation B and completed it successfully — all of this happened for real (this is what
    // the claim-acquisition transaction and a subsequent successful completion actually write),
    // independent of A's own (now-stale) invocation, which is about to try to finish late.
    await userRef.set({
      email: 'u2@example.test',
      pendingCheckout: { status: 'open', operationId: 'op_B', sessionUrl: 'https://checkout.stripe.com/op_B_session' },
    });

    // Now A's stale invocation finally finishes its own (outdated) work and tries to complete.
    const rStaleA = await setPendingCheckoutIfFenced(userRef, 'op_A', {
      status: 'open', operationId: 'op_A', sessionUrl: 'https://checkout.stripe.com/op_A_session',
    });
    expect(rStaleA.fenced).toBe(true); // discarded — op_A is no longer the current claim

    const doc = await userRef.get();
    expect(doc.data().pendingCheckout.operationId).toBe('op_B'); // B's claim survives, untouched by A
    expect(doc.data().pendingCheckout.sessionUrl).toBe('https://checkout.stripe.com/op_B_session');
  });

  it('an old invocation attempting to CLEAR a newer claim (mark it failed) is also fenced out', async () => {
    const userRef = db.collection('users').doc('uid_uncertain_3');
    // op_old was abandoned; a genuinely new claim op_new has since been established (simulating
    // what the claim-acquisition transaction's "recover" path, or a fresh attempt, would write).
    await userRef.set({ email: 'u3@example.test', pendingCheckout: { status: 'creating', operationId: 'op_new' } });

    const rStaleRelease = await setPendingCheckoutIfFenced(userRef, 'op_old', { status: 'failed', operationId: 'op_old' });
    expect(rStaleRelease.fenced).toBe(true);

    const doc = await userRef.get();
    expect(doc.data().pendingCheckout.operationId).toBe('op_new'); // not cleared by the stale worker
    expect(doc.data().pendingCheckout.status).toBe('creating');
  });
  },
);
