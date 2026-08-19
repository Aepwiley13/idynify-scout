/**
 * resolveActiveIcp.js — the canonical active-ICP resolution contract (server).
 *
 * Server-side mirror of src/utils/resolveActiveIcp.js. Same contract, same
 * three distinct unresolved reasons, same invariants. See the client module
 * for the full contract documentation.
 *
 * A background job has no greater authority to infer ICP identity than an
 * interactive caller: this resolver never invents an id either.
 */

export const ICP_RESOLVED = 'resolved';
export const ICP_UNRESOLVED = 'unresolved';

export const ICP_NO_PROFILES = 'no-profiles';
export const ICP_NONE_ACTIVE = 'none-active';
export const ICP_READ_FAILED = 'read-failed';
export const ICP_NO_USER = 'no-user';

function unresolved(reason, candidates = []) {
  return { status: ICP_UNRESOLVED, icpId: null, profile: null, reason, candidates };
}

function byCreatedAt(a, b) {
  const ts = v => {
    if (!v) return 0;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return ts(a.createdAt) - ts(b.createdAt);
}

/**
 * @param {FirebaseFirestore.Firestore} db - Admin SDK Firestore instance
 * @param {string} userId
 * @returns {Promise<Object>} an IcpResolution
 */
export async function resolveActiveIcp(db, userId) {
  if (!userId) return unresolved(ICP_NO_USER);

  let profiles;
  try {
    const snap = await db.collection('users').doc(userId).collection('icpProfiles').get();
    profiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[resolveActiveIcp] read failed:', err.message);
    return unresolved(ICP_READ_FAILED);
  }

  if (profiles.length === 0) return unresolved(ICP_NO_PROFILES);

  profiles.sort(byCreatedAt);
  const active = profiles.find(p => p.isActive === true && p.status === 'active');

  if (!active) return unresolved(ICP_NONE_ACTIVE, profiles);

  return {
    status: ICP_RESOLVED,
    icpId: active.id,
    profile: active,
    source: 'active-flag',
    candidates: profiles,
  };
}

export function isResolved(resolution) {
  return resolution?.status === ICP_RESOLVED;
}
