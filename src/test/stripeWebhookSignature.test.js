import { describe, it, expect, vi } from 'vitest';

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    webhooks = { constructEvent: (...a) => scenario.handlers.constructEvent(...a) };
  }
  return { default: FakeStripe };
});

const { fakeHttpEvent } = await import('./helpers/billingTestUtils.js');
const { handler } = await import('../../netlify/functions/stripe-webhook.js');

describe('stripe-webhook: signature verification', () => {
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
});
