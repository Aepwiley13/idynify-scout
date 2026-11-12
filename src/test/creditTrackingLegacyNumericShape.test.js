/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. The original creditTracking.js only guarded against `credits` being entirely
 * absent — a numeric-shaped account passed that guard and then silently wrote NaN
 * (`undefined.remaining` arithmetic). This asserts the fix: correct arithmetic on whichever
 * shape is actually stored, with no total/used ever fabricated for a numeric account.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
process.env.FIREBASE_PROJECT_ID ||= 'demo-billing-tests';

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'creditTracking: legacy numeric credits shape (run via: npm run test:billing-emulator)',
  () => {
  let db, deductCredits, refundCredits, getCreditBalance;

  beforeAll(async () => {
    ({ db } = await import('../../netlify/functions/firebase-admin.js'));
    ({ deductCredits, refundCredits, getCreditBalance } = await import('../../netlify/functions/utils/creditTracking.js'));
  });

  beforeEach(async () => {
    const snap = await db.collection('users').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  });

  it('deducting from a numeric account writes a correct number back, never NaN', async () => {
    await db.collection('users').doc('uid_num_1').set({ email: 'n1@example.test', credits: 50 });
    const result = await deductCredits('uid_num_1', 'enrichCompanyFull', 1); // cost 10
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(40);

    const doc = await db.collection('users').doc('uid_num_1').get();
    expect(doc.data().credits).toBe(40);
    expect(Number.isNaN(doc.data().credits)).toBe(false);
  });

  it('insufficient credits on a numeric account is correctly detected (the original bug let this always pass)', async () => {
    await db.collection('users').doc('uid_num_2').set({ email: 'n2@example.test', credits: 5 });
    const result = await deductCredits('uid_num_2', 'enrichCompanyFull', 1); // cost 10 > 5
    expect(result.success).toBe(false);
    expect(result.error).toBe('insufficient_credits');
    const doc = await db.collection('users').doc('uid_num_2').get();
    expect(doc.data().credits).toBe(5); // untouched
  });

  it('refunding a numeric account stays numeric and never fabricates total/used', async () => {
    await db.collection('users').doc('uid_num_3').set({ email: 'n3@example.test', credits: 30 });
    const result = await refundCredits('uid_num_3', 10);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(40);
    const doc = await db.collection('users').doc('uid_num_3').get();
    expect(doc.data().credits).toBe(40);
  });

  it('getCreditBalance reports total/used as null for a numeric account, not 0 or a guess', async () => {
    await db.collection('users').doc('uid_num_4').set({ email: 'n4@example.test', credits: 123 });
    const result = await getCreditBalance('uid_num_4');
    expect(result.success).toBe(true);
    expect(result.credits.remaining).toBe(123);
    expect(result.credits.total).toBeNull();
    expect(result.credits.used).toBeNull();
  });

  it('the object shape is unaffected — unchanged behavior', async () => {
    await db.collection('users').doc('uid_obj_1').set({
      email: 'o1@example.test', credits: { total: 400, used: 10, remaining: 390, resetDate: null },
    });
    const result = await deductCredits('uid_obj_1', 'revealEmail', 1);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(389);
    const doc = await db.collection('users').doc('uid_obj_1').get();
    expect(doc.data().credits).toEqual({ total: 400, used: 11, remaining: 389, resetDate: null });
  });
  },
);
