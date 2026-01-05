import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Check if a user is an admin
 * Checks both environment variable (ADMIN_USER_IDS) and Firestore role
 *
 * @param {string} uid - User ID to check
 * @returns {Promise<boolean>} - True if user is admin
 */
export async function isUserAdmin(uid) {
  if (!uid) return false;

  try {
    // Check Firestore for admin role
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
      const role = userDoc.data().role;
      if (role === 'admin') {
        return true;
      }
    }

    // Note: Environment variable check happens server-side only
    // Client-side can only check Firestore
    return false;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Fetch all users data for admin dashboard
 *
 * @param {string} userId - Admin user ID
 * @param {string} authToken - Firebase auth token
 * @returns {Promise<object>} - Users data and platform stats
 */
export async function fetchAllUsers(userId, authToken) {
  const response = await fetch('/.netlify/functions/admin-get-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, authToken })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch users');
  }

  return await response.json();
}
