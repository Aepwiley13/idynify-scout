/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file.
 *
 * Round-10 code review finding: when a worker's billingLock was found to have been stolen (stale,
 * taken by another worker) at the start of its final commit transaction, both
 * handleCheckoutCompleted and applySubscriptionLifecycleEvent simply `return`ed out of the
 * transaction with no writes — the transaction committed empty, the event was never marked
 * applied, and the handler still fell through to `ok()` (HTTP 200). Stripe reads 200 as "delivered
 * successfully" and never redelivers, so the event was silently and permanently dropped. Fixed by
 * throwing RetryableWebhookError in that branch instead, which the existing outer catch turns into
 * a 500 — Stripe redelivers, and a later attempt gets a real chance to hold the lock.
 *
 * Both tests pause a worker mid-flight (after it has acquired the lock, before it reads the lock
 * back inside its commit transaction) via a controlled gate, steal the lock out from under it by
 * writing a different operationId directly, then release the gate and prove: the response is
 * retryable (not 200), the event is never marked applied, and the stolen lock is left untouched.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = { retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a) };
    checkout = { sessions: { listLineItems: (...a) => scenario.handlers.listLineItems?.(...a) } };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: losing the account lock before commit is retryable, never a silent 200 (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    scenario.handlers = { customersRetrieve: async (id) => ({ id, metadata: {} }) };
  });

  /**
   * Polls rather than sleeping a fixed amount — this box runs under enough load that a fixed
   * delay can elapse before the worker has actually entered the gated Stripe call (and therefore
   * before it has acquired the lock), letting the "steal" write race ahead of the lock-acquire
   * instead of landing cleanly after it.
   */
  async function waitUntil(conditionFn, { timeoutMs = 5000, intervalMs = 10 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (!conditionFn()) {
      if (Date.now() > deadline) throw new Error('waitUntil: condition never became true');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  it('customer.subscription.updated: a stolen lock makes the handler retryable, not 200, and the event is never marked applied', async () => {
    await db.collection('users').doc('uid_lockloss_sub').set({
      email: 'lockloss-sub@example.test', stripeCustomerId: 'cus_lockloss_sub', stripeSubscriptionId: 'sub_lockloss',
      subscriptionStatus: 'active',
    });

    let releaseWorker;
    let enteredGate = false;
    const gate = new Promise((resolve) => { releaseWorker = resolve; });
    scenario.handlers.subscriptionsRetrieve = async () => {
      enteredGate = true;
      await gate;
      return {
        id: 'sub_lockloss', customer: 'cus_lockloss_sub', status: 'past_due', created: 2000000000,
        current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_lockloss_sub' },
      };
    };

    const event = {
      id: 'evt_lockloss_sub', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_lockloss', customer: 'cus_lockloss_sub', status: 'past_due', created: 2000000000, metadata: { firebaseUID: 'uid_lockloss_sub' } } },
    };

    const workerPromise = handler(fakeHttpEvent(event)); // acquires the lock, then blocks on the gate
    await waitUntil(() => enteredGate); // deterministic: the lock is held by the time we steal it

    const userRef = db.collection('users').doc('uid_lockloss_sub');
    const midFlight = await userRef.get();
    expect(midFlight.data().billingLock).toBeTruthy(); // this worker is holding it

    // Simulate a legitimate steal: the lock went stale (>60s) and a different real worker took
    // over — represented here by directly writing a different operationId, exactly what this
    // worker will observe when it finally re-reads the lock inside its own commit transaction.
    await userRef.set({ billingLock: { operationId: 'op_other_worker', acquiredAt: new Date().toISOString() } }, { merge: true });

    releaseWorker();
    const result = await workerPromise;

    expect(result.statusCode).not.toBe(200); // retryable, not a silent success
    expect(result.statusCode).toBe(500);

    const eventDoc = await db.collection('stripeWebhookEvents').doc('evt_lockloss_sub').get();
    expect(eventDoc.exists).toBe(false); // never marked applied — Stripe will redeliver

    const finalDoc = await userRef.get();
    expect(finalDoc.data().billingLock.operationId).toBe('op_other_worker'); // untouched by the stale worker
    expect(finalDoc.data().subscriptionStatus).toBe('active'); // the stale worker's own decision never landed
  }, 15000);

  it('checkout.session.completed: a stolen lock makes the handler retryable, not 200, and the event is never marked applied', async () => {
    await db.collection('users').doc('uid_lockloss_checkout').set({
      email: 'lockloss-checkout@example.test',
    });
    scenario.handlers.customersRetrieve = async (id) => ({ id, metadata: { firebaseUID: 'uid_lockloss_checkout' } });
    scenario.handlers.listLineItems = async () => ({ data: [{ price: { id: 'price_starter' } }] });

    let releaseWorker;
    let enteredGate = false;
    const gate = new Promise((resolve) => { releaseWorker = resolve; });
    scenario.handlers.subscriptionsRetrieve = async () => {
      enteredGate = true;
      await gate;
      return {
        id: 'sub_lockloss_checkout', customer: 'cus_lockloss_checkout', status: 'active', created: 2000000000,
        current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
      };
    };

    const event = {
      id: 'evt_lockloss_checkout', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_lockloss', customer: 'cus_lockloss_checkout', subscription: 'sub_lockloss_checkout', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid_lockloss_checkout', metadata: {},
        },
      },
    };

    const workerPromise = handler(fakeHttpEvent(event));
    await waitUntil(() => enteredGate); // deterministic: the lock is held by the time we steal it

    const userRef = db.collection('users').doc('uid_lockloss_checkout');
    const midFlight = await userRef.get();
    expect(midFlight.data().billingLock).toBeTruthy();

    await userRef.set({ billingLock: { operationId: 'op_other_worker_2', acquiredAt: new Date().toISOString() } }, { merge: true });

    releaseWorker();
    const result = await workerPromise;

    expect(result.statusCode).not.toBe(200);
    expect(result.statusCode).toBe(500);

    const eventDoc = await db.collection('stripeWebhookEvents').doc('evt_lockloss_checkout').get();
    expect(eventDoc.exists).toBe(false);

    const finalDoc = await userRef.get();
    expect(finalDoc.data().billingLock.operationId).toBe('op_other_worker_2');
    expect(finalDoc.data().hasCompletedPayment).toBeUndefined(); // the stale worker never granted anything
  }, 15000);
  },
);
