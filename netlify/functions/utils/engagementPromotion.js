/**
 * Server-side half of the engagement promotion.
 *
 * The client funnels every status transition through
 * `src/utils/contactStateMachine.js`, which promotes a contact out of
 * `suggested` the moment it becomes engaged. The Netlify send paths do not go
 * through that function — they build a patch and write it with the admin SDK —
 * so without this helper a contact engaged by a scheduled send, a wave, or
 * Barry would keep the `status: 'suggested'` stamp that auto-discovery left on
 * it.
 *
 * That stamp is not cosmetic. Saved Companies excludes suggested contacts and
 * People excludes engaged ones, so a contact that is both is counted by
 * neither while cadences keep running against it.
 *
 * The promotion decision itself lives in src/constants/statusModel.js and is
 * shared with the client, so the two runtimes cannot drift on what `suggested`
 * means. This wrapper only supplies the read.
 *
 * NEVER THROWS. A failed promotion must not fail a send that already
 * succeeded — the contact is merely left for the read-side compatibility
 * helpers to classify, which they do correctly.
 */

import { engagementPromotionFields } from '../../../src/constants/statusModel.js';

/**
 * Fields to merge into a contact update that represents engagement.
 *
 * @param {FirebaseFirestore.DocumentReference} contactRef
 * @param {string} reason  What engaged the contact — recorded on the row.
 * @returns {Promise<object>} Patch fields, or `{}` when nothing to promote.
 */
export async function engagementPromotionPatch(contactRef, reason) {
  try {
    const snap = await contactRef.get();
    if (!snap.exists) return {};
    return engagementPromotionFields(snap.data(), { reason });
  } catch (err) {
    console.error('[engagement-promotion] could not read contact, skipping promotion:', err);
    return {};
  }
}
