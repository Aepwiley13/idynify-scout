/**
 * BACKFILL: Mission Contact Name Denormalization (Step 6)
 *
 * Existing missions store contact.name but may not have firstName/lastName.
 * This utility reads the actual contact documents and patches mission contacts
 * with denormalized name fields for dashboard rendering.
 *
 * Run once per user — idempotent and safe to re-run.
 * Non-destructive: only adds fields, never removes existing data.
 *
 * Usage:
 *   import { backfillMissionContactNames } from './backfillMissionContacts';
 *   await backfillMissionContactNames(userId);
 */

import { collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Backfill firstName/lastName on mission contacts from contact documents.
 *
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<{updated: number, skipped: number, errors: number}>}
 */
export async function backfillMissionContactNames(userId) {
  const stats = { updated: 0, skipped: 0, errors: 0 };

  try {
    // Load all missions
    const missionsSnap = await getDocs(collection(db, 'users', userId, 'missions'));
    if (missionsSnap.empty) return stats;

    // Build a contact ID → name cache to avoid redundant reads
    const contactCache = new Map();

    for (const missionDoc of missionsSnap.docs) {
      const mission = missionDoc.data();
      const contacts = mission.contacts || [];

      let needsUpdate = false;
      const updatedContacts = [];

      for (const contact of contacts) {
        // Skip if already has firstName/lastName
        if (contact.firstName && contact.lastName) {
          updatedContacts.push(contact);
          continue;
        }

        // Resolve from cache or Firestore
        let firstName = null;
        let lastName = null;

        if (contactCache.has(contact.contactId)) {
          const cached = contactCache.get(contact.contactId);
          firstName = cached.firstName;
          lastName = cached.lastName;
        } else {
          try {
            const contactDoc = await getDoc(
              doc(db, 'users', userId, 'contacts', contact.contactId)
            );
            if (contactDoc.exists()) {
              const data = contactDoc.data();
              firstName = data.firstName || null;
              lastName = data.lastName || null;
              contactCache.set(contact.contactId, { firstName, lastName });
            }
          } catch (err) {
            console.warn(`[Backfill] Failed to read contact ${contact.contactId}:`, err);
            stats.errors++;
          }
        }

        if (firstName || lastName) {
          updatedContacts.push({
            ...contact,
            firstName,
            lastName,
            name: contact.name || `${firstName || ''} ${lastName || ''}`.trim()
          });
          needsUpdate = true;
        } else {
          updatedContacts.push(contact);
        }
      }

      if (needsUpdate) {
        try {
          await updateDoc(doc(db, 'users', userId, 'missions', missionDoc.id), {
            contacts: updatedContacts
          });
          stats.updated++;
        } catch (err) {
          console.error(`[Backfill] Failed to update mission ${missionDoc.id}:`, err);
          stats.errors++;
        }
      } else {
        stats.skipped++;
      }
    }
  } catch (err) {
    console.error('[Backfill] Fatal error:', err);
    stats.errors++;
  }

  return stats;
}
