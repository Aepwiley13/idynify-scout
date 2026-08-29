/**
 * relationshipEventWriter — the ONLY module that creates canonical relationship
 * events, materializes `contact.relationship.*`, or writes a legacy mirror.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ADR-006. THREE LAYERS, DERIVING STRICTLY DOWNWARD.                      ║
 * ║                                                                          ║
 * ║      relationship_events        immutable, the historical authority      ║
 * ║          ↓ derives                                                       ║
 * ║      contact.relationship.*     a read cache, reconstructible            ║
 * ║          ↓ mirrors                                                       ║
 * ║      eight legacy fields        write-only, for unmigrated consumers     ║
 * ║                                                                          ║
 * ║  Never upward. A legacy field is never an input. State never             ║
 * ║  reconstructs history.                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY THE RULES ARE NOT IN THIS FILE
 * ──────────────────────────────────
 * `src/utils/relationshipMaterialization.js` owns what an event MEANS for
 * state. This file owns whether an event EXISTS. Splitting them is what lets
 * the monotonic and cardinality invariants be tested with no database, and it
 * is the same split as identityResolution/contactResolver one layer up.
 *
 * WHY EXISTENCE IS DECIDED ON THE KEY AND NOTHING ELSE
 * ───────────────────────────────────────────────────
 * The sync worker replays its batch after any failure, by design. So replay is
 * ordinary traffic, not an edge case. If "have I seen this message?" were
 * answered from current state, the answer would be wrong for every out-of-order
 * delivery: state points at the newest message and the question is about an
 * older one. The event key — and only the event key — decides.
 */

import { FieldValue } from 'firebase-admin/firestore';
import {
  applyEvent,
  eventKey,
  createEmptyState,
  EVENT_TYPES,
} from '../../../src/utils/relationshipMaterialization.js';
import {
  CONVERSATION_STATES,
  resolveInboundTransition,
} from '../../../src/types/conversationState.js';

/**
 * The workflow state a confirmed inbound reply puts a conversation into.
 *
 * ─── WHY THIS IS A NAMED CONSTANT AND NOT AN INLINE STRING ──────────────────
 *
 * `conversationState` is a WORKFLOW vocabulary (twelve values — where a
 * conversation sits in the outreach lifecycle). `relationship.state` is a
 * RELATIONSHIP vocabulary (three values — who owes whom a message). They are
 * different domains that happen to both be strings on the same document.
 *
 * The mirror originally wrote the relationship value into the workflow field.
 * Nothing threw: Firestore does not police value domains, and every consumer
 * compares with `===`, so the chain went silent instead of loud.
 * `process-barry-inbox-queue` gates on `response_received` and never saw it, so
 * it never advanced the contact to `user_action_required` — the value that
 * `usePendingReplies`, `barryOrientationBrief` and `HunterContactDrawer` all
 * query. A reply could be ingested, matched, analysed and drafted and still
 * never reach a screen.
 *
 * Naming the handoff makes the coupling visible and lets a test assert that the
 * writer and the queue still agree, which is the only thing that stops them
 * drifting apart again.
 */
export const CONVERSATION_STATE_FOR_INBOUND_REPLY = CONVERSATION_STATES.RESPONSE_RECEIVED;

export const EVENTS_COLLECTION = 'relationship_events';
export const PROBE_COLLECTION = 'identity_resolution_probe';

/**
 * The safety gate (Sign-Off A, decision D5).
 *
 * FAIL-SAFE BY CONSTRUCTION: only the exact string 'live' enables writes.
 * Unset, empty, misspelled, or any other value resolves to dry_run. The failure
 * mode of a typo is therefore inertness, never mutation — which is the whole
 * reason this is an environment variable read before any I/O, rather than a
 * config document that could fail open when the read fails.
 */
export const IDENTITY_MODES = Object.freeze({ DRY_RUN: 'dry_run', LIVE: 'live' });

export function resolveIdentityMode(env = process.env) {
  return env.GMAIL_IDENTITY_MODE === IDENTITY_MODES.LIVE
    ? IDENTITY_MODES.LIVE
    : IDENTITY_MODES.DRY_RUN;
}

/**
 * Build the canonical event body from an ingested message and its resolution.
 *
 * `eventType` is decided ONCE, here, and frozen into the immutable document.
 * Recomputing "was this a reply?" at read time would let the answer drift as
 * the thread grows, and a canonical event whose meaning changes is not
 * canonical.
 */
export function buildInboundEvent({ message, contactId, identity, source, threadHasPriorOutbound }) {
  return {
    idynifyUserId: message.idynifyUserId,
    contactId,
    gmailMessageId: message.gmailMessageId,
    gmailThreadId: message.gmailThreadId ?? null,
    eventType: threadHasPriorOutbound ? EVENT_TYPES.INBOUND_REPLY : EVENT_TYPES.INBOUND_MESSAGE,
    occurredAt: message.receivedAt,
    source,
    identity: {
      signal: identity?.signal ?? null,
      outcome: identity?.outcome ?? null,
      engineVersion: identity?.engineVersion ?? 'identityResolution@gate2',
      adapter: 'admin',
    },
    communicationRecordId: message.communicationRecordId ?? null,
    subject: message.subject ?? null,
    ingestionVersion: message.ingestionVersion ?? null,
    supersededBy: null,
  };
}

/**
 * The legacy mirrors. NOT EXPORTED — deliberately.
 *
 * ADR-006 requires that no module other than this one can write a compatibility
 * field, even on purpose. Keeping this function private to the module is that
 * guarantee; an export would make it an API and the guarantee a convention.
 *
 * Note what is absent: `lastInboundAt` and `replyCount` have no readers
 * anywhere in the tree, so they are not mirrored, only deleted. Mirroring a
 * field nobody reads would manufacture the drift this contract exists to end.
 */
function buildCompatibilityMirrors(state, event, currentContact, message) {
  const mirrors = {
    lastInboundSubject: event.subject ?? null,
    last_reply_at: state.last_inbound_at,
    last_replied_at: state.last_inbound_at,
    'engagement_summary.replies_received': state.reply_count,
  };

  // ── conversationState: conditional, never unconditional ───────────────────
  //
  // This is a twelve-state WORKFLOW field, not a reply flag. Writing
  // `response_received` on every qualifying reply reopened finished
  // conversations — a won deal became an unread reply because someone sent a
  // thank-you note, and `meeting_scheduled` regressed to "they replied".
  //
  // `resolveInboundTransition` already encodes the correct rules: which states
  // advance, which are terminal, and the meeting_requested branch that depends
  // on scheduling language. It is a pure module with no imports, so the writer
  // calls it rather than approximating it. A second transition implementation
  // is exactly the drift this codebase keeps paying for.
  //
  // The key is omitted entirely when the state does not change, so a closed
  // conversation's workflow field is not merely rewritten with its own value —
  // it is never written at all.
  const transition = resolveInboundTransition(currentContact?.conversationState ?? null, message ?? {});
  if (transition.newState !== currentContact?.conversationState) {
    mirrors.conversationState = transition.newState;
  }

  // The two approved workflow transitions, and ONLY from the stated current
  // value. Every other current value is left exactly as it is — `contact_status`
  // has roughly ten independent writers and this contract does not own it.
  if (currentContact?.contact_status === 'Awaiting Reply') {
    mirrors.contact_status = 'In Conversation';
    mirrors.contact_status_updated_at = state.last_inbound_at;
  }
  if (currentContact?.hunter_status === 'awaiting_reply') {
    mirrors.hunter_status = 'in_conversation';
  }

  return mirrors;
}

/** Flatten `relationship.*` into dotted update paths so a merge cannot clobber siblings. */
function relationshipUpdatePaths(state) {
  return {
    'relationship.last_inbound_at': state.last_inbound_at,
    'relationship.last_inbound_message_id': state.last_inbound_message_id,
    'relationship.last_outbound_at': state.last_outbound_at,
    'relationship.reply_count': state.reply_count,
    'relationship.state': state.state,
    'relationship.source': state.source,
    'relationship.updated_at': FieldValue.serverTimestamp(),
  };
}

/**
 * Record one canonical inbound event and materialize the state it implies.
 *
 * Every side effect lives in the create branch. A replay reaches the early
 * return and writes nothing at all — no event, no count, no timeline, no queue
 * entry, no mirror.
 *
 * @returns {Promise<{
 *   mode: string, created: boolean, eventId: string|null,
 *   state: object|null, effects: string[], reason?: string
 * }>}
 */
export async function recordInboundEvent({
  db, message, contactId, identity, source,
  threadHasPriorOutbound = true, env = process.env,
}) {
  const mode = resolveIdentityMode(env);

  const event = buildInboundEvent({
    message, contactId, identity, source, threadHasPriorOutbound,
  });
  const key = eventKey(event);
  if (!key) {
    return { mode, created: false, eventId: null, state: null, effects: [], reason: 'unkeyable_event' };
  }

  // ── DRY RUN ────────────────────────────────────────────────────────────────
  // Resolution has already happened; we record what it decided and stop before
  // anything that mutates a relationship. The probe is a diagnostic collection
  // no product surface reads.
  if (mode === IDENTITY_MODES.DRY_RUN) {
    await db.collection(PROBE_COLLECTION).doc(key).set({
      ...event,
      wouldCreate: true,
      observedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { mode, created: false, eventId: null, state: null, effects: [], reason: 'dry_run' };
  }

  // ── LIVE ───────────────────────────────────────────────────────────────────
  const eventRef = db.collection(EVENTS_COLLECTION).doc(key);
  const contactRef = db
    .collection('users').doc(message.idynifyUserId)
    .collection('contacts').doc(contactId);

  return db.runTransaction(async (tx) => {
    // Serializable over this read: a concurrent duplicate loses the race, is
    // retried by Firestore, and on retry observes the document it did not see
    // the first time. Exactly-once holds under concurrency, not just replay,
    // and without any application-level lock.
    const [existing, contactSnap] = await Promise.all([tx.get(eventRef), tx.get(contactRef)]);

    if (existing.exists) {
      return { mode, created: false, eventId: key, state: null, effects: [], reason: 'already_recorded' };
    }
    if (!contactSnap.exists) {
      return { mode, created: false, eventId: null, state: null, effects: [], reason: 'contact_missing' };
    }

    const currentContact = contactSnap.data() || {};
    const priorState = { ...createEmptyState(), ...(currentContact.relationship || {}) };

    // The pure rules decide what this event means. `seenKeys` is empty because
    // the transaction has already established that this key is new — the store
    // is the authority, and this call is only doing the arithmetic.
    const { state, effects } = applyEvent(priorState, event, new Set());

    tx.create(eventRef, { ...event, recordedAt: FieldValue.serverTimestamp() });
    tx.update(contactRef, {
      ...relationshipUpdatePaths(state),
      ...buildCompatibilityMirrors(state, event, currentContact, message),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { mode, created: true, eventId: key, state, effects };
  });
}

/**
 * Rebuild `contact.relationship.*` from the event log.
 *
 * The repair path, the post-backfill verification, and the standing proof that
 * state is derived: if this cannot reproduce the cache, the cache has become an
 * authority of its own and ADR-006 has been violated.
 *
 * Read-only with respect to events. Never invents one.
 */
export async function recomputeRelationship({ db, userId, contactId }) {
  const snap = await db
    .collection(EVENTS_COLLECTION)
    .where('idynifyUserId', '==', userId)
    .where('contactId', '==', contactId)
    .get();

  const events = snap.docs.map(d => d.data());
  const seenKeys = new Set();
  let state = createEmptyState();
  for (const event of events) ({ state } = applyEvent(state, event, seenKeys));
  return { state, eventCount: events.length };
}

export default { recordInboundEvent, recomputeRelationship, resolveIdentityMode };
