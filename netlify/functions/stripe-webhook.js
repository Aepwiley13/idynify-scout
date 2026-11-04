import Stripe from 'stripe';
import { db } from './firebase-admin.js';
import { isKnownIdynifyPrice, priceIdOfSession, priceIdOfSubscription, knownPriceIds } from './utils/billingPrices.js';
import { describeSubscription, isBlockingStatus } from '../../src/utils/billingEntitlement.js';

// IMPORTANT Firestore constraint that shapes every transaction in this file: the Admin SDK
// requires every tx.get() to happen before any tx.set()/tx.update() in the same transaction —
// mixing them throws "Firestore transactions require all reads to be executed before all
// writes." (caught by the emulator integration suite, not by a mock). So every transaction below
// is structured as: (1) read everything via tx.get, and await any Stripe calls needed to decide,
// (2) compute a decision with pure functions that touch neither Firestore nor Stripe, (3) apply
// every tx.set/tx.update at the end.

const TIER_CREDITS = {
  starter: { credits: 400, companies: 40, contacts: 120, support: '48-hour email' },
  pro: { credits: 1250, companies: 125, contacts: 375, support: '24-hour email' },
};

function tierForPrice(priceId) {
  return priceId === process.env.STRIPE_PRICE_PRO ? 'pro' : 'starter';
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

class RetryableWebhookError extends Error {
  constructor(cause) {
    super('retryable webhook error');
    this.cause = cause;
  }
}

function ok() {
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}

function retryable(err) {
  console.error('Retryable webhook error — leaving event unresolved for Stripe redelivery:', err);
  return { statusCode: 500, body: JSON.stringify({ error: 'retry' }) };
}

// ── Stripe subscription-field reading — never a blind guess ──────────────────────────────────

function resolvePeriod(subscription) {
  if (subscription.current_period_start != null && subscription.current_period_end != null) {
    return { start: subscription.current_period_start, end: subscription.current_period_end };
  }
  const items = subscription.items?.data ?? [];
  const known = knownPriceIds();
  const candidates = items.length === 1 ? items : items.filter((i) => known.has(i?.price?.id));
  if (candidates.length !== 1) {
    console.warn('period_fields_ambiguous', { subscriptionId: subscription.id });
    return { start: null, end: null };
  }
  return { start: candidates[0].current_period_start, end: candidates[0].current_period_end };
}

function buildNormalizedFields(subscription) {
  const { start, end } = resolvePeriod(subscription);
  return {
    subscriptionStatus: subscription.status,
    currentPeriodStart: start != null ? new Date(start * 1000).toISOString() : null,
    currentPeriodEnd: end != null ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    pauseCollection: Boolean(subscription.pause_collection),
  };
}

/**
 * A Firestore transaction can only write a given document reference once. 'update' writes that
 * target the same ref (e.g. a credit grant and a reconciliation write both touching the user
 * doc) are merged into a single shallow-assigned update rather than issued as two calls.
 */
function mergeWritesByRef(writes) {
  const byPath = new Map();
  for (const w of writes) {
    if (w.type !== 'update') continue;
    const key = w.ref.path;
    byPath.set(key, { ref: w.ref, data: { ...(byPath.get(key)?.data ?? {}), ...w.data } });
  }
  return [...byPath.values()];
}

function ambiguousWriteFor({ uid, reason, details }) {
  return { ref: db.collection('billingAmbiguousAccounts').doc(), data: { uid, reason, details, flaggedAt: new Date().toISOString() } };
}

// ── Pure decision: operation-record validate-then-extend (no I/O) ─────────────────────────────
//
// `opData` is null if no operationId was named at all (legacy path — nothing to validate), or the
// already-fetched document data (or undefined if the named record doesn't exist).

function decideOperationRecord(operationId, opData, { resolvedUid, customerId, priceId, sessionId, subscriptionId }) {
  if (!operationId) return { valid: true, updateFields: null, ambiguousReason: null };
  if (opData === undefined) return { valid: false, updateFields: null, ambiguousReason: 'operation_record_missing' };

  const consistent =
    opData.uid === resolvedUid &&
    (opData.customerId == null || opData.customerId === customerId) &&
    (priceId == null || opData.priceId === priceId) &&
    (sessionId === undefined || opData.sessionId == null || opData.sessionId === sessionId) &&
    (subscriptionId === undefined || opData.subscriptionId == null || opData.subscriptionId === subscriptionId);
  if (!consistent) return { valid: false, updateFields: null, ambiguousReason: 'operation_record_mismatch' };

  const updates = {};
  if (customerId != null && opData.customerId == null) updates.customerId = customerId;
  if (sessionId !== undefined && opData.sessionId == null) updates.sessionId = sessionId;
  if (subscriptionId !== undefined && opData.subscriptionId == null) updates.subscriptionId = subscriptionId;
  return { valid: true, updateFields: Object.keys(updates).length > 0 ? updates : null, ambiguousReason: null };
}

// ── Pure decision: replacement authorization (no I/O — operationRecordData pre-fetched) ───────

function decideReplacementAuthorized(subscription, resolvedUid, customerId, operationRecordData) {
  const operationId = subscription.metadata?.checkoutOperationId;
  if (!operationId) return false; // bare uid metadata is never sufficient
  if (!operationRecordData) return false;
  return (
    operationRecordData.uid === resolvedUid &&
    operationRecordData.customerId === customerId &&
    (operationRecordData.subscriptionId == null || operationRecordData.subscriptionId === subscription.id) &&
    isKnownIdynifyPrice(operationRecordData.priceId)
  );
}

// ── Pure decision: 6b ownership/product/replacement reconciliation (no I/O) ───────────────────
//
// `onFile` is the already-fetched Stripe subscription currently on file (or null if not needed —
// i.e. userData has no stripeSubscriptionId, or it already matches). `operationRecordData` is the
// already-fetched billingCheckoutOperations doc for subscription.metadata.checkoutOperationId, if
// any (or null).

function decideReconciliation({ userData, subscription, onFile, operationRecordData, resolvedUid }) {
  if (!userData) return { action: 'flagAmbiguous', reason: 'user_not_found', details: { subscriptionId: subscription.id } };

  if (!isKnownIdynifyPrice(subscription)) {
    return { action: 'flagAmbiguous', reason: 'unknown_price', details: { subscriptionId: subscription.id } };
  }

  if (userData.stripeCustomerId && subscription.customer !== userData.stripeCustomerId) {
    return {
      action: 'flagAmbiguous', reason: 'customer_mismatch',
      details: { subscriptionId: subscription.id, incomingCustomer: subscription.customer, onFileCustomer: userData.stripeCustomerId },
    };
  }

  const normalizedFields = buildNormalizedFields(subscription);

  if (!userData.stripeSubscriptionId || userData.stripeSubscriptionId === subscription.id) {
    return {
      action: 'apply',
      fields: { stripeCustomerId: subscription.customer, stripeSubscriptionId: subscription.id, ...normalizedFields },
    };
  }

  // A different subscription is on file — a genuine replacement, authorized separately.
  if (!onFile) {
    // Caller should always have fetched this when stripeSubscriptionId differs; treat a missing
    // fetch as a retrieval failure rather than silently authorizing anything.
    return { action: 'retryError' };
  }
  const onFileIsDead = ['canceled', 'incomplete_expired'].includes(onFile.status);
  const verifiedNewer = subscription.created > onFile.created;
  const authorized = decideReplacementAuthorized(subscription, resolvedUid, subscription.customer, operationRecordData);

  if (onFileIsDead && verifiedNewer && authorized) {
    return { action: 'apply', fields: { stripeSubscriptionId: subscription.id, ...normalizedFields } };
  }
  return {
    action: 'flagAmbiguous', reason: 'replacement_not_authorized',
    details: { incomingSubscription: subscription.id, onFileSubscription: userData.stripeSubscriptionId },
  };
}

// ── Pure decision: 6c allocation eligibility (no I/O — onFileForConflict pre-fetched) ─────────

function decideAllocationEligibility({ userData, customerId, priceId, subscriptionId, onFileForConflict }) {
  if (!isKnownIdynifyPrice(priceId)) return { ok: false, reason: 'unknown_price' };
  if (userData?.stripeCustomerId && userData.stripeCustomerId !== customerId) {
    return { ok: false, reason: 'customer_mismatch' };
  }
  if (userData?.stripeSubscriptionId && userData.stripeSubscriptionId !== subscriptionId) {
    if (!onFileForConflict) return { ok: false, reason: 'onfile_retrieve_failed' };
    const normalized = describeSubscription({
      status: onFileForConflict.status,
      cancelAtPeriodEnd: onFileForConflict.cancel_at_period_end === true,
      pauseCollection: Boolean(onFileForConflict.pause_collection),
    });
    if (isBlockingStatus(normalized.normalizedState)) return { ok: false, reason: 'conflicting_subscription' };
  }
  return { ok: true };
}

function creditGrantFields(priceId) {
  const tier = tierForPrice(priceId);
  const config = TIER_CREDITS[tier] ?? TIER_CREDITS.starter;
  const nextReset = new Date();
  nextReset.setMonth(nextReset.getMonth() + 1);
  return {
    tier,
    fields: {
      hasCompletedPayment: true,
      paymentCompletedAt: new Date().toISOString(),
      subscriptionTier: tier,
      credits: { total: config.credits, used: 0, remaining: config.credits, resetDate: nextReset.toISOString() },
      tierLimits: {
        creditsPerMonth: config.credits, companiesPerMonth: config.companies,
        contactsPerMonth: config.contacts, teamSeats: 1, support: config.support,
      },
      features: { mobilePhone: tier === 'pro' },
    },
  };
}

// ── 6c: checkout.session.completed ────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(stripe, stripeEvent) {
  const session = stripeEvent.data.object;
  const eventId = stripeEvent.id;

  const preCheck = await db.collection('stripeWebhookEvents').doc(eventId).get();
  if (preCheck.exists) return ok();

  let customer;
  try {
    customer = await stripe.customers.retrieve(session.customer);
  } catch (err) {
    return retryable(err);
  }

  // 1. Identity cross-check — precedence is not validation; every present field must agree.
  const candidates = [
    session.metadata?.firebaseUID,
    session.metadata?.userId, // the old, currently-dead create-checkout-session.js shape
    session.client_reference_id, // live Payment Links
    customer?.metadata?.firebaseUID,
  ].filter(Boolean);
  const identityAgrees = candidates.length > 0 && candidates.every((c) => c === candidates[0]);

  if (!identityAgrees) {
    await db.runTransaction(async (tx) => {
      const eventRef = db.collection('stripeWebhookEvents').doc(eventId);
      const eventSnap = await tx.get(eventRef);
      if (eventSnap.exists) return;
      tx.set(db.collection('billingAmbiguousAccounts').doc(), {
        uid: candidates[0] ?? null, reason: 'identity_mismatch', details: { candidates, sessionId: session.id },
        flaggedAt: new Date().toISOString(),
      });
      tx.set(eventRef, { type: stripeEvent.type, appliedAt: new Date().toISOString() });
    });
    return ok();
  }
  const resolvedUid = candidates[0];

  let priceId;
  try {
    priceId = await priceIdOfSession(stripe, session);
  } catch (err) {
    return retryable(err);
  }

  const operationId = session.metadata?.checkoutOperationId ?? null;
  const subscriptionId = session.subscription;

  try {
    await db.runTransaction(async (tx) => {
      // ── READ PHASE (Firestore reads + Stripe re-fetches — all redone on any retry) ──────
      const eventRef = db.collection('stripeWebhookEvents').doc(eventId);
      const eventSnap = await tx.get(eventRef);
      if (eventSnap.exists) return; // genuine duplicate delivery

      // Re-fetched live, not trusted from the event payload, for the same reason subscription
      // lifecycle events are: a Firestore-triggered retry of this whole callback should see
      // Stripe's then-current state, not a stale snapshot captured before the retry.
      let subscription = null;
      if (subscriptionId) {
        try {
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        } catch (err) {
          throw new RetryableWebhookError(err);
        }
      }

      const opRef = operationId ? db.collection('billingCheckoutOperations').doc(operationId) : null;
      const opSnap = opRef ? await tx.get(opRef) : null;
      const opData = opSnap ? (opSnap.exists ? opSnap.data() : undefined) : null;

      const allocationRef = subscriptionId ? db.collection('billingAllocations').doc(subscriptionId) : null;
      const allocationSnap = allocationRef ? await tx.get(allocationRef) : null;

      const userRef = db.collection('users').doc(resolvedUid);
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : null;

      // Stripe reads needed to decide (not Firestore — fine to await here, before any writes).
      let onFile = null;
      const differentSubOnFile = userData?.stripeSubscriptionId && userData.stripeSubscriptionId !== subscriptionId;
      if (differentSubOnFile) {
        try {
          onFile = await stripe.subscriptions.retrieve(userData.stripeSubscriptionId);
        } catch (err) {
          throw new RetryableWebhookError(err);
        }
      }

      // ── DECIDE PHASE (pure) ─────────────────────────────────────────────────────────────
      const writes = [];
      const ambiguous = [];

      const opDecision = decideOperationRecord(operationId, opData, {
        resolvedUid, customerId: session.customer, priceId, sessionId: session.id, subscriptionId,
      });
      if (opDecision.ambiguousReason) {
        ambiguous.push({ uid: resolvedUid, reason: opDecision.ambiguousReason, details: { operationId, sessionId: session.id } });
      }

      if (subscriptionId) {
        const epochRaw = process.env.BILLING_LEDGER_EPOCH_UNIX;
        const epoch = epochRaw ? Number(epochRaw) : null;

        if (allocationSnap.exists) {
          // already granted — reconciliation only, below
        } else if (epoch == null || session.created < epoch) {
          ambiguous.push({
            uid: resolvedUid, reason: epoch == null ? 'epoch_unset' : 'pre_epoch_no_marker',
            details: { sessionId: session.id, subscriptionId, paymentStatus: session.payment_status },
          });
        } else if (operationId && !opDecision.valid) {
          // claims new-flow provenance but it didn't check out — already flagged above
        } else {
          const eligible = decideAllocationEligibility({
            userData, customerId: session.customer, priceId, subscriptionId, onFileForConflict: onFile,
          });
          if (!eligible.ok) {
            ambiguous.push({ uid: resolvedUid, reason: eligible.reason, details: { sessionId: session.id, subscriptionId } });
          } else if (session.payment_status !== 'paid') {
            ambiguous.push({ uid: resolvedUid, reason: 'not_paid', details: { sessionId: session.id, subscriptionId } });
          } else {
            // Either the new-flow path (operationId validated) or the legacy Payment Link path
            // (no operationId at all, structurally) — both reach here only after the same
            // ownership/price/eligibility/payment gate above.
            const { fields } = creditGrantFields(priceId);
            writes.push({ ref: userRef, type: 'update', data: fields });
            writes.push({ ref: allocationRef, type: 'set', data: { uid: resolvedUid, priceId, grantedAt: new Date().toISOString() } });
          }
        }
      }

      if (subscription) {
        const recon = decideReconciliation({
          userData, subscription, onFile, operationRecordData: opDecision.valid ? opData : null, resolvedUid,
        });
        if (recon.action === 'retryError') throw new RetryableWebhookError(new Error('on-file subscription retrieval failed'));
        if (recon.action === 'apply') writes.push({ ref: userRef, type: 'update', data: recon.fields });
        else if (recon.action === 'flagAmbiguous') ambiguous.push({ uid: resolvedUid, reason: recon.reason, details: recon.details });
      }

      // ── WRITE PHASE ──────────────────────────────────────────────────────────────────────
      // A transaction can only write to a given document reference once — the allocation grant
      // and the reconciliation write can both target userRef, so 'update' writes to the same ref
      // are merged into a single call rather than issued twice.
      if (opRef && opDecision.updateFields) tx.update(opRef, opDecision.updateFields);
      for (const { ref, data } of mergeWritesByRef(writes)) tx.update(ref, data);
      for (const w of writes.filter((w) => w.type === 'set')) tx.set(w.ref, w.data);
      for (const flag of ambiguous) {
        const { ref, data } = ambiguousWriteFor(flag);
        tx.set(ref, data);
      }
      tx.set(eventRef, { type: stripeEvent.type, appliedAt: new Date().toISOString() });
    });
  } catch (err) {
    if (err instanceof RetryableWebhookError) return retryable(err.cause);
    throw err;
  }

  if (session.customer) await drainPendingEvents(stripe, session.customer);
  return ok();
}

// ── 6d: customer.subscription.created/updated/deleted — one collapsed handler ─────────────────

async function resolveCandidateUid(subscription) {
  if (subscription.metadata?.firebaseUID) return subscription.metadata.firebaseUID;
  const q = await db.collection('users').where('stripeCustomerId', '==', subscription.customer).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

/**
 * Shared by the live dispatch path and draining — one transaction, read-then-write.
 *
 * Takes `subscriptionId`, not a pre-fetched subscription object, and re-fetches it live from
 * Stripe INSIDE the transaction callback — not before. This is what makes processing
 * order-independent: Firestore automatically retries a transaction's entire callback on
 * contention, so a retry re-fetches Stripe's then-current state rather than replaying a stale
 * snapshot captured before the retry. Two events for the same subscription, delivered in either
 * order or even genuinely concurrently, both converge on whatever Stripe considers current at
 * the moment they actually commit — never a stale embedded event payload.
 */
async function applySubscriptionLifecycleEvent(stripe, { eventType, eventId, subscriptionId, resolvedUid, markLedger, pendingRefToClear }) {
  await db.runTransaction(async (tx) => {
    // ── READ PHASE (Firestore reads + the Stripe re-fetch — both redone on any retry) ──
    let eventSnap = null;
    if (markLedger) {
      eventSnap = await tx.get(db.collection('stripeWebhookEvents').doc(eventId));
      if (eventSnap.exists) return;
    }
    if (pendingRefToClear) {
      const stillParked = await tx.get(pendingRefToClear);
      if (!stillParked.exists) return; // already drained by a concurrent run
    }

    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (err) {
      throw new RetryableWebhookError(err);
    }

    const operationId = subscription.metadata?.checkoutOperationId ?? null;
    const opRef = operationId ? db.collection('billingCheckoutOperations').doc(operationId) : null;
    const opSnap = opRef ? await tx.get(opRef) : null;
    const opData = opSnap ? (opSnap.exists ? opSnap.data() : undefined) : null;

    const userRef = db.collection('users').doc(resolvedUid);
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : null;

    let onFile = null;
    const differentSubOnFile = userData?.stripeSubscriptionId && userData.stripeSubscriptionId !== subscription.id;
    if (differentSubOnFile) {
      try {
        onFile = await stripe.subscriptions.retrieve(userData.stripeSubscriptionId);
      } catch (err) {
        throw new RetryableWebhookError(err);
      }
    }

    // ── DECIDE PHASE (pure) ──
    const writes = [];
    const ambiguous = [];

    const opDecision = decideOperationRecord(operationId, opData, {
      resolvedUid, customerId: subscription.customer, priceId: priceIdOfSubscription(subscription),
      subscriptionId: subscription.id,
    });
    if (opDecision.ambiguousReason) {
      ambiguous.push({ uid: resolvedUid, reason: opDecision.ambiguousReason, details: { operationId, subscriptionId: subscription.id } });
    } else {
      const recon = decideReconciliation({
        userData, subscription, onFile, operationRecordData: opDecision.valid ? opData : null, resolvedUid,
      });
      if (recon.action === 'retryError') throw new RetryableWebhookError(new Error('on-file subscription retrieval failed'));
      if (recon.action === 'apply') writes.push({ ref: userRef, type: 'update', data: recon.fields });
      else if (recon.action === 'flagAmbiguous') ambiguous.push({ uid: resolvedUid, reason: recon.reason, details: recon.details });
    }

    // ── WRITE PHASE ──
    if (opRef && opDecision.updateFields) tx.update(opRef, opDecision.updateFields);
    for (const w of writes) tx.update(w.ref, w.data);
    for (const flag of ambiguous) {
      const { ref, data } = ambiguousWriteFor(flag);
      tx.set(ref, data);
    }
    if (pendingRefToClear) tx.delete(pendingRefToClear);
    if (markLedger) tx.set(db.collection('stripeWebhookEvents').doc(eventId), { type: eventType, appliedAt: new Date().toISOString() });
  });
}

async function handleSubscriptionLifecycle(stripe, stripeEvent) {
  const subscription = stripeEvent.data.object;
  const eventId = stripeEvent.id;

  const preCheck = await db.collection('stripeWebhookEvents').doc(eventId).get();
  if (preCheck.exists) return ok();

  const resolvedUid = await resolveCandidateUid(subscription);

  if (!resolvedUid) {
    await db.collection('stripeWebhookPendingEvents').doc(subscription.customer)
      .collection('events').doc(eventId)
      .set({ type: stripeEvent.type, subscriptionId: subscription.id, parkedAt: new Date().toISOString() });
    return ok(); // explicitly NOT marked applied — available for later draining
  }

  try {
    await applySubscriptionLifecycleEvent(stripe, {
      eventType: stripeEvent.type, eventId, subscriptionId: subscription.id, resolvedUid, markLedger: true,
    });
  } catch (err) {
    if (err instanceof RetryableWebhookError) return retryable(err.cause);
    throw err;
  }

  await drainPendingEvents(stripe, subscription.customer);
  return ok();
}

// ── Draining — crash-recoverable, retried opportunistically on every event for the customer ────

async function drainPendingEvents(stripe, customerId) {
  const pendingSnap = await db.collection('stripeWebhookPendingEvents').doc(customerId).collection('events').get();

  for (const parkedDoc of pendingSnap.docs) {
    const parked = parkedDoc.data();
    try {
      // Resolve the candidate uid first, outside the transaction — a plain Stripe GET, cheap to
      // redo, and if it's still unresolved there's nothing to drain yet.
      let subscriptionForLookup;
      try {
        subscriptionForLookup = await stripe.subscriptions.retrieve(parked.subscriptionId);
      } catch {
        continue; // leave parked; retried on the next real event for this customer
      }
      const resolvedUid = await resolveCandidateUid(subscriptionForLookup);
      if (!resolvedUid) continue; // still unresolved, stays parked

      const pendingRef = db.collection('stripeWebhookPendingEvents').doc(customerId).collection('events').doc(parkedDoc.id);

      await applySubscriptionLifecycleEvent(stripe, {
        eventType: parked.type, eventId: parkedDoc.id, subscriptionId: parked.subscriptionId,
        resolvedUid, markLedger: true, pendingRefToClear: pendingRef,
      });
    } catch (err) {
      console.error(`drainPendingEvents: failed to drain ${parkedDoc.id} for customer ${customerId}`, err);
      // left parked on purpose — retried on the next real event for this customer
    }
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook secret is not configured');

    const stripe = getStripe();
    const sig = event.headers['stripe-signature'];

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return { statusCode: 400, body: JSON.stringify({ error: `Webhook Error: ${err.message}` }) };
    }

    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        return await handleCheckoutCompleted(stripe, stripeEvent);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return await handleSubscriptionLifecycle(stripe, stripeEvent);
      default:
        console.log(`ℹ️ Unhandled event type: ${stripeEvent.type}`);
        return ok();
    }
  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// Exported for tests.
export const __internal = {
  decideOperationRecord, decideReconciliation, decideAllocationEligibility, decideReplacementAuthorized,
  buildNormalizedFields, resolvePeriod, tierForPrice, resolveCandidateUid, drainPendingEvents,
  applySubscriptionLifecycleEvent, RetryableWebhookError,
};
