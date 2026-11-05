// Seeds the local emulators (project demo-contact-hub) with synthetic data only.
import { readFileSync } from 'node:fs';
import process from 'node:process';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');
const PROJECT = 'demo-contact-hub';
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
initializeApp({ projectId: PROJECT });
const auth = getAuth();
const db = getFirestore();
export const PASSWORD = 'Staging-QA-2026!';
const accounts = { 'qa-admin': 'admin', 'qa-beta': null, 'qa-user': null, 'qa-other': null };
for (const [uid, role] of Object.entries(accounts)) {
  await auth.createUser({ uid, email: `${uid}@example.test`, password: PASSWORD, displayName: uid });
  await db.doc(`users/${uid}`).set(role ? { email: `${uid}@example.test`, role } : { email: `${uid}@example.test` });
}
const csv = readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
let i = 0;
for (const [first, last, email, phone, org, title] of csv) {
  i += 1;
  const id = `c${String(i).padStart(2, '0')}`;
  await db.doc(`users/qa-beta/contacts/${id}`).set({
    name: `${first} ${last}`, first_name: first, last_name: last, email, email_normalized: email.toLowerCase(), phone,
    company_name: org, title, tags: i % 5 === 0 ? ['gala-2024'] : [], is_archived: i === 30, addedFrom: 'csv',
    addedAt: new Date(Date.UTC(2026, 9, 1 + (i % 28))).toISOString(), barryContext: { summary: 'synthetic' },
  });
}
for (const [n, name] of [[1, 'Olive Other'], [2, 'Otto Other'], [3, 'Oona Other']]) {
  await db.doc(`users/qa-other/contacts/o0${n}`).set({ name, email: `o${n}@example.test`, email_normalized: `o${n}@example.test`, is_archived: false, tags: [], addedAt: '2026-10-05T00:00:00Z', barryContext: { summary: 'synthetic' } });
}
await db.doc('feature_flags/stickers').set({ mode: process.argv[3] ?? 'beta' });
await db.doc('sticker_enrollment/qa-beta').set({ stage: 'beta' });
console.log(`seeded: 4 accounts, ${i} contacts for qa-beta (1 archived), 3 for qa-other, mode ${process.argv[3] ?? 'beta'}`);
process.exit(0);
