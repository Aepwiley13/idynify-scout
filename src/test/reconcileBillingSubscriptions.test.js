import { describe, it, expect } from 'vitest';
import { diffAccount } from '../../scripts/reconcileBillingSubscriptions.mjs';

describe('reconcileBillingSubscriptions: diffAccount (pure, no I/O)', () => {
  it('a non-paying account produces no findings', () => {
    expect(diffAccount({ uid: 'u1', data: {} }, null)).toEqual([]);
  });

  it('a paying account missing Stripe IDs is flagged AMBIGUOUS', () => {
    const findings = diffAccount({ uid: 'u2', data: { hasCompletedPayment: true } }, null);
    expect(findings.some((f) => f.severity === 'AMBIGUOUS' && f.reason === 'missing_stripe_ids')).toBe(true);
  });

  it('a legacy numeric credits account is listed as INFO, not an error', () => {
    const findings = diffAccount({ uid: 'u3', data: { hasCompletedPayment: true, stripeCustomerId: 'c', stripeSubscriptionId: 's', credits: 50 } }, null);
    expect(findings.some((f) => f.severity === 'INFO' && f.reason === 'legacy_numeric_credits')).toBe(true);
  });

  it('more than one live subscription on the same customer is flagged AMBIGUOUS', () => {
    const findings = diffAccount(
      { uid: 'u4', data: { hasCompletedPayment: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', currentPeriodEnd: 'x' } },
      {
        subscription: { id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: null },
        allSubscriptionsForCustomer: [{ id: 'sub_1', status: 'active' }, { id: 'sub_2', status: 'active' }],
      },
    );
    expect(findings.some((f) => f.severity === 'AMBIGUOUS' && f.reason === 'multiple_live_subscriptions')).toBe(true);
  });

  it('a status drift between Firestore and Stripe is flagged MISMATCH', () => {
    const findings = diffAccount(
      { uid: 'u5', data: { hasCompletedPayment: true, stripeCustomerId: 'c', stripeSubscriptionId: 's', subscriptionStatus: 'active', currentPeriodEnd: 'x' } },
      { subscription: { id: 's', status: 'past_due', cancel_at_period_end: false, current_period_end: null }, allSubscriptionsForCustomer: [{ id: 's', status: 'past_due' }] },
    );
    expect(findings.some((f) => f.severity === 'MISMATCH' && f.reason === 'status_drift')).toBe(true);
  });

  it('an on-file subscription id that Stripe does not recognize is flagged AMBIGUOUS', () => {
    const findings = diffAccount(
      { uid: 'u6', data: { hasCompletedPayment: true, stripeCustomerId: 'c', stripeSubscriptionId: 's_gone' } },
      { subscription: null, allSubscriptionsForCustomer: [] },
    );
    expect(findings.some((f) => f.severity === 'AMBIGUOUS' && f.reason === 'on_file_subscription_not_found_in_stripe')).toBe(true);
  });

  it('a clean, matching account produces no MISMATCH or AMBIGUOUS findings', () => {
    const findings = diffAccount(
      { uid: 'u7', data: { hasCompletedPayment: true, stripeCustomerId: 'c', stripeSubscriptionId: 's', subscriptionStatus: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-01-01T00:00:00.000Z' } },
      { subscription: { id: 's', status: 'active', cancel_at_period_end: false, current_period_end: Math.floor(new Date('2026-01-01T00:00:00.000Z').getTime() / 1000) }, allSubscriptionsForCustomer: [{ id: 's', status: 'active' }] },
    );
    expect(findings.filter((f) => f.severity === 'MISMATCH' || f.severity === 'AMBIGUOUS')).toEqual([]);
  });
});
