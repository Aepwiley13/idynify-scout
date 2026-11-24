import process from 'node:process';
import Stripe from 'stripe';
import { admin } from './firebase-admin.js';
import { checkAdminAccess } from './utils/adminAuth.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { inspectBillingReadiness } from './utils/billingReadiness.js';

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export async function checkBillingReadiness(event, {
  verifyToken = (token) => admin.auth().verifyIdToken(token, true),
  isAdmin = checkAdminAccess,
  env = process.env,
  stripeFactory = () => new Stripe(env.STRIPE_SECRET_KEY),
} = {}) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
  let actor;
  try {
    const token = extractAuthToken(event);
    if (!token) return reply(401, { error: 'unauthorized' });
    actor = await verifyToken(token);
  } catch {
    return reply(401, { error: 'unauthorized' });
  }
  if (!actor?.uid || actor.firebase?.sign_in_provider === 'custom') return reply(403, { error: 'forbidden' });
  if (!(await isAdmin(actor.uid))) return reply(403, { error: 'forbidden' });
  if (!/^sk_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? '') && !/^rk_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? '')) {
    const { ready, checks, errorCode } = await inspectBillingReadiness({ stripe: null, env });
    return reply(200, { ready, checks, ...(errorCode ? { errorCode } : {}) });
  }
  try {
    const result = await inspectBillingReadiness({ stripe: stripeFactory(), env });
    return reply(200, result);
  } catch {
    return reply(200, { ready: false, errorCode: 'stripe_runtime_check_failed' });
  }
}

export const handler = (event) => checkBillingReadiness(event);
