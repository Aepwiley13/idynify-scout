// The app's Firebase, pointed at the local emulators (project demo-contact-hub).
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
const app = initializeApp({ apiKey: 'demo-key', authDomain: 'demo-contact-hub.firebaseapp.com', projectId: 'demo-contact-hub', appId: 'demo-app' });
export const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
export const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
export const storage = {};
export default app;
