/**
 * HUNTER BOOTSTRAP UTILITY
 *
 * Seeds relationship_state and hunter_status on existing contacts that predate
 * these fields. Conservative mapping — when in doubt, prefer 'unaware' over
 * any warm state. Barry should underestimate and be corrected, not assume
 * warmth that isn't there and send the wrong message.
 *
 * hunter_status lifecycle:
 *   'deck'            → In the Hunter swipe queue
 *   'engaged_pending' → Rocket launched, Barry still processing (transient state)
 *   'active_mission'  → Contact has a live mission
 *   'archived'        → Soft-dismissed from deck, retrievable
 */

import { doc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';

// ── relationship_state seeding ──────────────────────────

/**
 * Maps existing warmth_level + contact_status to an initial relationship_state.
 * Called for contacts where relationship_state is null/undefined.
 *
 * Rules (conservative — underestimate, don't overestimate):
 * - contact_status 'Dormant'               → dormant
 * - contact_status 'Active Mission'
 *   or 'Mission Complete'                  → warm (they were engaged enough to mission)
 * - contact_status 'In Conversation'       → engaged
 * - contact_status 'Awaiting Reply'        → aware (we reached out, no reply yet)
 * - warmth_level 'hot'                     → warm (not 'trusted' — we can't infer that)
 * - warmth_level 'warm'                    → aware (some contact, conservative)
 * - warmth_level 'cold' or anything else   → unaware
 */
export function inferRelationshipState(contact) {
  const status = contact.contact_status || contact.status || '';
  const warmth = contact.warmth_level || '';

  // contact_status takes priority — it reflects actual platform activity
  if (status === 'Dormant') return 'dormant';
  if (status === 'In Conversation') return 'engaged';
  if (status === 'Active Mission' || status === 'Mission Complete') return 'warm';
  if (status === 'Awaiting Reply' || status === 'Engaged') return 'aware';
  if (status === 'In Campaign') return 'aware';

  // Fall back to warmth_level, conservatively
  if (warmth === 'hot') return 'warm';   // hot → warm (not trusted, can't infer depth)
  if (warmth === 'warm') return 'aware'; // warm temp → aware state (conservative)

  // Default: unaware. Better to underestimate.
  return 'unaware';
}

/**
 * inferHunterStatus — Determines the correct hunter_status for a contact
 * that doesn't have one yet.
 */
export function inferHunterStatus(contact) {
  const status = contact.contact_status || contact.status || '';

  if (status === 'Active Mission') return 'active_mission';
  if (status === 'Dormant') return 'deck'; // dormant contacts go back into deck for reconnect
  return 'deck'; // everything else is in the deck
}

// ── Batch bootstrap (Firestore) ─────────────────────────

/**
 * bootstrapContactsForUser — Seeds relationship_state and hunter_status
 * for all contacts belonging to a user that don't have these fields yet.
 *
 * Safe to run multiple times — only touches contacts where the field is missing.
 * Processes in batches of 20 to avoid overwhelming Firestore write limits.
 *
 * @param {string} userId
 * @param {function} onProgress - optional callback(current, total)
 * @returns {{ updated: number, skipped: number }}
 */
export async function bootstrapContactsForUser(userId, onProgress) {
  const contactsRef = collection(db, 'users', userId, 'contacts');

  // Only fetch contacts that are missing relationship_state
  // (Firestore doesn't support "field does not exist" queries, so we fetch all
  //  and filter client-side — acceptable since this runs once at startup)
  const snapshot = await getDocs(contactsRef);

  const toUpdate = snapshot.docs.filter(d => {
    const data = d.data();
    return !data.relationship_state || !data.hunter_status;
  });

  let updated = 0;
  const total = toUpdate.length;

  // Process in batches of 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (docSnap) => {
      const contact = { id: docSnap.id, ...docSnap.data() };
      const updates = {};

      if (!contact.relationship_state) {
        updates.relationship_state = inferRelationshipState(contact);
      }
      if (!contact.hunter_status) {
        updates.hunter_status = inferHunterStatus(contact);
      }

      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'users', userId, 'contacts', contact.id), {
          ...updates,
          updated_at: new Date().toISOString()
        });
        updated++;
      }
    }));

    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, total), total);
  }

  return { updated, skipped: total - updated };
}

// ── Single-contact helpers (used at write time) ─────────

/**
 * getRelationshipStateForNewContact — Returns the appropriate relationship_state
 * when saving a brand new contact (e.g., from Scout).
 * New contacts always start as 'unaware' unless the user has explicitly
 * set warmth_level or relationship_type during save.
 */
export function getRelationshipStateForNewContact(contactData) {
  // If user explicitly set relationship context, respect it
  if (contactData.relationship_type === 'partner') return 'warm';
  if (contactData.relationship_type === 'known') return 'aware';
  if (contactData.warmth_level === 'hot') return 'warm';
  if (contactData.warmth_level === 'warm') return 'aware';

  // Conservative default for new contacts
  return 'unaware';
}

/**
 * getHunterStatusForNewContact — New contacts saved from Scout go into the deck.
 */
export function getHunterStatusForNewContact() {
  return 'deck';
}
