/**
 * updateIcpFromChat.js — Write ICP changes from Barry dashboard chat to Firestore.
 *
 * Called by BarryChatPanel after the user confirms an ICP change (add or replace).
 * Merges or overwrites companyProfile/current based on the action.
 */

import { doc, setDoc, getDocs, collection, query, where, limit, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_ICP_ID } from './reconSectionMap';

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

  // Sync Barry's write-back to the ACTIVE icpProfiles document and keep the
  // bridge cache (companyProfile/current) in sync so all reads stay consistent.
  try {
    const icpSnap = await getDocs(
      query(
        collection(db, 'users', userId, 'icpProfiles'),
        where('isActive', '==', true),
        where('status', '==', 'active'),
        limit(1)
      )
    );

    // If no active profile found, fall back to the default profile doc
    const targetRef = icpSnap.empty
      ? doc(db, 'users', userId, 'icpProfiles', DEFAULT_ICP_ID)
      : icpSnap.docs[0].ref;
    const existing = icpSnap.empty ? {} : (icpSnap.docs[0].data() || {});

    const updatedIcpProfile = {
      ...existing,
      industries: newProfile.industries ?? existing.industries,
      companySizes: newProfile.companySizes ?? existing.companySizes,
      locations: newProfile.locations ?? existing.locations,
      targetTitles: newProfile.targetTitles ?? existing.targetTitles,
      companyKeywords: newProfile.companyKeywords ?? existing.companyKeywords,
      managedByBarry: true,
      updatedAt: new Date().toISOString(),
    };

    await setDoc(targetRef, updatedIcpProfile);
    await setDoc(profileRef, { ...updatedIcpProfile, lastModified: Timestamp.now() });
    return { ...updatedIcpProfile, lastModified: Timestamp.now() };
  } catch (syncErr) {
    console.warn('[updateIcpFromChat] icpProfiles sync failed (non-fatal):', syncErr.message);
  }

  return newProfile;
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
