/**
 * Runs against a REAL Firestore emulator. Every identity-bearing field present on a
 * checkout.session.completed event must agree — precedence (picking the first available one) is
 * not validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = { retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a) };
    checkout = { sessions: { listLineItems: (...a) => scenario.handlers.listLineItems(...a) } };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

const { db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js');
const { handler } = await import('../../netlify/functions/stripe-webhook.js');

beforeEach(async () => {
  await wipeBillingCollections();
  scenario.handlers = {
    subscriptionsRetrieve: async (id) => ({
      id, customer: 'cus_mismatch', status: 'active', created: 2000000000,
      current_period_start: 2000000000, current_period_end: 2003000000, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
    }),
    listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
  };
});

describe('stripe-webhook: identity cross-check, not precedence', () => {
  it('metadata.firebaseUID disagreeing with client_reference_id is quarantined, not resolved by priority', async () => {
    scenario.handlers.customersRetrieve = async (id) => ({ id, metadata: {} });
    await db.collection('users').doc('uid_a').set({ email: 'a@example.test' });
    await db.collection('users').doc('uid_b').set({ email: 'b@example.test' });

    const event = {
      id: 'evt_mismatch_1', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_mismatch', customer: 'cus_mismatch', subscription: 'sub_mismatch', payment_status: 'paid',
          created: 2000000000, metadata: { firebaseUID: 'uid_a' }, client_reference_id: 'uid_b',
        },
      },
    };
    await handler(fakeHttpEvent(event));

    const [a, b] = await Promise.all([
      db.collection('users').doc('uid_a').get(), db.collection('users').doc('uid_b').get(),
    ]);
    expect(a.data().credits).toBeUndefined();
    expect(b.data().credits).toBeUndefined();

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs.some((d) => d.data().reason === 'identity_mismatch')).toBe(true);
  });

  it('a customer whose own metadata.firebaseUID disagrees with the session is quarantined too', async () => {
    scenario.handlers.customersRetrieve = async (id) => ({ id, metadata: { firebaseUID: 'uid_c_wrong' } });
    await db.collection('users').doc('uid_c').set({ email: 'c@example.test' });

    const event = {
      id: 'evt_mismatch_2', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_mismatch_2', customer: 'cus_mismatch', subscription: 'sub_mismatch_2', payment_status: 'paid',
          created: 2000000000, client_reference_id: 'uid_c',
        },
      },
    };
    await handler(fakeHttpEvent(event));
    const userDoc = await db.collection('users').doc('uid_c').get();
    expect(userDoc.data().credits).toBeUndefined();
  });

  it('all present identity fields agreeing proceeds normally', async () => {
    scenario.handlers.customersRetrieve = async (id) => ({ id, metadata: { firebaseUID: 'uid_agree' } });
    await db.collection('users').doc('uid_agree').set({ email: 'agree@example.test' });

    const event = {
      id: 'evt_agree_1', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_agree', customer: 'cus_mismatch', subscription: 'sub_agree', payment_status: 'paid',
          created: 2000000000, metadata: { firebaseUID: 'uid_agree' }, client_reference_id: 'uid_agree',
        },
      },
    };
    await handler(fakeHttpEvent(event));
    const userDoc = await db.collection('users').doc('uid_agree').get();
    expect(userDoc.data().credits.remaining).toBe(400);
  });
});
