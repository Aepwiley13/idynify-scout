/**
 * verifyAuthToken.js — Shared auth verification for Netlify Functions.
 *
 * Uses Firebase Admin SDK instead of the Identity Toolkit REST endpoint so we can:
 *   1. Avoid requiring FIREBASE_API_KEY as a separate server-side env var (it's a
 *      build-time VITE_ var that is NOT available in the functions runtime).
 *   2. Support admin impersonation: when an admin calls a user-scoped function on
 *      behalf of an impersonated user, the auth token belongs to the admin while
 *      `userId` in the request body refers to the impersonated user. This is valid
 *      and should be allowed.
 *
 * @param {string} authToken - Firebase ID token from the client
 * @param {string} userId    - The target user UID the caller claims to act as
 * @returns {{ tokenUserId: string }} Resolved token UID (admin or user)
 * @throws {Error} If the token is invalid or userId mismatch cannot be justified
 */

import { admin } from '../firebase-admin.js';
import { checkAdminAccess } from './adminAuth.js';

export async function verifyAuthToken(authToken, userId) {
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(authToken);
  } catch (err) {
    throw new Error('Invalid authentication token');
  }

  const tokenUserId = decodedToken.uid;

  // Normal case: the token belongs to the acting user
  if (tokenUserId === userId) {
    return { tokenUserId };
  }

  // Mismatch — only permit if the token holder is an admin (impersonation flow)
  const isAdmin = await checkAdminAccess(tokenUserId);
  if (!isAdmin) {
    throw new Error('Token does not match user ID');
  }

  console.log(`🔑 Impersonation verified: admin ${tokenUserId} acting as user ${userId}`);
  return { tokenUserId };
}
