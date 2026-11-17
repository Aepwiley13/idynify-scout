/**
 * Stripe in staging, TEST MODE ONLY (docs/billing/STRIPE_TEST_MODE.md).
 *
 * The staging tools refused every Stripe key. A billing run (--billing) now allows Stripe, but
 * only a test-mode key, and every other integration stays refused. The setup script creates the
 * test catalog and portal configuration once, and never runs against a live key.
 */
import { describe, it, expect, vi } from 'vitest';
import { stripeKeyMode, checkStripeTestMode } from '../../scripts/staging/stripeTestMode.mjs';
import { checkStagingEnv } from '../../scripts/staging/stagingPreflight.mjs';
import { dropFromShell, planDevRun } from '../../scripts/staging/stagingDev.mjs';
import {
  run, readCurrent, planSetup, portalConfigurationParams, requireTestKey, envLines, SetupRefusal, TEST_CATALOG, SETUP_MARKER,
} from '../../scripts/staging/stripeTestModeSetup.mjs';

const P = 'acme-staging';
const PROD = 'acme-prod';
const KEY = '-----BEGIN PRIVATE KEY-----\\nSECRETKEYMATERIAL\\n-----END PRIVATE KEY-----';
const firebase = () => ({
  VITE_FIREBASE_API_KEY: 'AIzaSECRETWEBKEY', VITE_FIREBASE_AUTH_DOMAIN: `${P}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: P,
  VITE_FIREBASE_STORAGE_BUCKET: `${P}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123', VITE_FIREBASE_APP_ID: '1:123:web:abc',
  FIREBASE_PROJECT_ID: P, FIREBASE_CLIENT_EMAIL: `qa@${P}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: KEY,
});
const stripeTest = () => ({
  STRIPE_SECRET_KEY: 'sk_test_SECRETVALUE123', STRIPE_WEBHOOK_SECRET: 'whsec_SECRETVALUE456',
  STRIPE_PRICE_STARTER: 'price_starter1', STRIPE_PRICE_PRO: 'price_pro1',
  BILLING_LEDGER_EPOCH_UNIX: '1795000000', VITE_STRIPE_ENABLED: 'true', VITE_STRIPE_CHECKOUT_MODE: 'session',
});
const failing = (env, opts = {}) => checkStagingEnv(env, { productionProjectId: PROD, ...opts }).filter((r) => !r.ok).map((r) => r.id);

describe('stripeKeyMode', () => {
  it.each([
    ['sk_test_abc123', 'test'], ['rk_test_abc123', 'test'],
    ['sk_live_abc123', 'live'], ['rk_live_abc123', 'live'],
    ['pk_test_abc123', 'unknown'], ['', 'unknown'], [undefined, 'unknown'], ['sk_test_', 'unknown'],
  ])('%s → %s', (key, mode) => {
    expect(stripeKeyMode(key)).toBe(mode);
  });
});

describe('checkStagingEnv without --billing is unchanged', () => {
  it('still refuses a test-mode Stripe key', () => {
    expect(failing({ ...firebase(), STRIPE_SECRET_KEY: 'sk_test_SECRETVALUE123' })).toEqual(['no-integrations']);
  });

  it('still refuses VITE_STRIPE_ENABLED=true', () => {
    expect(failing({ ...firebase(), VITE_STRIPE_ENABLED: 'true' })).toEqual(['no-integrations']);
  });
});

describe('checkStagingEnv with --billing', () => {
  const billing = { billing: true };

  it('passes Firebase staging plus Stripe test mode', () => {
    expect(failing({ ...firebase(), ...stripeTest() }, billing)).toEqual([]);
  });

  it('refuses a live secret key, by name', () => {
    const results = checkStagingEnv({ ...firebase(), ...stripeTest(), STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE' }, { productionProjectId: PROD, ...billing });
    const r = results.find((x) => x.id === 'stripe-test-key');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/LIVE key/);
    expect(JSON.stringify(results)).not.toContain('SECRETVALUE');
  });

  it('refuses a live restricted key and a publishable key', () => {
    expect(failing({ ...firebase(), ...stripeTest(), STRIPE_SECRET_KEY: 'rk_live_x1' }, billing)).toEqual(['stripe-test-key']);
    expect(failing({ ...firebase(), ...stripeTest(), STRIPE_SECRET_KEY: 'pk_test_x1' }, billing)).toEqual(['stripe-test-key']);
  });

  it('still refuses every other integration', () => {
    expect(failing({ ...firebase(), ...stripeTest(), APOLLO_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }, billing)).toEqual(['no-integrations']);
  });

  it('still refuses production Firebase', () => {
    const env = { ...firebase(), ...stripeTest(), VITE_FIREBASE_PROJECT_ID: PROD, FIREBASE_PROJECT_ID: PROD, VITE_FIREBASE_AUTH_DOMAIN: `${PROD}.firebaseapp.com`, FIREBASE_CLIENT_EMAIL: `qa@${PROD}.iam.gserviceaccount.com` };
    expect(failing(env, billing)).toEqual(expect.arrayContaining(['looks-like-staging', 'not-production']));
  });

  it.each([
    ['no webhook secret', { STRIPE_WEBHOOK_SECRET: '' }, ['stripe-webhook-secret']],
    ['a price that is not a price id', { STRIPE_PRICE_PRO: 'prod_123' }, ['stripe-ids']],
    ['a portal id of the wrong kind', { STRIPE_PORTAL_CONFIGURATION_ID: 'price_x' }, ['stripe-ids']],
    ['no epoch', { BILLING_LEDGER_EPOCH_UNIX: '' }, ['billing-epoch']],
    ['an epoch in milliseconds', { BILLING_LEDGER_EPOCH_UNIX: '1795000000000' }, ['billing-epoch']],
  ])('refuses %s', (_label, change, ids) => {
    expect(failing({ ...firebase(), ...stripeTest(), ...change }, billing)).toEqual(ids);
  });

  it('accepts a well-formed portal configuration id', () => {
    expect(failing({ ...firebase(), ...stripeTest(), STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_abc123' }, billing)).toEqual([]);
  });
});

describe('checkStripeTestMode never prints a value', () => {
  it('names variables, not their contents', () => {
    const out = JSON.stringify(checkStripeTestMode({ STRIPE_SECRET_KEY: 'sk_live_TOPSECRET', STRIPE_WEBHOOK_SECRET: 'nope_TOPSECRET' }));
    expect(out).not.toContain('TOPSECRET');
  });
});

describe('stagingDev takes Stripe from the env file only', () => {
  it('drops every STRIPE_ and BILLING_ variable from the shell', () => {
    for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_PORTAL_CONFIGURATION_ID', 'STRIPE_PRICE_PRO', 'BILLING_LEDGER_EPOCH_UNIX']) {
      expect(dropFromShell(name)).toBe(true);
    }
    expect(dropFromShell('PATH')).toBe(false);
  });

  it('a live key in the shell never reaches the app; the env file test key does', () => {
    const plan = planDevRun({
      fileEnv: { ...firebase(), ...stripeTest() },
      credential: { source: 'test', clientEmail: `qa@${P}.iam.gserviceaccount.com`, privateKey: KEY, projectId: P },
      shellEnv: { PATH: '/bin', STRIPE_SECRET_KEY: 'sk_live_FROMSHELL' },
      checks: [],
    });
    expect(plan.ok).toBe(true);
    expect(plan.childEnv.STRIPE_SECRET_KEY).toBe('sk_test_SECRETVALUE123');
    expect(JSON.stringify(plan.childEnv)).not.toContain('FROMSHELL');
  });
});

// ── stripeTestModeSetup.mjs, against a fake Stripe client ───────────────────────────────────

function fakeStripe({ livemode = false, existing = {} } = {}) {
  const state = { prices: [...(existing.prices ?? [])], configs: [...(existing.configs ?? [])], products: [] };
  const calls = { creates: 0 };
  let n = 0;
  const stripe = {
    prices: {
      list: vi.fn(async ({ lookup_keys }) => ({ data: state.prices.filter((p) => lookup_keys.includes(p.lookup_key)), has_more: false })),
      create: vi.fn(async (params) => { calls.creates++; const p = { id: `price_new${++n}`, livemode, ...params }; state.prices.push(p); return p; }),
    },
    products: {
      create: vi.fn(async (params) => { calls.creates++; const p = { id: `prod_new${++n}`, livemode, ...params }; state.products.push(p); return p; }),
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({ data: state.configs, has_more: false })),
        create: vi.fn(async (params) => { calls.creates++; const c = { id: `bpc_new${++n}`, livemode, active: true, ...params }; state.configs.push(c); return c; }),
      },
    },
  };
  return { stripe, state, calls };
}

describe('stripeTestModeSetup', () => {
  it('refuses a live key before any client exists', async () => {
    const makeStripe = vi.fn();
    await expect(run({ argv: [], env: { STRIPE_SECRET_KEY: 'sk_live_x1' }, makeStripe, log: () => {} })).rejects.toThrow(/LIVE key/);
    expect(makeStripe).not.toHaveBeenCalled();
  });

  it('refuses a missing key', () => {
    expect(() => requireTestKey({})).toThrow(SetupRefusal);
  });

  it('a dry run reads and creates nothing', async () => {
    const { stripe, calls } = fakeStripe();
    const lines = [];
    await run({ argv: [], env: { STRIPE_SECRET_KEY: 'sk_test_abc1' }, makeStripe: () => stripe, log: (l) => lines.push(l) });
    expect(calls.creates).toBe(0);
    expect(lines.join('\n')).toMatch(/Would create: idynify_test_starter_monthly, idynify_test_pro_monthly, portal configuration/);
  });

  it('--apply creates the catalog and portal once; a second run creates nothing', async () => {
    const fake = fakeStripe();
    const lines = [];
    await run({ argv: ['--apply'], env: { STRIPE_SECRET_KEY: 'sk_test_abc1' }, makeStripe: () => fake.stripe, log: (l) => lines.push(l) });
    expect(fake.calls.creates).toBe(5); // 2 products, 2 prices, 1 portal configuration
    expect(lines.join('\n')).toMatch(/STRIPE_PRICE_STARTER=price_new\d+/);
    expect(lines.join('\n')).toMatch(/STRIPE_PORTAL_CONFIGURATION_ID=bpc_new\d+/);
    expect(lines.join('\n')).not.toContain('sk_test_abc1');

    await run({ argv: ['--apply'], env: { STRIPE_SECRET_KEY: 'sk_test_abc1' }, makeStripe: () => fake.stripe, log: () => {} });
    expect(fake.calls.creates).toBe(5);
  });

  it('sends an idempotency key with every create', async () => {
    const fake = fakeStripe();
    await run({ argv: ['--apply'], env: { STRIPE_SECRET_KEY: 'sk_test_abc1' }, makeStripe: () => fake.stripe, log: () => {} });
    for (const fn of [fake.stripe.products.create, fake.stripe.prices.create, fake.stripe.billingPortal.configurations.create]) {
      for (const call of fn.mock.calls) expect(call[1]?.idempotencyKey).toMatch(/^idynify-test-mode-v1-/);
    }
  });

  it('prices are monthly USD at $20 and $50, with their lookup keys', async () => {
    const fake = fakeStripe();
    await run({ argv: ['--apply'], env: { STRIPE_SECRET_KEY: 'sk_test_abc1' }, makeStripe: () => fake.stripe, log: () => {} });
    const params = fake.stripe.prices.create.mock.calls.map((c) => c[0]);
    expect(params.map((p) => [p.lookup_key, p.unit_amount, p.currency, p.recurring.interval])).toEqual([
      ['idynify_test_starter_monthly', 2000, 'usd', 'month'],
      ['idynify_test_pro_monthly', 5000, 'usd', 'month'],
    ]);
  });

  it('stops if Stripe ever answers with a live-mode object', async () => {
    const fake = fakeStripe({ existing: { prices: [{ id: 'price_live1', lookup_key: TEST_CATALOG[0].lookupKey, livemode: true }] } });
    await expect(readCurrent(fake.stripe)).rejects.toThrow(/live-mode price/);
  });

  it('finds an existing portal configuration by its marker', async () => {
    const fake = fakeStripe({ existing: { configs: [{ id: 'bpc_old', active: true, livemode: false, metadata: { idynify_setup: SETUP_MARKER } }] } });
    const current = await readCurrent(fake.stripe);
    expect(planSetup(current).createPortal).toBe(false);
    expect(envLines(current)).toContain('STRIPE_PORTAL_CONFIGURATION_ID=bpc_old');
  });
});

describe('the portal configuration', () => {
  const params = portalConfigurationParams('https://example.test/settings?tab=billing');

  it('cancels at the end of the period, never immediately', () => {
    expect(params.features.subscription_cancel).toEqual({ enabled: true, mode: 'at_period_end' });
  });

  it('keeps plan switching off until the webhook mirrors plan changes', () => {
    expect(params.features.subscription_update.enabled).toBe(false);
  });

  it('offers payment methods, invoices and billing details', () => {
    expect(params.features.payment_method_update.enabled).toBe(true);
    expect(params.features.invoice_history.enabled).toBe(true);
    expect(params.features.customer_update.enabled).toBe(true);
  });

  it('returns customers to Settings → Billing', () => {
    expect(params.default_return_url).toBe('https://example.test/settings?tab=billing');
  });
});
