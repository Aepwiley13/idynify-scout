import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBIEgry651JflumoZ9Ir24I6G5QWryX1F4",
  authDomain: "idynify-icp.firebaseapp.com",
  projectId: "idynify-icp",
  storageBucket: "idynify-icp.firebasestorage.app",
  messagingSenderId: "828638115993",
  appId: "1:828638115993:web:837f6dc6ac81828f6b2008"
};

console.log('Testing Firebase...');
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Try creating a test account
createUserWithEmailAndPassword(auth, 'test@example.com', 'password123')
  .then(() => console.log('✅ SUCCESS! Firebase auth works!'))
  .catch(err => console.error('❌ Error:', err.code, err.message));