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
 *
 * ── companyKeywords is sanitized at this boundary, not just at extraction ──
 * The reclarification prompt that produces `icpDelta` here (barryMissionChat
 * .js's ICP reclarification path) has no connection to the from-scratch
 * extraction's own validation — and even if it did, `action === 'add'` unions
 * the incoming value onto whatever the existing profile already has, so a
 * clean new delta is not enough: an invalid value written before validation
 * existed (or by a path that still lacks it) survives a union forever,
 * because a union never subtracts. Both sides of the merge are sanitized
 * before combining, via the one shared implementation in
 * src/utils/companyKeywordsResidue.js — not a second copy of the rule.
 */

import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { resolveActiveIcp, isResolved } from './resolveActiveIcp';
import { sanitizeCompanyKeywords } from './companyKeywordsResidue';

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

  let updatedIcpProfile;
  if (action === 'replace') {
    // Replace keeps its existing field-selection rule exactly as it was —
    // the delta's value wins when supplied, the old value survives when the
    // field is omitted. What changes is that whichever value is actually
    // chosen is sanitized before it is written, so an explicit [] still
    // clears an old invalid value (sanitizeCompanyKeywords([]) is []) and an
    // omitted field no longer carries a stale invalid value through
    // untouched.
    const chosenCompanyKeywords = icpDelta.companyKeywords !== undefined
      ? icpDelta.companyKeywords
      : authoritative.companyKeywords;
    updatedIcpProfile = {
      ...authoritative,
      ...icpDelta,
      companyKeywords: sanitizeCompanyKeywords(chosenCompanyKeywords || []),
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
      industries: dedupe([...(current.industries || []), ...(icpDelta.industries || [])]),
      companySizes: dedupe([...(current.companySizes || []), ...(icpDelta.companySizes || [])]),
      locations: dedupe([...(current.locations || []), ...(icpDelta.locations || [])]),
      targetTitles: dedupe([...(current.targetTitles || []), ...(icpDelta.targetTitles || [])]),
      // Both sides sanitized before the union — see the file header. An add
      // can only ever grow this list, so a value that survives sanitization
      // here survives forever; an invalid value must never be one of them.
      companyKeywords: dedupe([
        ...sanitizeCompanyKeywords(current.companyKeywords || []),
        ...sanitizeCompanyKeywords(icpDelta.companyKeywords || []),
      ]),
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
