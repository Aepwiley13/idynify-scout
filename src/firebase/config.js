import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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