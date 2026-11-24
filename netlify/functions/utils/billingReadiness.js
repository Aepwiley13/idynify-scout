const requiredEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
];
const validSecretFormat = (value) => /^sk_live_[A-Za-z0-9]+$/.test(value ?? '') || /^rk_live_[A-Za-z0-9]+$/.test(value ?? '');
const validWebhookSecretFormat = (value) => /^whsec_[A-Za-z0-9]+$/.test(value ?? '');
const safeCode = (error) => typeof error?.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
  ? error.code : typeof error?.type === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(error.type) ? error.type : 'unknown';

const priceSummary = (price, amount) => ({
  ready: Boolean(price?.active && price?.recurring?.interval === 'month' && price?.unit_amount === amount),
});

/** Read-only live Stripe checks. The function returns statuses only, never credential or resource values. */
export async function inspectBillingReadiness({ stripe, env, webhookUrl = 'https://idynify.com/.netlify/functions/stripe-webhook' }) {
  const checks = {
    liveSecretFormat: validSecretFormat(env.STRIPE_SECRET_KEY),
    webhookSecretFormat: validWebhookSecretFormat(env.STRIPE_WEBHOOK_SECRET),
    ledgerEpochUnchanged: env.BILLING_LEDGER_EPOCH_UNIX === '1794632515',
    starterPrice: { ready: false },
    proPrice: { ready: false },
    legacyFreeScoutPrice: { configured: Boolean(env.STRIPE_PRICE_SCOUT_STARTER_FREE), ready: false },
    portal: {
      ready: false,
      configured: Boolean(env.STRIPE_PORTAL_CONFIGURATION_ID),
      planChanges: false,
      safeDowngrades: false,
      cancelAtPeriodEnd: false,
    },
    webhook: { ready: false, endpointFound: false, missingEvents: requiredEvents },
  };
  if (!checks.liveSecretFormat) return { ready: false, checks, errorCode: 'secret_not_runtime_verifiable' };

  try {
    const [starter, pro, legacyFree] = await Promise.all([
      env.STRIPE_PRICE_STARTER ? stripe.prices.retrieve(env.STRIPE_PRICE_STARTER) : null,
      env.STRIPE_PRICE_PRO ? stripe.prices.retrieve(env.STRIPE_PRICE_PRO) : null,
      env.STRIPE_PRICE_SCOUT_STARTER_FREE ? stripe.prices.retrieve(env.STRIPE_PRICE_SCOUT_STARTER_FREE) : null,
    ]);
    checks.starterPrice = priceSummary(starter, 2000);
    checks.proPrice = priceSummary(pro, 5000);
    if (env.STRIPE_PRICE_SCOUT_STARTER_FREE) checks.legacyFreeScoutPrice = priceSummary(legacyFree, 0);
  } catch (error) {
    return { ready: false, checks, errorCode: safeCode(error) };
  }

  if (env.STRIPE_PORTAL_CONFIGURATION_ID) {
    try {
      const portal = await stripe.billingPortal.configurations.retrieve(env.STRIPE_PORTAL_CONFIGURATION_ID);
      const update = portal?.features?.subscription_update;
      const cancel = portal?.features?.subscription_cancel;
      const prices = new Set((update?.products ?? []).flatMap((product) => product.prices ?? []));
      checks.portal.planChanges = update?.enabled === true
        && update.default_allowed_updates?.includes('price') === true
        && prices.has(env.STRIPE_PRICE_STARTER)
        && prices.has(env.STRIPE_PRICE_PRO);
      checks.portal.safeDowngrades = checks.portal.planChanges
        && update.schedule_at_period_end?.conditions?.some((condition) => condition.type === 'decreasing_item_amount') === true;
      checks.portal.cancelAtPeriodEnd = cancel?.enabled === true && cancel.mode === 'at_period_end';
      checks.portal.ready = portal?.active === true
        && checks.portal.planChanges
        && checks.portal.safeDowngrades
        && checks.portal.cancelAtPeriodEnd;
    } catch (error) {
      checks.portal.errorCode = safeCode(error);
    }
  }

  try {
    let startingAfter;
    let bestMissing = requiredEvents;
    for (;;) {
      const page = await stripe.webhookEndpoints.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      for (const endpoint of page.data ?? []) {
        if (endpoint.url === webhookUrl && endpoint.status === 'enabled') {
          checks.webhook.endpointFound = true;
          const events = new Set(endpoint.enabled_events ?? []);
          const missing = requiredEvents.filter((event) => !events.has(event));
          if (missing.length < bestMissing.length) bestMissing = missing;
          if (missing.length === 0) checks.webhook.ready = true;
        }
      }
      if (!page.has_more || !page.data?.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    checks.webhook.missingEvents = bestMissing;
  } catch (error) {
    checks.webhook.errorCode = safeCode(error);
  }

  const ready = checks.liveSecretFormat && checks.webhookSecretFormat && checks.ledgerEpochUnchanged
    && checks.starterPrice.ready && checks.proPrice.ready
    && (!checks.legacyFreeScoutPrice.configured || checks.legacyFreeScoutPrice.ready)
    && checks.portal.ready && checks.webhook.ready;
  return { ready, checks };
}

export const __internal = { requiredEvents, validSecretFormat, validWebhookSecretFormat };
