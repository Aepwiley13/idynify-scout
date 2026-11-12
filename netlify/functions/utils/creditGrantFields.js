/**
 * The single, shared definition of "what a credit grant actually writes" — used by the automated
 * webhook allocation path (stripe-webhook.js) AND by scripts/manualCreditRecovery.mjs. Extracted
 * so the two can never drift apart: a manual recovery for a flagged purchase must produce exactly
 * the same shape an automated grant would have produced, not a hand-rolled approximation of it.
 */

export const TIER_CREDITS = {
  starter: { credits: 400, companies: 40, contacts: 120, support: '48-hour email' },
  pro: { credits: 1250, companies: 125, contacts: 375, support: '24-hour email' },
};

/**
 * Round-10 review finding: this used to default ANY priceId that wasn't literally
 * STRIPE_PRICE_PRO to 'starter' — including a totally unknown price, or the $0/month Scout
 * Starter free price. Both callers already gate with isCreditGrantingPrice() before reaching
 * here, but this is the shared, load-bearing function itself, so it fails closed on its own
 * rather than trusting every future caller to remember to gate first.
 */
export function tierForPrice(priceId) {
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
  throw new Error(`tierForPrice: ${priceId} is not a recognized credit-granting price (expected STRIPE_PRICE_STARTER or STRIPE_PRICE_PRO) — refusing to default to a tier`);
}

export function creditGrantFields(priceId) {
  const tier = tierForPrice(priceId);
  const config = TIER_CREDITS[tier];
  const nextReset = new Date();
  nextReset.setMonth(nextReset.getMonth() + 1);
  return {
    tier,
    fields: {
      hasCompletedPayment: true,
      paymentCompletedAt: new Date().toISOString(),
      subscriptionTier: tier,
      credits: { total: config.credits, used: 0, remaining: config.credits, resetDate: nextReset.toISOString() },
      tierLimits: {
        creditsPerMonth: config.credits, companiesPerMonth: config.companies,
        contactsPerMonth: config.contacts, teamSeats: 1, support: config.support,
      },
      features: { mobilePhone: tier === 'pro' },
    },
  };
}
