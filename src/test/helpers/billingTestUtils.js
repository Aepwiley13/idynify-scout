// Shared setup for the billing-hardening emulator test suite. Every test file still defines its
// own `vi.mock('stripe', ...)` (vi.mock factories are hoisted above imports, so a shared mock
// can't be re-exported cleanly) — but the env vars and Firestore wipe routine are identical
// everywhere, so they live here once.
process.env.FIREBASE_PROJECT_ID ||= 'demo-billing-tests';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_fake';
process.env.STRIPE_PRICE_STARTER ||= 'price_starter';
process.env.STRIPE_PRICE_PRO ||= 'price_pro';
process.env.BILLING_LEDGER_EPOCH_UNIX ||= '1000000000';

// Triggers firebase-admin.js's initializeApp() as a side effect before getFirestore() is ever
// called — importing this helper must come before `getFirestore()` is usable, in this file or
// anywhere else, since the Admin SDK throws if getFirestore() runs before any app exists.
const { db } = await import('../../../netlify/functions/firebase-admin.js');
export { db };

export const COLLECTIONS_TO_WIPE = [
  'users', 'stripeWebhookEvents', 'stripeWebhookPendingEvents', 'billingAllocations',
  'billingCheckoutOperations', 'billingAmbiguousAccounts',
];

export async function wipeBillingCollections() {
  for (const coll of COLLECTIONS_TO_WIPE) {
    const snap = await db.collection(coll).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

export function fakeHttpEvent(body, headers = {}) {
  return { httpMethod: 'POST', headers: { 'stripe-signature': 'sig', ...headers }, body: JSON.stringify(body) };
}
