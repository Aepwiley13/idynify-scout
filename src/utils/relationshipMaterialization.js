/**
 * relationshipMaterialization — the rules that turn canonical relationship
 * events into `contact.relationship.*`, and nothing else.
 *
 * ─── WHY THIS FILE HAS NO FIREBASE IMPORT ───────────────────────────────────
 *
 * Same reason as identityNormalization.js and identityResolution.js, for the
 * third and fourth time in this codebase: the rules have to be executable in a
 * test with no database, in a Netlify function on the ADMIN SDK, and — later,
 * if a client ever needs to predict state — in the browser on the WEB SDK. A
 * copy per runtime drifts, and the drift is invisible in review.
 *
 * So this module is pure. Events in, state out. Storage, transactions and
 * exactly-once creation live in the writer that calls it; the writer owns
 * *whether* an event is recorded, this file owns *what that means* for state.
 *
 * ─── WHAT THIS FILE IS FOR (ADR-006, Sign-Off A) ────────────────────────────
 *
 * Canonical events are the historical authority. `contact.relationship.*` is a
 * read cache derived from them and nothing else. Two invariants carry that:
 *
 *   MONOTONIC     last_inbound_at only ever moves forward. An event that
 *                 arrives late — out-of-order delivery, or a backfill of
 *                 history — is recorded and counted, but never drags current
 *                 state backwards to its own timestamp.
 *
 *   CARDINAL      reply_count is the size of a set, not a tally of processing
 *                 attempts. Replay cannot inflate it; a previously unseen
 *                 older event does increase it; arrival order is irrelevant.
 *
 * Those two together are why `materialize()` and repeated `applyEvent()` calls
 * must agree: if a full recompute from the log ever disagrees with the
 * incrementally-maintained cache, the cache has become an authority of its own
 * and the hierarchy in ADR-006 has been broken. The test asserts that equality
 * directly, which is what keeps state derived rather than sovereign.
 */

/** Canonical event types. Frozen at event creation, never recomputed. */
export const EVENT_TYPES = Object.freeze({
  INBOUND_REPLY: 'inbound_reply',
  INBOUND_MESSAGE: 'inbound_message',
  OUTBOUND: 'outbound',
});

/** Materialized relationship states. */
export const RELATIONSHIP_STATES = Object.freeze({
  NO_CONTACT: 'no_contact',
  AWAITING_REPLY: 'awaiting_reply',
  IN_CONVERSATION: 'in_conversation',
});

const INBOUND_TYPES = [EVENT_TYPES.INBOUND_REPLY, EVENT_TYPES.INBOUND_MESSAGE];

/**
 * The deterministic event key from ADR-006.
 *
 * This is the ONLY thing that decides whether a message has been seen. No
 * current-state field participates — which is the whole point: state points at
 * the newest message, and replay asks about an older one.
 *
 * @returns {string|null} null when either component is missing, so a malformed
 *   event can never collide with a well-formed one under a falsy key.
 */
export function eventKey(event) {
  const user = event?.idynifyUserId;
  const message = event?.gmailMessageId;
  if (!user || !message) return null;
  return `${user}__${message}`;
}

/** Milliseconds for an ISO timestamp, or null. Total: never throws. */
function ms(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A superseded event has been retracted by a later identity correction. */
function isActive(event) {
  return Boolean(event) && !event.supersededBy;
}

function isInbound(event) {
  return INBOUND_TYPES.includes(event?.eventType);
}

/** The empty cache, for a contact with no canonical events yet. */
export function createEmptyState() {
  return {
    last_inbound_at: null,
    last_inbound_message_id: null,
    last_outbound_at: null,
    reply_count: 0,
    state: RELATIONSHIP_STATES.NO_CONTACT,
    source: null,
  };
}

/**
 * Derive `relationship.state` from the two boundary timestamps.
 *
 * Deliberately a pure function of the cache rather than of the event that just
 * arrived: a late-arriving older event must not change the answer, and reading
 * only the boundaries makes that structural instead of conditional.
 */
function deriveState({ last_inbound_at, last_outbound_at }) {
  const inbound = ms(last_inbound_at);
  const outbound = ms(last_outbound_at);
  if (inbound === null && outbound === null) return RELATIONSHIP_STATES.NO_CONTACT;
  if (inbound === null) return RELATIONSHIP_STATES.AWAITING_REPLY;
  if (outbound === null) return RELATIONSHIP_STATES.IN_CONVERSATION;
  return inbound >= outbound
    ? RELATIONSHIP_STATES.IN_CONVERSATION
    : RELATIONSHIP_STATES.AWAITING_REPLY;
}

/**
 * Apply one canonical event to the cache.
 *
 * `seenKeys` models the event store's uniqueness guarantee — in production that
 * is Firestore document-ID uniqueness via create(), here it is a Set. Either
 * way the decision is the same and is made on the key alone.
 *
 * Every downstream effect is reported only when `created` is true, mirroring
 * ADR-006's rule that timeline writes, queue emission and compatibility mirrors
 * all live inside the create branch. A replay produces an empty effect list.
 *
 * @returns {{ state: object, created: boolean, effects: string[] }} a NEW state
 *   object; the input is never mutated.
 */
export function applyEvent(state, event, seenKeys) {
  const current = state ?? createEmptyState();
  const key = eventKey(event);

  // Unkeyable or already recorded — no event, no count, no effects.
  if (!key || seenKeys.has(key)) {
    return { state: { ...current }, created: false, effects: [] };
  }
  seenKeys.add(key);

  if (!isActive(event)) {
    // Recorded, but retracted: it exists in the log and materializes nothing.
    return { state: { ...current }, created: true, effects: [] };
  }

  const next = { ...current };
  const occurredAt = ms(event.occurredAt);

  // CARDINAL — unconditional on recency, conditional on first observation.
  if (event.eventType === EVENT_TYPES.INBOUND_REPLY) {
    next.reply_count = current.reply_count + 1;
  }

  // MONOTONIC — the boundary timestamps only ever move forward.
  if (isInbound(event) && occurredAt !== null) {
    const currentInbound = ms(current.last_inbound_at);
    if (currentInbound === null || occurredAt > currentInbound) {
      next.last_inbound_at = event.occurredAt;
      next.last_inbound_message_id = event.gmailMessageId;
      next.source = event.source ?? null;
    }
  }

  if (event.eventType === EVENT_TYPES.OUTBOUND && occurredAt !== null) {
    const currentOutbound = ms(current.last_outbound_at);
    if (currentOutbound === null || occurredAt > currentOutbound) {
      next.last_outbound_at = event.occurredAt;
    }
  }

  next.state = deriveState(next);

  return {
    state: next,
    created: true,
    effects: ['timeline_entry', 'intelligence_queue', 'compatibility_mirrors'],
  };
}

/**
 * Rebuild the cache from scratch, from the whole event log.
 *
 * The correctness oracle for the incremental path, and the reason state can be
 * called derived: drop `relationship.*` entirely and this reproduces it. Order
 * of the input is irrelevant — duplicates collapse on their key, and both
 * invariants are order-independent by construction.
 */
export function materialize(events) {
  const seenKeys = new Set();
  let state = createEmptyState();
  for (const event of events ?? []) {
    ({ state } = applyEvent(state, event, seenKeys));
  }
  return state;
}
