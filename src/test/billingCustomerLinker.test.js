import { describe, expect, it, vi } from 'vitest';
import { createBillingCustomerLinker, __internal } from '../../netlify/functions/utils/billingCustomerLinker.js';

const UID = 'firebase-user-1';

function harness({ account = { email: 'person@example.test' }, sessions = [], signInProvider = 'password' } = {}) {
  const data = new Map(account ? [[`users/${UID}`, account]] : []);
  const sessionRows = sessions;
  const refs = new Map();
  const ref = (path) => refs.get(path) ?? refs.set(path, { path }).get(path);
  const query = {
    collection: 'impersonationSessions',
    where() { return this; },
  };
  const db = {
    collection(name) {
      return {
        doc(id) { return ref(`${name}/${id}`); },
        where() { return query; },
      };
    },
    async runTransaction(callback) {
      const tx = {
        async get(target) {
          if (target === query) return { docs: sessionRows };
          const value = data.get(target.path);
          return { exists: value !== undefined, data: () => value };
        },
        set(target, value, options) {
          data.set(target.path, options?.merge ? { ...(data.get(target.path) ?? {}), ...value } : value);
        },
        update(target, value) {
          if (!data.has(target.path)) throw new Error('missing document');
          data.set(target.path, { ...data.get(target.path), ...value });
        },
      };
      return callback(tx);
    },
  };
  const stripe = { customers: { create: vi.fn().mockResolvedValue({ id: 'cus_new' }) } };
  const handler = createBillingCustomerLinker({
    db,
    extractToken: (event) => event.headers?.authorization?.replace(/^Bearer /, ''),
    verifyToken: vi.fn(async (token) => token === 'valid' ? { uid: UID, email: 'person@example.test', firebase: { sign_in_provider: signInProvider } } : Promise.reject(new Error('invalid'))),
    getStripe: () => stripe,
    now: () => 1_800_000_000_000,
  });
  const event = (token = 'valid') => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
  return { handler, event, data, stripe };
}

const body = (response) => JSON.parse(response.body);

describe('ensure-billing-customer', () => {
  it('creates and binds one customer using the verified Firebase UID, then becomes an external-call-free no-op', async () => {
    const { handler, event, data, stripe } = harness();
    expect(await handler(event())).toMatchObject({ statusCode: 200 });
    expect(body(await handler(event()))).toEqual({ status: 'linked' });
    expect(data.get(`users/${UID}`).stripeCustomerId).toBe('cus_new');
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(stripe.customers.create.mock.calls[0][0]).toMatchObject({ metadata: { firebaseUID: UID, idynifyAccount: 'true' } });
    expect(stripe.customers.create.mock.calls[0][1].idempotencyKey).toBe(`idynify-account-customer-${UID}`);
  });

  it('rejects unauthenticated and impersonation read-only calls before Stripe', async () => {
    const missing = harness();
    expect((await missing.handler(missing.event('bad'))).statusCode).toBe(401);
    const custom = harness({ signInProvider: 'custom' });
    expect((await custom.handler(custom.event())).statusCode).toBe(403);
    expect(custom.stripe.customers.create).not.toHaveBeenCalled();
    const active = harness({ sessions: [{ data: () => ({ expiresAt: { toMillis: () => 1_900_000_000_000 } }) }] });
    expect((await active.handler(active.event())).statusCode).toBe(403);
    expect(active.stripe.customers.create).not.toHaveBeenCalled();
  });

  it('blocks suspended and subscription-unlinked accounts rather than creating a second identity', async () => {
    const suspended = harness({ account: { email: 'x@example.test', accountStatus: 'suspended' } });
    expect((await suspended.handler(suspended.event())).statusCode).toBe(403);
    const subscription = harness({ account: { stripeSubscriptionId: 'sub_legacy' } });
    expect(body(await subscription.handler(subscription.event()))).toEqual({ error: 'billing_identity_needs_review' });
    expect(subscription.stripe.customers.create).not.toHaveBeenCalled();
  });

  it('does not restart a customer creation after the Stripe idempotency window expires', async () => {
    const h = harness();
    h.data.set(`billingCustomerOperations/${UID}`, {
      uid: UID, status: 'creating', createdAt: new Date(1_800_000_000_000 - __internal.IDEMPOTENCY_WINDOW_MS - 1).toISOString(),
    });
    expect(body(await h.handler(h.event()))).toEqual({ error: 'billing_identity_needs_review' });
    expect(h.stripe.customers.create).not.toHaveBeenCalled();
    expect(h.data.get(`billingCustomerOperations/${UID}`).status).toBe('needs_reconciliation');
  });
});
