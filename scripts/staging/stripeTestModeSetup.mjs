#!/usr/bin/env node
/**
 * STRIPE TEST MODE ONLY: create (once) the test-mode catalog and Customer Portal configuration
 * a staging billing run needs, and print the env-file lines for them.
 *
 * What it creates, in the TEST account only, each found again by its own marker so a second
 * run changes nothing:
 *   - Scout Starter (test): a $20/month price, lookup key idynify_test_starter_monthly
 *   - Scout Pro (test):     a $50/month price, lookup key idynify_test_pro_monthly
 *   - a Customer Portal configuration (metadata idynify_setup=test-mode-v1) offering payment
 *     methods, invoice history, billing details, and cancellation at the END of the period.
 *     Plan switching is OFF: it stays off until the webhook mirrors plan changes (billing
 *     plan, Phase 2). The account's default portal configuration is never touched.
 *
 * What it never does:
 *   - run with a live key. The key must be sk_test_… or rk_test_…; anything else is refused
 *     before a client is created, and any object Stripe returns with livemode: true stops it.
 *   - read the key from anywhere but STRIPE_SECRET_KEY in this shell, or print it.
 *   - create customers, subscriptions, charges, or webhooks.
 *
 *   read -rs STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY     # typed at a hidden prompt
 *   node scripts/staging/stripeTestModeSetup.mjs                # dry run: reads only
 *   node scripts/staging/stripeTestModeSetup.mjs --apply        # creates what is missing
 *   (optional) --return-url=<url>   portal "return to Idynify" link;
 *                                   default http://localhost:8888/settings?tab=billing
 *
 * Exit 0 when everything exists (or, in a dry run, when the plan was read); 1 otherwise.
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { stripeKeyMode } from './stripeTestMode.mjs';

export const SETUP_MARKER = 'test-mode-v1';
export const DEFAULT_RETURN_URL = 'http://localhost:8888/settings?tab=billing';

export const TEST_CATALOG = Object.freeze([
  Object.freeze({ envVar: 'STRIPE_PRICE_STARTER', lookupKey: 'idynify_test_starter_monthly', productName: 'Scout Starter (test)', unitAmount: 2000 }),
  Object.freeze({ envVar: 'STRIPE_PRICE_PRO', lookupKey: 'idynify_test_pro_monthly', productName: 'Scout Pro (test)', unitAmount: 5000 }),
]);

export class SetupRefusal extends Error {}

/** The portal configuration this run wants. Plan switching deliberately off. */
export function portalConfigurationParams(returnUrl = DEFAULT_RETURN_URL) {
  return {
    business_profile: { headline: 'Idynify billing (test mode)' },
    default_return_url: returnUrl,
    features: {
      customer_update: { enabled: true, allowed_updates: ['name', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
    metadata: { idynify_setup: SETUP_MARKER },
  };
}

function assertTestObject(obj, what) {
  if (obj && obj.livemode === true) throw new SetupRefusal(`Stripe returned a live-mode ${what}. Stopped: this tool only works in test mode.`);
  return obj;
}

/** Reads only. { prices: { [envVar]: price|null }, portal: configuration|null }. */
export async function readCurrent(stripe) {
  const list = await stripe.prices.list({ lookup_keys: TEST_CATALOG.map((c) => c.lookupKey), active: true, limit: 10 });
  const prices = {};
  for (const item of TEST_CATALOG) {
    const found = (list.data ?? []).find((p) => p.lookup_key === item.lookupKey) ?? null;
    prices[item.envVar] = assertTestObject(found, 'price');
  }
  let portal = null;
  let startingAfter;
  for (;;) {
    const page = await stripe.billingPortal.configurations.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    portal = (page.data ?? []).find((c) => c.metadata?.idynify_setup === SETUP_MARKER && c.active !== false) ?? null;
    if (portal || !page.has_more || !page.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  assertTestObject(portal, 'portal configuration');
  return { prices, portal };
}

/** What a run would create. Pure. */
export function planSetup(current) {
  return {
    createPrices: TEST_CATALOG.filter((item) => !current.prices[item.envVar]),
    createPortal: !current.portal,
  };
}

/** Creates what the plan lists. Idempotency keys make a retried run safe. */
export async function applySetup(stripe, plan, { returnUrl = DEFAULT_RETURN_URL } = {}) {
  const created = { prices: {}, portal: null };
  for (const item of plan.createPrices) {
    const product = assertTestObject(await stripe.products.create(
      { name: item.productName, metadata: { idynify_setup: SETUP_MARKER } },
      { idempotencyKey: `idynify-${SETUP_MARKER}-product-${item.lookupKey}` },
    ), 'product');
    const price = assertTestObject(await stripe.prices.create(
      {
        product: product.id, currency: 'usd', unit_amount: item.unitAmount, recurring: { interval: 'month' },
        lookup_key: item.lookupKey, metadata: { idynify_setup: SETUP_MARKER },
      },
      { idempotencyKey: `idynify-${SETUP_MARKER}-price-${item.lookupKey}` },
    ), 'price');
    created.prices[item.envVar] = price;
  }
  if (plan.createPortal) {
    created.portal = assertTestObject(await stripe.billingPortal.configurations.create(
      portalConfigurationParams(returnUrl),
      { idempotencyKey: `idynify-${SETUP_MARKER}-portal` },
    ), 'portal configuration');
  }
  return created;
}

/** The env-file lines for a billing run. Ids only; never a secret. */
export function envLines({ prices, portal }) {
  const lines = TEST_CATALOG.map((item) => `${item.envVar}=${prices[item.envVar]?.id ?? '<missing>'}`);
  lines.push(`STRIPE_PORTAL_CONFIGURATION_ID=${portal?.id ?? '<missing>'}`);
  return lines;
}

/** Refuses anything but a test-mode key, before any client exists. */
export function requireTestKey(env) {
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  if (mode === 'live') throw new SetupRefusal('STRIPE_SECRET_KEY is a LIVE key. This tool only runs in test mode. Nothing was contacted.');
  if (mode !== 'test') throw new SetupRefusal('Set STRIPE_SECRET_KEY to a test-mode key (sk_test_ or rk_test_). Nothing was contacted.');
  return env.STRIPE_SECRET_KEY;
}

export async function run({ argv, env, makeStripe, log = console.log }) {
  const apply = argv.includes('--apply');
  const returnArg = argv.find((a) => a.startsWith('--return-url='));
  const returnUrl = returnArg ? returnArg.slice('--return-url='.length) : DEFAULT_RETURN_URL;
  const unknown = argv.filter((a) => a !== '--apply' && !a.startsWith('--return-url='));
  if (unknown.length) throw new SetupRefusal(`Unknown argument: ${unknown[0].split('=')[0]}`);

  const stripe = makeStripe(requireTestKey(env));
  const current = await readCurrent(stripe);
  const plan = planSetup(current);
  const missing = [...plan.createPrices.map((p) => p.lookupKey), ...(plan.createPortal ? ['portal configuration'] : [])];

  if (!apply) {
    log(missing.length ? `Dry run. Would create: ${missing.join(', ')}.` : 'Dry run. Everything already exists.');
    log(envLines(current).join('\n'));
    return 0;
  }
  const created = await applySetup(stripe, plan, { returnUrl });
  const final = {
    prices: { ...current.prices, ...created.prices },
    portal: current.portal ?? created.portal,
  };
  log(missing.length ? `Created: ${missing.join(', ')}.` : 'Nothing to create.');
  log('Add these lines to the staging env file (they are ids, not secrets):');
  log(envLines(final).join('\n'));
  return 0;
}

async function main() {
  try {
    const { default: Stripe } = await import('stripe');
    return await run({ argv: process.argv.slice(2), env: process.env, makeStripe: (key) => new Stripe(key) });
  } catch (err) {
    if (err instanceof SetupRefusal) { console.error(`Refused: ${err.message}`); return 1; }
    console.error(`Failed: ${err?.type ?? err?.name ?? 'error'}: ${err?.message ?? ''}`.trim());
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = await main();
