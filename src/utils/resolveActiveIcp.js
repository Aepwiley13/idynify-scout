/**
 * resolveActiveIcp.js — the canonical active-ICP resolution contract (client).
 *
 * This is the single function every client caller uses to answer
 * "which ICP is active?". It replaces seven ad-hoc selection mechanisms that
 * disagreed with each other through three different fallback tiebreaks.
 *
 * Contract:
 *   RESOLVED    → { status:'resolved', icpId, profile, source:'active-flag', candidates }
 *   UNRESOLVED  → { status:'unresolved', icpId:null, profile:null, reason, candidates }
 *
 * The three unresolved reasons are semantically distinct and MUST stay distinct
 * at every hop. They are never collapsed into one another and never into an id:
 *
 *   'no-profiles'  — no ICP has been created. This is a VALID product state.
 *                    An ICP is capability-required, not platform-required: a
 *                    workspace may legitimately have zero ICPs and still use
 *                    relationship engagement, referrals, inbox intelligence,
 *                    meeting prep and follow-up. Only an operation that
 *                    semantically depends on a targeting definition may treat
 *                    this as blocking.
 *   'none-active'  — one or more ICPs exist but none is selected. `candidates`
 *                    is non-empty. A candidate may be rendered for continuity;
 *                    it must never be promoted, persisted, or searched against.
 *   'read-failed'  — resolution itself failed. Failure is not emptiness, and
 *                    emptiness is not a default.
 *
 * Invariants:
 *   - Never returns DEFAULT_ICP_ID, or any other id, as a stand-in for an
 *     absent selection.
 *   - Never reads companyProfile/current. The bridge is a projection; it is
 *     not an identity source.
 *   - Never classifies severity. It reports a state; the calling operation
 *     decides whether that state blocks it.
 */

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

export const ICP_RESOLVED = 'resolved';
export const ICP_UNRESOLVED = 'unresolved';

export const ICP_NO_PROFILES = 'no-profiles';
export const ICP_NONE_ACTIVE = 'none-active';
export const ICP_READ_FAILED = 'read-failed';
export const ICP_NO_USER = 'no-user';

function unresolved(reason, candidates = []) {
  return { status: ICP_UNRESOLVED, icpId: null, profile: null, reason, candidates };
}

/**
 * Sort profiles oldest-first so `candidates[0]` is stable across calls.
 * createdAt is an ISO string on profiles written by ICPSettings and a Firestore
 * Timestamp on profiles written by the migration — handle both.
 */
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
 * @param {string} userId
 * @returns {Promise<Object>} an IcpResolution — see the contract above.
 */
export async function resolveActiveIcp(userId) {
  if (!userId) return unresolved(ICP_NO_USER);

  let profiles;
  try {
    const snap = await getDocs(collection(db, 'users', userId, 'icpProfiles'));
    profiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // A failed read is NOT an empty collection. Saying "no-profiles" here would
    // tell a caller that the user has never created an ICP, which we do not know.
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

/** True when an ICP identity was established. */
export function isResolved(resolution) {
  return resolution?.status === ICP_RESOLVED;
}

/**
 * Human-readable explanation for an ICP-dependent surface that cannot proceed.
 * Only a surface attempting an ICP-dependent operation explains the
 * requirement — a workspace without an ICP is not "incomplete".
 */
export function explainUnresolved(resolution) {
  switch (resolution?.reason) {
    case ICP_NO_PROFILES:
      return 'This needs a target profile — tell Barry who you want to find.';
    case ICP_NONE_ACTIVE:
      return 'You have more than one target profile. Choose which one to use.';
    case ICP_READ_FAILED:
      return "Couldn't load your target profile. Try again.";
    case ICP_NO_USER:
      return 'Sign in to continue.';
    default:
      return 'No target profile is in use.';
  }
}
