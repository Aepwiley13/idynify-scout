// Centralized subscription-state module (billing hardening PR 1).
//
// Three exports, deliberately separate because they answer three different questions:
//
//   hasActiveAccess       — the compatibility gate. Exactly today's `hasCompletedPayment === true`
//                           check, de-duplicated from three inline copies in src/App.jsx. No
//                           behavior change — this is the only export wired into the real access
//                           gate in this PR.
//   describeSubscription — the future entitlement policy. Built and unit-tested, not wired into
//                           the access gate yet.
//   isBlockingStatus      — "should checkout refuse a new subscription and point the user at
//                           recovering the existing one instead" — a different question from
//                           hasAccess. unpaid/incomplete/paused subscriptions have no access but
//                           still block a sibling subscription from being created.
//
// Pure JS, no SDK dependency, importable from both the Vite client bundle and the Netlify
// functions runtime (both directions of that cross-import already exist elsewhere in this repo).

export function hasActiveAccess(userData) {
  return userData?.hasCompletedPayment === true;
}

const NORMALIZED_STATES = {
  ACTIVE: 'active',
  ACTIVE_CANCELING: 'active_canceling',
  COLLECTION_PAUSED: 'collection_paused',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  NATIVE_PAUSED: 'native_paused',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  UNPAID: 'unpaid',
  UNKNOWN: 'unknown',
};

/**
 * Normalizes a Stripe subscription's status (plus the two independent pause axes Stripe exposes)
 * into one of NORMALIZED_STATES, with the UI message and access decision that state implies.
 *
 * `status`, `cancelAtPeriodEnd`, and `pauseCollection` are independent — Stripe allows
 * `cancel_at_period_end` and `pause_collection` to both be set while `status` is still `active`.
 * Collapsing them into a single enum without checking cancelAtPeriodEnd/pauseCollection first
 * would silently misclassify either as plain "active".
 */
export function describeSubscription({ status, cancelAtPeriodEnd, pauseCollection } = {}) {
  if (status === 'active') {
    if (cancelAtPeriodEnd) {
      return {
        normalizedState: NORMALIZED_STATES.ACTIVE_CANCELING,
        hasAccess: true,
        uiMessage: 'Subscription scheduled to pause at the end of the current period.',
      };
    }
    if (pauseCollection) {
      return {
        normalizedState: NORMALIZED_STATES.COLLECTION_PAUSED,
        hasAccess: true,
        uiMessage: 'Billing is paused for this subscription.',
      };
    }
    return { normalizedState: NORMALIZED_STATES.ACTIVE, hasAccess: true, uiMessage: 'Active.' };
  }
  switch (status) {
    case 'trialing':
      return { normalizedState: NORMALIZED_STATES.TRIALING, hasAccess: true, uiMessage: 'Trial active.' };
    case 'past_due':
      return { normalizedState: NORMALIZED_STATES.PAST_DUE, hasAccess: false, uiMessage: 'Payment past due.' };
    case 'paused':
      return { normalizedState: NORMALIZED_STATES.NATIVE_PAUSED, hasAccess: false, uiMessage: 'Subscription paused.' };
    case 'canceled':
      return { normalizedState: NORMALIZED_STATES.CANCELED, hasAccess: false, uiMessage: 'Canceled.' };
    case 'incomplete':
      return { normalizedState: NORMALIZED_STATES.INCOMPLETE, hasAccess: false, uiMessage: 'Payment incomplete.' };
    case 'incomplete_expired':
      return { normalizedState: NORMALIZED_STATES.INCOMPLETE_EXPIRED, hasAccess: false, uiMessage: 'Checkout expired.' };
    case 'unpaid':
      return { normalizedState: NORMALIZED_STATES.UNPAID, hasAccess: false, uiMessage: 'Unpaid.' };
    default:
      // Fails safe: an unrecognized status (a future Stripe addition) never grants access and
      // never crashes.
      return { normalizedState: NORMALIZED_STATES.UNKNOWN, hasAccess: false, uiMessage: 'Unknown status.' };
  }
}

const BLOCKING_STATES = new Set([
  NORMALIZED_STATES.ACTIVE,
  NORMALIZED_STATES.ACTIVE_CANCELING,
  NORMALIZED_STATES.COLLECTION_PAUSED,
  NORMALIZED_STATES.TRIALING,
  NORMALIZED_STATES.PAST_DUE,
  NORMALIZED_STATES.NATIVE_PAUSED,
  NORMALIZED_STATES.UNPAID,
  NORMALIZED_STATES.INCOMPLETE,
]);

/**
 * Should checkout refuse to create a new subscription and instead point the user at recovering
 * the existing one? True for every state except canceled/incomplete_expired/unknown, which are
 * genuinely over (or unrecognized — fails safe to "not blocking" is wrong too; an unknown state
 * should not silently permit a second subscription, so it IS treated as blocking here).
 */
export function isBlockingStatus(normalizedState) {
  if (normalizedState === NORMALIZED_STATES.UNKNOWN) return true; // fail safe: don't permit a
                                                                    // second subscription when we
                                                                    // don't even recognize the first
  return BLOCKING_STATES.has(normalizedState);
}

export const BILLING_NORMALIZED_STATES = NORMALIZED_STATES;
