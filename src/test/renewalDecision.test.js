/**
 * W4b: the webhook's pure renewal decision (stripe-webhook.js decideRenewal). The real handler
 * runs against the Firestore emulator in stripeWebhookRenewal.test.js.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ db: {}, admin: {} }));

let decideRenewal;
let subscriptionIdOfInvoice;
let renewalMarkerId;
beforeAll(async () => {
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  process.env.STRIPE_PRICE_SCOUT_STARTER_FREE = 'price_scout_starter_free';
  ({ decideRenewal, subscriptionIdOfInvoice, renewalMarkerId } = await import('../../netlify/functions/stripe-webhook.js'));
});

const EPOCH = 1_000_000_000;
const invoice = (over = {}) => ({ id: 'in_1', billing_reason: 'subscription_cycle', created: 2_000_000_000, subscription: 'sub_1', ...over });
const sub = (over = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 2_002_592_000, items: { data: [{ price: { id: 'price_starter' } }] }, ...over });
const ACCOUNT = { hasCompletedPayment: true, subscriptionTier: 'starter', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', credits: { total: 400, used: 390, remaining: 10 } };
const decide = (over = {}) => decideRenewal({ invoice: invoice(), subscription: sub(), userData: ACCOUNT, markerExists: false, epoch: EPOCH, ...over });

describe('decideRenewal', () => {
  it("a paid renewal resets Starter's allowance, unused credits not carried over", () => {
    const d = decide();
    expect(d.kind).toBe('grant');
    expect(d.fields.credits).toEqual({ total: 400, used: 0, remaining: 400, resetDate: new Date(2_002_592_000 * 1000).toISOString() });
    expect(d.fields.subscriptionTier).toBe('starter');
  });

  it("Pro renews at Pro's allowance; a downgrade at period end renews at Starter's", () => {
    expect(decide({ subscription: sub({ items: { data: [{ price: { id: 'price_pro' } }] } }) }).fields.credits.total).toBe(1250);
    const down = decide({ userData: { ...ACCOUNT, subscriptionTier: 'pro' } });
    expect(down.fields).toMatchObject({ subscriptionTier: 'starter', credits: { total: 400 } });
  });

  it.each([
    ['the first invoice (checkout grants it)', { invoice: invoice({ billing_reason: 'subscription_create' }) }, 'not_a_renewal'],
    ["a plan change's proration invoice (W3 grants it)", { invoice: invoice({ billing_reason: 'subscription_update' }) }, 'not_a_renewal'],
    ['already granted for this invoice', { markerExists: true }, 'already_granted'],
    ['an invoice from before the ledger epoch', { invoice: invoice({ created: EPOCH - 1 }) }, 'pre_epoch'],
    ['an account without paid access', { userData: { ...ACCOUNT, hasCompletedPayment: false } }, 'no_paid_access'],
    ['a subscription that is not live', { subscription: sub({ status: 'past_due' }) }, 'subscription_not_live'],
    ['a price that grants nothing', { subscription: sub({ items: { data: [{ price: { id: 'price_scout_starter_free' } }] } }) }, 'not_credit_granting_price'],
  ])('ignored: %s', (_label, over, reason) => {
    expect(decide(over)).toEqual({ kind: 'ignore', reason });
  });

  it.each([
    ['no epoch configured', { epoch: null }, 'epoch_unset'],
    ['not the subscription on file', { userData: { ...ACCOUNT, stripeSubscriptionId: 'sub_other' } }, 'renewal_not_subscription_on_file'],
    ['another customer', { subscription: sub({ customer: 'cus_other' }) }, 'customer_mismatch'],
  ])('flagged for review: %s', (_label, over, reason) => {
    expect(decide(over)).toEqual({ kind: 'flag', reason });
  });

  it('reads the subscription from either invoice payload shape', () => {
    expect(subscriptionIdOfInvoice({ subscription: 'sub_1' })).toBe('sub_1');
    expect(subscriptionIdOfInvoice({ parent: { subscription_details: { subscription: 'sub_2' } } })).toBe('sub_2');
    expect(subscriptionIdOfInvoice({ subscription: { id: 'sub_3' } })).toBe('sub_3');
    expect(subscriptionIdOfInvoice({})).toBeNull();
    expect(renewalMarkerId('sub_1', 'in_1')).toBe('sub_1__renewal__in_1');
  });
});
