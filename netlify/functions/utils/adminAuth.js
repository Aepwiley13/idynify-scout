/**
 * Admin Authentication Utilities
 *
 * Shared utilities for checking admin access across all admin functions.
 */

import { db } from '../firebase-admin.js';

/**
 * Check if a user has admin access
 *
 * Checks both:
 * 1. ADMIN_USER_IDS environment variable (comma-separated list)
 * 2. Firestore users/{userId} document with role === 'admin'
 *
 * @param {string} userId - The Firebase Auth UID to check
 * @returns {Promise<boolean>} - True if user has admin access
 */
export async function checkAdminAccess(userId) {
  if (!userId) {
    return false;
  }

  // Check environment variable for admin user IDs
  const adminUserIds = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (adminUserIds.includes(userId)) {
    console.log('🔑 Admin access granted via ADMIN_USER_IDS env var');
    return true;
  }

  // Check Firestore for admin role
  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (userDoc.exists) {
      const userData = userDoc.data();
      const role = userData.role;

      if (role === 'admin') {
        console.log('🔑 Admin access granted via Firestore role');
        return true;
      }
    }
  } catch (error) {
    console.error('⚠️ Error checking Firestore for admin role:', error);
    // Don't throw - fail closed (return false)
  }

  console.log('❌ Admin access denied for user:', userId);
  return false;
}
