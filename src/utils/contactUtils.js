import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Returns contacts in 'Awaiting Reply' status whose last status update
 * is at least `days` days ago. Mirrors the stale-contact query in
 * barryMissionChat.js (lines 90–112) so both use identical logic.
 *
 * @param {string} userId
 * @param {number} days - minimum days since last contact (default 14)
 * @returns {Promise<Array>} array of contact objects with { id, ...data }
 */
export async function getStaleContacts(userId, days = 14) {
  const snap = await getDocs(
    query(
      collection(db, 'users', userId, 'contacts'),
      where('contact_status', '==', 'Awaiting Reply')
    )
  );

  const now = Date.now();
  const results = [];

  snap.forEach(docSnap => {
    const data = docSnap.data();
    const dateVal = data.contact_status_updated_at;
    if (!dateVal) return;

    const date = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
    if (isNaN(date.getTime())) return;

    const daysSince = Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= days) {
      results.push({ id: docSnap.id, ...data, daysSince });
    }
  });

  return results;
}
