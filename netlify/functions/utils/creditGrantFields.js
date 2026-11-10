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

export function tierForPrice(priceId) {
  return priceId === process.env.STRIPE_PRICE_PRO ? 'pro' : 'starter';
}

export function creditGrantFields(priceId) {
  const tier = tierForPrice(priceId);
  const config = TIER_CREDITS[tier] ?? TIER_CREDITS.starter;
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
