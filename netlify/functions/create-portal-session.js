/**
 * W3: open Stripe's Customer Portal for the signed-in customer.
 *
 *   POST   Authorization: Bearer <Firebase ID token>   → { url }
 *
 * The portal is for payment methods, invoices, billing details and cancelling at the end of the
 * period. It always uses Idynify's own portal configuration (STRIPE_PORTAL_CONFIGURATION_ID,
 * created by scripts/staging/stripeTestModeSetup.mjs in test mode), which has plan switching
 * OFF: plan changes go through change-plan.js, where payment comes before access. Without that
 * configuration this refuses (503) rather than fall back to the account's default portal, whose
 * settings Idynify does not control.
 *
 * The customer is the one on the account (server-written stripeCustomerId), never one from the
 * request.
 */
import process from 'node:process';
import Stripe from 'stripe';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { verifyBillingAppCheck } from './utils/billingAppCheck.js';

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/** The request handling, with Stripe injectable for tests. */
export async function createPortalSession(event, { stripe: injectedStripe } = {}) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'method_not_allowed' });

  let uid;
  try {
    const token = extractAuthToken(event);
    if (!token) return respond(401, { error: 'unauthorized' });
    uid = (await admin.auth().verifyIdToken(token)).uid;
  } catch {
    return respond(401, { error: 'unauthorized' });
  }
  if (!(await verifyBillingAppCheck(event))) return respond(403, { error: 'app_check_required' });

  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  if (!/^bpc_[A-Za-z0-9]+$/.test(configuration ?? '')) return respond(503, { error: 'portal_not_configured' });

  let customerId;
  try {
    const snap = await db.collection('users').doc(uid).get();
    customerId = snap.exists ? snap.data().stripeCustomerId : null;
  } catch {
    return respond(503, { error: 'entitlement_unavailable' });
  }
  if (!customerId) return respond(409, { error: 'no_billing_account' });

  // The same origin rule as create-checkout-session.js: the page the request came from.
  const origin = event.headers?.origin || 'https://idynify.com';
  try {
    const stripe = injectedStripe ?? getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${origin}/settings?tab=billing`,
    });
    return respond(200, { url: session.url });
  } catch (err) {
    console.error('portal_session.failed', { code: err?.code ?? err?.type ?? 'unknown' });
    return respond(503, { error: 'stripe_unavailable' });
  }
}

export const handler = (event) => createPortalSession(event);
