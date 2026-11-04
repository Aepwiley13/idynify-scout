/**
 * Runs against a REAL Firestore emulator with real transactions — two concurrent deductions
 * against the same starting balance must not lose an update (a plain read-then-write, which the
 * original code did, loses one of two concurrent decrements).
 */
import { describe, it, expect, beforeEach } from 'vitest';

process.env.FIREBASE_PROJECT_ID ||= 'demo-billing-tests';

const { db } = await import('../../netlify/functions/firebase-admin.js');
const { deductCredits } = await import('../../netlify/functions/utils/creditTracking.js');

beforeEach(async () => {
  const snap = await db.collection('users').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

describe('creditTracking: concurrent deductions are transactional', () => {
  it('two concurrent deductions on an object-shaped account both land — no lost update', async () => {
    await db.collection('users').doc('uid_conc_1').set({
      email: 'c1@example.test', credits: { total: 1000, used: 0, remaining: 1000, resetDate: null },
    });

    const [r1, r2] = await Promise.all([
      deductCredits('uid_conc_1', 'enrichCompanyFull', 1), // cost 10
      deductCredits('uid_conc_1', 'enrichCompanyFull', 1), // cost 10
    ]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const doc = await db.collection('users').doc('uid_conc_1').get();
    expect(doc.data().credits.remaining).toBe(980); // both decrements landed, not just one
    expect(doc.data().credits.used).toBe(20);
  }, 30000); // real transaction retries under contention are slower than the 5s default against this emulator

  it('eight concurrent deductions on a numeric account all land correctly', async () => {
    await db.collection('users').doc('uid_conc_2').set({ email: 'c2@example.test', credits: 1000 });

    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => deductCredits('uid_conc_2', 'addCompany', 1))); // cost 1 each
    expect(results.every((r) => r.success)).toBe(true);

    const doc = await db.collection('users').doc('uid_conc_2').get();
    expect(doc.data().credits).toBe(1000 - N); // none lost to a race
  }, 30000); // real transaction retries under contention take longer than the 5s default against the emulator

  it('concurrent deductions that would overdraw correctly reject the ones that can\'t be afforded', async () => {
    await db.collection('users').doc('uid_conc_3').set({ email: 'c3@example.test', credits: 15 });

    const results = await Promise.all([
      deductCredits('uid_conc_3', 'enrichCompanyFull', 1), // cost 10
      deductCredits('uid_conc_3', 'enrichCompanyFull', 1), // cost 10 — only one of these can succeed
    ]);
    const successes = results.filter((r) => r.success);
    expect(successes).toHaveLength(1); // not both — that would overdraw to -5
    const doc = await db.collection('users').doc('uid_conc_3').get();
    expect(doc.data().credits).toBe(5);
  }, 30000);
});
