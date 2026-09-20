import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

/**
 * Firebase client config, read from the build environment.
 *
 * THE PROJECT IS NAMED `idynify-scout-dev` AND IT IS PRODUCTION. That name is
 * an accident of history, not a statement about the environment: there is one
 * Firebase project and it serves real customers. A branch deploy or deploy
 * preview that resolves to it reads and writes real customer data (ADR-006).
 *
 * These values used to be literals in this file, which meant every build —
 * production, branch deploy, preview, and any fork — pointed at that one
 * project with no way to redirect it and no signal that it had happened. The
 * values are not secret (a Firebase web config is shipped to every browser),
 * but being unconfigurable is the problem: you could not stand up staging
 * without editing source, and a preview could not be pointed away from
 * production even deliberately.
 *
 * VALIDATION HAPPENS AT BUILD TIME, not here. vite.config.js refuses to build
 * when any of these is missing, so a misconfigured environment fails the
 * Netlify build with the variable names printed. Throwing here instead would
 * move that failure into the browser, where the user gets a white screen and
 * the operator gets nothing — a broken build is strictly better than a broken
 * page. That is why this file does not check anything.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence so Firestore reads are served from the local
// IndexedDB cache when the device has no network (weak signal, elevator, etc.).
// Gracefully handles the two expected failure cases without crashing.
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open — only one tab can hold the IndexedDB lock at a time.
    console.warn('[Firestore] Offline persistence unavailable: multiple tabs open.');
  } else if (err.code === 'unimplemented') {
    // The browser doesn't support IndexedDB (rare on modern mobile browsers).
    console.warn('[Firestore] Offline persistence not supported in this browser.');
  }
});
