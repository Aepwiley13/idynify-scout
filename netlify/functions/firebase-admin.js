/**
 * Firebase Admin SDK Initialization
 *
 * Shared Firebase Admin instance for all Netlify Functions.
 * Initializes once and exports for reuse across functions.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
}

// Create auth instance
const authInstance = getAuth();

// Export admin object with auth() method for compatibility with new functions
export const admin = {
  auth: () => authInstance
};

export const db = getFirestore();
