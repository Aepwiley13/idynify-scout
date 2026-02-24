/**
 * missionService.js — Phase 3 Service Layer
 *
 * Single point of contact for all mission-related Firebase operations.
 * When Missions is rebuilt, only this file changes. No UI components touch.
 */

import { db } from '../firebase/config';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';

/**
 * Fetch all active missions for a user.
 * Returns empty array (never throws) so callers handle UI gracefully.
 */
export async function getActiveMissions(userId) {
  try {
    const missionsRef = collection(db, 'users', userId, 'missions');
    const q = query(missionsRef, where('status', '==', 'active'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[missionService] getActiveMissions error:', err);
    return [];
  }
}

/**
 * Assign a company to an existing mission.
 * Adds companyId to mission's targetCompanyIds array (no duplicates via arrayUnion).
 */
export async function assignCompanyToMission(userId, companyId, missionId) {
  try {
    const missionRef = doc(db, 'users', userId, 'missions', missionId);
    await updateDoc(missionRef, {
      targetCompanyIds: arrayUnion(companyId),
      updatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    console.error('[missionService] assignCompanyToMission error:', err);
    return { success: false, error: err.message };
  }
}
