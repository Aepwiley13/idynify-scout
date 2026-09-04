/**
 * updateIcpFromChat.js — Write ICP changes from Barry dashboard chat to Firestore.
 *
 * Called by BarryChatPanel after the user confirms an ICP change (add or replace).
 *
 * This function updates an ICP the user already has. It never creates one.
 * It previously wrote companyProfile/current before it knew which ICP it was
 * projecting, and fell back to setDoc on icpProfiles/default when no active
 * profile resolved — an undeclared create that manufactured an ICP identity
 * out of a failed lookup. Both are gone: the authoritative icpProfiles document
 * is written first, the bridge is written after as a projection carrying its
 * icpId, and an unresolved identity refuses the write instead of inventing one.
 */

import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { resolveActiveIcp, isResolved } from './resolveActiveIcp';
import { normalizeIcpParams } from './normalizeIcpParams';

/**
 * Apply a confirmed ICP delta from Barry chat.
 *
 * @param {string} userId
 * @param {Object} icpDelta - New ICP fields extracted by Barry (icp_params shape)
 * @param {'add'|'replace'} action
 * @param {Object|null} existingProfile - Current profile shown in the chat (for merge)
 * @returns {Promise<Object>} On success the written profile, with `status:'resolved'`.
 *   On failure `{ status:'unresolved', reason }` — the caller surfaces it. The
 *   three reasons stay distinct: 'no-profiles' means the user has never created
 *   an ICP (a valid state — this operation simply needs one), 'none-active'
 *   means they must choose which ICP this change applies to, and 'read-failed'
 *   means the lookup itself failed and is worth retrying.
 */
export async function updateIcpFromChat(userId, icpDelta, action, existingProfile) {
  const resolution = await resolveActiveIcp(userId);

  if (!isResolved(resolution)) {
    console.warn(`[updateIcpFromChat] refusing write — ICP unresolved (${resolution.reason})`);
    return { status: 'unresolved', reason: resolution.reason };
  }

  const { icpId } = resolution;
  const authoritative = resolution.profile || {};
  const normalized = normalizeIcpParams(icpDelta);

  let updatedIcpProfile;
  if (action === 'replace') {
    updatedIcpProfile = {
      ...authoritative,
      ...normalized,
      managedByBarry: true,
      updatedAt: new Date().toISOString(),
    };
  } else {
    // Merge: combine arrays and deduplicate, preserve existing weights and strategy.
    // The authoritative document is the merge base — the chat's view of the
    // profile is a projection and may be stale.
    const current = { ...(existingProfile || {}), ...authoritative };
    updatedIcpProfile = {
      ...current,
      industries: dedupe([...(current.industries || []), ...(normalized.industries || [])]),
      companySizes: dedupe([...(current.companySizes || []), ...(normalized.companySizes || [])]),
      locations: dedupe([...(current.locations || []), ...(normalized.locations || [])]),
      targetTitles: dedupe([...(current.targetTitles || []), ...(normalized.targetTitles || [])]),
      companyKeywords: dedupe([...(current.companyKeywords || []), ...(normalized.companyKeywords || [])]),
      managedByBarry: true,
      updatedAt: new Date().toISOString(),
    };
  }

  // Authoritative first, projection second. A projection must carry the
  // identity of the ICP it represents.
  await setDoc(doc(db, 'users', userId, 'icpProfiles', icpId), updatedIcpProfile);
  await setDoc(doc(db, 'users', userId, 'companyProfile', 'current'), {
    ...updatedIcpProfile,
    icpId,
    lastModified: Timestamp.now(),
  });

  return { ...updatedIcpProfile, icpId, status: 'resolved' };
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
