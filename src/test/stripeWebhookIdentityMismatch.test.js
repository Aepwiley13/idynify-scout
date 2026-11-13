/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file. Every identity-bearing field present on a checkout.session.completed event
 * must agree — precedence (picking the first available one) is not validation.
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
  'stripe-webhook: identity cross-check, not precedence (run via: npm run test:billing-emulator)',
  () => {
    let db, wipeBillingCollections, fakeHttpEvent, handler;

    beforeAll(async () => {
      ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
      ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
    });

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

    it('an identity mismatch lands in the manual-review queue (status: pending) and changes nothing else', async () => {
      scenario.handlers.customersRetrieve = async (id) => ({ id, metadata: {} });
      await db.collection('users').doc('uid_a').set({ email: 'a@example.test' });
      await db.collection('users').doc('uid_b').set({ email: 'b@example.test' });

      const event = {
        id: 'evt_mismatch_pending', type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_mismatch_pending', customer: 'cus_mismatch', subscription: 'sub_mismatch_pending', payment_status: 'paid',
            created: 2000000000, metadata: { firebaseUID: 'uid_a' }, client_reference_id: 'uid_b',
          },
        },
      };
      const response = await handler(fakeHttpEvent(event));
      expect(response.statusCode).toBe(200);

      // The queue is defined as `status == 'pending'` — the record must be findable that way.
      const pending = await db.collection('billingAmbiguousAccounts').where('status', '==', 'pending').get();
      expect(pending.size).toBe(1);
      expect(pending.docs[0].data()).toMatchObject({
        uid: 'uid_a', reason: 'identity_mismatch', status: 'pending',
        details: { candidates: ['uid_a', 'uid_b'], sessionId: 'cs_mismatch_pending' },
      });

      // Visibility only: no grant, no allocation marker, neither account touched.
      const [a, b, allocation, applied] = await Promise.all([
        db.collection('users').doc('uid_a').get(), db.collection('users').doc('uid_b').get(),
        db.collection('billingAllocations').doc('sub_mismatch_pending').get(),
        db.collection('stripeWebhookEvents').doc('evt_mismatch_pending').get(),
      ]);
      expect(a.data()).toEqual({ email: 'a@example.test' });
      expect(b.data()).toEqual({ email: 'b@example.test' });
      expect(allocation.exists).toBe(false);
      expect(applied.exists).toBe(true);
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
  },
);
