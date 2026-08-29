/**
 * relationshipRead — the ONE way a consumer asks what happened in a
 * relationship.
 *
 * ADR-006 gives every consumer a single place to read from, so that migrating
 * them is a call-site change rather than an archaeology exercise. Import these
 * accessors; do not reach into `contact.relationship` directly, and never read
 * a compatibility mirror.
 *
 * ─── THE FALLBACK IS TEMPORARY AND LIVES ONLY HERE ──────────────────────────
 *
 * Until Sign-Off B authorizes the historical backfill, most contacts have no
 * canonical events at all — their reply state exists only in the legacy fields
 * a human wrote by clicking "Sync Replies". A consumer that read canonical and
 * stopped would therefore regress those contacts from "replied" to "never
 * heard from", which is worse than the bug being fixed.
 *
 * So each accessor prefers canonical and falls back to the mirror. That is a
 * read-side transition measure and NOT the prohibited legacy→truth direction:
 * nothing here writes, derives, or promotes a legacy value into canonical
 * state. The fallback is confined to this file precisely so that when the
 * backfill completes it is deleted in one edit, and the ESLint boundary keeps
 * every other module from growing its own copy.
 *
 * Pure. No Firestore, no React — it takes a contact document and returns
 * numbers and strings, so both runtimes and the tests share one answer.
 */

/**
 * How many replies we have from this person.
 *
 * Canonical: the count of unique inbound reply events. Falls back to the
 * mirror, which manual reply detection has been maintaining.
 */
export function getReplyCount(contact) {
  const canonical = contact?.relationship?.reply_count;
  if (typeof canonical === 'number') return canonical;
  return contact?.engagement_summary?.replies_received || 0;
}

/** True when this person has ever replied. The guardrail's core question. */
export function hasReplied(contact) {
  return getReplyCount(contact) > 0;
}

/**
 * When they last wrote to us, as an ISO string or null.
 *
 * The fallback deliberately does NOT consult `contact_status_updated_at` or
 * `last_interaction_at`. Both are written on events that are not inbound
 * replies — and `last_reply_at` itself was historically set to the moment
 * someone clicked "Sync Replies" rather than the moment the mail arrived, so
 * even the preferred mirror is only approximately an event time. Canonical is
 * the only value that is exactly one.
 */
export function getLastInboundAt(contact) {
  return contact?.relationship?.last_inbound_at
    ?? contact?.last_reply_at
    ?? contact?.last_replied_at
    ?? null;
}

/** Days since they last wrote, or null when we have never heard from them. */
export function daysSinceLastInbound(contact, now = Date.now()) {
  const at = getLastInboundAt(contact);
  if (!at) return null;
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return null;
  return (now - parsed) / 86_400_000;
}

/** The materialized relationship state, or null before any event exists. */
export function getRelationshipState(contact) {
  return contact?.relationship?.state ?? contact?.conversationState ?? null;
}

/**
 * True when this contact is mid-conversation and should not receive cold
 * outreach framing. The question F5 found the guardrail could never answer.
 */
export function isInConversation(contact) {
  return getRelationshipState(contact) === 'in_conversation'
    || contact?.contact_status === 'In Conversation'
    || contact?.hunter_status === 'in_conversation';
}

/**
 * The WORKFLOW state — where this conversation sits in the outreach lifecycle.
 *
 * Deliberately separate from `getRelationshipState`, which answers a different
 * question in a different vocabulary. Conflating the two is what stranded every
 * Gmail reply behind `process-barry-inbox-queue`: the writer put
 * `in_conversation` (a relationship value) into `conversationState` (a workflow
 * field), the queue gate compared it to `response_received`, and the reply
 * silently never reached a screen.
 *
 * Reading it through here rather than off the document gives that coupling one
 * place to live, and one place to delete when the workflow vocabulary is
 * eventually folded into the canonical contract.
 */
export function getConversationState(contact) {
  return contact?.conversationState ?? null;
}

/**
 * True when Barry has produced something the user is expected to act on.
 *
 * The single question `usePendingReplies`, `barryOrientationBrief` and
 * `HunterContactDrawer` each ask by hand today, in three separate string
 * comparisons against the same literal.
 */
export function awaitsUserAction(contact) {
  return getConversationState(contact) === 'user_action_required';
}

export default {
  getReplyCount, hasReplied, getLastInboundAt,
  daysSinceLastInbound, getRelationshipState, isInConversation,
  getConversationState, awaitsUserAction,
};
