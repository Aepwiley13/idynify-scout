import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCMJSaHTeNbNpAZO4Ap54QF93k-0UB-KAo",
  authDomain: "idynify-scout-dev.firebaseapp.com",
  projectId: "idynify-scout-dev",
  storageBucket: "idynify-scout-dev.firebasestorage.app",
  messagingSenderId: "263090641220",
  appId: "1:263090641220:web:57431871cdcb8d8382df110"
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