/**
 * Firebase Admin SDK Initialization
 *
 * Shared Firebase Admin instance for all Netlify Functions.
 * Initializes once and exports for reuse across functions.
 */

import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { requireProjectId } from './utils/firebaseEnv.js';
import { adminAppOptions } from './utils/adminCredential.js';

// Initialize Firebase Admin (only once). The service account from
// FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY, unless local staging QA opts
// into short-lived credentials (utils/adminCredential.js).
if (getApps().length === 0) {
  initializeApp(adminAppOptions(process.env, { cert, applicationDefault, projectId: requireProjectId() }));
}

// Create auth instance
const authInstance = getAuth();

// Export admin object with auth() method for compatibility with new functions
export const admin = {
  auth: () => authInstance
};

export const db = getFirestore();
