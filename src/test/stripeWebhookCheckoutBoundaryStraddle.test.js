/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. A checkout session created before this PR's deploy epoch but
 * delivered/completed after it must not be auto-granted (its own provenance may legitimately be
 * absent) and must not auto-top-up or reset an existing balance — it's flagged for manual
 * reconciliation, with the payment details preserved in the flagged record.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

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

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: checkout opened before deploy, completed after (run via: npm run test:billing-emulator)',
  () => {
    let db, wipeBillingCollections, fakeHttpEvent, handler;

    beforeAll(async () => {
      ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
      ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
    });

    beforeEach(async () => {
      await wipeBillingCollections();
      scenario.handlers = {
        customersRetrieve: async (id) => ({ id, metadata: {} }),
        subscriptionsRetrieve: async (id) => ({
          id, customer: 'cus_straddle', status: 'active', created: 500000000, // before the epoch too
          current_period_start: 500000000, current_period_end: 503000000, cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_starter' } }] }, metadata: {},
        }),
        listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
      };
    });

    it('a pre-epoch session delivered post-epoch is flagged, not granted, and does not touch an existing balance', async () => {
    await db.collection('users').doc('uid_straddle').set({
      email: 's@example.test', credits: { total: 400, used: 50, remaining: 350, resetDate: null },
    });

    const event = {
      id: 'evt_straddle_1', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_straddle', customer: 'cus_straddle', subscription: 'sub_straddle', payment_status: 'paid',
          created: 500000000, // BEFORE BILLING_LEDGER_EPOCH_UNIX (1000000000) — opened pre-deploy
          client_reference_id: 'uid_straddle', metadata: {},
        },
      },
    };

    const result = await handler(fakeHttpEvent(event));
    expect(result.statusCode).toBe(200);

    const userDoc = await db.collection('users').doc('uid_straddle').get();
    // Untouched — no auto-grant, no auto-top-up, no reset of the existing balance.
    expect(userDoc.data().credits).toEqual({ total: 400, used: 50, remaining: 350, resetDate: null });

    const allocation = await db.collection('billingAllocations').doc('sub_straddle').get();
    expect(allocation.exists).toBe(false);

    const ambiguous = await db.collection('billingAmbiguousAccounts').get();
    expect(ambiguous.docs).toHaveLength(1);
    const flag = ambiguous.docs[0].data();
    expect(flag.reason).toBe('pre_epoch_no_marker');
    expect(flag.details.paymentStatus).toBe('paid'); // the payment is visible in the flagged record
    expect(flag.details.sessionId).toBe('cs_straddle');
  });

  it('with the epoch unset entirely, a new purchase is flagged rather than guessed', async () => {
    const original = process.env.BILLING_LEDGER_EPOCH_UNIX;
    delete process.env.BILLING_LEDGER_EPOCH_UNIX;
    try {
      await db.collection('users').doc('uid_noepoch').set({ email: 'n@example.test' });
      const event = {
        id: 'evt_noepoch_1', type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_noepoch', customer: 'cus_straddle', subscription: 'sub_noepoch', payment_status: 'paid',
            created: 9999999999, client_reference_id: 'uid_noepoch', metadata: {},
          },
        },
      };
      await handler(fakeHttpEvent(event));
      const userDoc = await db.collection('users').doc('uid_noepoch').get();
      expect(userDoc.data().credits).toBeUndefined();
      const ambiguous = await db.collection('billingAmbiguousAccounts').get();
      expect(ambiguous.docs.some((d) => d.data().reason === 'epoch_unset')).toBe(true);
    } finally {
      process.env.BILLING_LEDGER_EPOCH_UNIX = original;
    }
    });
  },
);
