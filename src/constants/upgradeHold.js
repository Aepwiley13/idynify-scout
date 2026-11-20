/**
 * Billing launch fallback: Free Contact Hub without self-serve upgrades for existing accounts.
 *
 * Use this only if Free Contact Hub has to launch before authenticated checkout (#803) has
 * passed its Stripe test-mode validation. Until then, live checkout is Stripe Payment Links.
 * A Payment Link cannot attach a purchase to an account's existing Stripe customer, and it
 * cannot see a live subscription. Offering one to an existing account risks two outcomes:
 *
 *   - a customer who stopped paying gets a second Stripe customer, and their purchase is held
 *     for review instead of granted;
 *   - a current subscriber buys a second subscription.
 *
 * So while the hold is on (`UPGRADES_OPEN` false, the free plan switched on):
 *
 *   - Settings → Billing and Scout's "This is part of Scout" screen offer no purchase. They
 *     show a note and a support link instead; support starts the plan in Stripe.
 *   - /checkout serves only today's live signup flow: an account that chose a paid plan at
 *     signup, has not paid yet and has no Stripe history. Every other signed-in account goes
 *     to Settings → Billing.
 *
 * With the free plan switched off nothing here applies, so production checkout is unchanged.
 *
 * Lifting the hold is part of publishing #803: set UPGRADES_OPEN to true (or remove this file
 * and its three uses) in the same release that makes authenticated checkout the only checkout.
 */
import { FREE_PLAN } from './freePlan';
import { hasActiveAccess } from '../utils/billingEntitlement';

export const UPGRADES_OPEN = false;

const PAID_TIERS = new Set(['starter', 'pro']);

/** Today's live signup flow: a paid plan chosen at signup, not paid yet, no Stripe history. Pure. */
export function isPendingPaidSignup(data) {
  return PAID_TIERS.has(data?.selectedTier)
    && !hasActiveAccess(data)
    && !data?.stripeCustomerId
    && !data?.stripeSubscriptionId;
}

export const CHECKOUT_HOLD_DESTINATION = '/settings?tab=billing';

/**
 * Where /checkout sends this account instead, or null to show checkout. Pure.
 * The account is the one the purchase gate has already verified with the server.
 */
export function checkoutHoldRedirect(account, { open = UPGRADES_OPEN, freePlan = FREE_PLAN.enabled } = {}) {
  if (open || !freePlan) return null;
  if (isPendingPaidSignup(account?.data)) return null;
  return CHECKOUT_HOLD_DESTINATION;
}
