// Synthetic Contact Hub affiliation and trusted-merge acceptance against Firestore emulator.
// Run from repository root with demo-contact-hub-merge and an isolated emulator port.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-contact-hub-merge';
const requireFromRepo = createRequire(resolve('package.json'));
const { initializeApp, deleteApp } = requireFromRepo('firebase-admin/app');
const { getFirestore, Timestamp } = requireFromRepo('firebase-admin/firestore');
const { createContactAffiliationWriter } = await import(pathToFileURL(resolve('netlify/functions/utils/contactAffiliationWriter.js')));
const { createContactMerge } = await import(pathToFileURL(resolve('netlify/functions/utils/contactMerge.js')));
const app = initializeApp({ projectId }, 'contact-hub-merge-emulator-test');
const adminDb = getFirestore(app);
const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const uuid = () => crypto.randomUUID();
const event = (body, token = 'owner') => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const version = (snapshot) => `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;

try {
  await env.clearFirestore();
  await adminDb.doc('users/owner').set({ name: 'Synthetic Owner' });
  await adminDb.doc('users/other').set({ name: 'Other Synthetic Owner' });
  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();

  // Trusted affiliation writer: default-off flag, owner binding, impersonation,
  // stale versions, and server-owned primary projection.
  const affiliationRef = adminDb.doc('users/owner/contacts/affiliation-test');
  await affiliationRef.set({ name: 'Jordan Lee', title: 'Director', company_name: 'T-Mobile', company_id: 't-mobile' });
  const affiliations = [
    { id: 'legacy-director', organization_name: 'T-Mobile', company_id: 't-mobile', title: 'Director', type: 'Employment', status: 'current', primary: false, provenance: [{ source: 'business_card', contact_id: 'affiliation-test' }] },
    { id: uuid(), organization_name: 'Salt Lake Youth League', company_id: null, title: 'Basketball Coach', type: 'Volunteer', status: 'current', primary: true, provenance: [] },
  ];
  let affiliationEnabled = false;
  const affiliationWriter = createContactAffiliationWriter({
    db: adminDb,
    verifyToken: async (token) => ({ uid: token === 'other' ? 'other' : 'owner', firebase: { sign_in_provider: token === 'custom' ? 'custom' : 'password' } }),
    enabled: () => affiliationEnabled,
    timestamp: () => Timestamp.now(),
  });
  const staleBefore = version(await affiliationRef.get());
  const ownerArgs = { uid: 'owner', contactId: affiliationRef.id, expectedVersion: staleBefore, affiliations };
  assert.equal((await affiliationWriter(event(ownerArgs))).statusCode, 404, 'writer feature flag defaults off');
  affiliationEnabled = true;
  assert.equal((await affiliationWriter(event({ ...ownerArgs, uid: 'other' }))).statusCode, 403, 'cross-account body rejected');
  assert.equal((await affiliationWriter(event(ownerArgs, 'custom'))).statusCode, 403, 'custom/impersonation token rejected');
  assert.equal((await affiliationWriter(event({ ...ownerArgs, expectedVersion: '0:0' }))).statusCode, 409, 'stale version rejected');

  const directOwner = doc(owner, affiliationRef.path);
  const directOther = doc(other, affiliationRef.path);
  await assertSucceeds(getDoc(directOwner));
  await assertFails(getDoc(directOther));
  await assertFails(updateDoc(directOwner, { contact_affiliations: affiliations }));
  await assertFails(setDoc(doc(owner, 'users/owner/contacts/client-created-affiliations'), {
    name: 'Client attempt', contact_affiliations: affiliations,
  }));
  await assertFails(updateDoc(doc(other, 'users/other/contacts/affiliation-test'), { contact_affiliations: affiliations }));

  const activeSession = adminDb.doc('impersonationSessions/affiliation-write-denial');
  await activeSession.set({ adminUserId: 'owner', status: 'active', expiresAt: Timestamp.fromMillis(Date.now() + 60_000) });
  assert.equal((await affiliationWriter(event(ownerArgs))).statusCode, 403, 'active admin impersonation is read-only');
  await activeSession.delete();
  const saved = await affiliationWriter(event(ownerArgs));
  assert.equal(saved.statusCode, 200, saved.body);
  const persistedAffiliations = (await affiliationRef.get()).data();
  assert.equal(persistedAffiliations.contact_affiliations.length, 2);
  assert.deepEqual([persistedAffiliations.title, persistedAffiliations.company_name, persistedAffiliations.company_id],
    ['Basketball Coach', 'Salt Lake Youth League', null]);
  assert.equal(persistedAffiliations.contact_affiliations.find((row) => row.primary).id, affiliations[1].id);
  assert.equal(persistedAffiliations.contact_affiliations[1].provenance[0].source, 'user');

  // Real Firestore transaction: additive facts, source lineage, retirement fence,
  // rollback of both contacts and relationship records, with execution flag closed.
  let executionEnabled = false;
  const merge = createContactMerge({
    db: adminDb,
    verifyToken: async (token) => ({ uid: token === 'other' ? 'other' : 'owner', firebase: { sign_in_provider: token === 'custom' ? 'custom' : 'password' } }),
    secret: () => 'synthetic-contact-hub-emulator-secret-at-least-32',
    enabled: () => true,
    executionEnabled: () => executionEnabled,
    inspectCollections: async (ref) => (await ref.listCollections()).map((collection) => collection.id),
    timestamp: () => Timestamp.now(),
  });
  const survivorRef = adminDb.doc('users/owner/contacts/merge-survivor');
  const sourceRef = adminDb.doc('users/owner/contacts/merge-source');
  const survivorOriginal = {
    name: 'Jordan Lee', email: 'jordan.work@example.test',
    emails: [{ id: 'work', value: 'jordan.work@example.test', label: 'work', labelSource: 'card' }],
    phones: [{ id: 'mobile', value: '801-555-0101', label: 'mobile', labelSource: 'user' }], phone: '801-555-0101',
    sticker_ids: ['SYNTH-A', 'SYNTH-B'],
    sticker_assignments: { 'SYNTH-A': { assigned_by: 'owner', assigned_at: 'synthetic-a' }, 'SYNTH-B': { assigned_by: 'csv_import', assigned_at: 'synthetic-b' } },
    contact_affiliations: [{ id: 'director', organization_name: 'T-Mobile', company_id: 't-mobile', title: 'Director', type: 'Employment', status: 'current', primary: true, provenance: [{ source: 'business_card', contact_id: 'merge-survivor' }] }],
    notes: [{ id: 'note-a', content: 'Discussed networking event' }], source: 'business_card', identity_sources: ['business_card'],
    photo_url: 'https://photos.example.test/original.jpg', photo_source: 'imported_business_card',
  };
  const sourceOriginal = {
    name: 'Jordan Lee', email: 'jordan.personal@example.test',
    emails: [
      { id: 'shared-work', value: 'jordan.work@example.test', label: 'professional', labelSource: 'community_import' },
      { id: 'personal', value: 'jordan.personal@example.test', label: 'personal', labelSource: 'user' },
    ],
    phones: [
      { id: 'shared-phone', value: '801-555-0101', label: 'direct', labelSource: 'card' },
      { id: 'home', value: '801-555-0102', label: 'home', labelSource: 'user' },
    ], phone: '801-555-0102',
    sticker_ids: ['SYNTH-C', 'SYNTH-D'],
    sticker_assignments: { 'SYNTH-C': { assigned_by: 'owner', assigned_at: 'synthetic-c' }, 'SYNTH-D': { assigned_by: 'csv_import', assigned_at: 'synthetic-d' } },
    contact_affiliations: [{ id: 'coach', organization_name: 'Salt Lake Youth League', company_id: null, title: 'Basketball Coach', type: 'Volunteer', status: 'current', primary: true, provenance: [{ source: 'community_import', contact_id: 'merge-source' }] }],
    notes: [{ id: 'note-b', content: 'Coaches youth basketball' }], source: 'community_import', identity_sources: ['community_import'],
    photo_url: 'https://photos.example.test/youth.jpg', photo_source: 'community_import',
  };
  await Promise.all([
    survivorRef.set(survivorOriginal), sourceRef.set(sourceOriginal),
    survivorRef.collection('timeline').doc('call-a').set({ type: 'outreach_logged', preview: 'Call about the event' }),
    sourceRef.collection('timeline').doc('meeting-b').set({ type: 'outreach_logged', preview: 'Youth league meeting' }),
  ]);
  const operationId = uuid();
  const pair = { uid: 'owner', survivorId: survivorRef.id, sourceId: sourceRef.id, operationId,
    choices: { original_photo: 0, primary_email: 1, primary_phone: 1 } };
  const request = async (action, fields = {}, token = 'owner') => {
    const response = await merge(event({ ...pair, ...fields, action }, token));
    return { statusCode: response.statusCode, ...JSON.parse(response.body) };
  };
  assert.equal((await request('preview', {}, 'other')).statusCode, 403, 'foreign owner cannot preview this account');
  assert.equal((await request('preview', {}, 'custom')).statusCode, 403, 'custom auth cannot merge');
  const preview = await request('preview');
  assert.equal(preview.statusCode, 200);
  assert.ok(preview.token, JSON.stringify(preview));
  assert.equal(preview.combined.emails.length, 2);
  assert.deepEqual(preview.combined.emails.map((row) => row.label).sort(), ['personal', 'work']);
  assert.equal(preview.combined.sourceHistory.find((row) => row.contact_id === sourceRef.id)
    .email_facts.find((row) => row.value === 'jordan.work@example.test').label, 'professional');
  assert.equal(preview.combined.phones.length, 2);
  assert.deepEqual(preview.combined.phones.map((row) => row.label).sort(), ['home', 'mobile']);
  assert.equal(preview.combined.sourceHistory.find((row) => row.contact_id === sourceRef.id)
    .phone_facts.find((row) => row.value === '801-555-0101').label, 'direct');
  assert.deepEqual(preview.combined.stickers.map((row) => row.id).sort(), ['SYNTH-A', 'SYNTH-B', 'SYNTH-C', 'SYNTH-D']);
  assert.equal(preview.combined.affiliations.length, 2);
  assert.deepEqual(preview.combined.sourceHistory.map((row) => row.source).sort(), ['business_card', 'community_import']);

  const disabledCommit = await request('commit', { token: preview.token });
  assert.equal(disabledCommit.statusCode, 403, 'merge execution flag stays closed');
  assert.equal((await survivorRef.get()).data().contact_affiliations.length, 1, 'preview and denied commit are read-only');

  executionEnabled = true;
  const currentPreview = await request('preview');
  const commit = await request('commit', { token: currentPreview.token });
  assert.equal(commit.receipt?.status, 'merged', JSON.stringify(commit));
  const survivor = (await survivorRef.get()).data();
  assert.deepEqual(survivor.emails.map((row) => row.value).sort(), ['jordan.personal@example.test', 'jordan.work@example.test']);
  assert.deepEqual(survivor.phones.map((row) => row.value).sort(), ['801-555-0101', '801-555-0102']);
  assert.equal(survivor.phones.find((row) => row.value === '801-555-0101').label, 'mobile');
  assert.equal(survivor.email, 'jordan.personal@example.test');
  assert.equal(survivor.phone, '801-555-0102');
  assert.deepEqual(survivor.sticker_ids.sort(), ['SYNTH-A', 'SYNTH-B', 'SYNTH-C', 'SYNTH-D']);
  assert.equal(Object.keys(survivor.sticker_assignments).length, 4);
  assert.equal(survivor.sticker_assignments['SYNTH-D'].assigned_by, 'csv_import');
  assert.deepEqual(survivor.contact_hub_merge_origin.sticker_assignment_provenance[sourceRef.id], sourceOriginal.sticker_assignments);
  assert.deepEqual(survivor.contact_affiliations.map(({ title, organization_name }) => [title, organization_name]), [
    ['Director', 'T-Mobile'], ['Basketball Coach', 'Salt Lake Youth League'],
  ]);
  assert.deepEqual([survivor.title, survivor.company_name, survivor.company_id], ['Director', 'T-Mobile', 't-mobile']);
  assert.equal(survivor.notes.length, 2);
  assert.deepEqual(survivor.identity_sources.sort(), ['business_card', 'community_import']);
  assert.equal(survivor.contact_hub_merge_origin.source_provenance.length, 2);
  const retainedSource = survivor.contact_hub_merge_origin.source_provenance.find((row) => row.contact_id === sourceRef.id);
  assert.equal(retainedSource.email_facts.find((row) => row.value === 'jordan.work@example.test').label, 'professional');
  assert.equal(retainedSource.phone_facts.find((row) => row.value === '801-555-0101').label, 'direct');
  assert.equal((await survivorRef.collection('timeline').get()).size, 2);
  assert.equal((await sourceRef.get()).data().contact_hub_lifecycle.status, 'retired');
  await assertFails(updateDoc(doc(owner, sourceRef.path), { name: 'Must remain retired' }));
  await assertFails(updateDoc(doc(owner, survivorRef.path), { contact_affiliations: [] }));

  // Retirement must also block the trusted writer. A rollback only restores the
  // original records when its server-issued conditional token remains eligible.
  const retiredVersion = version(await sourceRef.get());
  const blockedRetiredWrite = await affiliationWriter(event({ uid: 'owner', contactId: sourceRef.id, expectedVersion: retiredVersion, affiliations: sourceOriginal.contact_affiliations }));
  assert.equal(blockedRetiredWrite.statusCode, 409);
  const rollbackPreview = await request('preview_rollback');
  assert.ok(rollbackPreview.token, JSON.stringify(rollbackPreview));
  const rollback = await request('rollback', { token: rollbackPreview.token });
  assert.equal(rollback.receipt?.status, 'rolled_back', JSON.stringify(rollback));
  assert.deepEqual((await survivorRef.get()).data(), survivorOriginal);
  assert.deepEqual((await sourceRef.get()).data(), sourceOriginal);
  assert.equal((await survivorRef.collection('timeline').get()).size, 1);
  assert.equal((await sourceRef.collection('timeline').get()).size, 1);

  console.log('Contact Hub emulator acceptance passed: affiliation owner/write protections; feature flags, impersonation and stale versions; actual additive email/phone/sticker/affiliation/note/Activity/source persistence; retirement write denial; conditional rollback. Synthetic-only records used.');
} finally {
  await env.cleanup();
  await deleteApp(app);
}
