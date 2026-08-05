/**
 * sniperWriteGuard — no new orphans in sniper_contacts.
 *
 * THE PROBLEM
 * ───────────
 * Sniper does not read `users/{uid}/contacts`. It reads
 * `users/{uid}/sniper_contacts`, a parallel collection, and adding someone to
 * Sniper COPIES them into it. The copy carries a name, a title, a company and
 * an email — and nothing else. Not the timeline. Not barry_memory. Not the
 * engagement summary, the brigade history or the next best step.
 *
 * So a contact you have worked for three months, whose entire relationship
 * history the product has been accumulating, arrives in Sniper as a stranger.
 * Worse, the two records then diverge: the canonical contact's stage says one
 * thing, the Sniper copy's stage says another, and nothing reconciles them.
 *
 * WHAT THIS SPRINT DOES ABOUT IT
 * ──────────────────────────────
 * Not the migration. The locked decision is that Sniper becomes
 * `stage: 'sniper'` on the canonical contact, with Sniper-specific detail as a
 * structured object or a related opportunity record — and that is a data
 * migration with its own rollback plan, deferred by the brief.
 *
 * What ships now is the FREEZE: every new Sniper record must carry
 * `canonical_contact_id` pointing at `users/{uid}/contacts/{id}`. That single
 * field is what makes the deferred migration possible — a record with it can
 * be reconciled mechanically; a record without it needs a human to guess which
 * contact it meant. Every day this ships earlier is a day fewer unmatchable
 * orphans.
 *
 * It also writes `stage: 'sniper'` onto the canonical contact, so the canonical
 * record is right from the moment of the copy. The copy becomes redundant
 * rather than authoritative, which is the state the migration needs to start
 * from.
 *
 * See docs/SNIPER_MIGRATION.md for the follow-on plan.
 */

import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { STAGE } from '../constants/statusModel';

/**
 * Create a Sniper record that is linked to its canonical contact.
 *
 * Throws without a canonical id rather than writing an unlinked record. This
 * is the freeze: an orphan created today is a manual reconciliation later, and
 * a thrown error at the call site is enormously cheaper than that.
 *
 * @param {string} userId
 * @param {string} canonicalContactId  users/{uid}/contacts/{id} — required.
 * @param {object} fields              Sniper-specific detail.
 * @returns {Promise<string>} the new sniper_contacts document id
 */
export async function createSniperRecord(userId, canonicalContactId, fields = {}) {
  if (!userId) throw new Error('createSniperRecord: userId is required.');

  if (!canonicalContactId) {
    throw new Error(
      'createSniperRecord: canonical_contact_id is required. ' +
      'Sniper records without a link back to users/{uid}/contacts cannot be migrated ' +
      'onto the canonical contact and lose the timeline, Barry memory and engagement ' +
      'history of the person they describe. See docs/SNIPER_MIGRATION.md.'
    );
  }

  const ref = await addDoc(collection(db, 'users', userId, 'sniper_contacts'), {
    ...fields,
    canonical_contact_id: canonicalContactId,
    // Kept alongside the new field. `contactRef` is what AllLeads and
    // SharedCompaniesView already read to decide whether a contact is in
    // Sniper; dropping it here would break both on the day this shipped.
    contactRef: fields.contactRef ?? canonicalContactId,
    createdAt: serverTimestamp(),
    lastTouchAt: serverTimestamp(),
  });

  // The canonical record learns it is in Sniper. This is the half of the
  // change that makes the copy redundant rather than authoritative — after
  // this, `stage` on the contact is true whether or not Sniper is open.
  try {
    await updateDoc(doc(db, 'users', userId, 'contacts', canonicalContactId), {
      stage: STAGE.SNIPER,
      stage_source: 'sniper_add',
      stage_entered_at: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal. The link exists, which is what the migration needs; a stage
    // that failed to write is recoverable from the link, an orphan is not.
    console.warn('[sniper-guard] could not set stage on canonical contact', {
      canonicalContactId, code: err?.code, message: err?.message,
    });
  }

  console.info('[sniper-guard] sniper record created and linked', {
    sniperId: ref.id, canonicalContactId,
  });

  return ref.id;
}

/**
 * Is this Sniper record linked to a canonical contact?
 *
 * Used by the verification script and by the migration to count what is left.
 * Reads both the new field and the pre-existing `contactRef`, because records
 * written before this sprint may carry the latter — those are migratable and
 * should not be counted as orphans.
 */
export function sniperCanonicalId(record = {}) {
  return record.canonical_contact_id ?? record.contactRef ?? null;
}

export default { createSniperRecord, sniperCanonicalId };
