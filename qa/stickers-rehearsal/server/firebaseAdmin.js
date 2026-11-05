// netlify/functions/firebase-admin.js, pointed at the local emulators.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ projectId: 'demo-contact-hub' });
const authInstance = getAuth();
export const admin = { auth: () => authInstance };
export const db = getFirestore();
