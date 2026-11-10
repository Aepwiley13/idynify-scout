/**
 * Runs against a REAL Firestore emulator with real transactions — `npm run test:billing-emulator`.
 * Plain `npm test` skips this file.
 *
 * scripts/manualCreditRecovery.mjs is the only path allowed to grant credits for a purchase the
 * automated webhook refused to (pre-epoch, epoch-unset, or a rollback-window purchase). These
 * tests prove the two properties that actually prevent a duplicate grant — not a reconciliation
 * report, which is visibility only, never a guard:
 *
 *   1. Transactional: the idempotency check (does billingAllocations/{subscriptionId} already
 *      exist) and the grant write happen in ONE Firestore transaction, not a separate
 *      check-then-act with a race window.
 *   2. Idempotent: running it twice for the same subscriptionId grants credits at most once —
 *      the second call is a clean, typed no-op (AlreadyGrantedError), not a silent double-write
 *      and not a crash.
 *
 * Also proves it refuses to run at all without purchase-specific evidence (never infers prior
 * grants from current balance alone), and that resolving the matching billingAmbiguousAccounts
 * record happens in the SAME commit as the grant.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'manualCreditRecovery: transactional, idempotent, evidence-required (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, applyManualRecovery, AlreadyGrantedError, UsageError, parseArgs;

  beforeAll(async () => {
    ({ db, wipeBillingCollections } = await import('./helpers/billingTestUtils.js'));
    ({ applyManualRecovery, AlreadyGrantedError, UsageError, parseArgs } = await import('../../scripts/manualCreditRecovery.mjs'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
  });

  it('grants credits, writes billingAllocations, and resolves the ambiguous-account record in one commit', async () => {
    await db.collection('users').doc('uid_recover_1').set({ email: 'recover1@example.test' });
    const ambigRef = await db.collection('billingAmbiguousAccounts').add({
      uid: 'uid_recover_1', reason: 'epoch_unset', status: 'pending', flaggedAt: new Date().toISOString(),
      details: { sessionId: 'cs_recover_1', subscriptionId: 'sub_recover_1' },
    });

    const result = await applyManualRecovery(db, {
      uid: 'uid_recover_1', subscriptionId: 'sub_recover_1', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_recover_1', evidenceNote: 'Confirmed paid invoice in Stripe, paymentCompletedAt correlates, no prior billingAllocations marker.',
      ambiguousAccountDocId: ambigRef.id, operator: 'aaron',
    });
    expect(result.applied).toBe(true);

    const userDoc = await db.collection('users').doc('uid_recover_1').get();
    expect(userDoc.data().hasCompletedPayment).toBe(true);
    expect(userDoc.data().credits.remaining).toBe(400);

    const allocDoc = await db.collection('billingAllocations').doc('sub_recover_1').get();
    expect(allocDoc.exists).toBe(true);
    expect(allocDoc.data().recoveredManually).toBe(true);
    expect(allocDoc.data().evidence.stripeSessionId).toBe('cs_recover_1');
    expect(allocDoc.data().evidence.note).toMatch(/Confirmed paid invoice/);

    const ambigDoc = await ambigRef.get();
    expect(ambigDoc.data().status).toBe('resolved');
    expect(ambigDoc.data().resolvedBy).toBe('aaron');
  });

  it('is idempotent: a second run for the same subscriptionId is a clean no-op, not a double grant', async () => {
    await db.collection('users').doc('uid_recover_2').set({ email: 'recover2@example.test' });
    const args = {
      uid: 'uid_recover_2', subscriptionId: 'sub_recover_2', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_recover_2', evidenceNote: 'Verified against Stripe invoice.',
    };

    const first = await applyManualRecovery(db, args);
    expect(first.applied).toBe(true);

    await expect(applyManualRecovery(db, args)).rejects.toThrow(AlreadyGrantedError);

    // Exactly one grant landed, not two.
    const userDoc = await db.collection('users').doc('uid_recover_2').get();
    expect(userDoc.data().credits.remaining).toBe(400); // not 800
  });

  it('is safe even if two recovery attempts race concurrently for the same subscriptionId', async () => {
    await db.collection('users').doc('uid_recover_3').set({ email: 'recover3@example.test' });
    const args = {
      uid: 'uid_recover_3', subscriptionId: 'sub_recover_3', priceId: 'price_pro',
      evidenceStripeSessionId: 'cs_recover_3', evidenceNote: 'Verified against Stripe invoice.',
    };

    const results = await Promise.allSettled([
      applyManualRecovery(db, args),
      applyManualRecovery(db, args),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1); // exactly one of the two actually granted
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AlreadyGrantedError);

    const userDoc = await db.collection('users').doc('uid_recover_3').get();
    expect(userDoc.data().credits.remaining).toBe(1250); // pro tier, granted exactly once
  });

  it('refuses to run without purchase-specific evidence — never infers a grant from current balance alone', () => {
    expect(() => parseArgs(['--uid', 'uid_x', '--subscription-id', 'sub_x', '--price-id', 'price_starter']))
      .toThrow(UsageError);
    // Missing both evidence fields — the error names them, not a generic "bad args" message.
    try {
      parseArgs(['--uid', 'uid_x', '--subscription-id', 'sub_x', '--price-id', 'price_starter']);
    } catch (err) {
      expect(err.message).toMatch(/evidenceStripeSessionId/);
      expect(err.message).toMatch(/evidenceNote/);
    }
  });

  it('a --dry-run reports what it would write without writing anything', async () => {
    await db.collection('users').doc('uid_recover_4').set({ email: 'recover4@example.test' });
    const result = await applyManualRecovery(db, {
      uid: 'uid_recover_4', subscriptionId: 'sub_recover_4', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_recover_4', evidenceNote: 'test', dryRun: true,
    });
    expect(result.applied).toBe(false);
    expect(result.dryRun).toBe(true);

    const userDoc = await db.collection('users').doc('uid_recover_4').get();
    expect(userDoc.data().hasCompletedPayment).toBeUndefined();
    const allocDoc = await db.collection('billingAllocations').doc('sub_recover_4').get();
    expect(allocDoc.exists).toBe(false);
  });
  },
);
