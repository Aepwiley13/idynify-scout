import { doc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * The lifecycle transition, in one place.
 *
 * Every surface that reflects an activation locally must agree with what this
 * function writes, or the screen and Firestore drift apart and the next save
 * replays the drift. Exported so React state can be derived from the same rule
 * rather than a hand-copied approximation of it.
 *
 * A non-target that was 'active' becomes 'inactive'. A non-target that was
 * 'pending' stays 'pending' — a half-finished ICP is not demoted by someone
 * else being activated.
 *
 * @param {Object} profile - the profile as it stands
 * @param {boolean} isTarget - whether this profile is the one being activated
 */
export function nextLifecycleState(profile, isTarget) {
  const current = profile?.status;
  return {
    isActive: isTarget,
    status: isTarget ? 'active' : (current === 'active' ? 'inactive' : (current || 'inactive')),
  };
}

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
  const fromFirestore = async () =>
    (await getDocs(collection(db, 'users', userId, 'icpProfiles'))).docs.map(d => ({
      id: d.id, ref: d.ref, data: d.data(),
    }));

  const fromList = list =>
    list.map(p => ({ id: p.id, ref: doc(db, 'users', userId, 'icpProfiles', p.id), data: p }));

  let entries = profiles ? fromList(profiles) : await fromFirestore();

  // A caller's pre-loaded list can be stale — an ICP created after it was read
  // is missing from it. Re-read before concluding the target does not exist.
  if (profiles && !entries.some(e => e.id === targetIcpId)) {
    entries = await fromFirestore();
  }

  // Every branch below deactivates non-targets. With no target among them that
  // is not an activation, it is a workspace-wide deactivation: resolveActiveIcp
  // then reports 'none-active' and ICP-dependent surfaces stop attributing
  // anything. Refuse the whole operation instead of committing half of it.
  if (!entries.some(e => e.id === targetIcpId)) {
    throw new Error(
      `setActiveIcpProfile: ICP "${targetIcpId}" not found for user ${userId}; ` +
      'refusing to deactivate every profile.'
    );
  }

  const batch = writeBatch(db);
  let targetData = {};

  entries.forEach(({ id, ref, data }) => {
    const isTarget = id === targetIcpId;
    if (isTarget) targetData = { ...data, ...additionalData };
    batch.update(ref, {
      ...nextLifecycleState(data, isTarget),
      ...(isTarget && Object.keys(additionalData).length ? additionalData : {}),
      updatedAt: new Date().toISOString(),
    });
  });

  // The bridge is a projection, not an authority. It carries the identity of
  // the ICP it represents so no consumer has to guess which ICP it came from.
  batch.set(doc(db, 'users', userId, 'companyProfile', 'current'), {
    ...targetData,
    icpId: targetIcpId,
    icpIdSource: 'active-selection',
    isActive: true,
    status: 'active',
    updatedAt: new Date().toISOString(),
  });

  await batch.commit();
}
