/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file (no FIRESTORE_EMULATOR_HOST): merely importing stripe-webhook.js pulls in
 * firebase-admin.js, which throws at module load without an emulator or real credentials, even
 * though this file's own tests never touch Firestore.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    webhooks = { constructEvent: (...a) => scenario.handlers.constructEvent(...a) };
  }
  return { default: FakeStripe };
});

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: signature verification (run via: npm run test:billing-emulator)',
  () => {
    let fakeHttpEvent, handler;

    beforeAll(async () => {
      ({ fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
      ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
    });

    it('rejects an invalid signature with 400 and performs no Firestore calls', async () => {
      scenario.handlers.constructEvent = () => {
        throw new Error('No signatures found matching the expected signature for payload');
      };
      const result = await handler(fakeHttpEvent({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } }));
      expect(result.statusCode).toBe(400);
    });

    it('rejects non-POST requests', async () => {
      const result = await handler({ httpMethod: 'GET' });
      expect(result.statusCode).toBe(405);
    });
  },
);
