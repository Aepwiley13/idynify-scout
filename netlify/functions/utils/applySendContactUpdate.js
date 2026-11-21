/**
 * applySendContactUpdate — the transactional half of a confirmed send's
 * contact write.
 *
 * Every send path (quick, wave, both scheduled paths) reads the contact,
 * decides whether to mark it awaiting_reply via sendShouldMarkAwaitingReply,
 * and writes known send-time fields (gmail_last_message_id, last_sent_at,
 * thread id, engagement promotion). A plain get()-then-update() leaves a
 * window between the two calls where replyPolling.js's own transaction can
 * land in between and genuinely advance the contact (e.g. to
 * in_conversation) — this read-then-write would then commit its
 * now-stale decision afterward, regressing the exact status this guard
 * exists to protect. Wrapping the whole read-decide-write in one Firestore
 * transaction closes that window: Firestore serializes it against any
 * other transaction touching the same document, replyPolling.js's included
 * — one of them retries automatically rather than both landing.
 *
 * `baseUpdate` carries only fields already known before this call (Gmail
 * message id, timestamps, thread id) — never anything status-related; the
 * status decision and the promotion-fields merge both happen fresh here,
 * against the same tx.get() read, so they can never be computed from data
 * older than what actually gets written.
 */
import { sendShouldMarkAwaitingReply } from '../../../src/utils/relationshipRead.js';
import { engagementPromotionFields } from '../../../src/constants/statusModel.js';

/**
 * @param {FirebaseFirestore.DocumentReference} contactRef
 * @param {object} baseUpdate  Fields to write regardless of status — never
 *   hunter_status/contact_status; those are decided inside the transaction.
 * @param {string} reason  Passed through to engagementPromotionFields.
 * @returns {Promise<{markedAwaitingReply: boolean}>}
 */
export async function applySendContactUpdate(contactRef, baseUpdate, reason) {
  let markedAwaitingReply = false;

  await contactRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(contactRef);
    const currentContact = snap.exists ? snap.data() : null;

    const update = { ...baseUpdate };

    markedAwaitingReply = sendShouldMarkAwaitingReply(currentContact);
    if (markedAwaitingReply) {
      update.hunter_status = 'awaiting_reply';
    }

    // Engaging a contact means the user kept it, so it can no longer be a
    // discovery suggestion. Computed directly from the same fresh read
    // rather than through engagementPromotionPatch's own separate get() —
    // that wrapper exists only to supply a read this call site already has.
    // Never allowed to block the status write above: this helper's whole
    // contract (NEVER THROWS, inherited from engagementPromotionPatch) is
    // that a promotion-computation failure must not cost a send its
    // contact update.
    if (currentContact) {
      try {
        Object.assign(update, engagementPromotionFields(currentContact, { reason }));
      } catch (err) {
        console.error('[engagement-promotion] could not compute promotion fields, skipping promotion:', err);
      }
    }

    tx.update(contactRef, update);
  });

  return { markedAwaitingReply };
}
