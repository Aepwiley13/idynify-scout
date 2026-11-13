/**
 * Runs under plain `npm test` — no emulator. The emulator suite
 * (stripeWebhookIdentityMismatch.test.js) proves the same thing against real Firestore, but it
 * is skipped wherever the emulator isn't running, so this pins the one property that was
 * missing in a place that always executes: an identity_mismatch record must carry
 * `status: 'pending'`, because `status == 'pending'` IS the manual-review queue. Without it the
 * record is written but no queue query ever returns it.
 *
 * Firestore is replaced by a recorder, so this also shows the mismatch path's complete write
 * set: exactly one ambiguous record and one event-ledger entry, nothing on any user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recorded = vi.hoisted(() => ({ sets: [], updates: [], customer: { id: 'cus_1', metadata: {} } }));

vi.mock('../../netlify/functions/firebase-admin.js', () => {
  let autoId = 0;
  const ref = (path) => ({ path, get: async () => ({ exists: false, data: () => undefined }) });
  const collection = (name) => ({
    doc: (id) => ref(`${name}/${id ?? `auto_${++autoId}`}`),
  });
  const tx = {
    get: async () => ({ exists: false, data: () => undefined }),
    set: (r, data) => recorded.sets.push({ path: r.path, data }),
    update: (r, data) => recorded.updates.push({ path: r.path, data }),
  };
  return { db: { collection, runTransaction: async (fn) => fn(tx) } };
});

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: async () => recorded.customer };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

function mismatchEvent() {
  return {
    httpMethod: 'POST', headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', payment_status: 'paid', created: 2000000000,
        metadata: { firebaseUID: 'uid_a' }, client_reference_id: 'uid_b',
      } },
    }),
  };
}

describe('stripe-webhook identity_mismatch — visible in the manual-review queue', () => {
  beforeEach(() => {
    recorded.sets.length = 0;
    recorded.updates.length = 0;
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x');
  });

  it('writes the ambiguous record with status: pending', async () => {
    const { handler } = await import('../../netlify/functions/stripe-webhook.js');
    const response = await handler(mismatchEvent());
    expect(response.statusCode).toBe(200);

    const flagged = recorded.sets.filter((w) => w.path.startsWith('billingAmbiguousAccounts/'));
    expect(flagged).toHaveLength(1);
    expect(flagged[0].data).toMatchObject({
      uid: 'uid_a', reason: 'identity_mismatch', status: 'pending',
      details: { candidates: ['uid_a', 'uid_b'], sessionId: 'cs_1' },
    });
    expect(typeof flagged[0].data.flaggedAt).toBe('string');
  });

  it('writes nothing else: one flag, one event-ledger entry, no user or allocation write', async () => {
    const { handler } = await import('../../netlify/functions/stripe-webhook.js');
    await handler(mismatchEvent());

    expect(recorded.updates).toEqual([]);
    expect(recorded.sets.map((w) => w.path.split('/')[0]).sort()).toEqual(['billingAmbiguousAccounts', 'stripeWebhookEvents']);
    expect(recorded.sets.find((w) => w.path === 'stripeWebhookEvents/evt_1')).toBeTruthy();
  });
});
