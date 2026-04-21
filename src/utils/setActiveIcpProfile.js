import { doc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Atomically activates one ICP profile, deactivates all others, and
 * overwrites the companyProfile/current bridge cache so every read path
 * sees the change immediately.
 *
 * @param {string} userId
 * @param {string} targetIcpId
 * @param {Object} [additionalData={}] - Extra fields merged into the target profile (e.g. messaging answers)
 * @param {Array} [profiles=null] - Pre-loaded profile list; skips Firestore fetch when provided
 */
export async function setActiveIcpProfile(userId, targetIcpId, additionalData = {}, profiles = null) {
  const entries = profiles
    ? profiles.map(p => ({ id: p.id, ref: doc(db, 'users', userId, 'icpProfiles', p.id), data: p }))
    : (await getDocs(collection(db, 'users', userId, 'icpProfiles'))).docs.map(d => ({
        id: d.id, ref: d.ref, data: d.data(),
      }));

  const batch = writeBatch(db);
  let targetData = {};

  entries.forEach(({ id, ref, data }) => {
    const isTarget = id === targetIcpId;
    if (isTarget) targetData = { ...data, ...additionalData };
    batch.update(ref, {
      isActive: isTarget,
      status: isTarget ? 'active' : (data.status === 'active' ? 'inactive' : (data.status || 'inactive')),
      ...(isTarget && Object.keys(additionalData).length ? additionalData : {}),
      updatedAt: new Date().toISOString(),
    });
  });

  batch.set(doc(db, 'users', userId, 'companyProfile', 'current'), {
    ...targetData,
    isActive: true,
    status: 'active',
    updatedAt: new Date().toISOString(),
  });

  await batch.commit();
}
