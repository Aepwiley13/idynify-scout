/**
 * W3: the webhook's pure decision for a plan change on the account's existing subscription
 * (stripe-webhook.js decidePlanChange). The real handler is exercised against the Firestore
 * emulator in stripeWebhookPlanChange.test.js.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ db: {}, admin: {} }));

let decidePlanChange;
let planChangeMarkerId;
beforeAll(async () => {
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  process.env.STRIPE_PRICE_SCOUT_STARTER_FREE = 'price_scout_starter_free';
  ({ decidePlanChange, planChangeMarkerId } = await import('../../netlify/functions/stripe-webhook.js'));
});

const STARTER = {
  hasCompletedPayment: true, subscriptionTier: 'starter', stripeSubscriptionId: 'sub_1',
  credits: { total: 400, used: 30, remaining: 370, resetDate: '2026-12-01T00:00:00Z' },
};
const sub = (over = {}) => ({ id: 'sub_1', status: 'active', current_period_start: 1000, ...over });
const decide = (over = {}) => decidePlanChange({
  userData: STARTER, subscription: sub(), priceId: 'price_pro', markerExists: false, epochConfigured: true, ...over,
});

describe('decidePlanChange', () => {
  it('Starter → Pro: Pro limits and features, and 850 more credits added to what is left', () => {
    const d = decide();
    expect(d.kind).toBe('change');
    expect(d.grant).toBe(850);
    expect(d.fields.subscriptionTier).toBe('pro');
    expect(d.fields.tierLimits.creditsPerMonth).toBe(1250);
    expect(d.fields.features).toEqual({ mobilePhone: true });
    expect(d.fields.credits).toEqual({ total: 1250, used: 30, remaining: 1220, resetDate: '2026-12-01T00:00:00Z' });
  });

  it('an upgrade already granted this period (marker present): plan follows, no second grant', () => {
    const d = decide({ markerExists: true });
    expect(d).toMatchObject({ kind: 'change', grant: 0, alreadyGranted: true });
    expect(d.fields.credits).toBeUndefined();
  });

  it('epoch not configured: plan follows, no automatic grant, flagged for review', () => {
    expect(decide({ epochConfigured: false })).toMatchObject({ kind: 'change', grant: 0, flag: 'epoch_unset' });
  });

  it('Pro → Starter: Starter limits, and no credits taken back', () => {
    const d = decide({ userData: { ...STARTER, subscriptionTier: 'pro' }, priceId: 'price_starter' });
    expect(d).toMatchObject({ kind: 'change', grant: 0 });
    expect(d.fields.subscriptionTier).toBe('starter');
    expect(d.fields.credits).toBeUndefined();
  });

  it('a legacy numeric balance keeps its shape', () => {
    expect(decide({ userData: { ...STARTER, credits: 120 } }).fields.credits).toBe(970);
  });

  it.each([
    ['same tier', { priceId: 'price_starter' }],
    ['no paid access yet (checkout grants first)', { userData: { ...STARTER, hasCompletedPayment: false } }],
    ['not the subscription on file', { subscription: sub({ id: 'sub_other' }) }],
    ['not live', { subscription: sub({ status: 'past_due' }) }],
    ['incomplete', { subscription: sub({ status: 'incomplete' }) }],
    ['a price that grants nothing', { priceId: 'price_scout_starter_free' }],
    ['no account', { userData: null }],
  ])('nothing changes: %s', (_label, over) => {
    expect(decide(over)).toEqual({ kind: 'none' });
  });

  it('the marker is per subscription, price and period', () => {
    expect(planChangeMarkerId(sub(), 'price_pro')).toBe('sub_1__plan__price_pro__1000');
    expect(planChangeMarkerId(sub({ current_period_start: 2000 }), 'price_pro')).not.toBe(planChangeMarkerId(sub(), 'price_pro'));
  });
});
