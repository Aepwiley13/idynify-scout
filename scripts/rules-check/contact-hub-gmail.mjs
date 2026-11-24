// Verify that client rules cannot access the server-only Gmail credentials or ledger.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-contact-hub-gmail',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
});
const records = [
  'contact_hub_gmail/owner',
  'contact_hub_gmail_oauth/completion',
  'contact_hub_gmail_limits/owner',
  'contact_hub_gmail_limits/owner/attempts/attempt',
];

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/owner'), { name: 'Fixture owner' });
    for (const path of records) await setDoc(doc(db, path), { fixture: true });
  });

  for (const context of [env.authenticatedContext('owner'), env.authenticatedContext('other'), env.unauthenticatedContext()]) {
    const db = context.firestore();
    for (const path of records) {
      const ref = doc(db, path);
      await assertFails(getDoc(ref));
      await assertFails(getDocs(collection(db, path.split('/').slice(0, -1).join('/'))));
      await assertFails(setDoc(ref, { fixture: false }));
      await assertFails(deleteDoc(ref));
    }
  }
  console.log('Contact Hub Gmail rules: 48 client denials verified.');
} finally {
  await env.cleanup();
}
