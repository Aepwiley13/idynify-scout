import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { describeSubscription, isBlockingStatus } from '../../src/utils/billingEntitlement.js';

// Stripe retains idempotency keys for roughly 24h. A margin under that is the bound past which a
// stuck "creating" claim can no longer be safely recovered by replaying the same key — beyond it,
// the only safe move is to stop and ask for manual reconciliation, never to silently retry
// creation with a key that may no longer protect anything.
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function priceIdForTier(tier) {
  return tier === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_STARTER;
}

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function writeAmbiguous(uid, reason, details = {}) {
  await db.collection('billingAmbiguousAccounts').add({ uid, reason, details, flaggedAt: new Date().toISOString() });
}

/** Fully paginates a Stripe list response, applying `predicate` to each page's items. */
async function listAllPages(listFn, params, predicate) {
  let startingAfter;
  for (;;) {
    const page = await listFn({ ...params, starting_after: startingAfter });
    for (const item of page.data) {
      if (predicate(item)) return item;
    }
    if (!page.has_more || page.data.length === 0) return null;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let uid;
  try {
    const token = extractAuthToken(event);
    if (!token) return respond(401, { error: 'Missing authentication token' });
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid; // uid comes ONLY from the verified token, never from the request body
  } catch (err) {
    return respond(401, { error: 'Invalid authentication token' });
  }

  let tier;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    tier = body.tier === 'pro' ? 'pro' : 'starter';
  } catch {
    return respond(400, { error: 'Invalid request body' });
  }

  const priceId = priceIdForTier(tier);
  if (!priceId) return respond(500, { error: `No price configured for tier: ${tier}` });

  let stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    return respond(500, { error: err.message });
  }

  const userRef = db.collection('users').doc(uid);

  // ── Duplicate-subscription check uses isBlockingStatus, not hasAccess ──────────────────────
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : {};
  if (userData.subscriptionStatus) {
    const normalized = describeSubscription({
      status: userData.subscriptionStatus,
      cancelAtPeriodEnd: userData.cancelAtPeriodEnd === true,
      pauseCollection: Boolean(userData.pauseCollection),
    });
    if (isBlockingStatus(normalized.normalizedState)) {
      const accessGrantingReason = normalized.hasAccess ? 'already_subscribed' : 'subscription_needs_recovery';
      return respond(409, { error: accessGrantingReason });
    }
  }

  // ── Claim acquisition — a stable operationId anchors both recovery and later provenance ───
  let claim;
  try {
    claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const existing = snap.data()?.pendingCheckout;

      if (existing?.status === 'open') {
        return { kind: 'reuse_open', operationId: existing.operationId };
      }
      if (existing?.status === 'creating') {
        return { kind: 'recover', operationId: existing.operationId };
      }

      const operationId = randomUUID();
      const opRef = db.collection('billingCheckoutOperations').doc(operationId);
      tx.set(opRef, {
        uid, tier, priceId,
        successUrl: `${event.headers?.origin || 'https://idynify.com'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${event.headers?.origin || 'https://idynify.com'}/checkout/cancel`,
        createdAt: new Date().toISOString(),
        customerId: null, sessionId: null, subscriptionId: null,
      });
      tx.set(userRef, { pendingCheckout: { status: 'creating', operationId, claimedAt: new Date().toISOString() } }, { merge: true });
      return { kind: 'fresh', operationId };
    });
  } catch (err) {
    console.error('Checkout claim transaction failed:', err);
    return respond(500, { error: 'checkout_claim_failed' });
  }

  if (claim.kind === 'reuse_open') {
    const opSnap = await db.collection('billingCheckoutOperations').doc(claim.operationId).get();
    const op = opSnap.data();
    if (op?.sessionId) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(op.sessionId);
        if (existingSession.status === 'open') return respond(200, { url: existingSession.url });
      } catch { /* fall through to recovery below */ }
    }
  }

  const opRef = db.collection('billingCheckoutOperations').doc(claim.operationId);
  const opSnap = await opRef.get();
  const op = opSnap.data();
  const claimedAtMs = Date.parse(op.createdAt);
  const withinWindow = Date.now() - claimedAtMs < IDEMPOTENCY_WINDOW_MS;

  // ── Customer resolution ──────────────────────────────────────────────────────────────────
  let customerId = op.customerId;
  if (!customerId) {
    if (withinWindow) {
      try {
        const customer = await stripe.customers.create(
          { email: userData.email, metadata: { firebaseUID: uid } },
          { idempotencyKey: `cust-create-${claim.operationId}` }
        );
        customerId = customer.id;
        await opRef.update({ customerId });
        await userRef.update({ stripeCustomerId: customerId });
      } catch (err) {
        if (err?.type === 'StripeIdempotencyError') {
          return respond(425, { error: 'checkout_in_progress' }); // genuinely still running elsewhere
        }
        console.error('Customer creation failed:', err);
        return respond(500, { error: 'customer_creation_failed' });
      }
    } else {
      // Beyond the idempotency window with no customerId recorded: a customer-scoped listing is
      // impossible without a customer id, and an account-wide search is not a safe substitute
      // (Stripe Search is eventually consistent — a negative result never proves absence). Stop.
      await writeAmbiguous(uid, 'checkout_customer_recovery_expired', { operationId: claim.operationId });
      await userRef.set({ pendingCheckout: { status: 'failed', operationId: claim.operationId } }, { merge: true });
      return respond(409, { error: 'checkout_needs_manual_reconciliation' });
    }
  } else if (userData.stripeCustomerId && userData.stripeCustomerId !== customerId) {
    return respond(409, { error: 'customer_binding_conflict' });
  }

  // Verify ownership of a reused customer before trusting it.
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.metadata?.firebaseUID && customer.metadata.firebaseUID !== uid) {
      console.error('Customer ownership mismatch', { uid, customerId });
      await writeAmbiguous(uid, 'customer_ownership_mismatch', { customerId });
      await userRef.set({ pendingCheckout: { status: 'failed', operationId: claim.operationId } }, { merge: true });
      return respond(409, { error: 'contact_support' });
    }
  } catch (err) {
    return respond(500, { error: 'customer_retrieve_failed' });
  }

  // ── Duplicate check, fully paginated, direct from Stripe ─────────────────────────────────
  const blockingSub = await listAllPages(
    (params) => stripe.subscriptions.list(params),
    { customer: customerId, status: 'all', limit: 100 },
    (sub) => !['canceled', 'incomplete_expired'].includes(sub.status) && sub.id !== op.subscriptionId
  );
  if (blockingSub) {
    await userRef.set({ pendingCheckout: { status: 'failed', operationId: claim.operationId } }, { merge: true });
    return respond(409, { error: 'already_subscribed' });
  }

  // ── Session resolution ───────────────────────────────────────────────────────────────────
  let sessionUrl;
  if (op.sessionId) {
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(op.sessionId);
      if (existingSession.status === 'open') sessionUrl = existingSession.url;
    } catch { /* fall through */ }
  }

  if (!sessionUrl) {
    if (withinWindow) {
      try {
        const session = await stripe.checkout.sessions.create(
          {
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: op.priceId, quantity: 1 }],
            client_reference_id: uid,
            metadata: { firebaseUID: uid, checkoutOperationId: claim.operationId, tier: op.tier },
            subscription_data: { metadata: { firebaseUID: uid, checkoutOperationId: claim.operationId, tier: op.tier } },
            success_url: op.successUrl,
            cancel_url: op.cancelUrl,
          },
          { idempotencyKey: `checkout-session-${claim.operationId}` }
        );
        await opRef.update({ sessionId: session.id });
        sessionUrl = session.url;
      } catch (err) {
        if (err?.type === 'StripeIdempotencyError') {
          return respond(425, { error: 'checkout_in_progress' });
        }
        console.error('Session creation failed:', err);
        return respond(500, { error: 'session_creation_failed' });
      }
    } else {
      // Beyond the window: the customer IS known, so an exact, bounded lookup is possible and is
      // the only thing attempted — matched by this operation's own id, never "similar tier".
      const matched = await listAllPages(
        (params) => stripe.checkout.sessions.list(params),
        { customer: customerId, limit: 100 },
        (s) => s.metadata?.checkoutOperationId === claim.operationId
      );
      if (matched) {
        await opRef.update({ sessionId: matched.id });
        sessionUrl = matched.url;
      } else {
        await writeAmbiguous(uid, 'checkout_session_recovery_expired', { operationId: claim.operationId, customerId });
        await userRef.set({ pendingCheckout: { status: 'failed', operationId: claim.operationId } }, { merge: true });
        return respond(409, { error: 'checkout_needs_manual_reconciliation' });
      }
    }
  }

  await userRef.set({
    pendingCheckout: { status: 'open', operationId: claim.operationId, sessionUrl, claimedAt: new Date().toISOString() },
  }, { merge: true });

  return respond(200, { url: sessionUrl });
};
