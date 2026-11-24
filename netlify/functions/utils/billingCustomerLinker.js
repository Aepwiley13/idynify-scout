const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const respond = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});
const safeCode = (error) => typeof error?.code === 'string' && /^[a-zA-Z0-9._/-]{1,64}$/.test(error.code)
  ? error.code : typeof error?.type === 'string' && /^[a-zA-Z0-9._/-]{1,64}$/.test(error.type)
    ? error.type : 'unknown';

/**
 * Lazily link an account to exactly one Stripe Customer without creating a subscription.
 * Free accounts remain Free in Firebase and need no card. A stable Stripe idempotency key plus
 * a server-only operation record makes retries safe; after Stripe's retention window, the handler
 * stops for reconciliation instead of risking a duplicate Customer.
 */
export function createBillingCustomerLinker({ db, extractToken, verifyToken, verifyAppCheck = async () => true, getStripe, now = Date.now }) {
  return async function ensureBillingCustomer(event) {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'method_not_allowed' });

    let actor;
    try {
      const token = extractToken(event);
      if (!token) return respond(401, { error: 'unauthorized' });
      actor = await verifyToken(token);
    } catch {
      return respond(401, { error: 'unauthorized' });
    }
    if (!actor?.uid || actor.firebase?.sign_in_provider === 'custom') {
      return respond(403, { error: 'read_only' });
    }
    if (!(await verifyAppCheck(event))) return respond(403, { error: 'app_check_required' });

    const uid = actor.uid;
    const userRef = db.collection('users').doc(uid);
    const operationRef = db.collection('billingCustomerOperations').doc(uid);
    const sessions = db.collection('impersonationSessions')
      .where('adminUserId', '==', uid).where('status', '==', 'active');
    let claim;
    try {
      claim = await db.runTransaction(async (tx) => {
        const [userSnap, operationSnap, activeSessions] = await Promise.all([
          tx.get(userRef), tx.get(operationRef), tx.get(sessions),
        ]);
        if (activeSessions.docs.some((row) => {
          const expires = row.data().expiresAt?.toMillis?.();
          return !Number.isFinite(expires) || expires > now();
        })) return { kind: 'read_only' };
        if (!userSnap.exists) return { kind: 'account_missing' };
        const user = userSnap.data() ?? {};
        if (user.accountStatus === 'suspended') return { kind: 'read_only' };
        const operation = operationSnap.exists ? operationSnap.data() : null;

        // The server-written binding is the idempotent fast path: no repeated Stripe calls.
        if (user.stripeCustomerId) return { kind: 'linked' };
        // Never create a new customer around a subscription whose existing customer binding is
        // missing. That state needs exact reconciliation from the authoritative subscription.
        if (user.stripeSubscriptionId) return { kind: 'subscription_unlinked' };
        if (operation?.status === 'needs_reconciliation') return { kind: 'reconcile' };
        if (operation?.customerId) {
          tx.update(userRef, { stripeCustomerId: operation.customerId });
          tx.update(operationRef, { status: 'linked', linkedAt: new Date(now()).toISOString() });
          return { kind: 'linked' };
        }

        if (operation?.status === 'creating') {
          const createdAt = Date.parse(operation.createdAt ?? '');
          if (!Number.isFinite(createdAt) || now() - createdAt >= IDEMPOTENCY_WINDOW_MS) {
            tx.update(operationRef, { status: 'needs_reconciliation', reason: 'idempotency_window_expired' });
            return { kind: 'reconcile' };
          }
          return { kind: 'resume', email: user.email ?? actor.email ?? null };
        }

        tx.set(operationRef, {
          uid,
          status: 'creating',
          createdAt: new Date(now()).toISOString(),
          idempotencyKeyVersion: 1,
        });
        return { kind: 'create', email: user.email ?? actor.email ?? null };
      });
    } catch (error) {
      console.error('billing_customer.claim_failed', { code: safeCode(error) });
      return respond(503, { error: 'billing_unavailable' });
    }

    if (claim.kind === 'linked') return respond(200, { status: 'linked' });
    if (claim.kind === 'read_only') return respond(403, { error: 'read_only' });
    if (claim.kind === 'account_missing') return respond(404, { error: 'account_not_found' });
    if (claim.kind === 'subscription_unlinked' || claim.kind === 'reconcile') {
      return respond(409, { error: 'billing_identity_needs_review' });
    }

    let stripe;
    try {
      stripe = getStripe();
    } catch {
      return respond(503, { error: 'billing_unavailable' });
    }

    let customer;
    try {
      customer = await stripe.customers.create(
        { ...(claim.email ? { email: claim.email } : {}), metadata: { firebaseUID: uid, idynifyAccount: 'true' } },
        { idempotencyKey: `idynify-account-customer-${uid}` },
      );
    } catch (error) {
      // Keep the creating claim: a timeout may follow a successful Stripe write. Retry with the
      // same idempotency key while it remains valid; never mint a second operation on uncertainty.
      console.error('billing_customer.create_failed', { code: safeCode(error) });
      return respond(503, { error: 'billing_unavailable' });
    }

    try {
      const bound = await db.runTransaction(async (tx) => {
        const [userSnap, operationSnap, activeSessions] = await Promise.all([
          tx.get(userRef), tx.get(operationRef), tx.get(sessions),
        ]);
        if (!userSnap.exists || !operationSnap.exists) return false;
        if (activeSessions.docs.some((row) => {
          const expires = row.data().expiresAt?.toMillis?.();
          return !Number.isFinite(expires) || expires > now();
        })) return false;
        const user = userSnap.data() ?? {};
        const operation = operationSnap.data() ?? {};
        if (user.stripeCustomerId && user.stripeCustomerId !== customer.id) return false;
        if (operation.status !== 'creating') return user.stripeCustomerId === customer.id;
        tx.update(userRef, { stripeCustomerId: customer.id });
        tx.update(operationRef, {
          status: 'linked', customerId: customer.id, linkedAt: new Date(now()).toISOString(),
        });
        return true;
      });
      if (!bound) {
        console.error('billing_customer.bind_conflict', { code: 'claim_changed' });
        return respond(409, { error: 'billing_identity_needs_review' });
      }
      return respond(200, { status: 'linked' });
    } catch (error) {
      // The operation remains recoverable with the same Stripe idempotency key.
      console.error('billing_customer.bind_failed', { code: safeCode(error) });
      return respond(503, { error: 'billing_unavailable' });
    }
  };
}

export const __internal = { IDEMPOTENCY_WINDOW_MS };
