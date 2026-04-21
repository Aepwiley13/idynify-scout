import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_ICP_ID } from './reconSectionMap';

/**
 * Returns the active ICP profile ID for a user.
 * Queries icpProfiles where isActive:true and status:'active'.
 * Falls back to DEFAULT_ICP_ID if no active profile is found.
 */
export async function getActiveIcpId(userId) {
  try {
    const snap = await getDocs(query(
      collection(db, 'users', userId, 'icpProfiles'),
      where('isActive', '==', true),
      where('status', '==', 'active'),
      limit(1)
    ));
    return snap.empty ? DEFAULT_ICP_ID : snap.docs[0].id;
  } catch {
    return DEFAULT_ICP_ID;
  }
}
