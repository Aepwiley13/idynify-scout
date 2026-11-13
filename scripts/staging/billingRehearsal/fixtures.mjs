/**
 * BILLING REHEARSAL — fixtures. Stripe-shaped objects, a fixture Stripe client, and locally
 * signed webhook deliveries. Nothing here contacts Stripe, in any mode.
 *
 * The fixture client replaces the `stripe` module for the handler under rehearsal. Its
 * retrieve calls answer from the in-memory store below. Its `webhooks` object is the REAL
 * Stripe library's, so signature verification is the production code path: a delivery is
 * accepted only if it was signed (locally, with the fixture secret) by signedDelivery().
 */
import { FIXTURE_STRIPE_KEY, FIXTURE_PRICES, assertRunId, uidPrefix, stripeIdInfix, RehearsalRefusal } from './guard.mjs';

/** One synthetic account per scenario. Fixed, so clean-up can enumerate them from a run id alone. */
export const SLOTS = Object.freeze([
  'unset', 'grant', 'grantpro', 'preepoch', 'order', 'rollback', 'badsig', 'failure', 'lockloss', 'ida', 'idb',
]);

/** Every event a run may deliver for a slot. Fixed for the same reason. */
export const EVENT_LABELS = Object.freeze([
  'checkout', 'checkout2', 'subcreated', 'subupdated',
]);

export function idsFor(runId) {
  assertRunId(runId);
  const slot = (name) => {
    if (!SLOTS.includes(name)) throw new RehearsalRefusal(`Unknown rehearsal slot "${name}".`);
    return name;
  };
  const infix = stripeIdInfix(runId);
  return {
    runId,
    uid: (name) => `${uidPrefix(runId)}${slot(name)}`,
    customer: (name) => `cus${infix}${slot(name)}`,
    subscription: (name) => `sub${infix}${slot(name)}`,
    session: (name) => `cs${infix}${slot(name)}`,
    invoice: (name) => `in${infix}${slot(name)}`,
    event: (name, label) => {
      if (!EVENT_LABELS.includes(label)) throw new RehearsalRefusal(`Unknown rehearsal event label "${label}".`);
      return `evt${infix}${slot(name)}_${label}`;
    },
  };
}

// ── The fixture Stripe store ─────────────────────────────────────────────────────────────────

function emptyStore() {
  return {
    customers: new Map(), subscriptions: new Map(), sessions: new Map(), lineItems: new Map(), invoices: new Map(),
    failNext: new Map(), // call name -> remaining forced failures
    hooks: {}, // call name -> async (id) => void, run once before answering
    calls: [],
  };
}

/** Module-level on purpose: the handler constructs its own client, which must see the same data. */
export const store = emptyStore();

export function resetStore() {
  Object.assign(store, emptyStore());
}

async function answer(call, map, id) {
  store.calls.push({ call, id });
  const hook = store.hooks[call];
  if (hook) {
    delete store.hooks[call];
    await hook(id);
  }
  const remaining = store.failNext.get(call) ?? 0;
  if (remaining > 0) {
    store.failNext.set(call, remaining - 1);
    throw new Error(`fixture: forced ${call} failure`);
  }
  if (!map.has(id)) throw new Error(`fixture: no such object for ${call}: ${id}`);
  // A copy, as a network client would return: the handler can never mutate the store.
  return JSON.parse(JSON.stringify(map.get(id)));
}

/**
 * The class that stands in for `stripe`'s default export. `RealStripe` is the genuine
 * library, used for one thing: its local, offline webhook signature code.
 */
export function makeFixtureStripeClass(RealStripe) {
  const realWebhooks = new RealStripe(FIXTURE_STRIPE_KEY).webhooks;
  return class FixtureStripe {
    constructor(key) {
      if (key !== FIXTURE_STRIPE_KEY) {
        throw new RehearsalRefusal('The fixture Stripe client was constructed with a key that is not the rehearsal fixture.');
      }
      this.customers = { retrieve: (id) => answer('customers.retrieve', store.customers, id) };
      this.subscriptions = { retrieve: (id) => answer('subscriptions.retrieve', store.subscriptions, id) };
      this.invoices = { retrieve: (id) => answer('invoices.retrieve', store.invoices, id) };
      this.checkout = {
        sessions: {
          retrieve: (id) => answer('checkout.sessions.retrieve', store.sessions, id),
          listLineItems: (id) => answer('checkout.sessions.listLineItems', store.lineItems, id),
        },
      };
      this.webhooks = realWebhooks;
    }
  };
}

// ── Stripe-shaped objects ────────────────────────────────────────────────────────────────────

const MONTH = 30 * 24 * 3600;

/**
 * Registers one purchase (customer, subscription, checkout session, line items, paid invoice)
 * for a slot, shaped like a live Payment Link checkout: the buyer is identified by
 * client_reference_id, and neither the customer nor the subscription carries metadata.
 */
export function registerPurchase(ids, slotName, {
  uid = ids.uid(slotName), price = FIXTURE_PRICES.STRIPE_PRICE_STARTER, created, status = 'active',
  paymentStatus = 'paid', sessionMetadata = {}, customerMetadata = {},
} = {}) {
  if (!Number.isInteger(created)) throw new RehearsalRefusal('registerPurchase needs an integer `created` (unix seconds).');
  const customer = { id: ids.customer(slotName), object: 'customer', metadata: { ...customerMetadata } };
  const subscription = {
    id: ids.subscription(slotName), object: 'subscription', customer: customer.id, status, created,
    current_period_start: created, current_period_end: created + MONTH, cancel_at_period_end: false,
    items: { data: [{ price: { id: price } }] }, metadata: {}, latest_invoice: ids.invoice(slotName),
  };
  const session = {
    id: ids.session(slotName), object: 'checkout.session', customer: customer.id, subscription: subscription.id,
    payment_status: paymentStatus, created, client_reference_id: uid, metadata: { ...sessionMetadata },
  };
  store.customers.set(customer.id, customer);
  store.subscriptions.set(subscription.id, subscription);
  store.sessions.set(session.id, session);
  store.lineItems.set(session.id, { data: [{ price: { id: price } }] });
  store.invoices.set(subscription.latest_invoice, { id: subscription.latest_invoice, status: 'paid' });
  return { customer, subscription, session, price, uid };
}

export function checkoutCompletedEvent(ids, slotName, label = 'checkout') {
  const session = store.sessions.get(ids.session(slotName));
  if (!session) throw new RehearsalRefusal(`No purchase registered for slot "${slotName}".`);
  return {
    id: ids.event(slotName, label), object: 'event', type: 'checkout.session.completed', livemode: false,
    data: { object: JSON.parse(JSON.stringify(session)) },
  };
}

export function subscriptionEvent(ids, slotName, type, label) {
  const subscription = store.subscriptions.get(ids.subscription(slotName));
  if (!subscription) throw new RehearsalRefusal(`No purchase registered for slot "${slotName}".`);
  return {
    id: ids.event(slotName, label), object: 'event', type, livemode: false,
    data: { object: JSON.parse(JSON.stringify(subscription)) },
  };
}

// ── Deliveries ───────────────────────────────────────────────────────────────────────────────

/**
 * The HTTP event the Netlify function receives for `event`, signed with `secret` by the real
 * Stripe library's test-header helper. Refuses anything marked livemode.
 */
export function signedDelivery(webhooks, event, secret) {
  if (event?.livemode !== false) throw new RehearsalRefusal('A rehearsal event must be explicitly livemode: false.');
  const payload = JSON.stringify(event);
  const header = webhooks.generateTestHeaderString({ payload, secret });
  return { httpMethod: 'POST', headers: { 'stripe-signature': header }, body: payload };
}

/** The same delivery with its body altered after signing: must fail verification. */
export function tamperedDelivery(webhooks, event, secret) {
  const delivery = signedDelivery(webhooks, event, secret);
  return { ...delivery, body: delivery.body.replace('"paid"', '"paid" ') };
}
