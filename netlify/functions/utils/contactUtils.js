/**
 * Server-side contact utilities — uses Firebase Admin SDK.
 * Logic mirrors src/utils/contactUtils.js (client SDK) so both surfaces
 * use the same stale-contact definition.
 */

function daysSince(dateVal) {
  if (!dateVal) return Infinity;
  const date = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
  if (isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns contacts in 'Awaiting Reply' status whose last status update
 * is at least `days` days ago.
 *
 * @param {FirebaseFirestore.CollectionReference} userRef - Admin SDK user doc ref
 * @param {number} days - minimum days since last contact (default 14)
 * @returns {Promise<Array>} array of { id, ...contactData, daysSince }
 */
export async function getStaleContacts(userRef, days = 14) {
  const snap = await userRef
    .collection('contacts')
    .where('contact_status', '==', 'Awaiting Reply')
    .limit(20)
    .get();

  const results = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    const d = daysSince(data.contact_status_updated_at);
    if (d >= days) {
      results.push({ id: docSnap.id, ...data, daysSince: d });
    }
  });
  return results;
}
