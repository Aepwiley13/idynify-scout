import process from 'node:process';
import Stripe from 'stripe';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { createBillingCustomerLinker } from './utils/billingCustomerLinker.js';
import { verifyBillingAppCheck } from './utils/billingAppCheck.js';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export const handler = createBillingCustomerLinker({
  db,
  extractToken: extractAuthToken,
  verifyToken: (token) => admin.auth().verifyIdToken(token, true),
  verifyAppCheck: (event) => verifyBillingAppCheck(event),
  getStripe,
  now: () => Date.now(),
});
