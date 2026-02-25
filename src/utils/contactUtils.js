import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Returns true if a contact is currently snoozed (snoozed_until is set and in the future).
 */
function isSnoozed(data) {
  if (!data.snoozed_until) return false;
  const snoozeTs = data.snoozed_until?.toMillis
    ? data.snoozed_until.toMillis()
    : new Date(data.snoozed_until).getTime();
  return snoozeTs > Date.now();
}

/**
 * Returns contacts in 'Awaiting Reply' status whose last status update
 * is at least `days` days ago. Mirrors the stale-contact query in
 * barryMissionChat.js so both use identical logic.
 *
 * Excludes contacts with an active snooze (snoozed_until > now).
 * Uses two queries (snoozed_until == null and snoozed_until <= now) merged
 * client-side so that contacts without the field are included.
 *
 * @param {string} userId
 * @param {number} days - minimum days since last contact (default 14)
 * @returns {Promise<Array>} array of contact objects with { id, ...data }
 */
export async function getStaleContacts(userId, days = 14) {
  const contactsRef = collection(db, 'users', userId, 'contacts');
  const now = Date.now();
  const nowTimestamp = Timestamp.fromMillis(now);

  // Two queries merged client-side: contacts with no snooze OR snooze already expired
  const [nullSnap, expiredSnap] = await Promise.all([
    getDocs(query(
      contactsRef,
      where('contact_status', '==', 'Awaiting Reply'),
      where('snoozed_until', '==', null)
    )),
    getDocs(query(
      contactsRef,
      where('contact_status', '==', 'Awaiting Reply'),
      where('snoozed_until', '<=', nowTimestamp)
    ))
  ]);

  // Merge and dedupe by document ID
  const seen = new Set();
  const merged = [];
  for (const snap of [nullSnap, expiredSnap]) {
    snap.forEach(docSnap => {
      if (!seen.has(docSnap.id)) {
        seen.add(docSnap.id);
        merged.push(docSnap);
      }
    });
  }

  const results = [];

  for (const docSnap of merged) {
    const data = docSnap.data();
    // Double-check: skip any contact that slipped through with an active snooze
    if (isSnoozed(data)) continue;

    const dateVal = data.contact_status_updated_at;
    if (!dateVal) continue;

    const date = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
    if (isNaN(date.getTime())) continue;

    const daysSince = Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= days) {
      results.push({ id: docSnap.id, ...data, daysSince });
    }
  }

  return results;
}
