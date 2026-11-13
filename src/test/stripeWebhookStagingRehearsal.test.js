/**
 * The billing cutover rehearsal, against REAL Firestore: the emulator
 * (`npm run test:billing-emulator`, which is how CI runs it) or the staging project
 * (`node scripts/staging/billingRehearsal.mjs --apply …`, the only supported way to start a
 * staging run). Plain `npm test` skips this file; src/test/billingRehearsalSteps.test.js runs
 * the same steps there against an in-memory store.
 *
 * Nothing here contacts Stripe. The `stripe` module is replaced by the fixture client; only
 * its offline signature code is the real library's. The target is checked by
 * scripts/staging/billingRehearsal/guard.mjs before the Firestore client is even imported.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import {
  resolveTarget, assertClientProject, readClientProject, assertStripeFixturesOnly, assertRunId, newRunId, RehearsalRefusal,
  FIXTURE_STRIPE_KEY, FIXTURE_WEBHOOK_SECRET, FIXTURE_PRICES, EMULATOR_PROJECT,
  MODE_VARIABLE, RUN_ID_VARIABLE, KEEP_VARIABLE, REPORT_VARIABLE,
} from '../../scripts/staging/billingRehearsal/guard.mjs';
import { store, resetStore, idsFor, makeFixtureStripeClass } from '../../scripts/staging/billingRehearsal/fixtures.mjs';
import { STEPS, createStepRunner } from '../../scripts/staging/billingRehearsal/steps.mjs';
import { deleteRunDocs } from '../../scripts/staging/billingRehearsal/cleanup.mjs';
import { readStagingCredential } from '../../scripts/staging/stagingCredentials.mjs';

vi.mock('stripe', async () => {
  const actual = await vi.importActual('stripe');
  const { makeFixtureStripeClass: make } = await import('../../scripts/staging/billingRehearsal/fixtures.mjs');
  return { default: make(actual.default) };
});

const EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const STAGING = process.env[MODE_VARIABLE] === 'staging';
const FIXTURE_ENV = { STRIPE_SECRET_KEY: FIXTURE_STRIPE_KEY, STRIPE_WEBHOOK_SECRET: FIXTURE_WEBHOOK_SECRET, ...FIXTURE_PRICES };
const STEP_TIMEOUT = STAGING ? 180_000 : 30_000;

describe.skipIf(!EMULATOR && !STAGING)(
  'billing cutover rehearsal against real Firestore (emulator: npm run test:billing-emulator; staging: scripts/staging/billingRehearsal.mjs)',
  () => {
    const saved = {};
    const runner = createStepRunner();
    const { results } = runner;
    let ctx = null;
    let target = null;

    beforeAll(async () => {
      // 1. Fixture Stripe values, replacing whatever an earlier file left in this worker.
      for (const [name, value] of Object.entries({ ...FIXTURE_ENV, BILLING_LEDGER_EPOCH_UNIX: undefined })) {
        saved[name] = process.env[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      if (EMULATOR && !process.env.FIREBASE_PROJECT_ID) process.env.FIREBASE_PROJECT_ID = EMULATOR_PROJECT;

      // 2. Where would this go? Refuse BEFORE anything that can open a connection is imported.
      if (EMULATOR && STAGING) throw new RehearsalRefusal('Both an emulator host and staging mode are set. Refusing to guess.');
      const credential = STAGING ? readStagingCredential(process.env) : null;
      target = resolveTarget(process.env, { credential });
      if (STAGING && target.mode !== 'staging') throw new RehearsalRefusal('Staging mode did not resolve to the staging project.');
      assertStripeFixturesOnly(process.env);

      // 3. Only now: the real Firestore client, the real handler, the real recovery transaction.
      const { db } = await import('../../netlify/functions/firebase-admin.js');
      // The SDK's own idea of its project, checked before the first read or write. Fail
      // closed: an id that cannot be resolved is a refusal (guard.mjs: assertClientProject).
      const { getApp } = await import('firebase-admin/app');
      assertClientProject(target, readClientProject(db, getApp()));
      const { handler } = await import('../../netlify/functions/stripe-webhook.js');
      const recovery = await import('../../scripts/manualCreditRecovery.mjs');
      const { default: RealStripe } = await vi.importActual('stripe');
      const FixtureStripe = makeFixtureStripeClass(RealStripe);

      const runId = assertRunId(process.env[RUN_ID_VARIABLE] || newRunId());
      resetStore();
      ctx = {
        db, handler, store, env: process.env, ids: idsFor(runId),
        webhooks: new RealStripe(FIXTURE_STRIPE_KEY).webhooks,
        newStripeClient: () => new FixtureStripe(FIXTURE_STRIPE_KEY),
        applyManualRecovery: recovery.applyManualRecovery,
        errors: { AlreadyGrantedError: recovery.AlreadyGrantedError, EvidenceValidationError: recovery.EvidenceValidationError },
        keepData: process.env[KEEP_VARIABLE] === '1',
      };
    }, STEP_TIMEOUT);

    afterAll(async () => {
      // Safety net: if the run stopped before its own clean-up step, remove what it left.
      // Never after a failed step: what the run wrote is then evidence, and is left in place.
      let leftover = null;
      const failed = results.some((step) => !step.pass);
      if (ctx && !ctx.keepData && !ctx.state?.cleanup && !failed) {
        try {
          leftover = await deleteRunDocs(ctx.db, ctx.ids.runId);
        } catch (err) {
          leftover = { error: err.message };
        }
      }
      if (process.env[REPORT_VARIABLE]) {
        writeFileSync(process.env[REPORT_VARIABLE], JSON.stringify({
          mode: target?.mode ?? null, projectId: target?.projectId ?? null, runId: ctx?.ids.runId ?? null,
          steps: results, cleanup: ctx?.state?.cleanup ?? null, safetyNetCleanup: leftover,
          halted: runner.halted, dataPreservedAfterFailure: Boolean(ctx) && failed && !ctx.state?.cleanup,
        }, null, 2));
      }
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }, STEP_TIMEOUT);

    // FAIL FAST (steps.mjs: createStepRunner). Once a step fails, nothing after it is run:
    // the remaining steps are skipped, clean-up included, and the run's documents stay as evidence.
    for (const step of STEPS) {
      it(`${step.id} — ${step.title}`, async (test) => {
        const outcome = await runner.run(step, ctx);
        if (outcome.skipped) test.skip();
        expect(outcome.failed).toEqual([]);
      }, STEP_TIMEOUT);
    }
  },
);
