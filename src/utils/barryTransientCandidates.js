/**
 * TRANSIENT CANDIDATE STORE — in memory, for the life of the tab. Nothing else.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Two rules pull in opposite directions:
 *
 *   1. result_set / resolution_preview should be TURNS in the canonical Barry
 *      conversation, so there is one thread and one history.
 *   2. First Value results are PROPOSALS and must not be persisted.
 *
 * Writing 20 Apollo people into a turn document would satisfy (1) and break (2)
 * — a durable copy of candidate identity in Firestore is candidate persistence
 * whatever collection it lives in.
 *
 * So the turn persists only the conversational FACT — Barry's sentence, the
 * `kind`, and non-identifying counts — while the candidate identity data lives
 * here, in memory, keyed by a transient sessionRef the turn points at.
 *
 * ─── THE HONEST CONSEQUENCE ─────────────────────────────────────────────────
 * After a reload the turn is still in the thread and still reads correctly
 * ("I found 20 people who look relevant"), but it is no longer interactive.
 * That is the truthful behaviour: a search proposal from yesterday should not
 * be silently re-selectable, because the underlying results may no longer be
 * accurate and were never ours to keep.
 */

const sets = new Map();   // sessionRef -> { kind, source, results, createdAt }

export function mintSessionRef() {
  return `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Hold a result set for the life of the tab. Returns the sessionRef to put on the turn. */
export function holdResultSet({ sessionRef, kind, source, results }) {
  const ref = sessionRef || mintSessionRef();
  sets.set(ref, { kind, source, results, createdAt: Date.now() });
  return ref;
}

/** null when the tab has been reloaded since the turn was written — render statically. */
export function getResultSet(sessionRef) {
  return sets.get(sessionRef) || null;
}

export function hasResultSet(sessionRef) {
  return sets.has(sessionRef);
}

/** Called once the user has acted; the proposals are no longer needed. */
export function releaseResultSet(sessionRef) {
  sets.delete(sessionRef);
}

/** Test hook. */
export function _clearAll() {
  sets.clear();
}

export function _size() {
  return sets.size;
}
