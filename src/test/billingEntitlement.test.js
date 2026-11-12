import { describe, it, expect } from 'vitest';
import { hasActiveAccess, describeSubscription, isBlockingStatus, BILLING_NORMALIZED_STATES as S } from '../utils/billingEntitlement.js';

describe('hasActiveAccess — the compatibility gate, unchanged behavior', () => {
  it('is true only when hasCompletedPayment is literally true', () => {
    expect(hasActiveAccess({ hasCompletedPayment: true })).toBe(true);
    expect(hasActiveAccess({ hasCompletedPayment: false })).toBe(false);
    expect(hasActiveAccess({ hasCompletedPayment: 'true' })).toBe(false);
    expect(hasActiveAccess(undefined)).toBe(false);
    expect(hasActiveAccess({})).toBe(false);
  });
});

describe('describeSubscription — full state table', () => {
  it('active, no cancellation or pause', () => {
    const r = describeSubscription({ status: 'active' });
    expect(r.normalizedState).toBe(S.ACTIVE);
    expect(r.hasAccess).toBe(true);
  });

  it('active + cancel_at_period_end -> active_canceling, still has access', () => {
    const r = describeSubscription({ status: 'active', cancelAtPeriodEnd: true });
    expect(r.normalizedState).toBe(S.ACTIVE_CANCELING);
    expect(r.hasAccess).toBe(true);
  });

  it('active + pause_collection -> collection_paused, distinct from plain active', () => {
    const r = describeSubscription({ status: 'active', pauseCollection: true });
    expect(r.normalizedState).toBe(S.COLLECTION_PAUSED);
    expect(r.hasAccess).toBe(true);
  });

  it('cancelAtPeriodEnd takes precedence over pauseCollection when both are set', () => {
    const r = describeSubscription({ status: 'active', cancelAtPeriodEnd: true, pauseCollection: true });
    expect(r.normalizedState).toBe(S.ACTIVE_CANCELING);
  });

  it('trialing has access', () => {
    expect(describeSubscription({ status: 'trialing' }).hasAccess).toBe(true);
  });

  for (const status of ['past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid']) {
    it(`${status} has no access`, () => {
      expect(describeSubscription({ status }).hasAccess).toBe(false);
    });
  }

  it("Stripe's native status: 'paused' is normalized distinctly from pause_collection", () => {
    const r = describeSubscription({ status: 'paused' });
    expect(r.normalizedState).toBe(S.NATIVE_PAUSED);
    expect(r.hasAccess).toBe(false);
  });

  it('an unrecognized status fails safe to no access, never throws', () => {
    const r = describeSubscription({ status: 'some_future_stripe_status' });
    expect(r.normalizedState).toBe(S.UNKNOWN);
    expect(r.hasAccess).toBe(false);
  });

  it('no input at all fails safe', () => {
    expect(() => describeSubscription()).not.toThrow();
    expect(describeSubscription().hasAccess).toBe(false);
  });
});

describe('isBlockingStatus — a different question from hasAccess', () => {
  it('unpaid and incomplete have no access but still block a new subscription', () => {
    expect(describeSubscription({ status: 'unpaid' }).hasAccess).toBe(false);
    expect(isBlockingStatus(S.UNPAID)).toBe(true);
    expect(describeSubscription({ status: 'incomplete' }).hasAccess).toBe(false);
    expect(isBlockingStatus(S.INCOMPLETE)).toBe(true);
  });

  it('both pause variants block, despite collection_paused having access', () => {
    expect(isBlockingStatus(S.COLLECTION_PAUSED)).toBe(true);
    expect(isBlockingStatus(S.NATIVE_PAUSED)).toBe(true);
  });

  it('canceled and incomplete_expired do not block — genuinely over, a fresh subscription is correct', () => {
    expect(isBlockingStatus(S.CANCELED)).toBe(false);
    expect(isBlockingStatus(S.INCOMPLETE_EXPIRED)).toBe(false);
  });

  it('an unknown state blocks rather than silently permitting a second subscription', () => {
    expect(isBlockingStatus(S.UNKNOWN)).toBe(true);
  });

  it('active and active_canceling block, as expected', () => {
    expect(isBlockingStatus(S.ACTIVE)).toBe(true);
    expect(isBlockingStatus(S.ACTIVE_CANCELING)).toBe(true);
  });
});
