/**
 * The billing rehearsal's safety checks (scripts/staging/billingRehearsal/): it runs against
 * the emulator or the one pinned staging project and refuses everything else; it accepts no
 * Stripe key but its own fixture; it signs its own events and nothing else verifies; and it
 * can only ever delete documents that carry its run id.
 */
import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGING_PROJECT, FIXTURE_STRIPE_KEY, FIXTURE_WEBHOOK_SECRET, FIXTURE_PRICES, CONFIRM_VARIABLE, MODE_VARIABLE, RUN_ID_VARIABLE,
  RehearsalRefusal, resolveTarget, isLoopbackHost, assertStripeFixturesOnly, assertRunId, newRunId,
  assertRehearsalDocPath, isRehearsalUid, isRehearsalStripeId,
} from '../../scripts/staging/billingRehearsal/guard.mjs';
import {
  SLOTS, EVENT_LABELS, idsFor, resetStore, makeFixtureStripeClass, registerPurchase, checkoutCompletedEvent,
  signedDelivery, tamperedDelivery,
} from '../../scripts/staging/billingRehearsal/fixtures.mjs';
import { findRunDocs, deleteRunDocs } from '../../scripts/staging/billingRehearsal/cleanup.mjs';
import { parseArgs, planRehearsal, dropFromShell, describeRun } from '../../scripts/staging/billingRehearsal.mjs';
import { createMemoryFirestore } from './helpers/memoryFirestore.js';

const PROD = 'acme-production';
const OTHER = 'acme-staging';
const RUN = 'guardtest01';
const stagingCredential = { kind: 'short-lived', source: 'GOOGLE_APPLICATION_CREDENTIALS', path: '/outside/credential.json', projectId: STAGING_PROJECT };
const stagingEnv = (over = {}) => ({
  FIREBASE_PROJECT_ID: STAGING_PROJECT, PRODUCTION_FIREBASE_PROJECT_ID: PROD, [CONFIRM_VARIABLE]: STAGING_PROJECT, ...over,
});
const refusal = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RehearsalRefusal);
    return err.message;
  }
  throw new Error('expected a RehearsalRefusal');
};

describe('billing rehearsal — target: the emulator or the pinned staging project, nothing else', () => {
  it('accepts the staging project with its own credential and an explicit confirmation', () => {
    expect(resolveTarget(stagingEnv(), { credential: stagingCredential })).toEqual({ mode: 'staging', projectId: STAGING_PROJECT });
  });

  it('refuses every other project id, however staging-like it looks', () => {
    for (const projectId of [OTHER, `${STAGING_PROJECT}-2`, `x${STAGING_PROJECT}`, STAGING_PROJECT.toUpperCase(), 'staging', 'demo-anything']) {
      const credential = { ...stagingCredential, projectId };
      expect(refusal(() => resolveTarget(stagingEnv({ FIREBASE_PROJECT_ID: projectId }), { credential }))).toMatch(/not the staging project/);
    }
  });

  it('refuses the production project by name, in both modes', () => {
    expect(refusal(() => resolveTarget(stagingEnv({ FIREBASE_PROJECT_ID: PROD }), { credential: stagingCredential }))).toMatch(/production project/);
    expect(refusal(() => resolveTarget({ FIREBASE_PROJECT_ID: PROD, PRODUCTION_FIREBASE_PROJECT_ID: PROD, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }))).toMatch(/production project/);
  });

  it('refuses when production cannot be ruled out, or is declared to be staging', () => {
    expect(refusal(() => resolveTarget(stagingEnv({ PRODUCTION_FIREBASE_PROJECT_ID: undefined }), { credential: stagingCredential }))).toMatch(/PRODUCTION_FIREBASE_PROJECT_ID/);
    expect(refusal(() => resolveTarget(stagingEnv({ FIREBASE_PROJECT_ID: OTHER, PRODUCTION_FIREBASE_PROJECT_ID: STAGING_PROJECT }), { credential: stagingCredential }))).toMatch(/names the staging project/);
  });

  it('refuses with no project, no credential, or a credential for another project', () => {
    expect(refusal(() => resolveTarget({}))).toMatch(/FIREBASE_PROJECT_ID is not set/);
    expect(refusal(() => resolveTarget(stagingEnv(), { credential: null }))).toMatch(/credential for the staging project is required/);
    expect(refusal(() => resolveTarget(stagingEnv(), { credential: { ...stagingCredential, projectId: PROD } }))).toMatch(/different project/);
  });

  it('refuses without the explicit confirmation, or with a wrong one', () => {
    for (const value of [undefined, '', 'yes', OTHER]) {
      expect(refusal(() => resolveTarget(stagingEnv({ [CONFIRM_VARIABLE]: value }), { credential: stagingCredential }))).toMatch(/explicit confirmation/);
    }
  });

  it('refuses when any other project variable disagrees', () => {
    for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'VITE_FIREBASE_PROJECT_ID']) {
      expect(refusal(() => resolveTarget(stagingEnv({ [name]: PROD }), { credential: stagingCredential }))).toMatch(new RegExp(name));
    }
  });

  it('emulator mode needs a loopback host and a demo- (or staging-named) namespace', () => {
    expect(resolveTarget({ FIREBASE_PROJECT_ID: 'demo-billing-tests', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).mode).toBe('emulator');
    expect(resolveTarget({ FIREBASE_PROJECT_ID: STAGING_PROJECT, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }).mode).toBe('emulator');
    expect(refusal(() => resolveTarget({ FIREBASE_PROJECT_ID: 'demo-x', FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }))).toMatch(/not a loopback/);
    expect(refusal(() => resolveTarget({ FIREBASE_PROJECT_ID: OTHER, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }))).toMatch(/neither a "demo-" project/);
    expect(refusal(() => resolveTarget({ FIREBASE_PROJECT_ID: 'demo-x', GCLOUD_PROJECT: OTHER, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }))).toMatch(/GCLOUD_PROJECT/);
  });

  it('recognises only real loopback addresses', () => {
    for (const host of ['localhost:8080', '127.0.0.1:8080', '[::1]:8080', 'localhost']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['', undefined, '10.0.0.5:8080', 'localhost.evil.example:8080', 'example.com', '127.0.0.1.example.com:80', 'http://localhost:8080']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('billing rehearsal — Stripe: fixtures only', () => {
  const fixtureEnv = { STRIPE_SECRET_KEY: FIXTURE_STRIPE_KEY, STRIPE_WEBHOOK_SECRET: FIXTURE_WEBHOOK_SECRET, ...FIXTURE_PRICES };

  it('accepts exactly the fixture values', () => {
    expect(() => assertStripeFixturesOnly(fixtureEnv)).not.toThrow();
  });

  it('refuses a live key anywhere in the environment, even in an unrelated variable', () => {
    for (const key of ['sk_live_abc123', 'rk_live_abc123']) {
      expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, STRIPE_SECRET_KEY: key }))).toMatch(/live-mode key/);
      expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, SOME_OTHER_TOOL_KEY: key }))).toMatch(/SOME_OTHER_TOOL_KEY/);
      expect(refusal(() => assertStripeFixturesOnly({ SOME_OTHER_TOOL_KEY: key }, { strict: false }))).toMatch(/live-mode key/);
    }
  });

  it('never repeats a key value in its refusal', () => {
    expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE' }))).not.toContain('SECRETVALUE');
  });

  it('refuses a real test-mode key, a missing key, a foreign webhook secret and foreign prices', () => {
    expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, STRIPE_SECRET_KEY: 'sk_test_51Real' }))).toMatch(/not the rehearsal fixture/);
    expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, STRIPE_SECRET_KEY: undefined }))).toMatch(/not the rehearsal fixture/);
    expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, STRIPE_WEBHOOK_SECRET: 'whsec_real' }))).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(refusal(() => assertStripeFixturesOnly({ ...fixtureEnv, STRIPE_PRICE_PRO: 'price_1Real' }))).toMatch(/STRIPE_PRICE_PRO/);
  });

  it('the fixture client cannot be constructed with any other key', () => {
    const FixtureStripe = makeFixtureStripeClass(Stripe);
    expect(() => new FixtureStripe(FIXTURE_STRIPE_KEY)).not.toThrow();
    for (const key of ['sk_live_abc', 'sk_test_51Real', undefined]) expect(() => new FixtureStripe(key)).toThrow(RehearsalRefusal);
  });

  it('the fixture client answers only from its store, and returns copies', async () => {
    resetStore();
    const ids = idsFor(RUN);
    registerPurchase(ids, 'grant', { created: 2_000_000_000 });
    const client = new (makeFixtureStripeClass(Stripe))(FIXTURE_STRIPE_KEY);
    const subscription = await client.subscriptions.retrieve(ids.subscription('grant'));
    subscription.status = 'canceled';
    expect((await client.subscriptions.retrieve(ids.subscription('grant'))).status).toBe('active');
    await expect(client.customers.retrieve('cus_real_customer')).rejects.toThrow(/no such object/);
  });

  it('events are signed locally and verify with the real Stripe library; anything else fails', () => {
    resetStore();
    const ids = idsFor(RUN);
    registerPurchase(ids, 'grant', { created: 2_000_000_000 });
    const event = checkoutCompletedEvent(ids, 'grant');
    const { webhooks } = new Stripe(FIXTURE_STRIPE_KEY);

    const good = signedDelivery(webhooks, event, FIXTURE_WEBHOOK_SECRET);
    expect(webhooks.constructEvent(good.body, good.headers['stripe-signature'], FIXTURE_WEBHOOK_SECRET).id).toBe(event.id);

    const tampered = tamperedDelivery(webhooks, event, FIXTURE_WEBHOOK_SECRET);
    expect(tampered.body).not.toBe(good.body);
    expect(() => webhooks.constructEvent(tampered.body, tampered.headers['stripe-signature'], FIXTURE_WEBHOOK_SECRET)).toThrow();
    expect(() => webhooks.constructEvent(good.body, good.headers['stripe-signature'], 'whsec_production_secret')).toThrow();
  });

  it('refuses to sign an event that is not explicitly livemode: false', () => {
    const { webhooks } = new Stripe(FIXTURE_STRIPE_KEY);
    for (const event of [{ id: 'evt_x', livemode: true }, { id: 'evt_x' }]) {
      expect(() => signedDelivery(webhooks, event, FIXTURE_WEBHOOK_SECRET)).toThrow(RehearsalRefusal);
    }
  });
});

describe('billing rehearsal — ids and clean-up: only this run\'s documents', () => {
  it('run ids are constrained, and fresh ones are valid and distinct', () => {
    for (const bad of ['', 'short', 'UPPERCASE1', 'has-dash-1', 'has_underscore', 'a'.repeat(25), '../../users', undefined]) {
      expect(() => assertRunId(bad)).toThrow(RehearsalRefusal);
    }
    const a = newRunId(new Date('2026-11-13T15:00:00Z'), () => 0.1);
    const b = newRunId(new Date('2026-11-13T15:00:00Z'), () => 0.9);
    expect(assertRunId(a)).toBe(a);
    expect(a).not.toBe(b);
  });

  it('every id a run mints carries the run id, and unknown slots or labels are refused', () => {
    const ids = idsFor(RUN);
    for (const slot of SLOTS) {
      expect(isRehearsalUid(ids.uid(slot), RUN)).toBe(true);
      for (const id of [ids.customer(slot), ids.subscription(slot), ids.session(slot), ids.invoice(slot)]) expect(isRehearsalStripeId(id, RUN)).toBe(true);
      for (const label of EVENT_LABELS) expect(isRehearsalStripeId(ids.event(slot, label), RUN)).toBe(true);
    }
    expect(ids.session('grant').startsWith('cs_')).toBe(true);
    expect(() => ids.uid('someone-real')).toThrow(RehearsalRefusal);
    expect(() => ids.event('grant', 'anything')).toThrow(RehearsalRefusal);
  });

  it('accepts only paths that are provably this run\'s', () => {
    const ids = idsFor(RUN);
    const ok = [
      [`users/${ids.uid('grant')}`],
      [`billingAllocations/${ids.subscription('grant')}`],
      [`stripeWebhookEvents/${ids.event('grant', 'checkout')}`],
      [`stripeWebhookPendingEvents/${ids.customer('order')}/events/${ids.event('order', 'subcreated')}`],
      ['billingAmbiguousAccounts/Zk3randomAutoId', { data: { uid: ids.uid('unset') } }],
    ];
    for (const [path, options] of ok) expect(assertRehearsalDocPath(path, RUN, options)).toBe(path);

    const otherRun = idsFor('otherrun99');
    const refused = [
      ['users/realCustomerUid123'],
      [`users/${otherRun.uid('grant')}`],
      ['users/rehearsal-guardtest01-'],
      [`users/${ids.uid('grant')}/contacts/c1`],
      ['billingAllocations/sub_1RealSubscription'],
      [`billingAllocations/${otherRun.subscription('grant')}`],
      ['stripeWebhookEvents/evt_1RealEvent'],
      [`stripeWebhookPendingEvents/cus_real/events/${ids.event('order', 'subcreated')}`],
      ['billingAmbiguousAccounts/Zk3randomAutoId', { data: { uid: 'realCustomerUid123' } }],
      ['billingAmbiguousAccounts/Zk3randomAutoId', { data: { uid: null } }],
      ['billingAmbiguousAccounts/Zk3randomAutoId'],
      [`billingCheckoutOperations/${ids.subscription('grant')}`],
      [`companies/${ids.uid('grant')}`],
      [''],
      ['users'],
    ];
    for (const [path, options] of refused) expect(() => assertRehearsalDocPath(path, RUN, options)).toThrow(RehearsalRefusal);
  });

  async function seeded() {
    const db = createMemoryFirestore();
    const ids = idsFor(RUN);
    const other = idsFor('otherrun99');
    const mine = {
      [`users/${ids.uid('grant')}`]: { hasCompletedPayment: true },
      [`billingAllocations/${ids.subscription('grant')}`]: { uid: ids.uid('grant') },
      [`stripeWebhookEvents/${ids.event('grant', 'checkout')}`]: { type: 'checkout.session.completed' },
      [`stripeWebhookPendingEvents/${ids.customer('order')}/events/${ids.event('order', 'subcreated')}`]: { type: 'x' },
      'billingAmbiguousAccounts/autoMine': { uid: ids.uid('unset'), status: 'pending' },
    };
    const theirs = {
      'users/realCustomerUid123': { hasCompletedPayment: true },
      'billingAllocations/sub_1RealSubscription': { uid: 'realCustomerUid123' },
      'stripeWebhookEvents/evt_1RealEvent': { type: 'checkout.session.completed' },
      'billingAmbiguousAccounts/autoTheirs': { uid: 'realCustomerUid123', status: 'pending' },
      [`users/${other.uid('grant')}`]: { hasCompletedPayment: false },
      [`billingAllocations/${other.subscription('grant')}`]: { uid: other.uid('grant') },
      'billingAmbiguousAccounts/autoOtherRun': { uid: other.uid('unset'), status: 'pending' },
    };
    for (const [path, data] of Object.entries({ ...mine, ...theirs })) {
      const parts = path.split('/');
      let ref = db.collection(parts[0]).doc(parts[1]);
      if (parts.length === 4) ref = ref.collection(parts[2]).doc(parts[3]);
      await ref.set(data);
    }
    return { db, mine: Object.keys(mine).sort(), theirs: Object.keys(theirs).sort() };
  }

  it('finds exactly this run\'s documents among real ones and another run\'s', async () => {
    const { db, mine } = await seeded();
    expect((await findRunDocs(db, RUN)).map((d) => d.path).sort()).toEqual(mine);
  });

  it('a dry-run clean-up deletes nothing and lists what it would delete', async () => {
    const { db, mine, theirs } = await seeded();
    const plan = await deleteRunDocs(db, RUN, { dryRun: true });
    expect(plan).toEqual({ deleted: [], wouldDelete: mine, remaining: mine.length });
    expect(db.__paths()).toEqual([...mine, ...theirs].sort());
  });

  it('clean-up deletes this run\'s documents and leaves every other document in place', async () => {
    const { db, mine, theirs } = await seeded();
    const done = await deleteRunDocs(db, RUN);
    expect(done).toEqual({ deleted: mine, wouldDelete: [], remaining: 0 });
    expect(db.__paths()).toEqual(theirs);
  });

  it('clean-up refuses a malformed run id before reading anything', async () => {
    const { db, mine, theirs } = await seeded();
    await expect(deleteRunDocs(db, '')).rejects.toThrow(RehearsalRefusal);
    await expect(findRunDocs(db, 'x')).rejects.toThrow(RehearsalRefusal);
    expect(db.__paths()).toEqual([...mine, ...theirs].sort());
  });
});

describe('billing rehearsal — the launcher: dry run by default, a sealed environment', () => {
  const shell = { PATH: '/usr/bin', HOME: '/home/op', PRODUCTION_FIREBASE_PROJECT_ID: PROD, GOOGLE_APPLICATION_CREDENTIALS: '/outside/credential.json' };
  const plan = (argv, over = {}) => planRehearsal({
    args: parseArgs(argv), shellEnv: shell, credential: stagingCredential, makeRunId: () => 'fixedrunid01', ...over,
  });

  it('with no arguments it is a dry run, and carries no confirmation', () => {
    const p = plan([]);
    expect(p.problems).toEqual([]);
    expect(p.mode).toBe('dry-run');
    expect(p.env[CONFIRM_VARIABLE]).toBeUndefined();
  });

  it('--apply alone is refused; the confirmation must name the staging project', () => {
    expect(plan(['--apply']).problems.join(' ')).toMatch(/--apply needs --confirm-project/);
    expect(plan(['--apply', `--confirm-project=${PROD}`]).problems.join(' ')).toMatch(/does not name the staging project/);
    const ok = plan(['--apply', `--confirm-project=${STAGING_PROJECT}`]);
    expect(ok.problems).toEqual([]);
    expect(ok.mode).toBe('run');
  });

  it('the run always targets the staging project, whatever the shell says', () => {
    const p = plan(['--apply', `--confirm-project=${STAGING_PROJECT}`], {
      shellEnv: { ...shell, FIREBASE_PROJECT_ID: PROD, GCLOUD_PROJECT: PROD, GOOGLE_CLOUD_PROJECT: PROD, VITE_FIREBASE_PROJECT_ID: PROD },
    });
    expect(p.problems).toEqual([]);
    expect(p.env.FIREBASE_PROJECT_ID).toBe(STAGING_PROJECT);
    for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'VITE_FIREBASE_PROJECT_ID']) expect(p.env[name]).toBeUndefined();
    expect(p.env[MODE_VARIABLE]).toBe('staging');
    expect(p.env[RUN_ID_VARIABLE]).toBe('fixedrunid01');
  });

  it('drops every credential, key and integration variable from the shell and installs the fixtures', () => {
    const p = plan([], {
      shellEnv: {
        ...shell, STRIPE_SECRET_KEY: 'sk_test_51RealTestKey', STRIPE_WEBHOOK_SECRET: 'whsec_real', STRIPE_PRICE_STARTER: 'price_1Real',
        FIREBASE_PRIVATE_KEY: 'pem', FIREBASE_CLIENT_EMAIL: 'sa@x', BILLING_LEDGER_EPOCH_UNIX: '1794507945', APOLLO_API_KEY: 'k', ANTHROPIC_API_KEY: 'k',
      },
    });
    expect(p.problems).toEqual([]);
    expect(p.env.STRIPE_SECRET_KEY).toBe(FIXTURE_STRIPE_KEY);
    expect(p.env.STRIPE_WEBHOOK_SECRET).toBe(FIXTURE_WEBHOOK_SECRET);
    expect(p.env.STRIPE_PRICE_STARTER).toBe(FIXTURE_PRICES.STRIPE_PRICE_STARTER);
    for (const name of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'BILLING_LEDGER_EPOCH_UNIX', 'APOLLO_API_KEY', 'ANTHROPIC_API_KEY']) {
      expect(p.env[name]).toBeUndefined();
    }
    expect(p.env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/outside/credential.json');
    expect(p.env.PATH).toBe('/usr/bin');
    for (const name of ['STRIPE_SECRET_KEY', 'FIREBASE_PROJECT_ID', 'VITE_X', 'BILLING_LEDGER_EPOCH_UNIX', 'FIRESTORE_EMULATOR_HOST', 'GCLOUD_PROJECT']) {
      expect(dropFromShell(name)).toBe(true);
    }
  });

  it('refuses a live Stripe key in the shell, an emulator host, an inline key, or a linked checkout', () => {
    expect(plan([], { shellEnv: { ...shell, STRIPE_SECRET_KEY: 'sk_live_abc' } }).problems.join(' ')).toMatch(/live-mode key/);
    expect(plan([], { shellEnv: { ...shell, FIRESTORE_EMULATOR_HOST: 'localhost:8080' } }).problems.join(' ')).toMatch(/FIRESTORE_EMULATOR_HOST/);
    expect(plan([], { shellEnv: { ...shell, STAGING_SERVICE_ACCOUNT_KEY: '{}' } }).problems.join(' ')).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
    expect(plan([], { checkout: { linkedSite: true, rootEnvFiles: [] } }).problems.join(' ')).toMatch(/linked to a Netlify site/);
    expect(plan([], { checkout: { linkedSite: false, rootEnvFiles: ['.env'] } }).problems.join(' ')).toMatch(/\.env/);
  });

  it('refuses with no credential, a credential for another project, or production not ruled out', () => {
    expect(plan([], { credential: null }).problems.join(' ')).toMatch(/credential for the staging project is required/);
    expect(plan([], { credential: { ...stagingCredential, projectId: PROD } }).problems.join(' ')).toMatch(/different project/);
    expect(plan([], { shellEnv: { PATH: '/usr/bin' } }).problems.join(' ')).toMatch(/PRODUCTION_FIREBASE_PROJECT_ID/);
  });

  it('clean-up needs a run id, is a dry run by default, and rejects a malformed id', () => {
    expect(plan(['--cleanup-only']).problems.join(' ')).toMatch(/needs --run-id/);
    expect(plan(['--cleanup-only', '--run-id=abc123xyz']).mode).toBe('cleanup-dry-run');
    expect(plan(['--cleanup-only', '--run-id=abc123xyz', '--apply', `--confirm-project=${STAGING_PROJECT}`]).mode).toBe('cleanup');
    expect(plan(['--cleanup-only', '--run-id=../users']).problems.join(' ')).toMatch(/run id must be/);
  });

  it('rejects unknown arguments instead of ignoring them', () => {
    expect(() => parseArgs(['--project=anything'])).toThrow(RehearsalRefusal);
    expect(() => parseArgs(['--force'])).toThrow(RehearsalRefusal);
  });

  it('describes a run from its id alone', () => {
    const run = describeRun('fixedrunid01');
    expect(run.users).toHaveLength(SLOTS.length);
    expect(run.users.every((path) => path.startsWith('users/rehearsal-fixedrunid01-'))).toBe(true);
    expect(run.steps).toHaveLength(11);
  });
});

describe('billing rehearsal — it changes no billing function', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (path) => readFileSync(resolve(here, '../..', path), 'utf8');

  it('no Netlify function imports anything from the rehearsal', () => {
    for (const file of ['netlify/functions/stripe-webhook.js', 'netlify/functions/create-checkout-session.js', 'netlify/functions/firebase-admin.js']) {
      expect(read(file)).not.toMatch(/billingRehearsal|rehearsal/i);
    }
  });

  it('the real-Firestore spec checks its target before it imports the Firestore client', () => {
    const spec = read('src/test/stripeWebhookStagingRehearsal.test.js');
    const guardAt = spec.indexOf('target = resolveTarget(');
    const importAt = spec.indexOf("await import('../../netlify/functions/firebase-admin.js')");
    expect(guardAt).toBeGreaterThan(0);
    expect(importAt).toBeGreaterThan(guardAt);
    expect(spec).not.toMatch(/import .* from '\.\.\/\.\.\/netlify\/functions/);
    expect(spec).not.toMatch(/billingTestUtils|wipeBillingCollections/);
  });
});
