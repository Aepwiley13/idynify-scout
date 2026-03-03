/**
 * updateIcpFromChat.js — Write ICP changes from Barry dashboard chat to Firestore.
 *
 * Called by BarryChatPanel after the user confirms an ICP change (add or replace).
 * Merges or overwrites companyProfile/current based on the action.
 */

import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Apply a confirmed ICP delta from Barry chat to companyProfile/current.
 *
 * @param {string} userId
 * @param {Object} icpDelta - New ICP fields extracted by Barry (icp_params shape)
 * @param {'add'|'replace'} action
 * @param {Object|null} existingProfile - Current companyProfile/current doc (for merge)
 * @returns {Promise<Object>} The new profile written to Firestore
 */
export async function updateIcpFromChat(userId, icpDelta, action, existingProfile) {
  const profileRef = doc(db, 'users', userId, 'companyProfile', 'current');

  let newProfile;

  if (action === 'replace') {
    newProfile = {
      ...icpDelta,
      managedByBarry: true,
      lastModified: Timestamp.now()
    };
  } else {
    // Merge: combine arrays and deduplicate, preserve existing weights and strategy
    const current = existingProfile || {};
    newProfile = {
      ...current,
      industries: dedupe([...(current.industries || []), ...(icpDelta.industries || [])]),
      companySizes: dedupe([...(current.companySizes || []), ...(icpDelta.companySizes || [])]),
      locations: dedupe([...(current.locations || []), ...(icpDelta.locations || [])]),
      targetTitles: dedupe([...(current.targetTitles || []), ...(icpDelta.targetTitles || [])]),
      companyKeywords: dedupe([...(current.companyKeywords || []), ...(icpDelta.companyKeywords || [])]),
      managedByBarry: true,
      lastModified: Timestamp.now()
    };
  }

  await setDoc(profileRef, newProfile);
  return newProfile;
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
