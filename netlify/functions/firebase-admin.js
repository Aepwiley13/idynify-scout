/**
 * Firebase Admin SDK Initialization
 *
 * Shared Firebase Admin instance for all Netlify Functions.
 * Initializes once and exports for reuse across functions.
 */

import process from 'node:process';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { requireProjectId } from './utils/firebaseEnv.js';
import { wantsApplicationDefaultCredentials } from './utils/adminCredential.js';

// Local staging QA only: short-lived credentials, no key, and only when
// FIREBASE_ADMIN_CREDENTIALS=application-default (utils/adminCredential.js).
// Nothing deployed sets it, so the block below runs exactly as before.
if (getApps().length === 0 && wantsApplicationDefaultCredentials(process.env)) {
  initializeApp({ credential: applicationDefault(), projectId: requireProjectId() });
}

// Test runs against the Firestore emulator (billing hardening PR 1's integration suite,
// `firebase emulators:exec` sets this). The emulator doesn't check credentials — only a
// project id is needed, never real service-account values. A separate, earlier guard
// (not nested inside the block below) so that block stays byte-for-byte the original
// deployed path — asserted directly by src/test/adminCredential.test.js.
if (getApps().length === 0 && process.env.FIRESTORE_EMULATOR_HOST) {
  initializeApp({ projectId: requireProjectId() });
}

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: requireProjectId(),
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
