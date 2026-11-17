/**
 * scripts/staging/billingAccountSnapshot.mjs: the read-only check used after each Stripe
 * test-mode checkout scenario. It must refuse anything but staging and test mode, and its
 * checks must catch the failures the validation exists to find.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeAccount, assertTestMode, parseArgs, planSnapshot, SnapshotRefusal,
} from '../../scripts/staging/billingAccountSnapshot.mjs';
import { STAGING_PROJECT } from '../../scripts/staging/billingRehearsal/guard.mjs';

// Project ids come from the tool's own constant, never a literal (scripts/checkNoHardcodedProjectId.mjs).
const OTHER_PROJECT = 'acme-prod';

const failing = (summary) => summary.checks.filter((c) => !c.ok).map((c) => c.id);
const sub = (id, status, price = 'price_starter') => ({ id, status, livemode: false, items: { data: [{ price: { id: price } }] } });
const STARTER = { hasCompletedPayment: true, subscriptionTier: 'starter', subscriptionStatus: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', credits: { total: 400, used: 0, remaining: 400 } };
const stripeWith = (subscriptions) => ({ customer: { id: 'cus_1', livemode: false }, subscriptions, sessions: [] });

describe('summarizeAccount', () => {
  it('a new Free account: plan free, every check passes', () => {
    const s = summarizeAccount({ user: { email: 'a@example.test' }, stripe: stripeWith([]) });
    expect(s.plan).toBe('free');
    expect(failing(s)).toEqual([]);
  });

  it('a successful Starter purchase: one subscription, 400 credits, one grant', () => {
    const s = summarizeAccount({ user: STARTER, allocations: [{ id: 'sub_1', priceId: 'price_starter' }], stripe: stripeWith([sub('sub_1', 'active')]) });
    expect(s.plan).toBe('starter');
    expect(failing(s)).toEqual([]);
  });

  it('a duplicate subscription is caught', () => {
    const s = summarizeAccount({ user: STARTER, allocations: [{ id: 'sub_1' }], stripe: stripeWith([sub('sub_1', 'active'), sub('sub_2', 'active')]) });
    expect(failing(s)).toContain('one-live-subscription');
  });

  it('paid in Stripe but no paid access (a grant that did not happen) is caught', () => {
    const s = summarizeAccount({ user: { stripeCustomerId: 'cus_1', subscriptionStatus: 'active' }, stripe: stripeWith([sub('sub_1', 'active')]) });
    expect(failing(s)).toContain('paid-access-matches-stripe');
  });

  it('paid access with no paying subscription (a cancellation not applied) is caught', () => {
    const s = summarizeAccount({ user: STARTER, allocations: [{ id: 'sub_1' }], stripe: stripeWith([sub('sub_1', 'canceled')]) });
    expect(failing(s)).toContain('paid-access-matches-stripe');
  });

  it('wrong credits, or no grant marker, is caught', () => {
    const s = summarizeAccount({ user: { ...STARTER, credits: { total: 1250 } }, allocations: [], stripe: stripeWith([sub('sub_1', 'active')]) });
    expect(failing(s)).toEqual(expect.arrayContaining(['plan-credits', 'granted-once']));
  });

  it('a pending review record and a stuck checkout are caught', () => {
    const s = summarizeAccount({
      user: { ...STARTER, pendingCheckout: { status: 'needs_reconciliation' } },
      allocations: [{ id: 'sub_1' }],
      ambiguous: [{ reason: 'customer_mismatch', status: 'pending' }],
      stripe: stripeWith([sub('sub_1', 'active')]),
    });
    expect(failing(s)).toEqual(expect.arrayContaining(['no-pending-review', 'no-stuck-checkout']));
  });

  it('a resubscription: one canceled and one active subscription, two grants, is consistent', () => {
    const s = summarizeAccount({
      user: { ...STARTER, stripeSubscriptionId: 'sub_2' },
      allocations: [{ id: 'sub_1' }, { id: 'sub_2' }],
      stripe: stripeWith([sub('sub_1', 'canceled'), sub('sub_2', 'active')]),
    });
    expect(failing(s)).toEqual([]);
    expect(s.grants).toHaveLength(2);
  });

  it('without a Stripe key it checks Firestore only', () => {
    const s = summarizeAccount({ user: STARTER, allocations: [{ id: 'sub_1' }], stripe: null });
    expect(s.stripe).toBeNull();
    expect(s.checks.map((c) => c.id)).not.toContain('one-live-subscription');
  });
});

describe('test mode only', () => {
  it('stops on any live-mode Stripe object', () => {
    expect(() => assertTestMode([{ id: 'cus_1', livemode: false }, { id: 'sub_1', livemode: true }])).toThrow(SnapshotRefusal);
  });

  it('refuses a live key before contacting anything', () => {
    expect(() => planSnapshot({ STRIPE_SECRET_KEY: 'sk_live_abc', PRODUCTION_FIREBASE_PROJECT_ID: 'prod' }, null)).toThrow(/LIVE key/);
  });

  it('refuses a key that is not recognisably test mode', () => {
    expect(() => planSnapshot({ STRIPE_SECRET_KEY: 'pk_test_abc', PRODUCTION_FIREBASE_PROJECT_ID: 'prod' }, null)).toThrow(/test-mode key/);
  });
});

describe('staging only', () => {
  const credential = { kind: 'key', projectId: STAGING_PROJECT, clientEmail: `qa@${STAGING_PROJECT}.iam.gserviceaccount.com`, privateKey: 'x' };

  it('resolves to the staging project with a staging credential', () => {
    const plan = planSnapshot({ PRODUCTION_FIREBASE_PROJECT_ID: OTHER_PROJECT }, credential);
    expect(plan.target).toEqual({ mode: 'staging', projectId: STAGING_PROJECT });
    expect(plan.env.FIREBASE_PROJECT_ID).toBe(STAGING_PROJECT);
  });

  it('refuses without the production id to rule out', () => {
    expect(() => planSnapshot({}, credential)).toThrow(/PRODUCTION_FIREBASE_PROJECT_ID/);
  });

  it('refuses a credential from another project', () => {
    expect(() => planSnapshot({ PRODUCTION_FIREBASE_PROJECT_ID: OTHER_PROJECT }, { ...credential, projectId: OTHER_PROJECT })).toThrow();
  });

  it('refuses with no credential', () => {
    expect(() => planSnapshot({ PRODUCTION_FIREBASE_PROJECT_ID: OTHER_PROJECT }, null)).toThrow(/credential/);
  });

  it('refuses the emulator', () => {
    expect(() => planSnapshot({ PRODUCTION_FIREBASE_PROJECT_ID: OTHER_PROJECT, FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, credential)).toThrow(/staging project/);
  });
});

describe('arguments', () => {
  it('takes exactly one of --uid or --email', () => {
    expect(parseArgs(['--uid=u1'])).toMatchObject({ uid: 'u1', email: null });
    expect(parseArgs(['--email=a@example.test', '--json'])).toMatchObject({ email: 'a@example.test', json: true });
    expect(() => parseArgs([])).toThrow(SnapshotRefusal);
    expect(() => parseArgs(['--uid=u1', '--email=a@example.test'])).toThrow(SnapshotRefusal);
    expect(() => parseArgs(['--write'])).toThrow(/Unknown argument/);
  });
});
