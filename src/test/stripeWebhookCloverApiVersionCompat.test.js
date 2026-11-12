/**
 * Runs against a REAL Firestore emulator — `npm run test:billing-emulator`. Plain `npm test`
 * skips this file.
 *
 * Production's webhook endpoint is pinned to Stripe API version 2025-10-29.clover — confirmed
 * by the account owner, not the SDK's own default (2025-02-24.acacia, read from
 * node_modules/stripe/cjs/apiVersion.js — see docs/BILLING_CUTOVER_RUNBOOK.md §0.3). Verified
 * against Stripe's own changelog (docs.stripe.com/changelog/basil/2025-03-31/
 * deprecate-subscription-current-period-start-and-end): as of 2025-03-31.basil and every later
 * version including clover, `current_period_start`/`current_period_end` are REMOVED from the
 * top-level Subscription object entirely — replaced by `items.data[].current_period_start/end`
 * on each subscription item.
 *
 * Correction: an earlier version of this file attributed that removal to "flexible billing
 * mode" and assumed every live subscription uses it. Both were wrong. A REAL production payload
 * supplied by the account owner carries `billing_mode.type: "classic"` and *still* has
 * item-level-only periods — proof the top-level field removal is a property of the API VERSION
 * rendering the object, applying uniformly regardless of `billing_mode`, not a consequence of
 * which mode a given subscription happens to use. `cloverSubscription()` below preserves that
 * real example (`billing_mode: { type: 'classic' }`) rather than a guessed/labeled one, and a
 * dedicated test confirms the code's behavior doesn't depend on `billing_mode` at all — it never
 * reads that field, only whichever period fields are actually present.
 *
 * Separately: this app's OWN `VITE_STRIPE_CHECKOUT_MODE` build flag (session vs. legacy Payment
 * Link — src/pages/CheckoutPage.jsx) is unrelated to Stripe's `billing_mode` and was never meant
 * to imply anything about it; confirmed by grep, this repo's committed config
 * (netlify.toml, .env.example) sets neither VITE_STRIPE_CHECKOUT_MODE nor any Stripe billing-mode
 * value — the actual live Netlify value is a production-only setting outside this repo, checked
 * per docs/BILLING_CUTOVER_RUNBOOK.md §0.2, and the per-subscription billing_mode Stripe assigns
 * at creation time is not something this session has live access to confirm either way. Neither
 * matters for correctness here: resolvePeriod's fallback is driven entirely by which fields are
 * present on the object it's given, not by any mode flag on either side.
 *
 * resolvePeriod() (netlify/functions/stripe-webhook.js) was already written with a fallback to
 * item-level fields — this file is what actually proves that fallback produces the correct
 * result against the real shape, end to end, for all four event types the user asked to verify.
 * No other field this code reads changed shape between acacia and clover (checked against the
 * changelog for cancel_at_period_end — unaffected, confirmed via docs.stripe.com/changelog/
 * basil/2025-07-30/cancel-at-enums: that change only adds new CREATE/UPDATE request enum values
 * for mixed-interval cancellation, cancel_at_period_end itself is unchanged as a read field —
 * and for Checkout Session shipping_details, which this codebase never reads at all).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const FIRESTORE_EMULATOR_AVAILABLE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const scenario = vi.hoisted(() => ({ handlers: {} }));

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { retrieve: (...a) => scenario.handlers.customersRetrieve(...a) };
    subscriptions = {
      retrieve: (...a) => scenario.handlers.subscriptionsRetrieve(...a),
      list: async () => ({ data: [], has_more: false }),
    };
    checkout = { sessions: { listLineItems: (...a) => scenario.handlers.listLineItems(...a) } };
    webhooks = { constructEvent: (body) => JSON.parse(body) };
  }
  return { default: FakeStripe };
});

/**
 * A genuinely clover-shaped subscription, preserving the REAL example supplied by the account
 * owner: `billing_mode.type` is "classic" — NOT "flexible" — and current_period_start/
 * current_period_end are still absent at the top level (not null — the key is simply not
 * present, exactly as Stripe sends it), with those fields living only on the single item. This
 * is the proof that the shape is version-driven, not mode-driven: a classic-mode subscription,
 * rendered through the clover API version, gets the same item-level-only periods a
 * flexible-mode one would.
 */
function cloverSubscription(overrides = {}) {
  const { itemOverrides, ...subOverrides } = overrides;
  return {
    id: 'sub_clover_1', customer: 'cus_clover_1', status: 'active', created: 2000000000,
    cancel_at_period_end: false, pause_collection: null,
    billing_mode: { type: 'classic' }, // the real, supplied example — not "flexible"
    metadata: { firebaseUID: 'uid_clover_1' },
    items: {
      data: [{
        price: { id: 'price_starter' },
        current_period_start: 2000000000, current_period_end: 2003000000,
        ...itemOverrides,
      }],
    },
    ...subOverrides,
    // current_period_start/current_period_end deliberately NOT included at the top level —
    // confirmed absent on this API version regardless of billing_mode.
  };
}

describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)(
  'stripe-webhook: production API version 2025-10-29.clover compatibility (run via: npm run test:billing-emulator)',
  () => {
  let resolvePeriod, buildNormalizedFields;

  beforeAll(async () => {
    // billingTestUtils.js sets FIREBASE_PROJECT_ID and the Stripe price env vars as a side
    // effect of its own import, BEFORE triggering firebase-admin.js's initializeApp() — must be
    // imported before stripe-webhook.js (whose own module-level import of firebase-admin.js
    // otherwise throws immediately: "FIREBASE_PROJECT_ID is not set").
    await import('./helpers/billingTestUtils.js');
    const mod = await import('../../netlify/functions/stripe-webhook.js');
    ({ resolvePeriod, buildNormalizedFields } = mod.__internal);
  });

  describe('resolvePeriod — the item-level fallback this PR already built, verified against the real shape', () => {
    it('reads the period from the single item when the top-level fields are absent (the clover shape, billing_mode.type: "classic" — the real supplied example)', () => {
      const subscription = cloverSubscription();
      expect(subscription.billing_mode).toEqual({ type: 'classic' }); // sanity: preserving the real example, not a guess
      const result = resolvePeriod(subscription);
      expect(result).toEqual({ start: 2000000000, end: 2003000000 });
    });

    it('is driven entirely by which fields are present, never by billing_mode — classic and flexible resolve identically', () => {
      const classic = cloverSubscription({ billing_mode: { type: 'classic' } });
      const flexible = cloverSubscription({ billing_mode: { type: 'flexible' } });
      expect(resolvePeriod(classic)).toEqual(resolvePeriod(flexible));
      expect(resolvePeriod(classic)).toEqual({ start: 2000000000, end: 2003000000 });
    });

    it('still prefers top-level fields when present — no regression against the pre-clover (acacia) shape', () => {
      const subscription = cloverSubscription({ current_period_start: 1000000000, current_period_end: 1003000000 });
      const result = resolvePeriod(subscription);
      expect(result).toEqual({ start: 1000000000, end: 1003000000 }); // top-level wins, item ignored
    });

    it('per-item billing periods: disambiguates a multi-item clover subscription by known price id', () => {
      const subscription = cloverSubscription();
      subscription.items.data = [
        { price: { id: 'price_unrelated_addon' }, current_period_start: 1111111111, current_period_end: 1111999999 },
        { price: { id: 'price_starter' }, current_period_start: 2000000000, current_period_end: 2003000000 },
      ];
      const result = resolvePeriod(subscription);
      expect(result).toEqual({ start: 2000000000, end: 2003000000 }); // the known-price item, not the first one
    });

    it('per-item billing periods: a multi-item clover subscription with no identifiable known-price item is explicitly ambiguous, never guessed', () => {
      const subscription = cloverSubscription();
      subscription.items.data = [
        { price: { id: 'price_unrelated_1' }, current_period_start: 1111111111, current_period_end: 1111999999 },
        { price: { id: 'price_unrelated_2' }, current_period_start: 2222222222, current_period_end: 2222999999 },
      ];
      const result = resolvePeriod(subscription);
      expect(result).toEqual({ start: null, end: null });
    });

    it('a clover subscription whose single item has not started billing yet (null item-level periods) resolves to null, not a crash', () => {
      const subscription = cloverSubscription({ itemOverrides: { current_period_start: null, current_period_end: null } });
      const result = resolvePeriod(subscription);
      expect(result).toEqual({ start: null, end: null });
    });
  });

  describe('buildNormalizedFields — the full derived field set, against the real clover shape', () => {
    it('produces correct ISO period strings sourced from the item, plus every other field, for an active clover subscription', () => {
      const fields = buildNormalizedFields(cloverSubscription());
      expect(fields.currentPeriodStart).toBe(new Date(2000000000 * 1000).toISOString());
      expect(fields.currentPeriodEnd).toBe(new Date(2003000000 * 1000).toISOString());
      expect(fields.subscriptionStatus).toBe('active');
      expect(fields.cancelAtPeriodEnd).toBe(false);
      expect(fields.pauseCollection).toBe(false);
      expect(fields.hasCompletedPayment).toBeUndefined(); // only dead statuses touch this
    });

    it('clears hasCompletedPayment for a canceled clover subscription, with period fields still correctly null-safe', () => {
      const fields = buildNormalizedFields(cloverSubscription({ status: 'canceled', itemOverrides: { current_period_start: null, current_period_end: null } }));
      expect(fields.hasCompletedPayment).toBe(false);
      expect(fields.currentPeriodStart).toBeNull();
      expect(fields.currentPeriodEnd).toBeNull();
    });

    it('cancelAtPeriodEnd reads correctly on the clover shape (unaffected by the mixed-interval cancel_at enum addition — confirmed via changelog, this account uses the plain boolean)', () => {
      const fields = buildNormalizedFields(cloverSubscription({ cancel_at_period_end: true }));
      expect(fields.cancelAtPeriodEnd).toBe(true);
    });
  });

  describe('end-to-end against the real handler, all four event types, fully clover-shaped payloads', () => {
    let db, wipeBillingCollections, fakeHttpEvent, handler;

    beforeAll(async () => {
      ({ db, wipeBillingCollections, fakeHttpEvent } = await import('./helpers/billingTestUtils.js'));
      ({ handler } = await import('../../netlify/functions/stripe-webhook.js'));
    });

    beforeEach(async () => {
      await wipeBillingCollections();
      scenario.handlers = {
        customersRetrieve: async (id) => ({ id, metadata: { firebaseUID: 'uid_clover_1' } }),
        subscriptionsRetrieve: async () => cloverSubscription(),
        listLineItems: async () => ({ data: [{ price: { id: 'price_starter' } }] }),
      };
    });

    it('checkout.session.completed: grants credits and records the correct clover-sourced period fields, with no top-level period fields anywhere in the fixture', async () => {
      await db.collection('users').doc('uid_clover_1').set({ email: 'clover1@example.test' });
      const event = {
        id: 'evt_clover_checkout', type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_clover_1', customer: 'cus_clover_1', subscription: 'sub_clover_1', payment_status: 'paid',
            created: 2000000000, client_reference_id: 'uid_clover_1', metadata: {},
          },
        },
      };

      const result = await handler(fakeHttpEvent(event));
      expect(result.statusCode).toBe(200);

      const doc = await db.collection('users').doc('uid_clover_1').get();
      expect(doc.data().credits.remaining).toBe(400); // allocation unaffected by the shape change
      expect(doc.data().currentPeriodStart).toBe(new Date(2000000000 * 1000).toISOString());
      expect(doc.data().currentPeriodEnd).toBe(new Date(2003000000 * 1000).toISOString());
      expect(doc.data().stripeSubscriptionId).toBe('sub_clover_1');

      const allocation = await db.collection('billingAllocations').doc('sub_clover_1').get();
      expect(allocation.exists).toBe(true);
    });

    it('customer.subscription.created: binds the subscription and records clover-sourced period fields on first binding', async () => {
      await db.collection('users').doc('uid_clover_1').set({ email: 'clover1@example.test' });
      const event = { id: 'evt_clover_sub_created', type: 'customer.subscription.created', data: { object: cloverSubscription() } };

      const result = await handler(fakeHttpEvent(event));
      expect(result.statusCode).toBe(200);

      const doc = await db.collection('users').doc('uid_clover_1').get();
      expect(doc.data().stripeSubscriptionId).toBe('sub_clover_1');
      expect(doc.data().currentPeriodStart).toBe(new Date(2000000000 * 1000).toISOString());
      expect(doc.data().currentPeriodEnd).toBe(new Date(2003000000 * 1000).toISOString());
      expect(doc.data().credits).toBeUndefined(); // binding only — never implies allocation
    });

    it('customer.subscription.updated: a renewal moves the clover item-level period forward and the stored fields follow it', async () => {
      await db.collection('users').doc('uid_clover_1').set({
        email: 'clover1@example.test', stripeCustomerId: 'cus_clover_1', stripeSubscriptionId: 'sub_clover_1',
        currentPeriodStart: new Date(2000000000 * 1000).toISOString(), currentPeriodEnd: new Date(2003000000 * 1000).toISOString(),
      });
      const renewed = cloverSubscription({ itemOverrides: { current_period_start: 2003000000, current_period_end: 2006000000 } });
      scenario.handlers.subscriptionsRetrieve = async () => renewed;
      const event = { id: 'evt_clover_sub_renewed', type: 'customer.subscription.updated', data: { object: renewed } };

      const result = await handler(fakeHttpEvent(event));
      expect(result.statusCode).toBe(200);

      const doc = await db.collection('users').doc('uid_clover_1').get();
      expect(doc.data().currentPeriodStart).toBe(new Date(2003000000 * 1000).toISOString());
      expect(doc.data().currentPeriodEnd).toBe(new Date(2006000000 * 1000).toISOString());
    });

    it('customer.subscription.deleted: revokes access correctly on the clover shape (item-level period fields, no top-level ones)', async () => {
      await db.collection('users').doc('uid_clover_1').set({
        email: 'clover1@example.test', stripeCustomerId: 'cus_clover_1', stripeSubscriptionId: 'sub_clover_1',
        hasCompletedPayment: true, subscriptionStatus: 'active',
      });
      const canceled = cloverSubscription({ status: 'canceled', itemOverrides: { current_period_start: null, current_period_end: null } });
      scenario.handlers.subscriptionsRetrieve = async () => canceled;
      const event = { id: 'evt_clover_sub_deleted', type: 'customer.subscription.deleted', data: { object: canceled } };

      const result = await handler(fakeHttpEvent(event));
      expect(result.statusCode).toBe(200);

      const doc = await db.collection('users').doc('uid_clover_1').get();
      expect(doc.data().hasCompletedPayment).toBe(false);
      expect(doc.data().subscriptionStatus).toBe('canceled');
    });
  });
  },
);
