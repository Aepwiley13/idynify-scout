/**
 * updateIcpFromChat.js — Write ICP changes from Barry dashboard chat to Firestore.
 *
 * Called by BarryChatPanel after the user confirms an ICP change (add or replace).
 * Merges or overwrites companyProfile/current based on the action.
 */

import { doc, setDoc, getDocs, collection, query, orderBy, limit, Timestamp } from 'firebase/firestore';
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

  // Sync to icpProfiles collection so Scout ICP Settings reflects Barry's update.
  // ICPSettings.jsx reads from icpProfiles; it only syncs the first (oldest) ICP
  // back to companyProfile/current on save, so we must write in both directions.
  try {
    const icpSnap = await getDocs(
      query(collection(db, 'users', userId, 'icpProfiles'), orderBy('createdAt', 'asc'), limit(1))
    );
    if (!icpSnap.empty) {
      const primaryDoc = icpSnap.docs[0];
      const existing = primaryDoc.data();
      await setDoc(primaryDoc.ref, {
        ...existing,
        industries: newProfile.industries ?? existing.industries,
        companySizes: newProfile.companySizes ?? existing.companySizes,
        locations: newProfile.locations ?? existing.locations,
        targetTitles: newProfile.targetTitles ?? existing.targetTitles,
        companyKeywords: newProfile.companyKeywords ?? existing.companyKeywords,
        managedByBarry: true,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (syncErr) {
    console.warn('[updateIcpFromChat] icpProfiles sync failed (non-fatal):', syncErr.message);
  }

  return newProfile;
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
