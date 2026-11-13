/**
 * Runs the billing rehearsal's whole step sequence in plain `npm test`, with the REAL webhook
 * handler and the REAL manual-recovery transaction over an in-memory store
 * (helpers/memoryFirestore.js) and locally signed fixture events.
 *
 * What this is for: proving the rehearsal DRIVER is sound (fixtures, signatures, ordering,
 * checks, clean-up) on a machine with no emulator, so a staging run is not the first time its
 * steps execute. It is not evidence about Firestore itself; see the helper's header.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import { FIXTURE_STRIPE_KEY, FIXTURE_WEBHOOK_SECRET, FIXTURE_PRICES } from '../../scripts/staging/billingRehearsal/guard.mjs';
import { store, resetStore, idsFor, makeFixtureStripeClass, registerPurchase, checkoutCompletedEvent, signedDelivery } from '../../scripts/staging/billingRehearsal/fixtures.mjs';
import { STEPS, STEP_IDS, canonical } from '../../scripts/staging/billingRehearsal/steps.mjs';
import { findRunDocs } from '../../scripts/staging/billingRehearsal/cleanup.mjs';

const memory = vi.hoisted(() => ({ db: null }));

vi.mock('../../netlify/functions/firebase-admin.js', async () => {
  const { createMemoryFirestore } = await import('./helpers/memoryFirestore.js');
  memory.db = createMemoryFirestore();
  return { db: memory.db };
});

vi.mock('stripe', async () => {
  const actual = await vi.importActual('stripe');
  const { makeFixtureStripeClass: make } = await import('../../scripts/staging/billingRehearsal/fixtures.mjs');
  return { default: make(actual.default) };
});

const RUN_ID = 'unittest01';
const FIXTURE_ENV = { STRIPE_SECRET_KEY: FIXTURE_STRIPE_KEY, STRIPE_WEBHOOK_SECRET: FIXTURE_WEBHOOK_SECRET, ...FIXTURE_PRICES };

describe('billing rehearsal — the full step sequence, real handler, in-memory store', () => {
  const saved = {};
  let ctx;

  beforeAll(async () => {
    for (const [name, value] of Object.entries({ ...FIXTURE_ENV, BILLING_LEDGER_EPOCH_UNIX: undefined })) {
      saved[name] = process.env[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const { handler } = await import('../../netlify/functions/stripe-webhook.js');
    const recovery = await import('../../scripts/manualCreditRecovery.mjs');
    const { default: RealStripe } = await vi.importActual('stripe');
    const FixtureStripe = makeFixtureStripeClass(RealStripe);
    resetStore();
    // An unrelated account that no step may ever touch.
    await memory.db.collection('users').doc('bystander-account').set({ email: 'someone@example.test', hasCompletedPayment: true });
    ctx = {
      db: memory.db, handler, store, env: process.env, ids: idsFor(RUN_ID),
      webhooks: new RealStripe(FIXTURE_STRIPE_KEY).webhooks,
      newStripeClient: () => new FixtureStripe(FIXTURE_STRIPE_KEY),
      applyManualRecovery: recovery.applyManualRecovery,
      errors: { AlreadyGrantedError: recovery.AlreadyGrantedError, EvidenceValidationError: recovery.EvidenceValidationError },
      keepData: false,
    };
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('covers the scenarios the rehearsal plan requires, in order', () => {
    expect(STEP_IDS).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
  });

  for (const step of STEPS) {
    it(`${step.id} — ${step.title}`, async () => {
      const checks = await step.run(ctx);
      expect(checks.filter((check) => !check.ok)).toEqual([]);
      expect(checks.length).toBeGreaterThan(0);
    }, 30_000);
  }

  it('after the run: nothing of the run remains, the bystander is untouched, the epoch is restored', async () => {
    expect(await findRunDocs(memory.db, RUN_ID)).toEqual([]);
    expect(memory.db.__paths()).toEqual(['users/bystander-account']);
    expect(process.env.BILLING_LEDGER_EPOCH_UNIX).toBeUndefined();
  });

  it('never asked the fixture client for anything outside this run', () => {
    expect(store.calls.length).toBeGreaterThan(0);
    expect(store.calls.every((call) => call.id.includes(`_rehearsal_${RUN_ID}_`))).toBe(true);
  });

  it('the checks can fail: a handler that grants while the epoch is unset is caught by S1', async () => {
    const ids = idsFor('negative01');
    const granting = async () => {
      await memory.db.collection('users').doc(ids.uid('unset')).set({ hasCompletedPayment: true, credits: { total: 400, used: 0, remaining: 400 } }, { merge: true });
      return { statusCode: 200 };
    };
    const checks = await STEPS[1].run({ ...ctx, ids, handler: granting, state: {} });
    const failed = checks.filter((check) => !check.ok).map((check) => check.name);
    expect(failed).toEqual(expect.arrayContaining(['exactly one review record', 'access not granted', 'no credits written']));
    await memory.db.collection('users').doc(ids.uid('unset')).delete();
  });

  it('a delivery not signed with the fixture secret never reaches the handler logic', async () => {
    const ids = idsFor('negative02');
    registerPurchase(ids, 'grant', { created: 2_000_000_000 });
    const res = await ctx.handler(signedDelivery(ctx.webhooks, checkoutCompletedEvent(ids, 'grant'), 'whsec_not_the_fixture'));
    expect(res.statusCode).toBe(400);
    expect(await findRunDocs(memory.db, 'negative02')).toEqual([]);
  });

  it('compares maps without regard to key order, as Firestore returns them', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });
});
