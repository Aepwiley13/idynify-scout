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
const { createContactHubDelete } = await import(pathToFileURL(resolve('netlify/functions/utils/contactHubDelete.js')));
const { appendContactChild, deletedContactRef } = await import(pathToFileURL(resolve('netlify/functions/utils/contactWriteLifecycle.js')));
const remove = createContactHubDelete({ db: adminDb, verifyToken: async () => ({ uid: 'owner' }) });
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
  await assertFails(setDoc(doc(owner, 'users/owner/contacts/missing/timeline/event'), { type: 'note_added' }));
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
  const queue = adminDb.doc('users/owner/nbs_queue/delete-race');
  await queue.set({ contact_id: 'race' });
  const [writeDuringDeletion, deletion] = await Promise.all([
    write(saved.version),
    remove({ httpMethod: 'POST', headers: { authorization: 'Bearer owner' },
      body: JSON.stringify({ uid: 'owner', contactIds: ['race'] }) }),
    appendContactChild(adminDb, contact, 'timeline', { type: 'email_opened' }),
  ]);
  assert.equal(JSON.parse(deletion.body).results[0].status, 'deleted');
  assert.equal((await queue.get()).exists, false);
  assert.equal((await contact.collection('timeline').get()).empty, true);
  assert.equal(await appendContactChild(adminDb, contact, 'barry_drafts', { queued: true }), null);
  const deletionMarker = deletedContactRef(adminDb, 'owner', 'race');
  assert.equal((await deletionMarker.get()).exists, true);
  await assertFails(getDoc(doc(owner, deletionMarker.path)));
  await assertFails(setDoc(doc(owner, deletionMarker.path), { deleted: false }));
  await assertFails(setDoc(doc(owner, contact.path + '/timeline/late-event'), { type: 'note_added' }));
  assert.ok([200, 404].includes(writeDuringDeletion.statusCode), writeDuringDeletion.body);
  assert.equal((await override.get()).exists, false);
  assert.equal((await contact.get()).exists, false);

  const { createContactMerge } = await import(pathToFileURL(resolve('netlify/functions/utils/contactMerge.js')));
  const merge = createContactMerge({
    db: adminDb, verifyToken: async () => ({ uid: 'owner' }),
    secret: () => 'isolated-firestore-test-secret-777', enabled: () => true, executionEnabled: () => true,
    timestamp: () => Timestamp.now(),
  });
  const survivor = adminDb.doc('users/owner/contacts/merge-survivor');
  const duplicate = adminDb.doc('users/owner/contacts/merge-source');
  const pair = { uid: 'owner', survivorId: survivor.id, sourceId: duplicate.id, choices: {},
    operationId: 'd0a7a553-7e3f-4a3d-8b89-ae7f9652fb89' };
  const mergeRequest = async (action, fields = {}) => {
    const response = await merge({ httpMethod: 'POST', headers: { authorization: 'Bearer owner' },
      body: JSON.stringify({ ...pair, ...fields, action }) });
    return { status: response.statusCode, ...JSON.parse(response.body) };
  };
  await Promise.all([
    survivor.set({ name: 'Synthetic Merge', email: 'merge@example.test' }),
    duplicate.set({ name: 'Synthetic Merge', email: 'merge@example.test' }),
  ]);
  let proposed = await mergeRequest('preview');
  assert.ok(proposed.token, JSON.stringify(proposed));
  await appendContactChild(adminDb, duplicate, 'timeline', { type: 'note_added' });
  assert.equal((await mergeRequest('commit', { token: proposed.token })).error, 'preview_changed');
  proposed = await mergeRequest('preview');
  const committed = await mergeRequest('commit', { token: proposed.token });
  assert.equal(committed.receipt?.status, 'merged', JSON.stringify(committed));
  await assertFails(updateDoc(doc(owner, duplicate.path), { name: 'Late edit' }));
  await assertFails(setDoc(doc(owner, duplicate.path + '/timeline/late-merge-event'), { type: 'note_added' }));
  assert.equal(await appendContactChild(adminDb, duplicate, 'timeline', { type: 'email_opened' }), null);
  const deletionResult = await remove({ httpMethod: 'POST', headers: { authorization: 'Bearer owner' },
    body: JSON.stringify({ uid: 'owner', contactIds: [duplicate.id] }) });
  assert.equal(JSON.parse(deletionResult.body).results[0].status, 'contact_retired');
  const reverse = await mergeRequest('preview_rollback');
  assert.ok(reverse.token, JSON.stringify(reverse));
  assert.equal((await mergeRequest('rollback', { token: reverse.token })).receipt?.status, 'rolled_back');
  const fresh = await mergeRequest('preview');
  const [racingMerge, racingPhoto] = await Promise.all([
    mergeRequest('commit', { operationId: '018ce2e2-4c0c-4f6d-be3c-75f9c4562f89', token: fresh.token }),
    writer({ httpMethod: 'POST', headers: { authorization: 'Bearer owner' }, body: JSON.stringify({
      uid: 'owner', contactId: duplicate.id, expectedVersion: null, photo: { kind: 'hidden' },
    }) }),
  ]);
  if (racingMerge.receipt?.status === 'merged') {
    assert.equal(racingPhoto.statusCode, 409);
    assert.equal((await duplicate.collection('private').doc('photo').get()).exists, false);
  } else {
    assert.equal(racingPhoto.statusCode, 200, racingPhoto.body);
    assert.ok(['merge_blocked', 'preview_changed'].includes(racingMerge.error), JSON.stringify(racingMerge));
    assert.equal((await duplicate.collection('private').doc('photo').get()).exists, true);
  }
  const c = adminDb.doc('users/owner/contacts/relationship-survivor');
  const d = adminDb.doc('users/owner/contacts/relationship-source');
  const due = '2030-01-01T12:00:00.000Z';
  const step = (id, action) => ({ id, action, type: 'follow_up', status: 'confirmed', user_confirmed: true,
    due_at: due, metadata: { source: 'contact_hub' } });
  const stepA = step('fixture-queue-a', 'Call Jordan');
  const stepB = step('fixture-queue-b', 'Send the event details');
  const qa = adminDb.doc('users/owner/nbs_queue/' + stepA.id);
  const qb = adminDb.doc('users/owner/nbs_queue/' + stepB.id);
  const photoA = c.collection('private').doc('photo');
  const photoB = d.collection('private').doc('photo');
  const oldA = { kind: 'hidden', updatedAt: Timestamp.fromMillis(100) };
  const oldB = { kind: 'url', url: 'https://example.test/fixture.jpg', updatedAt: Timestamp.fromMillis(200) };
  const base = { name: 'Synthetic Relationship', email: 'synthetic@example.test', next_step_due: due, next_step_type: 'follow_up' };
  const makeQueue = (row, ownerId) => ({ contact_id: ownerId, contact_name: base.name, nbs: row, status: 'confirmed', due_at: due });
  await Promise.all([
    c.set({ ...base, emails: [base.email, 'first@example.test'], phone: '8015550101', sticker_ids: ['a'],
      sticker_assignments: { a: { assigned_by: 'manual' } }, notes: [{ id: 'a', content: 'First note' }], source: 'manual',
      contact_hub_photo: 'hidden', next_best_step: stepA }),
    d.set({ ...base, emails: [base.email, 'second@example.test'], phone: '8015550102', sticker_ids: ['b'],
      sticker_assignments: { b: { assigned_by: 'manual' } }, notes: [{ id: 'b', content: 'Second note' }], source: 'csv_import',
      contact_hub_photo: 'custom', next_best_step: stepB }),
    c.collection('timeline').doc('note').set({ type: 'note_added', preview: 'first' }),
    d.collection('timeline').doc('note').set({ type: 'message_sent', preview: 'second' }),
    photoA.set(oldA), photoB.set(oldB), qa.set(makeQueue(stepA, c.id)), qb.set(makeQueue(stepB, d.id)),
    adminDb.doc('emailSuppressionList/second@example.test').set({ reason: 'unsubscribe' }),
  ]);
  const complex = { survivorId: c.id, sourceId: d.id, operationId: 'b81cb80a-4ca2-4bb3-9461-927db498df00',
    choices: { primary_phone: 1, photo_display: 1, active_reminder: 1 } };
  const relationshipPreview = await mergeRequest('preview', complex);
  assert.ok(relationshipPreview.token, JSON.stringify(relationshipPreview));
  assert.deepEqual(relationshipPreview.combined.suppressedEmails, ['second@example.test']);
  const relationshipCommit = await mergeRequest('commit', { ...complex, token: relationshipPreview.token });
  assert.equal(relationshipCommit.receipt?.status, 'merged', JSON.stringify(relationshipCommit));
  const combined = (await c.get()).data();
  assert.equal(combined.emails.length, 3);
  assert.equal(combined.phones.length, 2);
  assert.deepEqual(combined.sticker_ids, ['a', 'b']);
  assert.deepEqual(combined.identity_sources, ['manual', 'csv_import']);
  assert.equal(combined.notes.length, 2);
  assert.equal((await c.collection('timeline').get()).size, 2);
  assert.equal(combined.next_best_step.id, stepB.id);
  assert.equal((await qa.get()).data().nbs.disposition, 'superseded_by_merge');
  assert.equal((await qb.get()).data().contact_id, c.id);
  assert.equal((await photoA.get()).data().url, oldB.url);
  assert.equal((await photoB.get()).data().url, oldB.url);
  const backup = adminDb.doc(`contact_hub_merges/owner/operations/${complex.operationId}/photo/survivor`);
  assert.deepEqual((await backup.get()).data(), oldA);
  const relationshipUndo = await mergeRequest('preview_rollback', complex);
  assert.ok(relationshipUndo.token, JSON.stringify(relationshipUndo));
  const undone = await mergeRequest('rollback', { ...complex, token: relationshipUndo.token });
  assert.equal(undone.receipt?.status, 'rolled_back', JSON.stringify(undone));
  assert.deepEqual((await photoA.get()).data(), oldA);
  assert.equal((await qa.get()).data().status, 'confirmed');
  assert.equal((await qb.get()).data().contact_id, d.id);
  assert.equal((await c.collection('timeline').get()).size, 1);
  assert.equal((await backup.get()).exists, false);
  console.log('Synthetic relationship merge and rollback passed: 3 emails, 2 phones, 2 stickers, 2 notes, 2 Activity rows, private photo provenance, both reminder queue rows and an authoritative opt-out.');
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
