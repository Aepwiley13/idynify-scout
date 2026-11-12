/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * scripts/manualCreditRecovery.mjs used to trust its CLI arguments at face value — including
 * --evidence-stripe-session-id/--evidence-note, which were recorded but never independently
 * checked against anything. verifyPurchaseAgainstStripe() now re-derives the purchase facts from
 * Stripe itself before any write happens. Every test below proves TWO things together: the
 * attempt is refused, AND nothing was written — no credits field touched, no allocation marker
 * created, no ambiguous-account record mutated, and no EXISTING balance/usage disturbed. An
 * operator's evidence note is an approval record of who ran this and why; it has never been, and
 * is still not, a substitute for this validation.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function fakeStripe({ subscriptions = {}, sessions = {}, customers = {}, invoices = {} } = {}) {
  return {
    subscriptions: { retrieve: async (id) => { if (!subscriptions[id]) throw new Error(`no such subscription: ${id}`); return subscriptions[id]; } },
    checkout: { sessions: { retrieve: async (id) => { if (!sessions[id]) throw new Error(`no such checkout session: ${id}`); return sessions[id]; } } },
    customers: { retrieve: async (id) => { if (!customers[id]) throw new Error(`no such customer: ${id}`); return customers[id]; } },
    invoices: { retrieve: async (id) => { if (!invoices[id]) throw new Error(`no such invoice: ${id}`); return invoices[id]; } },
  };
}

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'manualCreditRecovery: evidence is an approval record, never a substitute for Stripe-verified validation (run via: npm run test:billing-emulator)',
  () => {
  let db, wipeBillingCollections, applyManualRecovery, EvidenceValidationError;

  beforeAll(async () => {
    ({ db, wipeBillingCollections } = await import('./helpers/billingTestUtils.js'));
    ({ applyManualRecovery, EvidenceValidationError } = await import('../../scripts/manualCreditRecovery.mjs'));
  });

  beforeEach(async () => {
    await wipeBillingCollections();
  });

  async function expectNoWrite(uid, subscriptionId) {
    const userDoc = await db.collection('users').doc(uid).get();
    expect(userDoc.data().hasCompletedPayment).toBeUndefined();
    expect(userDoc.data().credits).toBeUndefined();
    const allocDoc = await db.collection('billingAllocations').doc(subscriptionId).get();
    expect(allocDoc.exists).toBe(false);
  }

  it('rejects a genuinely unknown price id, and writes nothing', async () => {
    await db.collection('users').doc('uid_ev_unknown').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_unknown: { customer: 'cus_ev_unknown', status: 'active', items: { data: [{ price: { id: 'price_totally_unrelated' } }] } } },
      customers: { cus_ev_unknown: { metadata: { firebaseUID: 'uid_ev_unknown' } } },
      sessions: { cs_ev_unknown: { subscription: 'sub_ev_unknown', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_unknown', subscriptionId: 'sub_ev_unknown', priceId: 'price_totally_unrelated',
      evidenceStripeSessionId: 'cs_ev_unknown', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_unknown', 'sub_ev_unknown');
  });

  it('rejects the known-but-free price (e.g. the $0/month Scout Starter price), and writes nothing', async () => {
    await db.collection('users').doc('uid_ev_free').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_free: { customer: 'cus_ev_free', status: 'active', items: { data: [{ price: { id: process.env.STRIPE_PRICE_SCOUT_STARTER_FREE } }] } } },
      customers: { cus_ev_free: { metadata: { firebaseUID: 'uid_ev_free' } } },
      sessions: { cs_ev_free: { subscription: 'sub_ev_free', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_free', subscriptionId: 'sub_ev_free', priceId: process.env.STRIPE_PRICE_SCOUT_STARTER_FREE,
      evidenceStripeSessionId: 'cs_ev_free', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_free', 'sub_ev_free');
  });

  it('rejects when the account\'s recorded stripeCustomerId does not match the subscription\'s Stripe customer (mismatched account)', async () => {
    await db.collection('users').doc('uid_ev_mismatch_acct').set({ email: 'x@example.test', stripeCustomerId: 'cus_real_owner' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_mismatch_acct: { customer: 'cus_someone_else', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      // Even if Stripe's own metadata agreed, the account's OWN recorded customer id disagrees.
      customers: { cus_someone_else: { metadata: { firebaseUID: 'uid_ev_mismatch_acct' } } },
      sessions: { cs_ev_mismatch_acct: { subscription: 'sub_ev_mismatch_acct', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_mismatch_acct', subscriptionId: 'sub_ev_mismatch_acct', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_mismatch_acct', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_mismatch_acct', 'sub_ev_mismatch_acct');
  });

  it('rejects missing customer binding: the Stripe customer has no firebaseUID metadata at all — absence is not a cleared contradiction', async () => {
    await db.collection('users').doc('uid_ev_no_binding').set({ email: 'x@example.test' }); // no stripeCustomerId on file either
    const stripe = fakeStripe({
      subscriptions: { sub_ev_no_binding: { customer: 'cus_ev_no_binding', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_no_binding: { metadata: {} } }, // no firebaseUID at all
      sessions: { cs_ev_no_binding: { subscription: 'sub_ev_no_binding', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_no_binding', subscriptionId: 'sub_ev_no_binding', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_no_binding', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_no_binding', 'sub_ev_no_binding');
  });

  it('rejects missing customer binding: the Stripe customer\'s firebaseUID metadata belongs to a DIFFERENT uid — no positive ownership proof', async () => {
    await db.collection('users').doc('uid_ev_wrong_binding').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_wrong_binding: { customer: 'cus_ev_wrong_binding', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_wrong_binding: { metadata: { firebaseUID: 'uid_SOMEONE_ELSE' } } },
      sessions: { cs_ev_wrong_binding: { subscription: 'sub_ev_wrong_binding', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_wrong_binding', subscriptionId: 'sub_ev_wrong_binding', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_wrong_binding', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_wrong_binding', 'sub_ev_wrong_binding');
  });

  it('rejects when the subscription does not actually carry the claimed price (mismatched purchase record)', async () => {
    await db.collection('users').doc('uid_ev_mismatch_price').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      // Operator claims price_pro, but the subscription was actually a Starter purchase.
      subscriptions: { sub_ev_mismatch_price: { customer: 'cus_ev_mismatch_price', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_mismatch_price: { metadata: { firebaseUID: 'uid_ev_mismatch_price' } } },
      sessions: { cs_ev_mismatch_price: { subscription: 'sub_ev_mismatch_price', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_mismatch_price', subscriptionId: 'sub_ev_mismatch_price', priceId: 'price_pro',
      evidenceStripeSessionId: 'cs_ev_mismatch_price', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_mismatch_price', 'sub_ev_mismatch_price');
  });

  it('rejects a canceled subscription — never restores access that is not currently in force', async () => {
    await db.collection('users').doc('uid_ev_canceled').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_canceled: { customer: 'cus_ev_canceled', status: 'canceled', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_canceled: { metadata: { firebaseUID: 'uid_ev_canceled' } } },
      sessions: { cs_ev_canceled: { subscription: 'sub_ev_canceled', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_canceled', subscriptionId: 'sub_ev_canceled', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_canceled', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_canceled', 'sub_ev_canceled');
  });

  it('rejects an incomplete_expired subscription the same way as canceled', async () => {
    await db.collection('users').doc('uid_ev_expired').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_expired: { customer: 'cus_ev_expired', status: 'incomplete_expired', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_expired: { metadata: { firebaseUID: 'uid_ev_expired' } } },
      sessions: { cs_ev_expired: { subscription: 'sub_ev_expired', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_expired', subscriptionId: 'sub_ev_expired', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_expired', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_expired', 'sub_ev_expired');
  });

  it('rejects when the account already has a DIFFERENT subscription on file — preserves that unrelated balance and usage untouched', async () => {
    await db.collection('users').doc('uid_ev_other_sub').set({
      email: 'x@example.test',
      stripeCustomerId: 'cus_ev_other_sub',
      stripeSubscriptionId: 'sub_ALREADY_ON_FILE',
      hasCompletedPayment: true,
      subscriptionTier: 'pro',
      credits: { total: 1250, used: 300, remaining: 950, resetDate: '2026-12-01T00:00:00.000Z' },
    });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_other_sub: { customer: 'cus_ev_other_sub', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_other_sub: { metadata: { firebaseUID: 'uid_ev_other_sub' } } },
      sessions: { cs_ev_other_sub: { subscription: 'sub_ev_other_sub', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_other_sub', subscriptionId: 'sub_ev_other_sub', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_other_sub', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    // The existing, unrelated subscription's balance and usage are completely untouched.
    const userDoc = await db.collection('users').doc('uid_ev_other_sub').get();
    expect(userDoc.data().credits).toEqual({ total: 1250, used: 300, remaining: 950, resetDate: '2026-12-01T00:00:00.000Z' });
    expect(userDoc.data().subscriptionTier).toBe('pro');
    expect(userDoc.data().stripeSubscriptionId).toBe('sub_ALREADY_ON_FILE');

    const allocDoc = await db.collection('billingAllocations').doc('sub_ev_other_sub').get();
    expect(allocDoc.exists).toBe(false);
  });

  it('rejects existing same-subscription usage: the account already shows recorded usage for THIS subscription with no billingAllocations marker — preserves it rather than resetting it', async () => {
    await db.collection('users').doc('uid_ev_same_sub_usage').set({
      email: 'x@example.test',
      stripeCustomerId: 'cus_ev_same_sub_usage',
      stripeSubscriptionId: 'sub_ev_same_sub_usage', // SAME subscription as the one being recovered
      hasCompletedPayment: false, // not yet marked complete, but usage already exists below
      credits: { total: 400, used: 120, remaining: 280, resetDate: '2026-12-01T00:00:00.000Z' },
    });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_same_sub_usage: { customer: 'cus_ev_same_sub_usage', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_same_sub_usage: { metadata: { firebaseUID: 'uid_ev_same_sub_usage' } } },
      sessions: { cs_ev_same_sub_usage: { subscription: 'sub_ev_same_sub_usage', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_same_sub_usage', subscriptionId: 'sub_ev_same_sub_usage', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_same_sub_usage', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    // The existing usage is completely untouched — not reset to a fresh 400/0/400 grant.
    const userDoc = await db.collection('users').doc('uid_ev_same_sub_usage').get();
    expect(userDoc.data().credits).toEqual({ total: 400, used: 120, remaining: 280, resetDate: '2026-12-01T00:00:00.000Z' });

    const allocDoc = await db.collection('billingAllocations').doc('sub_ev_same_sub_usage').get();
    expect(allocDoc.exists).toBe(false);
  });

  it('rejects existing same-subscription state when hasCompletedPayment is already true, even with zero recorded usage yet', async () => {
    await db.collection('users').doc('uid_ev_already_complete').set({
      email: 'x@example.test',
      stripeCustomerId: 'cus_ev_already_complete',
      stripeSubscriptionId: 'sub_ev_already_complete',
      hasCompletedPayment: true,
      credits: { total: 400, used: 0, remaining: 400, resetDate: '2026-12-01T00:00:00.000Z' },
    });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_already_complete: { customer: 'cus_ev_already_complete', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_already_complete: { metadata: { firebaseUID: 'uid_ev_already_complete' } } },
      sessions: { cs_ev_already_complete: { subscription: 'sub_ev_already_complete', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_already_complete', subscriptionId: 'sub_ev_already_complete', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_already_complete', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    const allocDoc = await db.collection('billingAllocations').doc('sub_ev_already_complete').get();
    expect(allocDoc.exists).toBe(false);
  });

  it('rejects when the evidence checkout session does not actually point at this subscription — evidence must independently check out, not just be supplied', async () => {
    await db.collection('users').doc('uid_ev_bad_evidence').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_bad_evidence: { customer: 'cus_ev_bad_evidence', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_bad_evidence: { metadata: { firebaseUID: 'uid_ev_bad_evidence' } } },
      // A real, resolvable checkout session — but for a DIFFERENT subscription entirely.
      sessions: { cs_ev_bad_evidence: { subscription: 'sub_SOME_OTHER_PURCHASE', payment_status: 'paid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_bad_evidence', subscriptionId: 'sub_ev_bad_evidence', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_bad_evidence',
      evidenceNote: 'Operator is confident this is correct.', // a confident note is still not proof
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_bad_evidence', 'sub_ev_bad_evidence');
  });

  it('rejects when the evidence checkout session is unpaid', async () => {
    await db.collection('users').doc('uid_ev_unpaid').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_unpaid: { customer: 'cus_ev_unpaid', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_unpaid: { metadata: { firebaseUID: 'uid_ev_unpaid' } } },
      sessions: { cs_ev_unpaid: { subscription: 'sub_ev_unpaid', payment_status: 'unpaid' } },
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_unpaid', subscriptionId: 'sub_ev_unpaid', priceId: 'price_starter',
      evidenceStripeSessionId: 'cs_ev_unpaid', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_unpaid', 'sub_ev_unpaid');
  });

  it('rejects unpaid subscription-id evidence: no checkout session exists, and the subscription\'s latest invoice is not paid', async () => {
    await db.collection('users').doc('uid_ev_unpaid_sub_evidence').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: {
        sub_ev_unpaid_sub_evidence: {
          customer: 'cus_ev_unpaid_sub_evidence', status: 'active', latest_invoice: 'in_ev_unpaid',
          items: { data: [{ price: { id: 'price_starter' } }] },
        },
      },
      customers: { cus_ev_unpaid_sub_evidence: { metadata: { firebaseUID: 'uid_ev_unpaid_sub_evidence' } } },
      invoices: { in_ev_unpaid: { status: 'open' } }, // not paid — a confident note cannot substitute for this
      sessions: {},
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_unpaid_sub_evidence', subscriptionId: 'sub_ev_unpaid_sub_evidence', priceId: 'price_starter',
      evidenceStripeSessionId: 'sub_ev_unpaid_sub_evidence',
      evidenceNote: 'Operator believes this legacy Payment Link purchase was paid.',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_unpaid_sub_evidence', 'sub_ev_unpaid_sub_evidence');
  });

  it('rejects subscription-id evidence with no latest_invoice at all to confirm payment against', async () => {
    await db.collection('users').doc('uid_ev_no_invoice').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: {
        sub_ev_no_invoice: { customer: 'cus_ev_no_invoice', status: 'active', latest_invoice: null, items: { data: [{ price: { id: 'price_starter' } }] } },
      },
      customers: { cus_ev_no_invoice: { metadata: { firebaseUID: 'uid_ev_no_invoice' } } },
      sessions: {},
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_no_invoice', subscriptionId: 'sub_ev_no_invoice', priceId: 'price_starter',
      evidenceStripeSessionId: 'sub_ev_no_invoice', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_no_invoice', 'sub_ev_no_invoice');
  });

  it('rejects an evidence id that is neither a resolvable checkout session nor the subscription id itself', async () => {
    await db.collection('users').doc('uid_ev_garbage').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_garbage: { customer: 'cus_ev_garbage', status: 'active', items: { data: [{ price: { id: 'price_starter' } }] } } },
      customers: { cus_ev_garbage: { metadata: { firebaseUID: 'uid_ev_garbage' } } },
      sessions: {},
    });

    await expect(applyManualRecovery(db, stripe, {
      uid: 'uid_ev_garbage', subscriptionId: 'sub_ev_garbage', priceId: 'price_starter',
      evidenceStripeSessionId: 'not_a_real_stripe_id', evidenceNote: 'operator claims this is genuine',
    })).rejects.toThrow(EvidenceValidationError);

    await expectNoWrite('uid_ev_garbage', 'sub_ev_garbage');
  });

  it('accepts the subscription id itself as evidence (the documented <cs_...|sub_...> form) when its own latest invoice is independently confirmed paid', async () => {
    await db.collection('users').doc('uid_ev_sub_evidence').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: {
        sub_ev_sub_evidence: {
          customer: 'cus_ev_sub_evidence', status: 'active', latest_invoice: 'in_ev_sub_evidence',
          items: { data: [{ price: { id: 'price_starter' } }] },
        },
      },
      customers: { cus_ev_sub_evidence: { metadata: { firebaseUID: 'uid_ev_sub_evidence' } } },
      invoices: { in_ev_sub_evidence: { status: 'paid' } },
      sessions: {},
    });

    const result = await applyManualRecovery(db, stripe, {
      uid: 'uid_ev_sub_evidence', subscriptionId: 'sub_ev_sub_evidence', priceId: 'price_starter',
      evidenceStripeSessionId: 'sub_ev_sub_evidence', evidenceNote: 'No checkout session exists for this legacy Payment Link purchase; the subscription\'s own paid invoice is the evidence.',
    });
    expect(result.applied).toBe(true);
  });

  it('a fully valid, independently-verified recovery still succeeds end to end', async () => {
    await db.collection('users').doc('uid_ev_valid').set({ email: 'x@example.test' });
    const stripe = fakeStripe({
      subscriptions: { sub_ev_valid: { customer: 'cus_ev_valid', status: 'active', items: { data: [{ price: { id: 'price_pro' } }] } } },
      customers: { cus_ev_valid: { metadata: { firebaseUID: 'uid_ev_valid' } } },
      sessions: { cs_ev_valid: { subscription: 'sub_ev_valid', payment_status: 'paid' } },
    });

    const result = await applyManualRecovery(db, stripe, {
      uid: 'uid_ev_valid', subscriptionId: 'sub_ev_valid', priceId: 'price_pro',
      evidenceStripeSessionId: 'cs_ev_valid', evidenceNote: 'Confirmed paid invoice in Stripe.',
    });
    expect(result.applied).toBe(true);

    const userDoc = await db.collection('users').doc('uid_ev_valid').get();
    expect(userDoc.data().credits.remaining).toBe(1250);
  });
  },
);
