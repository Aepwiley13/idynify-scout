/**
 * W3: move an existing Starter customer to Pro on the SAME Stripe subscription.
 *
 *   POST { action: 'preview' }                     Authorization: Bearer <Firebase ID token>
 *     → { amountDue, currency, prorationDate, currentPeriodEnd }
 *       What Stripe would charge today for the rest of this period (its own proration preview).
 *   POST { action: 'upgrade', prorationDate }      the value the preview returned
 *     → { status: 'upgraded' }                      paid; the webhook gives Pro access and credits
 *     → { status: 'payment_required', invoiceUrl }  the bank wants confirmation, or the card
 *                                                    failed: Stripe's invoice page takes the
 *                                                    payment; nothing changes until it is paid
 *
 * How it stays safe:
 *   - Never a second subscription: it only ever calls subscriptions.update on the subscription
 *     already on the account, after checking it belongs to the account's Stripe customer, is
 *     live, has exactly one item on the Starter price, and has no pending or scheduled change.
 *   - Payment first: `payment_behavior: 'pending_if_incomplete'` leaves the subscription on
 *     Starter until the prorated invoice is paid. Pro access and the extra credits come only
 *     from the webhook seeing the paid change (stripe-webhook.js decidePlanChange).
 *   - Proration: `always_invoice`, charged now for the rest of the current period, with the
 *     preview's `proration_date` passed to the update so the amount matches what was shown.
 *   - Retries: the Stripe idempotency key is the subscription, the Pro price and that proration
 *     date, so a double click or a resent request applies the change once. A preview older than
 *     30 minutes is refused, so the customer confirms a current amount.
 *   - The decision uses server-controlled data only: the account read through the Admin SDK and
 *     the subscription read from Stripe. Nothing in the request body except the action and the
 *     preview's date.
 * Downgrades and cancellation are not here: cancellation is in the Customer Portal
 * (create-portal-session.js); a move to Starter goes through support for now.
 */
import process from 'node:process';
import Stripe from 'stripe';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { hasActiveAccess } from '../../src/utils/billingEntitlement.js';

export const PREVIEW_MAX_AGE_SECONDS = 30 * 60;
const LIVE = new Set(['active', 'trialing']);

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Why this account cannot move to Pro in-app, or null. Pure. */
export function accountRefusal(userData) {
  if (!userData || !hasActiveAccess(userData)) return { statusCode: 402, error: 'paid_plan_required' };
  if (userData.subscriptionTier === 'pro') return { statusCode: 409, error: 'already_pro' };
  if (userData.subscriptionTier !== 'starter') return { statusCode: 409, error: 'plan_unknown' };
  if (!userData.stripeCustomerId || !userData.stripeSubscriptionId) return { statusCode: 409, error: 'subscription_not_found' };
  if (userData.cancelAtPeriodEnd === true) return { statusCode: 409, error: 'subscription_canceling' };
  return null;
}

/** Why this subscription cannot be moved to Pro, or null. Pure. */
export function subscriptionRefusal(subscription, userData, { starterPrice, proPrice }) {
  if (!subscription || subscription.customer !== userData.stripeCustomerId) return { statusCode: 409, error: 'subscription_mismatch' };
  if (!LIVE.has(subscription.status)) return { statusCode: 409, error: 'subscription_not_active' };
  if (subscription.pending_update) return { statusCode: 409, error: 'upgrade_pending' };
  if (subscription.schedule) return { statusCode: 409, error: 'change_scheduled' };
  if (subscription.cancel_at_period_end) return { statusCode: 409, error: 'subscription_canceling' };
  const items = subscription.items?.data ?? [];
  if (items.length !== 1) return { statusCode: 409, error: 'subscription_items_unexpected' };
  if (items[0].price?.id === proPrice) return { statusCode: 409, error: 'already_pro' };
  if (items[0].price?.id !== starterPrice) return { statusCode: 409, error: 'plan_unknown' };
  return null;
}

/** The amount due now: the proration lines Stripe dated at the proration date. Pure. */
export function prorationAmount(invoice, prorationDate) {
  const lines = invoice?.lines?.data ?? [];
  return lines.filter((l) => l?.period?.start === prorationDate).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
}

/** Is a preview's proration date usable for the update now? Pure. */
export function validProrationDate(prorationDate, subscription, nowSeconds) {
  if (!Number.isInteger(prorationDate)) return false;
  if (prorationDate > nowSeconds + 60 || nowSeconds - prorationDate > PREVIEW_MAX_AGE_SECONDS) return false;
  const start = subscription.current_period_start;
  const end = subscription.current_period_end;
  if (Number.isInteger(start) && prorationDate < start) return false;
  if (Number.isInteger(end) && prorationDate >= end) return false;
  return true;
}

export const upgradeIdempotencyKey = (subscriptionId, proPrice, prorationDate) => `plan-upgrade:${subscriptionId}:${proPrice}:${prorationDate}`;

/** The request handling, with Stripe and the clock injectable for tests. */
export async function changePlan(event, { stripe: injectedStripe, now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'method_not_allowed' });

  let uid;
  try {
    const token = extractAuthToken(event);
    if (!token) return respond(401, { error: 'unauthorized' });
    uid = (await admin.auth().verifyIdToken(token)).uid;
  } catch {
    return respond(401, { error: 'unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'invalid_request' });
  }
  const action = body?.action;
  if (action !== 'preview' && action !== 'upgrade') return respond(400, { error: 'invalid_request' });

  const starterPrice = process.env.STRIPE_PRICE_STARTER;
  const proPrice = process.env.STRIPE_PRICE_PRO;
  if (!starterPrice || !proPrice) return respond(503, { error: 'billing_not_configured' });

  let userData;
  try {
    const snap = await db.collection('users').doc(uid).get();
    userData = snap.exists ? snap.data() : null;
  } catch {
    return respond(503, { error: 'entitlement_unavailable' });
  }
  const refusal = accountRefusal(userData);
  if (refusal) return respond(refusal.statusCode, { error: refusal.error });

  let stripe;
  let subscription;
  try {
    stripe = injectedStripe ?? getStripe();
    subscription = await stripe.subscriptions.retrieve(userData.stripeSubscriptionId, { expand: ['latest_invoice'] });
  } catch {
    return respond(503, { error: 'stripe_unavailable' });
  }
  const subRefusal = subscriptionRefusal(subscription, userData, { starterPrice, proPrice });
  if (subRefusal) {
    const invoiceUrl = subRefusal.error === 'upgrade_pending' ? subscription.latest_invoice?.hosted_invoice_url ?? null : undefined;
    return respond(subRefusal.statusCode, { error: subRefusal.error, ...(invoiceUrl !== undefined ? { invoiceUrl } : {}) });
  }
  const item = subscription.items.data[0];

  if (action === 'preview') {
    const prorationDate = now();
    try {
      const invoice = await stripe.invoices.createPreview({
        customer: userData.stripeCustomerId,
        subscription: subscription.id,
        subscription_details: {
          items: [{ id: item.id, price: proPrice }],
          proration_behavior: 'always_invoice',
          proration_date: prorationDate,
        },
      });
      return respond(200, {
        amountDue: prorationAmount(invoice, prorationDate),
        currency: invoice.currency ?? 'usd',
        prorationDate,
        currentPeriodEnd: subscription.current_period_end ?? null,
      });
    } catch (err) {
      console.error('change_plan.preview_failed', { code: err?.code ?? err?.type ?? 'unknown' });
      return respond(503, { error: 'stripe_unavailable' });
    }
  }

  const prorationDate = body.prorationDate;
  if (!validProrationDate(prorationDate, subscription, now())) return respond(409, { error: 'preview_expired' });

  let updated;
  try {
    updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: proPrice }],
      proration_behavior: 'always_invoice',
      proration_date: prorationDate,
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice'],
    }, { idempotencyKey: upgradeIdempotencyKey(subscription.id, proPrice, prorationDate) });
  } catch (err) {
    if (err?.type === 'StripeIdempotencyError' || err?.code === 'idempotency_key_in_use') return respond(409, { error: 'upgrade_in_progress' });
    if (err?.type === 'StripeCardError') return respond(402, { error: 'card_declined' });
    console.error('change_plan.update_failed', { code: err?.code ?? err?.type ?? 'unknown' });
    return respond(503, { error: 'stripe_unavailable' });
  }

  if (updated.pending_update) {
    return respond(200, { status: 'payment_required', invoiceUrl: updated.latest_invoice?.hosted_invoice_url ?? null });
  }
  return respond(200, { status: 'upgraded' });
}

export const handler = (event) => changePlan(event);
