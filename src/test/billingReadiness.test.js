import { describe, expect, it, vi } from 'vitest';
import { inspectBillingReadiness } from '../../netlify/functions/utils/billingReadiness.js';
vi.mock('../../netlify/functions/firebase-admin.js', () => ({ admin: { auth: () => ({ verifyIdToken: vi.fn() }) } }));
import { checkBillingReadiness } from '../../netlify/functions/admin-billing-readiness.js';

const env = {
  STRIPE_SECRET_KEY: 'sk_live_testfixtureonly',
  STRIPE_WEBHOOK_SECRET: 'whsec_testfixtureonly',
  STRIPE_PRICE_STARTER: 'price_starter_fixture',
  STRIPE_PRICE_PRO: 'price_pro_fixture',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
  BILLING_LEDGER_EPOCH_UNIX: '1794632515',
};

function stripeFixture({ missingEvents = [], portalActive = true, planChanges = false } = {}) {
  const expected = [
    'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'invoice.paid',
  ];
  return {
    prices: { retrieve: vi.fn(async (id) => ({
      active: true, recurring: { interval: 'month' }, unit_amount: id === env.STRIPE_PRICE_STARTER ? 2000 : 5000,
    })) },
    billingPortal: { configurations: { retrieve: vi.fn(async () => ({
      active: portalActive,
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_update: {
          enabled: planChanges,
        },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
      },
    })) } },
    webhookEndpoints: { list: vi.fn(async () => ({
      data: [{ id: 'we_fixture', url: 'https://idynify.com/.netlify/functions/stripe-webhook', status: 'enabled', enabled_events: expected.filter((event) => !missingEvents.includes(event)) }],
      has_more: false,
    })) },
  };
}

describe('read-only production billing readiness', () => {
  it('checks plan prices, portal, event coverage and fixed ledger epoch without exposing values', async () => {
    const result = await inspectBillingReadiness({ stripe: stripeFixture(), env });
    expect(result.ready).toBe(true);
    expect(result.checks).toMatchObject({
      liveSecretFormat: true, webhookSecretFormat: true, ledgerEpochUnchanged: true,
      starterPrice: { ready: true }, proPrice: { ready: true }, portal: { ready: true }, webhook: { ready: true },
    });
    expect(result.checks.portal).toMatchObject({
      paymentMethods: true,
      invoices: true,
      planChanges: false,
      planChangesDisabled: true,
      cancelAtPeriodEnd: true,
    });
    expect(JSON.stringify(result)).not.toContain(env.STRIPE_SECRET_KEY);
    expect(JSON.stringify(result)).not.toContain(env.STRIPE_WEBHOOK_SECRET);
  });

  it('reports missing renewal events and missing portal configuration as blockers', async () => {
    const result = await inspectBillingReadiness({
      stripe: stripeFixture({ missingEvents: ['invoice.paid'], portalActive: false }),
      env: { ...env, STRIPE_PORTAL_CONFIGURATION_ID: '' },
    });
    expect(result.ready).toBe(false);
    expect(result.checks.webhook.missingEvents).toContain('invoice.paid');
    expect(result.checks.portal.configured).toBe(false);
  });

  it('rejects portal plan switching and requires payment methods, invoices, and end-of-period cancellation', async () => {
    const stripe = stripeFixture({ planChanges: true });
    const result = await inspectBillingReadiness({ stripe, env });
    expect(result.ready).toBe(false);
    expect(result.checks.portal.planChanges).toBe(true);
    expect(result.checks.portal.planChangesDisabled).toBe(false);

    stripe.billingPortal.configurations.retrieve.mockResolvedValue({ active: true, features: {
      payment_method_update: { enabled: false },
      invoice_history: { enabled: true },
      subscription_update: { enabled: false },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    } });
    const missingPaymentMethods = await inspectBillingReadiness({ stripe, env });
    expect(missingPaymentMethods.ready).toBe(false);
    expect(missingPaymentMethods.checks.portal.paymentMethods).toBe(false);
    expect(missingPaymentMethods.checks.portal.planChangesDisabled).toBe(true);
  });

  it('does not call Stripe when Netlify has only an unusable masked secret string', async () => {
    const stripe = stripeFixture();
    const result = await inspectBillingReadiness({ stripe, env: { ...env, STRIPE_SECRET_KEY: 'masked-output' } });
    expect(result.errorCode).toBe('secret_not_runtime_verifiable');
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
  });

  it('is admin-only and uses the actual function environment at runtime', async () => {
    const stripe = stripeFixture();
    const options = {
      verifyToken: async () => ({ uid: 'admin-uid', firebase: { sign_in_provider: 'password' } }),
      isAdmin: async () => true,
      env,
      stripeFactory: () => stripe,
    };
    const response = await checkBillingReadiness({ httpMethod: 'POST', headers: { authorization: 'Bearer token' } }, options);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).ready).toBe(true);
    expect((await checkBillingReadiness({ httpMethod: 'POST', headers: {} }, options)).statusCode).toBe(401);
    expect((await checkBillingReadiness({ httpMethod: 'POST', headers: { authorization: 'Bearer token' } }, { ...options, isAdmin: async () => false })).statusCode).toBe(403);
  });
});
