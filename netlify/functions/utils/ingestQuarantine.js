/**
 * ingestQuarantine — bounded retry for a message that will not ingest, so one
 * bad message cannot hold every later Gmail event behind it forever.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE WEDGE THIS EXISTS TO END                                            ║
 * ║                                                                          ║
 * ║  The sync worker holds `lastHistoryId` whenever a message fails, so the  ║
 * ║  next run replays the same batch. That is correct for a transient        ║
 * ║  failure and catastrophic for a permanent one: the same message fails    ║
 * ║  the same way forever, the cursor never advances, and every message      ║
 * ║  behind it — indefinitely many — is never ingested. Silently.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── WHY THIS IS AT THE INGESTION LAYER AND NOT IN THE RESOLVER ─────────────
 *
 * The obvious fix is to catch the Firestore error where it is thrown and carry
 * on. That is the one thing that must not happen: the identity engine rethrows
 * precisely so a query failure can never read as "no duplicate", because
 * creating a second copy of a person because the database blinked is worse than
 * failing loudly. That guarantee is load-bearing and is not weakened here — the
 * engine still throws, `findByField` still rethrows, and nothing in this file
 * inspects or reinterprets why a message failed.
 *
 * What changes is only how long the *pipeline* is willing to keep retrying
 * before it sets a message aside and moves on. A failure is still a failure;
 * after MAX_ATTEMPTS it becomes a recorded, visible failure instead of an
 * invisible blockade.
 *
 * ─── WHY RETRY FIRST RATHER THAN QUARANTINE IMMEDIATELY ────────────────────
 *
 * Most ingestion failures are transient — a Firestore deadline, a rate limit, a
 * cold start. Quarantining on the first error would discard messages that would
 * have succeeded seconds later. Holding the cursor for a bounded number of
 * attempts keeps the existing "never skip a message" guarantee for exactly the
 * failures where it is worth having, and gives up only once the evidence says
 * the failure is durable.
 *
 * ─── WHAT QUARANTINE IS NOT ────────────────────────────────────────────────
 *
 * It is not a delete. The message id, the error, every attempt and its
 * timestamps are kept, and the Gmail message itself is untouched and still in
 * the mailbox. A quarantined message can be replayed at any time: ingestion is
 * keyed by `(userId, gmailMessageId)` all the way down to the canonical event,
 * so replaying one produces exactly one event, one timeline entry and one queue
 * job — never a duplicate.
 */

import { FieldValue } from 'firebase-admin/firestore';

export const QUARANTINE_COLLECTION = 'gmail_ingest_failures';

/**
 * How many runs a single message may hold the cursor before it is set aside.
 *
 * Three, against a ten-minute schedule, means a transient fault has roughly
 * thirty minutes to clear itself before anything is quarantined, and a
 * permanent one blocks the mailbox for at most that long. Raising it trades
 * mailbox latency for patience; lowering it risks quarantining flaky-but-real
 * failures.
 */
export const MAX_ATTEMPTS = 3;

export const FAILURE_STATUS = Object.freeze({
  RETRYING: 'retrying',
  QUARANTINED: 'quarantined',
});

export function failureKey(userId, gmailMessageId) {
  if (!userId || !gmailMessageId) return null;
  return `${userId}__${gmailMessageId}`;
}

/**
 * Record one failed ingestion attempt and decide what the worker should do.
 *
 * @returns {Promise<{
 *   attempts: number, quarantined: boolean, holdCursor: boolean, key: string|null
 * }>}
 *   `holdCursor: true`  — retry this message next run; do not advance past it.
 *   `holdCursor: false` — quarantined; the worker may move on.
 *
 * Fails OPEN, deliberately: if the quarantine bookkeeping itself cannot be
 * written we hold the cursor, which is the pre-existing behaviour. A bug in the
 * escape hatch must not become a new way to skip mail.
 */
export async function recordIngestFailure(db, { userId, gmailMessageId, reason, threadId = null }) {
  const key = failureKey(userId, gmailMessageId);
  if (!key) return { attempts: 0, quarantined: false, holdCursor: true, key: null };

  try {
    // Inside the try: obtaining the reference can itself throw, and every
    // failure of the bookkeeping must land on the same fail-open path.
    const ref = db.collection(QUARANTINE_COLLECTION).doc(key);
    const snap = await ref.get();
    const attempts = (snap.exists ? snap.data().attempts || 0 : 0) + 1;
    const quarantined = attempts >= MAX_ATTEMPTS;

    await ref.set({
      idynifyUserId: userId,
      gmailMessageId,
      gmailThreadId: threadId,
      attempts,
      status: quarantined ? FAILURE_STATUS.QUARANTINED : FAILURE_STATUS.RETRYING,
      lastError: String(reason || 'unknown').slice(0, 1000),
      lastFailedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { firstFailedAt: FieldValue.serverTimestamp() }),
      ...(quarantined && !snap.data()?.quarantinedAt
        ? { quarantinedAt: FieldValue.serverTimestamp() }
        : {}),
    }, { merge: true });

    return { attempts, quarantined, holdCursor: !quarantined, key };
  } catch (err) {
    console.error('[gmail-sync] quarantine bookkeeping failed:', err.message);
    return { attempts: 0, quarantined: false, holdCursor: true, key };
  }
}

/**
 * Clear a message's failure record after it finally ingests.
 *
 * Without this, a message that failed twice and then succeeded would keep its
 * attempt count and be quarantined on its next unrelated hiccup. Best-effort:
 * a failed cleanup must never fail the ingestion that just worked.
 */
export async function clearIngestFailure(db, { userId, gmailMessageId }) {
  const key = failureKey(userId, gmailMessageId);
  if (!key) return;
  try {
    await db.collection(QUARANTINE_COLLECTION).doc(key).delete();
  } catch (err) {
    console.warn('[gmail-sync] could not clear failure record:', err.message);
  }
}

/** How many messages are currently set aside for a user — for health reporting. */
export async function countQuarantined(db, userId) {
  try {
    const snap = await db
      .collection(QUARANTINE_COLLECTION)
      .where('idynifyUserId', '==', userId)
      .where('status', '==', FAILURE_STATUS.QUARANTINED)
      .count()
      .get();
    return snap.data().count;
  } catch (err) {
    console.warn('[gmail-sync] could not count quarantined messages:', err.message);
    return null;
  }
}

export default { recordIngestFailure, clearIngestFailure, countQuarantined, MAX_ATTEMPTS };
