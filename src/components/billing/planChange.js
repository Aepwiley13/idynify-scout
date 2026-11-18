/** Words and amounts for the plan-change screens (PlanActions.jsx). Pure. */
import { PLAN_DETAILS } from '../../constants/plans';

/** Pro's monthly credits minus Starter's: what an upgrade adds once (stripe-webhook.js decidePlanChange). */
export const PRO_EXTRA_CREDITS = PLAN_DETAILS.pro.credits - PLAN_DETAILS.starter.credits;

/** Stripe amounts are in the currency's smallest unit. */
export function formatMoney(amount, currency = 'usd') {
  const value = (Number(amount) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency).toUpperCase() }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

const MESSAGES = {
  already_pro: 'You are already on Pro.',
  upgrade_pending: 'An upgrade is already waiting for its payment. Confirm it from your latest invoice in Manage billing.',
  upgrade_in_progress: 'Your upgrade is already being made. Give it a moment.',
  preview_expired: 'That price was worked out a while ago. Check the price again and confirm.',
  subscription_canceling: 'Your plan is set to end. Keep it in Manage billing first, then upgrade.',
  subscription_not_active: 'Your subscription is not active right now. Check Manage billing.',
  card_declined: 'The card was declined. Nothing changed. Update your card in Manage billing and try again.',
  portal_not_configured: 'Billing management is not available yet. Contact us and we will help.',
  no_billing_account: 'There is no billing account on file yet.',
  slow_confirmation: 'Your payment went through and your upgrade is still being confirmed. Refresh in a minute; you will not be charged again.',
  network: 'Could not reach Idynify. Nothing changed. Try again.',
};

export function planChangeMessage(code) {
  return MESSAGES[code] ?? 'Something went wrong. Nothing changed. Try again, or contact us.';
}
