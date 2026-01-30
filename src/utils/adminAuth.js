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
 * @param {object} options - Optional pagination options { limit, cursor }
 * @returns {Promise<object>} - Users data and platform stats
 */
export async function fetchAllUsers(userId, authToken, options = {}) {
  // Use environment variable for admin API base URL
  const adminApiBase = import.meta.env.VITE_ADMIN_API_BASE;

  if (!adminApiBase) {
    throw new Error('VITE_ADMIN_API_BASE environment variable not configured');
  }

  const endpoint = `${adminApiBase}/adminGetUsers`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      userId,
      ...options // Include limit and cursor if provided (for future pagination)
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch users');
  }

  return await response.json();
}

/**
 * Fetch API logs for admin dashboard
 *
 * @param {string} userId - Admin user ID
 * @param {string} authToken - Firebase auth token
 * @param {object} filters - Optional filters { startDate, endDate, endpoint, userId, environment }
 * @returns {Promise<object>} - API logs data
 */
export async function fetchApiLogs(userId, authToken, filters = {}) {
  const adminApiBase = import.meta.env.VITE_ADMIN_API_BASE;

  if (!adminApiBase) {
    throw new Error('VITE_ADMIN_API_BASE environment variable not configured');
  }

  const endpoint = `${adminApiBase}/adminGetApiLogs`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      userId,
      filters
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch API logs');
  }

  return await response.json();
}
