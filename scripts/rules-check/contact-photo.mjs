// Run with FIRESTORE_EMULATOR_HOST and a demo project from the repository root.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-contact-photo';
const requireFromRepo = createRequire(resolve('package.json'));
const { initializeApp, deleteApp } = requireFromRepo('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = requireFromRepo('firebase-admin/firestore');
const { createContactPhotoWriter } = await import(pathToFileURL(resolve('netlify/functions/utils/contactPhotoWriter.js')));
const app = initializeApp({ projectId }, 'contact-photo-rules-test');
const adminDb = getFirestore(app);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const person = 'users/owner/contacts/c1';
const photo = person + '/private/photo';
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/owner'), { name: 'Owner' });
    await setDoc(doc(db, 'users/deleted/contacts/c1'), { name: 'Orphaned account contact' });
    await setDoc(doc(db, 'users/deleted/contacts/c1/private/photo'), { kind: 'hidden' });
    await setDoc(doc(db, person), { name: 'Fixture', contact_hub_photo: 'hidden' });
    await setDoc(doc(db, photo), { kind: 'hidden' });
    await setDoc(doc(db, 'users/owner/contacts/c2'), { name: 'Other fixture' });
    const ordinary = writeBatch(db);
    for (let index = 0; index < 25; index++) ordinary.set(doc(db, `users/owner/contacts/bulk-${index}`), { name: 'Ordinary' });
    await ordinary.commit();
    await setDoc(doc(db, 'users/owner/contacts/orphan/private/photo'), { kind: 'hidden' });
  });
  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();
  const signedOut = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(owner, photo)));
  await assertFails(getDoc(doc(other, photo)));
  await assertFails(getDoc(doc(signedOut, photo)));
  await assertFails(getDoc(doc(env.authenticatedContext('deleted').firestore(), 'users/deleted/contacts/c1/private/photo')));
  await assertFails(getDoc(doc(owner, 'users/owner/contacts/orphan/private/photo')));
  await assertFails(getDocs(collection(owner, person + '/private')));
  await assertFails(setDoc(doc(owner, photo), { kind: 'upload', jpeg: 'bad' }));
  await assertFails(updateDoc(doc(owner, photo), { kind: 'url' }));
  await assertFails(deleteDoc(doc(owner, photo)));
  await assertFails(setDoc(doc(owner, photo + '/anything/else'), { kind: 'hidden' }));
  await assertFails(setDoc(doc(owner, 'users/owner/contacts/c2/private/photo'), { kind: 'hidden' }));
  await assertFails(updateDoc(doc(owner, person), { contact_hub_photo: 'custom' }));
  await assertFails(setDoc(doc(owner, 'users/owner/contacts/c3'), { contact_hub_photo: 'hidden' }));
  await assertSucceeds(updateDoc(doc(owner, person), { name: 'Changed' }));
  await assertSucceeds(setDoc(doc(owner, person + '/timeline/event'), { type: 'note_added' }));
  await assertFails(deleteDoc(doc(owner, person)));
  const batch = writeBatch(owner);
  batch.delete(doc(owner, person));
  batch.delete(doc(owner, 'users/owner/contacts/c2'));
  await assertFails(batch.commit());
  assert.equal((await getDoc(doc(owner, 'users/owner/contacts/c2'))).exists(), true);
  await assertSucceeds(deleteDoc(doc(owner, 'users/owner/contacts/c2')));
  const ordinary = writeBatch(owner);
  for (let index = 0; index < 25; index++) ordinary.delete(doc(owner, `users/owner/contacts/bulk-${index}`));
  await assertSucceeds(ordinary.commit());
  await env.withSecurityRulesDisabled(async (context) => {
    const trusted = context.firestore();
    const cleanup = writeBatch(trusted);
    cleanup.delete(doc(trusted, photo));
    cleanup.delete(doc(trusted, person));
    await cleanup.commit();
    assert.equal((await getDoc(doc(trusted, photo))).exists(), false);
  });
  const contact = adminDb.doc('users/owner/contacts/race');
  const override = contact.collection('private').doc('photo');
  await contact.set({ name: 'Concurrent fixture', photo_url: 'https://example.test/original.jpg' });
  const writer = createContactPhotoWriter({
    db: adminDb, enabled: () => true, now: Date.now, verifyToken: async () => ({ uid: 'owner' }),
    timestampAfter: (previous) => Timestamp.fromMillis(Math.max(Date.now(), previous ? Math.floor(previous.toMillis()) + 1 : 0)),
    deleteField: () => FieldValue.delete(),
  });
  const write = (expectedVersion, kind = 'hidden') => writer({
    httpMethod: 'POST', headers: { authorization: 'Bearer fixture-token' },
    body: JSON.stringify({ uid: 'owner', contactId: 'race', expectedVersion,
      photo: kind === 'hidden' ? { kind } : { kind, url: 'https://example.test/new.jpg' } }),
  });
  const peers = await Promise.all([write(null), write(null, 'url')]);
  assert.deepEqual(peers.map((entry) => entry.statusCode).sort(), [200, 409]);
  const saved = JSON.parse(peers.find((entry) => entry.statusCode === 200).body);
  const [writeDuringDeletion] = await Promise.all([
    write(saved.version),
    adminDb.runTransaction(async (tx) => {
      await tx.get(contact);
      tx.delete(override);
      tx.delete(contact);
    }),
  ]);
  assert.ok([200, 404].includes(writeDuringDeletion.statusCode), writeDuringDeletion.body);
  assert.equal((await override.get()).exists, false);
  assert.equal((await contact.get()).exists, false);

  const account = adminDb.doc('users/purge-fixture');
  const purgePhoto = account.collection('contacts').doc('c1').collection('private').doc('photo');
  await account.set({ name: 'Purge fixture' });
  await purgePhoto.set({ kind: 'hidden' });
  await adminDb.recursiveDelete(account);
  assert.equal((await purgePhoto.get()).exists, false);
  console.log('Contact photo rules, concurrent writes, and deletion invariants passed.');
} finally {
  await env.cleanup();
  await deleteApp(app);
}
