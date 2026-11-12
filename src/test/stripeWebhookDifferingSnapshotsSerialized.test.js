/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file.
 *
 * Round-9 code review finding 4: subscriptions.retrieve happened before tx.get(userRef), so
 * worker A could fetch an OLDER snapshot, pause, then read the user doc AFTER worker B had
 * already committed a NEWER one — and overwrite it, with no Firestore conflict to stop it,
 * because Firestore's own optimistic concurrency only protects against conflicting FIRESTORE
 * writes between a transaction's own read and commit; it has no visibility into staleness of the
 * EXTERNAL Stripe data a decision is based on. The previous concurrency test gave both workers
 * IDENTICAL Stripe state, which cannot exercise this at all. This file does two things:
 *
 *   1. Proves the account-lock primitive itself enforces mutual exclusion, deterministically,
 *      with no webhook machinery involved.
 *   2. Drives the real handler with two DIFFERENT, deliberately-ordered snapshots and a
 *      controlled gate, proving a worker holding the lock while slow cannot be overtaken by a
 *      second worker for the same account, and the account converges on the correct state.
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
  'stripe-webhook: differing Stripe snapshots are serialized, not raced (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, fakeHttpEvent, handler, acquireAccountLock;

  beforeAll(async () => {
    ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
    const mod = await import('../../netlify/functions/stripe-webhook.js');
    handler = mod.handler;
    acquireAccountLock = mod.__internal.acquireAccountLock;
  });

  beforeEach(async () => {
    await wipeBillingCollections();
    scenario.handlers = { customersRetrieve: async (id) => ({ id, metadata: {} }) };
  });

  it('acquireAccountLock enforces mutual exclusion directly — a second caller cannot acquire a fresh lock', async () => {
    await db.collection('users').doc('uid_lock_1').set({ email: 'lock1@example.test' });

    const firstOperationId = await acquireAccountLock('uid_lock_1');
    expect(firstOperationId).toBeTruthy();

    // A second caller, immediately after, must NOT be able to acquire — the lock is fresh.
    const secondOperationId = await acquireAccountLock('uid_lock_1');
    expect(secondOperationId).toBeNull();

    const doc = await db.collection('users').doc('uid_lock_1').get();
    expect(doc.data().billingLock.operationId).toBe(firstOperationId); // unchanged by the failed second attempt
  }, 15000);

  it('a slow worker holding the lock cannot be overtaken — the account converges on the correct, later state', async () => {
    await db.collection('users').doc('uid_race_diff').set({
      email: 'racediff@example.test', stripeCustomerId: 'cus_diff', stripeSubscriptionId: 'sub_diff',
      subscriptionStatus: 'active',
    });

    let releaseWorkerA;
    const workerAGate = new Promise((resolve) => { releaseWorkerA = resolve; });
    let fetchCount = 0;

    // Worker A's fetch deliberately returns an OLDER snapshot and blocks on the gate before
    // resolving — simulating "fetched old state, then paused" for exactly as long as the test
    // needs to prove worker B cannot make progress in the meantime.
    scenario.handlers.subscriptionsRetrieve = async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await workerAGate;
        return {
          id: 'sub_diff', customer: 'cus_diff', status: 'past_due', created: 2000000000, // OLDER/stale decision
          current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_race_diff' },
        };
      }
      return {
        id: 'sub_diff', customer: 'cus_diff', status: 'active', created: 2000000000, // NEWER/current truth
        current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_starter' } }] }, metadata: { firebaseUID: 'uid_race_diff' },
      };
    };

    const eventA = {
      id: 'evt_diff_a', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_diff', customer: 'cus_diff', status: 'past_due', created: 2000000000, metadata: { firebaseUID: 'uid_race_diff' } } },
    };
    const eventB = {
      id: 'evt_diff_b', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_diff', customer: 'cus_diff', status: 'active', created: 2000000000, metadata: { firebaseUID: 'uid_race_diff' } } },
    };

    const workerAPromise = handler(fakeHttpEvent(eventA)); // starts, acquires the lock, blocks mid-fetch
    await new Promise((r) => setTimeout(r, 100)); // let A actually acquire the lock and reach the gate

    const lockAfterAStarted = await db.collection('users').doc('uid_race_diff').get();
    expect(lockAfterAStarted.data().billingLock).toBeTruthy(); // A is holding it

    const workerBPromise = handler(fakeHttpEvent(eventB)); // attempts concurrently — must wait on A's lock
    await new Promise((r) => setTimeout(r, 100)); // give B a chance to try-and-fail to acquire while A holds it

    const stillUnresolved = await db.collection('stripeWebhookEvents').doc('evt_diff_b').get();
    expect(stillUnresolved.exists).toBe(false); // B has made no progress while A holds the lock

    releaseWorkerA(); // let A finish: decide on its (old) snapshot and commit, releasing the lock
    const [resultA, resultB] = await Promise.all([workerAPromise, workerBPromise]);
    expect(resultA.statusCode).toBe(200);
    expect(resultB.statusCode).toBe(200); // B then acquires and completes with ITS OWN fresh fetch

    // The account converges on 'active' — B's event, processed after A released the lock, is not
    // overwritten by A's stale 'past_due' decision landing late. Both events are genuinely
    // distinct and both get marked applied; the final state is never corrupted into something
    // neither fetch actually returned.
    const finalDoc = await db.collection('users').doc('uid_race_diff').get();
    expect(finalDoc.data().subscriptionStatus).toBe('active');
    expect(finalDoc.data().billingLock).toBeNull();
  }, 15000);
  },
);
