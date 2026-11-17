/**
 * STAGING ONLY: the rules for letting Stripe into a staging run, in TEST MODE ONLY.
 *
 * Staging normally holds no Stripe key at all (stagingPreflight.mjs, I5). Billing work needs
 * real Stripe behaviour: Checkout, the Customer Portal, test clocks, real webhook payloads. These
 * checks allow exactly that and nothing more:
 *
 *   - the secret key is a test-mode key (sk_test_… or rk_test_…). A live key is refused by
 *     name, and so is anything that is not recognisably either;
 *   - the webhook secret is a signing secret (whsec_…), normally the one `stripe listen` prints;
 *   - the price ids are price ids. A live price cannot be read with a test key, so the setup
 *     script (stripeTestModeSetup.mjs) is what proves they belong to the test account;
 *   - BILLING_LEDGER_EPOCH_UNIX is a whole number of seconds, so the webhook grants in staging
 *     the way it does in production. It is staging's own value, never production's.
 *
 * Pure: no network, no file access, never a value in a message.
 */

export const STRIPE_TEST_MODE_KEYS = Object.freeze([
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PRO',
]);

/** Stripe variables a billing run may also carry. Checked when present. */
export const STRIPE_OPTIONAL_KEYS = Object.freeze([
  'STRIPE_PRICE_SCOUT_STARTER_FREE', 'STRIPE_PORTAL_CONFIGURATION_ID',
]);

/** 'test', 'live' or 'unknown'. Secret keys (sk_) and restricted keys (rk_) only. */
export function stripeKeyMode(key) {
  if (typeof key !== 'string') return 'unknown';
  if (/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) return 'test';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  return 'unknown';
}

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/** [{ id, ok, message }] for a billing run's Stripe settings. Pure. */
export function checkStripeTestMode(env) {
  const results = [];
  const add = (id, ok, message) => results.push({ id, ok, message });

  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  add('stripe-test-key', mode === 'test',
    mode === 'test' ? 'STRIPE_SECRET_KEY is a test-mode key.'
      : mode === 'live' ? 'STRIPE_SECRET_KEY is a LIVE key. Only test-mode keys (sk_test_ or rk_test_) are allowed in staging.'
        : 'STRIPE_SECRET_KEY must be a test-mode key (sk_test_ or rk_test_).');

  const secretOk = /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? '');
  add('stripe-webhook-secret', secretOk,
    secretOk ? 'STRIPE_WEBHOOK_SECRET is a signing secret.' : 'STRIPE_WEBHOOK_SECRET must be the signing secret `stripe listen` prints (whsec_…).');

  const badPrices = ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PRO']
    .filter((k) => !/^price_[A-Za-z0-9]+$/.test(env[k] ?? ''));
  const badOptional = STRIPE_OPTIONAL_KEYS
    .filter((k) => filled(env[k]))
    .filter((k) => !(k === 'STRIPE_PORTAL_CONFIGURATION_ID' ? /^bpc_[A-Za-z0-9]+$/ : /^price_[A-Za-z0-9]+$/).test(env[k]));
  const bad = [...badPrices, ...badOptional];
  add('stripe-ids', bad.length === 0,
    bad.length ? `Not a Stripe id of the right kind: ${bad.join(', ')}. Run scripts/staging/stripeTestModeSetup.mjs for the values.`
      : 'The price (and portal configuration) ids are well formed.');

  const epoch = env.BILLING_LEDGER_EPOCH_UNIX;
  const epochOk = /^\d{10}$/.test(epoch ?? '');
  add('billing-epoch', epochOk,
    epochOk ? 'BILLING_LEDGER_EPOCH_UNIX is set for this staging run.'
      : 'Set BILLING_LEDGER_EPOCH_UNIX to a Unix time in seconds (for example the output of `date +%s` when the session starts). Without it every staging purchase is flagged instead of granted.');

  return results;
}
