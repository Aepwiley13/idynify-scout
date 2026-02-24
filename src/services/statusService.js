/**
 * statusService.js — Phase 3 Service Layer
 *
 * Handles all company status updates in Firebase.
 * Generic updateCompanyStatus is available for future use.
 */

import { db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';

/**
 * Mark a company as deprioritized.
 * Moves it to LONG RANGE bucket in the prioritization engine.
 */
export async function deprioritizeCompany(userId, companyId) {
  return updateCompanyStatus(userId, companyId, 'deprioritized');
}

/**
 * Generic company status updater.
 * Safe to call for any status transition — current or future.
 */
export async function updateCompanyStatus(userId, companyId, status) {
  try {
    const companyRef = doc(db, 'users', userId, 'companies', companyId);
    await updateDoc(companyRef, {
      status,
      updatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    console.error('[statusService] updateCompanyStatus error:', err);
    return { success: false, error: err.message };
  }
}
