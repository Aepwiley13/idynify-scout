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
  resolveTarget, assertStripeFixturesOnly, assertRunId, newRunId, RehearsalRefusal,
  FIXTURE_STRIPE_KEY, FIXTURE_WEBHOOK_SECRET, FIXTURE_PRICES, EMULATOR_PROJECT, STAGING_PROJECT,
  MODE_VARIABLE, RUN_ID_VARIABLE, KEEP_VARIABLE, REPORT_VARIABLE,
} from '../../scripts/staging/billingRehearsal/guard.mjs';
import { store, resetStore, idsFor, makeFixtureStripeClass } from '../../scripts/staging/billingRehearsal/fixtures.mjs';
import { STEPS } from '../../scripts/staging/billingRehearsal/steps.mjs';
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
    const results = [];
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
      // The client's own idea of its project, checked again now that it exists. Against the
      // emulator any "demo-" namespace is acceptable; against staging only the pinned project.
      // (The getter throws until the client knows its project; the environment check above
      // has already pinned it, so "not known yet" is not a refusal.)
      let clientProject = null;
      try {
        clientProject = db.projectId;
      } catch {
        clientProject = null;
      }
      const clientOk = !clientProject || clientProject === STAGING_PROJECT
        || (target.mode === 'emulator' && clientProject.startsWith('demo-'));
      if (!clientOk) throw new RehearsalRefusal('The Firestore client resolved a different project than the one that was checked.');
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
      let leftover = null;
      if (ctx && !ctx.keepData && !ctx.state?.cleanup) {
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
        }, null, 2));
      }
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }, STEP_TIMEOUT);

    for (const step of STEPS) {
      it(`${step.id} — ${step.title}`, async () => {
        const checks = await step.run(ctx);
        const failed = checks.filter((check) => !check.ok);
        results.push({ id: step.id, title: step.title, pass: failed.length === 0, checks });
        expect(failed).toEqual([]);
        expect(checks.length).toBeGreaterThan(0);
      }, STEP_TIMEOUT);
    }
  },
);
