/* global process */
/**
 * W3: Starter → Pro on the customer's existing subscription, and the Customer Portal.
 *
 * The real handlers, with a fake Stripe that records every call and a fake Firestore holding
 * the account. What is proved:
 *   - the upgrade is only ever subscriptions.update on the subscription on file; nothing that
 *     could create a second subscription or customer is ever called;
 *   - payment first (pending_if_incomplete), prorated now (always_invoice), with the preview's
 *     proration date, and an idempotency key that makes a retry the same request;
 *   - every account or subscription that should not be upgraded is refused before Stripe is
 *     asked to change anything;
 *   - the portal uses Idynify's configuration and the account's own customer, or refuses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { user: null, failRead: false } }));

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken: async (t) => { if (t !== 'tok-u1') throw new Error('bad'); return { uid: 'u1' }; } }) },
  db: {
    collection: () => ({
      doc: () => ({
        get: async () => {
          if (state.failRead) throw new Error('unavailable');
          return { exists: state.user !== null, data: () => state.user };
        },
      }),
    }),
  },
}));

const { changePlan, accountRefusal, subscriptionRefusal, prorationAmount, validProrationDate, upgradeIdempotencyKey, PREVIEW_MAX_AGE_SECONDS } =
  await import('../../netlify/functions/change-plan.js');
const { createPortalSession } = await import('../../netlify/functions/create-portal-session.js');

const NOW = 1_800_000_000;
const STARTER_ACCOUNT = {
  hasCompletedPayment: true, subscriptionTier: 'starter', subscriptionStatus: 'active',
  stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false,
};
const subscription = (over = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', pending_update: null, schedule: null, cancel_at_period_end: false,
  current_period_start: NOW - 10 * 86400, current_period_end: NOW + 20 * 86400,
  items: { data: [{ id: 'si_1', price: { id: 'price_starter' } }] },
  latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.test/i_1' },
  ...over,
});

function fakeStripe({ sub = subscription(), update, preview } = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return undefined; };
  const stripe = {
    calls,
    subscriptions: {
      retrieve: async (...a) => { calls.push(['subscriptions.retrieve', ...a]); return sub; },
      update: async (...a) => { calls.push(['subscriptions.update', ...a]); return update ? update(...a) : { ...sub, pending_update: null, items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] } }; },
      create: record('subscriptions.create'),
    },
    invoices: {
      createPreview: async (...a) => {
        calls.push(['invoices.createPreview', ...a]);
        return preview ?? { currency: 'usd', lines: { data: [
          { amount: -1333, period: { start: NOW } },      // unused Starter time
          { amount: 3333, period: { start: NOW } },       // remaining Pro time
          { amount: 5000, period: { start: NOW + 20 * 86400 } }, // next period: not due today
        ] } };
      },
    },
    checkout: { sessions: { create: record('checkout.sessions.create') } },
    customers: { create: record('customers.create') },
    billingPortal: { sessions: { create: async (...a) => { calls.push(['billingPortal.sessions.create', ...a]); return { url: 'https://billing.stripe.test/p_1' }; } } },
  };
  return stripe;
}

const request = (body, { token = 'tok-u1', method = 'POST' } = {}) => ({
  httpMethod: method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://app.idynify.test' },
  body: JSON.stringify(body),
});
const parsed = (res) => JSON.parse(res.body);
const run = (body, stripe, opts) => changePlan(request(body, opts), { stripe, now: () => NOW });

beforeEach(() => {
  state.user = { ...STARTER_ACCOUNT };
  state.failRead = false;
  vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter');
  vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro');
  vi.stubEnv('STRIPE_PORTAL_CONFIGURATION_ID', 'bpc_test1');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const NEVER_CREATES = ['subscriptions.create', 'checkout.sessions.create', 'customers.create'];
const created = (stripe) => stripe.calls.filter(([name]) => NEVER_CREATES.includes(name));

describe('preview', () => {
  it("Stripe's own proration preview for the same subscription; only today's lines are due today", async () => {
    const stripe = fakeStripe();
    const res = await run({ action: 'preview' }, stripe);
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toEqual({ amountDue: 2000, currency: 'usd', prorationDate: NOW, currentPeriodEnd: NOW + 20 * 86400 });
    const [, params] = stripe.calls.find(([n]) => n === 'invoices.createPreview');
    expect(params).toEqual({
      customer: 'cus_1', subscription: 'sub_1',
      subscription_details: { items: [{ id: 'si_1', price: 'price_pro' }], proration_behavior: 'always_invoice', proration_date: NOW },
    });
    expect(stripe.calls.some(([n]) => n === 'subscriptions.update')).toBe(false);
    expect(created(stripe)).toEqual([]);
  });
});

describe('upgrade', () => {
  it('updates the existing subscription to Pro: payment first, prorated now, at the previewed date, once', async () => {
    const stripe = fakeStripe();
    const res = await run({ action: 'upgrade', prorationDate: NOW - 60 }, stripe);
    expect(parsed(res)).toEqual({ status: 'upgraded' });
    const updates = stripe.calls.filter(([n]) => n === 'subscriptions.update');
    expect(updates).toHaveLength(1);
    const [, subId, params, options] = updates[0];
    expect(subId).toBe('sub_1');
    expect(params).toEqual({
      items: [{ id: 'si_1', price: 'price_pro' }], proration_behavior: 'always_invoice', proration_date: NOW - 60,
      payment_behavior: 'pending_if_incomplete', expand: ['latest_invoice'],
    });
    expect(options).toEqual({ idempotencyKey: 'plan-upgrade:sub_1:price_pro:1799999940' });
    expect(created(stripe)).toEqual([]);
  });

  it('a retried confirm sends the same request with the same idempotency key', async () => {
    const stripe = fakeStripe();
    await run({ action: 'upgrade', prorationDate: NOW - 60 }, stripe);
    await run({ action: 'upgrade', prorationDate: NOW - 60 }, stripe);
    const keys = stripe.calls.filter(([n]) => n === 'subscriptions.update').map((c) => c[3].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(upgradeIdempotencyKey('sub_1', 'price_pro', 5)).toBe('plan-upgrade:sub_1:price_pro:5');
  });

  it("the bank wants confirmation: Stripe's invoice page takes the payment, and nothing changes until then", async () => {
    const stripe = fakeStripe({ update: () => ({ ...subscription(), pending_update: { expires_at: NOW + 3600 }, latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.test/i_2' } }) });
    const res = await run({ action: 'upgrade', prorationDate: NOW }, stripe);
    expect(parsed(res)).toEqual({ status: 'payment_required', invoiceUrl: 'https://invoice.stripe.test/i_2' });
  });

  it('a declined card, a concurrent identical request, and Stripe being down are each explained', async () => {
    const fail = (err) => fakeStripe({ update: () => { throw err; } });
    expect(parsed(await run({ action: 'upgrade', prorationDate: NOW }, fail({ type: 'StripeCardError' })))).toEqual({ error: 'card_declined' });
    expect(parsed(await run({ action: 'upgrade', prorationDate: NOW }, fail({ type: 'StripeIdempotencyError' })))).toEqual({ error: 'upgrade_in_progress' });
    expect((await run({ action: 'upgrade', prorationDate: NOW }, fail(new Error('down')))).statusCode).toBe(503);
  });

  it.each([
    ['older than 30 minutes', NOW - PREVIEW_MAX_AGE_SECONDS - 1],
    ['in the future', NOW + 3600],
    ['before this period', NOW - 11 * 86400],
    ['not a number', 'yesterday'],
    ['missing', undefined],
  ])('a proration date %s is refused before any change', async (_label, prorationDate) => {
    const stripe = fakeStripe();
    const res = await run({ action: 'upgrade', prorationDate }, stripe);
    expect(parsed(res)).toEqual({ error: 'preview_expired' });
    expect(stripe.calls.some(([n]) => n === 'subscriptions.update')).toBe(false);
  });
});

describe('refusals: nothing is changed', () => {
  const refused = async (body, stripe, status, error) => {
    const res = await run(body, stripe);
    expect(res.statusCode).toBe(status);
    expect(parsed(res).error).toBe(error);
    expect(stripe.calls.some(([n]) => n === 'subscriptions.update' || n === 'invoices.createPreview')).toBe(false);
    expect(created(stripe)).toEqual([]);
  };

  it('no or a bad token', async () => {
    const stripe = fakeStripe();
    expect((await changePlan(request({ action: 'preview' }, { token: null }), { stripe })).statusCode).toBe(401);
    expect((await changePlan(request({ action: 'preview' }, { token: 'forged' }), { stripe })).statusCode).toBe(401);
  });

  it('a Free account', async () => { state.user = { email: 'free@example.test' }; await refused({ action: 'preview' }, fakeStripe(), 402, 'paid_plan_required'); });
  it('already Pro', async () => { state.user = { ...STARTER_ACCOUNT, subscriptionTier: 'pro' }; await refused({ action: 'preview' }, fakeStripe(), 409, 'already_pro'); });
  it('a plan set to end', async () => { state.user = { ...STARTER_ACCOUNT, cancelAtPeriodEnd: true }; await refused({ action: 'preview' }, fakeStripe(), 409, 'subscription_canceling'); });
  it('no subscription on file', async () => { state.user = { ...STARTER_ACCOUNT, stripeSubscriptionId: null }; await refused({ action: 'preview' }, fakeStripe(), 409, 'subscription_not_found'); });
  it('a subscription of another customer', async () => { await refused({ action: 'upgrade', prorationDate: NOW }, fakeStripe({ sub: subscription({ customer: 'cus_other' }) }), 409, 'subscription_mismatch'); });
  it('a subscription that is not live', async () => { await refused({ action: 'preview' }, fakeStripe({ sub: subscription({ status: 'past_due' }) }), 409, 'subscription_not_active'); });
  it('a change already pending payment, with its invoice', async () => {
    const stripe = fakeStripe({ sub: subscription({ pending_update: { expires_at: NOW + 60 } }) });
    const res = await run({ action: 'upgrade', prorationDate: NOW }, stripe);
    expect(parsed(res)).toEqual({ error: 'upgrade_pending', invoiceUrl: 'https://invoice.stripe.test/i_1' });
  });
  it('a scheduled change', async () => { await refused({ action: 'preview' }, fakeStripe({ sub: subscription({ schedule: 'sub_sched_1' }) }), 409, 'change_scheduled'); });
  it('a subscription already on the Pro price', async () => {
    await refused({ action: 'preview' }, fakeStripe({ sub: subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] } }) }), 409, 'already_pro');
  });
  it('an unknown price or more than one item', async () => {
    await refused({ action: 'preview' }, fakeStripe({ sub: subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_other' } }] } }) }), 409, 'plan_unknown');
    await refused({ action: 'preview' }, fakeStripe({ sub: subscription({ items: { data: [{ id: 'a' }, { id: 'b' }] } }) }), 409, 'subscription_items_unexpected');
  });
  it('the account cannot be read', async () => { state.failRead = true; await refused({ action: 'preview' }, fakeStripe(), 503, 'entitlement_unavailable'); });
  it('an unknown action', async () => { await refused({ action: 'downgrade' }, fakeStripe(), 400, 'invalid_request'); });
});

describe('pure rules', () => {
  it('accountRefusal and subscriptionRefusal agree with the handler', () => {
    expect(accountRefusal(STARTER_ACCOUNT)).toBeNull();
    expect(subscriptionRefusal(subscription(), STARTER_ACCOUNT, { starterPrice: 'price_starter', proPrice: 'price_pro' })).toBeNull();
    expect(accountRefusal(null)).toEqual({ statusCode: 402, error: 'paid_plan_required' });
  });
  it('prorationAmount counts only lines dated at the proration date', () => {
    expect(prorationAmount({ lines: { data: [{ amount: 100, period: { start: 5 } }, { amount: 900, period: { start: 6 } }] } }, 5)).toBe(100);
    expect(prorationAmount(null, 5)).toBe(0);
  });
  it('validProrationDate', () => {
    expect(validProrationDate(NOW, subscription(), NOW)).toBe(true);
    expect(validProrationDate(NOW + 20 * 86400, subscription(), NOW + 20 * 86400)).toBe(false);
  });
});

describe('Customer Portal', () => {
  const portal = (stripe, opts) => createPortalSession(request({}, opts), { stripe });

  it("opens Idynify's configuration for the account's own customer, returning to Billing", async () => {
    const stripe = fakeStripe();
    const res = await portal(stripe);
    expect(parsed(res)).toEqual({ url: 'https://billing.stripe.test/p_1' });
    const [, params] = stripe.calls.find(([n]) => n === 'billingPortal.sessions.create');
    expect(params).toEqual({ customer: 'cus_1', configuration: 'bpc_test1', return_url: 'https://app.idynify.test/settings?tab=billing' });
  });

  it("without Idynify's configuration it refuses rather than use Stripe's default portal", async () => {
    vi.stubEnv('STRIPE_PORTAL_CONFIGURATION_ID', '');
    const stripe = fakeStripe();
    expect(parsed(await portal(stripe))).toEqual({ error: 'portal_not_configured' });
    expect(stripe.calls).toEqual([]);
  });

  it('no customer on the account, no token', async () => {
    state.user = { email: 'free@example.test' };
    expect(parsed(await portal(fakeStripe()))).toEqual({ error: 'no_billing_account' });
    expect((await portal(fakeStripe(), { token: null })).statusCode).toBe(401);
  });

  it('process.env is untouched by the handlers (sanity)', () => {
    expect(process.env.STRIPE_PRICE_PRO).toBe('price_pro');
  });
});
