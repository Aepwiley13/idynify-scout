/**
 * Which plan an account is on, from the account state the gates already hold.
 *
 *   'pro' | 'starter'   the account has paid access (billingEntitlement.hasActiveAccess)
 *   'free'              the SERVER answered and the account has no paid access:
 *                       a new signup with no card, or a customer who stopped paying
 *   'unknown'           anything else — a failed, slow or cache-only read, or no
 *                       account state at all. Never shown as Free, never offered a
 *                       purchase: a paying customer whose read failed must not be
 *                       told they are on Free and invited to buy again.
 *
 * Pure. The account comes from utils/accountVerification.js (readAccount,
 * classifySnapshot, useAccountVerification).
 */
import { ACCOUNT } from './accountVerification';
import { hasActiveAccess } from './billingEntitlement';

export const PLAN = Object.freeze({
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  UNKNOWN: 'unknown',
});

export function paidTierOf(data) {
  return data?.subscriptionTier === 'pro' ? PLAN.PRO : PLAN.STARTER;
}

export function planOf(account) {
  const data = account?.data ?? null;
  switch (account?.status) {
    case ACCOUNT.VERIFIED:
      return hasActiveAccess(data) ? paidTierOf(data) : PLAN.FREE;
    case ACCOUNT.CACHED:
      // A saved copy is only ever classified CACHED when it says paid; anything
      // else from the cache is UNVERIFIED. Checked again here so this function
      // never calls a cached copy "free".
      return hasActiveAccess(data) ? paidTierOf(data) : PLAN.UNKNOWN;
    default:
      return PLAN.UNKNOWN;
  }
}

export const isPaidPlan = (plan) => plan === PLAN.STARTER || plan === PLAN.PRO;
