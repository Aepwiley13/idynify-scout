/**
 * My Card storage, against the REAL rules (../../firestore.rules, the live
 * file) in the Firestore emulator on a throwaway `demo-` project.
 *
 * Two things are checked:
 *   - the rules: the owner can read and write users/{uid}/card/main only as the
 *     rules allow (known fields, each within its limit, a photo that is nothing, an https link or a
 *     bounded JPEG data URL, sharing off, the next revision, no delete, no other document, nothing
 *     nested), and another
 *     signed-in user and an anonymous visitor can do nothing with it;
 *   - the app's own service code (src/services/myCard/myCardCore.js), given
 *     this package's copy of the web SDK, doing its work through those rules:
 *     load, save, two tabs racing, a failed read that must never look like a
 *     missing card, and suggestions.
 *
 * No production project, no credentials, no real data.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup, runTransaction,
} from 'firebase/firestore';
import { createMyCardService, MY_CARD_STATUS as S, MY_CARD_ERRORS as E } from '../../src/services/myCard/myCardCore.js';
import { CARD_FIELDS, CARD_LIMITS, DEFAULT_SHARE, SHAREABLE_FIELDS, newCard } from '../../src/utils/myCardRules.js';
import { EXIF, base64Of, photoDataUrl } from '../../src/test/helpers/photoFixtures.js';

const env = await initializeTestEnvironment({
  projectId: 'demo-my-card',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();

const U = 'U';
const OTHER = 'OTHER';
const CARD = (uid) => `users/${uid}/card/main`;
const fs = { doc, getDoc, runTransaction };

const asAdmin = async (fn) => {
  let value;
  await env.withSecurityRulesDisabled(async (ctx) => { value = await fn(ctx.firestore()); });
  return value;
};
const read = (path) => asAdmin(async (db) => { const snap = await getDoc(doc(db, path)); return snap.exists() ? snap.data() : undefined; });
const seed = (path, data) => asAdmin((db) => setDoc(doc(db, path), data));
const wipeCard = (uid) => asAdmin((db) => deleteDoc(doc(db, CARD(uid))));

const owner = () => env.authenticatedContext(U).firestore();
const other = () => env.authenticatedContext(OTHER).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** A service for `uid` over a given Firestore connection. */
const serviceFor = (uid, db) => createMyCardService({ db, fs, getSignedInUid: () => uid });
/** Two tabs of the same signed-in owner: two connections, one account. */
const tab = () => serviceFor(U, owner());

const goodCard = (extra = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', email: 'ada@example.com', share: { ...DEFAULT_SHARE }, ...extra,
});

const codeOf = async (promise) => {
  try { await promise; return 'ok'; } catch (err) { return err.code ?? err.message; }
};
const CHECKS = [];
const check = (name, fn) => CHECKS.push([name, fn]);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectCode = async (promise, expected, what) => {
  const code = await codeOf(promise);
  assert(code === expected, `${what}: expected ${expected}, got ${code}`);
};

// ── The rules ───────────────────────────────────────────────────────────────

/** A card exactly as the service stores it: every known field, sharing off, a revision. */
const stored = (extra = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', photoUrl: '', title: 'Analyst', organization: '', email: 'ada@example.com',
  phone: '', linkedinUrl: '', instagram: '', website: '', share: { ...DEFAULT_SHARE }, sharingEnabled: false,
  schemaVersion: 1, revision: 1, createdAt: '2026-11-17T10:00:00.000Z', updatedAt: '2026-11-17T10:00:00.000Z', ...extra,
});
/** The same card with one key taken out. */
const without = (card, key) => { const copy = { ...card }; delete copy[key]; return copy; };
const put = (db, data, path = CARD(U)) => setDoc(doc(db, path), data);

check('rules: the owner can create, read, list and update their card, but not delete it', async () => {
  await wipeCard(U);
  const db = owner();
  await expectCode(put(db, stored()), 'ok', 'owner create');
  await expectCode(getDoc(doc(db, CARD(U))), 'ok', 'owner get');
  await expectCode(getDocs(collection(db, `users/${U}/card`)), 'ok', 'owner list');
  await expectCode(put(db, stored({ title: 'Director', revision: 2 })), 'ok', 'owner update');
  await expectCode(deleteDoc(doc(db, CARD(U))), 'permission-denied', 'owner delete');
  assert((await read(CARD(U))).title === 'Director', 'the card is intact');
});

check('rules: another signed-in user can do nothing with it', async () => {
  await seed(CARD(U), { firstName: 'Ada', revision: 1 });
  const db = other();
  await expectCode(getDoc(doc(db, CARD(U))), 'permission-denied', 'other get');
  await expectCode(getDocs(collection(db, `users/${U}/card`)), 'permission-denied', 'other list');
  await expectCode(setDoc(doc(db, CARD(U)), { firstName: 'Mallory' }), 'permission-denied', 'other overwrite');
  await expectCode(updateDoc(doc(db, CARD(U)), { firstName: 'Mallory' }), 'permission-denied', 'other update');
  await expectCode(deleteDoc(doc(db, CARD(U))), 'permission-denied', 'other delete');
  await expectCode(setDoc(doc(db, `users/${U}/card/second`), { firstName: 'Mallory' }), 'permission-denied', 'other create elsewhere in the folder');
  assert((await read(CARD(U))).firstName === 'Ada', 'the card is unchanged');
});

check('rules: an anonymous visitor can do nothing with it', async () => {
  await seed(CARD(U), { firstName: 'Ada', revision: 1 });
  const db = anon();
  await expectCode(getDoc(doc(db, CARD(U))), 'permission-denied', 'anonymous get');
  await expectCode(getDocs(collection(db, `users/${U}/card`)), 'permission-denied', 'anonymous list');
  await expectCode(setDoc(doc(db, CARD(U)), { firstName: 'Mallory' }), 'permission-denied', 'anonymous overwrite');
  await expectCode(updateDoc(doc(db, CARD(U)), { firstName: 'Mallory' }), 'permission-denied', 'anonymous update');
  await expectCode(deleteDoc(doc(db, CARD(U))), 'permission-denied', 'anonymous delete');
  assert((await read(CARD(U))).firstName === 'Ada', 'the card is unchanged');
});

check('rules: no one can find cards by searching across users', async () => {
  await seed(CARD(U), { firstName: 'Ada' });
  await seed(CARD(OTHER), { firstName: 'Grace' });
  for (const [who, db] of [['other', other()], ['anonymous', anon()], ['owner', owner()]]) {
    await expectCode(getDocs(collectionGroup(db, 'card')), 'permission-denied', `${who} collection-group query`);
  }
});

check('rules: nothing under users/{uid} is readable by a stranger, so a card has no public path', async () => {
  await seed(CARD(U), { firstName: 'Ada' });
  await seed(`users/${U}`, { displayName: 'Ada' });
  for (const [who, db] of [['other', other()], ['anonymous', anon()]]) {
    await expectCode(getDoc(doc(db, `users/${U}`)), 'permission-denied', `${who} account`);
    await expectCode(getDoc(doc(db, CARD(U))), 'permission-denied', `${who} card`);
  }
});

check('rules: sharing cannot be switched on by a direct write, on create or on update', async () => {
  await wipeCard(U);
  for (const value of [true, 'true', 'false', 1, 0, null]) {
    await expectCode(put(owner(), stored({ sharingEnabled: value })), 'permission-denied', `create with sharingEnabled ${JSON.stringify(value)}`);
  }
  await expectCode(put(owner(), without(stored(), 'sharingEnabled')), 'permission-denied', 'create without sharingEnabled');
  assert((await read(CARD(U))) === undefined, 'nothing was created');
  await seed(CARD(U), stored());
  await expectCode(put(owner(), stored({ sharingEnabled: true, revision: 2 })), 'permission-denied', 'update to sharingEnabled true');
  await expectCode(updateDoc(doc(owner(), CARD(U)), { sharingEnabled: true, revision: 2 }), 'permission-denied', 'partial update to sharingEnabled true');
  assert((await read(CARD(U))).sharingEnabled === false, 'sharing is still off');
});

// ── The service, through the rules ──────────────────────────────────────────

check('service: a missing card is missing, for the owner', async () => {
  await wipeCard(U);
  const result = await tab().loadMyCard();
  assert(result.status === S.MISSING && result.revision === null, `got ${JSON.stringify(result)}`);
});

check('service: the first save creates revision 1, with sharing off and nothing extra', async () => {
  await wipeCard(U);
  const result = await tab().saveMyCard(goodCard({ sharingEnabled: true, suggestions: { title: 'x' }, source: 'linkedin' }), { expectedRevision: null });
  assert(result.status === S.SAVED && result.revision === 1, `got ${JSON.stringify(result)}`);
  const stored = await read(CARD(U));
  assert(stored.sharingEnabled === false, 'sharingEnabled is false');
  assert(stored.revision === 1 && stored.createdAt && stored.updatedAt, 'metadata');
  assert(!('suggestions' in stored) && !('source' in stored), 'nothing else is stored');
  const loaded = await tab().loadMyCard();
  assert(loaded.status === S.OK && loaded.revision === 1 && loaded.card.firstName === 'Ada', `got ${JSON.stringify(loaded)}`);
});

check('service: a save at the current revision updates it, keeping createdAt', async () => {
  await wipeCard(U);
  const service = tab();
  const first = await service.saveMyCard(goodCard(), { expectedRevision: null });
  const createdAt = (await read(CARD(U))).createdAt;
  const second = await service.saveMyCard(goodCard({ title: 'Director' }), { expectedRevision: first.revision });
  assert(second.status === S.SAVED && second.revision === 2, `got ${JSON.stringify(second)}`);
  const stored = await read(CARD(U));
  assert(stored.title === 'Director' && stored.createdAt === createdAt, 'updated, createdAt kept');
});

check('service: a second tab with an old copy gets a conflict and writes nothing', async () => {
  await wipeCard(U);
  const tabA = tab();
  const tabB = tab();
  const saved = await tabA.saveMyCard(goodCard({ title: 'Original' }), { expectedRevision: null });
  const loadedByB = await tabB.loadMyCard();
  await tabA.saveMyCard(goodCard({ title: 'Tab A edit' }), { expectedRevision: saved.revision });
  const lost = await tabB.saveMyCard(goodCard({ title: 'Tab B edit' }), { expectedRevision: loadedByB.revision });
  assert(lost.status === S.CONFLICT, `got ${JSON.stringify(lost)}`);
  assert(lost.current.status === S.OK && lost.current.card.title === 'Tab A edit' && lost.current.revision === 2, 'conflict carries the newer card');
  assert((await read(CARD(U))).title === 'Tab A edit', 'tab A\'s card is intact');
  const retry = await tabB.saveMyCard(goodCard({ title: 'Tab B edit' }), { expectedRevision: lost.current.revision });
  assert(retry.status === S.SAVED && retry.revision === 3, 'saves once it has taken the newer card');
});

check('service: two saves racing on the same revision: exactly one wins', async () => {
  await wipeCard(U);
  const base = await tab().saveMyCard(goodCard(), { expectedRevision: null });
  const results = await Promise.all(['one', 'two', 'three', 'four'].map((title) => tab().saveMyCard(goodCard({ title }), { expectedRevision: base.revision })));
  const saved = results.filter((r) => r.status === S.SAVED);
  const conflicts = results.filter((r) => r.status === S.CONFLICT);
  assert(saved.length === 1 && conflicts.length === 3, `saved ${saved.length}, conflicts ${conflicts.length}: ${results.map((r) => r.status).join(',')}`);
  const stored = await read(CARD(U));
  assert(stored.revision === 2 && stored.title === saved[0].card.title, 'one write, the winner\'s');
});

check('service: a blank draft cannot replace a real card', async () => {
  await wipeCard(U);
  await tab().saveMyCard(goodCard({ title: 'Real card' }), { expectedRevision: null });
  const result = await tab().saveMyCard(goodCard({ title: 'Blank draft' }), { expectedRevision: null });
  assert(result.status === S.CONFLICT, `got ${result.status}`);
  assert((await read(CARD(U))).title === 'Real card', 'the real card is intact');
});

check('service: a damaged stored card loads repaired, with sharing off', async () => {
  await seed(CARD(U), { firstName: 'Ada', lastName: 'Lovelace', email: 'nope', sharingEnabled: true, revision: 4, schemaVersion: 1 });
  const result = await tab().loadMyCard();
  assert(result.status === S.REPAIRED && result.revision === 4, `got ${result.status}`);
  assert(result.card.email === '' && result.card.sharingEnabled === false && 'email' in result.errors, 'repaired');
});

check('service: a read the rules refuse is an error, never a missing card', async () => {
  await seed(CARD(U), { firstName: 'Ada', lastName: 'Lovelace', revision: 1 });
  // The service believes it is U, but the connection belongs to someone else.
  for (const [who, db] of [['another signed-in user', other()], ['an anonymous visitor', anon()]]) {
    const result = await serviceFor(U, db).loadMyCard();
    assert(result.status === S.ERROR && result.code === E.PERMISSION_DENIED && !('card' in result), `${who}: got ${JSON.stringify(result)}`);
  }
});

check('service: a save the rules refuse is an error and changes nothing', async () => {
  await seed(CARD(U), { firstName: 'Ada', lastName: 'Lovelace', title: 'Real card', revision: 1 });
  for (const [who, db] of [['another signed-in user', other()], ['an anonymous visitor', anon()]]) {
    const result = await serviceFor(U, db).saveMyCard(goodCard({ title: 'Mallory' }), { expectedRevision: 1 });
    assert(result.status === S.ERROR && result.code === E.PERMISSION_DENIED, `${who}: got ${JSON.stringify(result)}`);
  }
  assert((await read(CARD(U))).title === 'Real card', 'the card is unchanged');
});

check('service: each account has its own card, and a service only ever touches its own', async () => {
  await wipeCard(U);
  await wipeCard(OTHER);
  const mine = tab();
  const theirs = serviceFor(OTHER, other());
  await mine.saveMyCard(goodCard({ title: 'Mine' }), { expectedRevision: null });
  assert((await theirs.loadMyCard()).status === S.MISSING, 'their card is separate');
  await theirs.saveMyCard(goodCard({ firstName: 'Grace', lastName: 'Hopper', title: 'Theirs', uid: U }), { expectedRevision: null });
  assert((await read(CARD(U))).title === 'Mine' && (await read(CARD(OTHER))).title === 'Theirs', 'two cards, each its owner\'s');
});

check('service: suggestions come from the owner\'s account and LinkedIn, and write nothing', async () => {
  await wipeCard(U);
  await seed(`users/${U}`, {
    displayName: 'Ada Lovelace', email: 'ada@example.com', credits: 400, stripeCustomerId: 'cus_123',
    section1Answers: { role: 'Analyst', companyName: 'Analytical Engines' },
  });
  await seed(`users/${U}/integrations/linkedin`, {
    status: 'connected', givenName: 'Ada', familyName: 'Lovelace', email: 'ada@linkedin.example.com', emailVerified: true,
    pictureUrl: 'https://media.example.com/ada.jpg',
  });
  const { suggestions, unavailable } = await tab().loadCardSuggestions();
  assert(unavailable.length === 0, `unavailable: ${unavailable}`);
  const values = Object.fromEntries(Object.entries(suggestions).map(([f, s]) => [f, s.value]));
  assert(
    values.firstName === 'Ada' && values.lastName === 'Lovelace' && values.email === 'ada@example.com'
    && values.title === 'Analyst' && values.organization === 'Analytical Engines' && values.photoUrl === 'https://media.example.com/ada.jpg',
    `values: ${JSON.stringify(values)}`,
  );
  assert((await read(CARD(U))) === undefined, 'no card was created');
});

check('service: someone else cannot read a user\'s suggestions; both sources report unavailable', async () => {
  const { suggestions, unavailable } = await serviceFor(U, other()).loadCardSuggestions();
  assert(Object.keys(suggestions).length === 0 && unavailable.join() === 'account,linkedin', `got ${JSON.stringify({ suggestions, unavailable })}`);
});

check('service: a new card pre-filled from suggestions is not saved until the owner saves', async () => {
  await wipeCard(U);
  const service = tab();
  const loaded = await service.loadMyCard();
  await service.loadCardSuggestions();
  assert(loaded.status === S.MISSING && (await read(CARD(U))) === undefined, 'nothing stored by loading');
  assert(JSON.stringify(newCard()) === JSON.stringify(loaded.card), 'the missing card is a blank new card');
});

// ── Revision enforcement: what actually holds, against the real transaction and rules ──

check('revision: an overwrite after a conflict is made against the revision just seen, and lands only if nothing moved', async () => {
  await wipeCard(U);
  const a = tab();
  const b = tab();
  const first = await a.saveMyCard(goodCard({ title: 'Original' }), { expectedRevision: null });
  const loadedByB = await b.loadMyCard();
  await a.saveMyCard(goodCard({ title: 'A edit' }), { expectedRevision: first.revision });
  const conflict = await b.saveMyCard(goodCard({ title: 'B edit' }), { expectedRevision: loadedByB.revision });
  assert(conflict.status === S.CONFLICT && conflict.current.revision === 2, `expected a conflict at revision 2, got ${JSON.stringify(conflict).slice(0, 120)}`);
  assert((await read(CARD(U))).title === 'A edit', 'the conflict wrote nothing');
  // The person confirms "save mine over it": against revision 2, the one just seen, not the revision 1 they started from.
  const over = await b.saveMyCard(goodCard({ title: 'B edit' }), { expectedRevision: conflict.current.revision });
  assert(over.status === S.SAVED && over.revision === 3, `overwrite: ${JSON.stringify(over).slice(0, 120)}`);
  assert((await read(CARD(U))).title === 'B edit', 'the overwrite landed');
});

check('revision: if the card changes again before the overwrite lands, the overwrite stops and the newer card survives', async () => {
  await wipeCard(U);
  const a = tab();
  const b = tab();
  const first = await a.saveMyCard(goodCard({ title: 'Original' }), { expectedRevision: null });
  const loadedByB = await b.loadMyCard();
  await a.saveMyCard(goodCard({ title: 'A edit' }), { expectedRevision: first.revision });
  const conflict = await b.saveMyCard(goodCard({ title: 'B edit' }), { expectedRevision: loadedByB.revision });
  // Before B confirms, A saves again: the card is now at revision 3.
  await a.saveMyCard(goodCard({ title: 'A edit, again' }), { expectedRevision: conflict.current.revision });
  const over = await b.saveMyCard(goodCard({ title: 'B edit' }), { expectedRevision: conflict.current.revision });
  assert(over.status === S.CONFLICT && over.current.revision === 3, `expected a second conflict at revision 3, got ${JSON.stringify(over).slice(0, 120)}`);
  assert(over.current.card.title === 'A edit, again', 'the second conflict carries the newer card');
  const stored = await read(CARD(U));
  assert(stored.title === 'A edit, again' && stored.revision === 3, 'nothing was overwritten');
});

check('revision: the server refuses a write that was based on a read that moved underneath it (the rules, not our code)', async () => {
  await wipeCard(U);
  await seed(CARD(U), stored({ title: 'Seeded', revision: 1 }));
  const db = owner();
  const ref = doc(db, CARD(U));
  let attempts = 0;
  const code = await codeOf(runTransaction(db, async (tx) => {
    attempts += 1;
    const snap = await tx.get(ref);
    // Somebody else saves between this read and this write.
    if (attempts === 1) await seed(CARD(U), { ...snap.data(), title: 'Moved underneath', revision: 2 });
    tx.set(ref, { ...snap.data(), title: 'From the transaction', revision: snap.data().revision + 1 });
  }));
  // Before the card rules, Firestore retried this transaction. Now the rules refuse the stale write at the
  // server, so the transaction fails and the newer card is untouched: the service turns that into a conflict.
  assert(code === 'permission-denied', `the server accepted a write based on a stale read (${code}, attempts: ${attempts})`);
  const after = await read(CARD(U));
  assert(after.revision === 2 && after.title === 'Moved underneath', `stored ${JSON.stringify(after)}`);
});

check('revision: sixteen saves racing on one revision: exactly one lands, the other fifteen are conflicts', async () => {
  await wipeCard(U);
  const base = await tab().saveMyCard(goodCard(), { expectedRevision: null });
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => tab().saveMyCard(goodCard({ title: `racer ${i}` }), { expectedRevision: base.revision })));
  const saved = results.filter((r) => r.status === S.SAVED);
  assert(saved.length === 1 && results.filter((r) => r.status === S.CONFLICT).length === 15, `saved ${saved.length}: ${results.map((r) => r.status).join(',')}`);
  const stored = await read(CARD(U));
  assert(stored.revision === 2 && stored.title === saved[0].card.title, 'one write, the winner\'s');
});

check('revision: the rules take only the next revision, so a write that skips the service cannot lower or skip it', async () => {
  await wipeCard(U);
  await seed(CARD(U), stored({ title: 'Newer', revision: 5 }));
  const attempts = [['the same revision', 5], ['a lower revision (a stale write)', 1], ['revision 0', 0], ['a skipped revision', 7], ['a negative revision', -6],
    ['a revision as text', '6'], ['a revision as a fraction', 5.5], ['no revision at all', undefined]];
  for (const [what, revision] of attempts) {
    const card = revision === undefined ? without(stored({ title: 'Stale write' }), 'revision') : stored({ title: 'Stale write', revision });
    await expectCode(put(owner(), card), 'permission-denied', what);
  }
  assert((await read(CARD(U))).title === 'Newer' && (await read(CARD(U))).revision === 5, 'the newer card was not touched');
  await expectCode(put(owner(), stored({ title: 'Next', revision: 6 })), 'ok', 'the next revision');
  await expectCode(put(owner(), stored({ title: 'Replay', revision: 6 })), 'permission-denied', 'replaying that revision');
  await expectCode(put(other(), stored({ title: 'x', revision: 7 })), 'permission-denied', 'other user');
  await expectCode(put(anon(), stored({ title: 'x', revision: 7 })), 'permission-denied', 'anonymous');
});

check('revision: a new card must be revision 1, and a second create at 1 cannot replace it', async () => {
  await wipeCard(U);
  for (const revision of [0, 2, 5, '1', 1.5, null]) {
    await expectCode(put(owner(), stored({ revision })), 'permission-denied', `create at ${JSON.stringify(revision)}`);
  }
  await expectCode(put(owner(), stored({ revision: 1 })), 'ok', 'create at 1');
  await expectCode(put(owner(), stored({ title: 'Again', revision: 1 })), 'permission-denied', 'a second create at 1');
});

check('rules: only card/main, and nothing under it', async () => {
  await wipeCard(U);
  for (const path of [`users/${U}/card/second`, `users/${U}/card/Main`, `users/${U}/card/main2`, `users/${U}/card/main/extra/doc`, `users/${U}/card/main/versions/v1`]) {
    await expectCode(put(owner(), stored(), path), 'permission-denied', `create at ${path}`);
  }
  await seed(`users/${U}/card/second`, stored());
  await expectCode(put(owner(), stored({ revision: 2 }), `users/${U}/card/second`), 'permission-denied', 'update of another card document');
  await expectCode(deleteDoc(doc(owner(), `users/${U}/card/second`)), 'permission-denied', 'delete of another card document');
  await seed(`users/${U}/card/main/notes/n1`, { text: 'x' });
  await expectCode(updateDoc(doc(owner(), `users/${U}/card/main/notes/n1`), { text: 'y' }), 'permission-denied', 'update under card/main');
  await expectCode(deleteDoc(doc(owner(), `users/${U}/card/main/notes/n1`)), 'permission-denied', 'delete under card/main');
});

check('rules: a card has exactly its known fields: none missing, none extra', async () => {
  await wipeCard(U);
  for (const key of Object.keys(stored())) {
    await expectCode(put(owner(), without(stored(), key)), 'permission-denied', `create without ${key}`);
  }
  for (const extra of [{ role: 'admin' }, { uid: 'someone' }, { suggestions: {} }, { source: 'linkedin' }, { photoData: 'x' }]) {
    await expectCode(put(owner(), stored(extra)), 'permission-denied', `create with ${Object.keys(extra)[0]}`);
  }
  await seed(CARD(U), stored());
  await expectCode(put(owner(), { ...stored({ revision: 2 }), role: 'admin' }), 'permission-denied', 'update with an extra field');
  await expectCode(updateDoc(doc(owner(), CARD(U)), { revision: 2, role: 'admin' }), 'permission-denied', 'partial update adding a field');
  await expectCode(updateDoc(doc(owner(), CARD(U)), { revision: 2, title: 'Partial' }), 'ok', 'a partial update that leaves a valid card');
});

check('rules: every text field must be text', async () => {
  await wipeCard(U);
  for (const field of CARD_FIELDS) {
    for (const value of [42, true, null, ['x'], { a: 1 }]) {
      await expectCode(put(owner(), stored({ [field]: value })), 'permission-denied', `${field} as ${JSON.stringify(value)}`);
    }
  }
  for (const field of ['schemaVersion', 'revision']) {
    await expectCode(put(owner(), stored({ [field]: 'x' })), 'permission-denied', `${field} as text`);
  }
});

check('rules: every field has its limit, the same as CARD_LIMITS: at the limit is fine, one over is not', async () => {
  for (const [field, limit] of Object.entries(CARD_LIMITS)) {
    const fill = (length) => (field === 'photoUrl' ? `https://${'a'.repeat(length - 8)}` : 'a'.repeat(length));
    await wipeCard(U);
    await expectCode(put(owner(), stored({ [field]: fill(limit) })), 'ok', `${field} at ${limit}`);
    await wipeCard(U);
    await expectCode(put(owner(), stored({ [field]: fill(limit + 1) })), 'permission-denied', `${field} at ${limit + 1}`);
  }
  await wipeCard(U);
  await expectCode(put(owner(), stored({ firstName: 'a'.repeat(1_000_000) })), 'permission-denied', 'a one-megabyte name');
  await expectCode(put(owner(), stored({ photoUrl: `https://${'a'.repeat(900_000)}` })), 'permission-denied', 'a 900 KB photo link');
  await expectCode(put(owner(), stored({ createdAt: `2026-11-17T10:00:00.000Z${'0'.repeat(100)}` })), 'permission-denied', 'an oversized time');
  assert((await read(CARD(U))) === undefined, 'nothing was created');
});

check('rules: a photo link is https or nothing: no script, no plain http, no other kind of link', async () => {
  await wipeCard(U);
  for (const photoUrl of ['http://example.com/a.jpg', 'data:image/jpeg;base64,/9j/4AAQ', 'javascript:alert(1)', 'ftp://example.com/a.jpg', 'https:/x', ' https://example.com/a.jpg', 'blob:https://example.com/x']) {
    await expectCode(put(owner(), stored({ photoUrl })), 'permission-denied', `photo ${photoUrl.slice(0, 24)}`);
  }
  await expectCode(put(owner(), stored({ photoUrl: 'https://media.example.com/ada.jpg?x=1' })), 'ok', 'an https link');
  await expectCode(put(owner(), stored({ photoUrl: '', revision: 2 })), 'ok', 'no photo');
});

/** A photo data URL of exactly this many characters, in the shape the rules look at (not a real picture). */
const PREFIX = 'data:image/jpeg;base64,';
const photoOfLength = (total, { start = '/9j/', fill = 'A', tail = '' } = {}) => {
  const body = total - PREFIX.length - start.length - tail.length;
  return `${PREFIX}${start}${fill.repeat(body)}${tail}`;
};
/** The longest length the rules take: 23 + a multiple of 4, at most 80,000. */
const LONGEST = 23 + 4 * Math.floor((80_000 - 23) / 4);

check('rules: a photo picture is taken only as a bounded JPEG data URL, and the bounds are the bounds', async () => {
  // At and inside the bounds.
  for (const length of [203, 703, 20_003, 65_535, 65_539, LONGEST]) {
    await wipeCard(U);
    await expectCode(put(owner(), stored({ photoUrl: photoOfLength(length) })), 'ok', `a photo of ${length} characters`);
  }
  await wipeCard(U);
  await expectCode(put(owner(), stored({ photoUrl: photoOfLength(LONGEST - 4, { tail: '=' }) })), 'ok', 'with one padding character');
  await wipeCard(U);
  await expectCode(put(owner(), stored({ photoUrl: photoOfLength(LONGEST - 4, { tail: '==' }) })), 'ok', 'with two padding characters');
  // Outside them.
  const refused = [
    ['one block over the longest', photoOfLength(LONGEST + 4)],
    ['far over: 200,000 characters', photoOfLength(200_003)],
    ['a megabyte', photoOfLength(1_000_003)],
    ['under 200 characters', photoOfLength(199)],
    ['the prefix and nothing', PREFIX],
    ['a length that is not a whole number of base64 blocks', photoOfLength(LONGEST - 1)],
    ['another length that is not', photoOfLength(5000)],
  ];
  for (const [what, photoUrl] of refused) {
    await wipeCard(U);
    await expectCode(put(owner(), stored({ photoUrl })), 'permission-denied', what);
  }
  assert((await read(CARD(U))) === undefined, 'nothing was created');
});

check('rules: a photo picture is refused unless it is exactly a JPEG data URL: type, start, characters and padding', async () => {
  // Every case is exactly 1003 characters, a valid length (23 + a multiple of 4) inside the bounds, so the
  // ONE thing wrong with it is the thing named. A case that is also the wrong length proves nothing.
  const shaped = ({ prefix = PREFIX, start = '/9j/', tail = '', total = 1003 } = {}) => `${prefix}${start}${'A'.repeat(total - prefix.length - start.length - tail.length)}${tail}`;
  assert(shaped().length === 1003 && (1003 - 23) % 4 === 0, 'the cases are the right length');
  await wipeCard(U);
  await expectCode(put(owner(), stored({ photoUrl: shaped() })), 'ok', 'the same shape, with nothing wrong, is accepted');
  const cases = [
    ['a PNG data URL', shaped({ prefix: 'data:image/png;base64,' })],
    ['a JPG (not JPEG) type', shaped({ prefix: 'data:image/jpg;base64,' })],
    ['a GIF data URL', shaped({ prefix: 'data:image/gif;base64,' })],
    ['a WebP data URL', shaped({ prefix: 'data:image/webp;base64,' })],
    ['an SVG, which can carry script', shaped({ prefix: 'data:image/svg+xml;base64,' })],
    ['HTML', shaped({ prefix: 'data:text/html;base64,' })],
    ['an uppercase prefix', shaped({ prefix: 'DATA:IMAGE/JPEG;BASE64,' })],
    ['a mixed-case type', shaped({ prefix: 'data:image/JPEG;base64,' })],
    ['a parameter in the type', shaped({ prefix: 'data:image/jpeg;charset=utf-8;base64,' })],
    ['not base64 at all', shaped({ prefix: 'data:image/jpeg,' })],
    ['a space before the data', shaped({ start: ' /9j' })],
    ['no prefix', shaped({ prefix: '' })],
    ['a link where the prefix should be', shaped({ prefix: 'https://example.com/a/' })],
    ['a PNG\'s own first bytes after the JPEG prefix', shaped({ start: 'iVBO' })],
    ['a start that is nearly a JPEG\'s', shaped({ start: '/9k/' })],
    ['a start that is shorter than a JPEG\'s', shaped({ start: '/9j' })],
    ['the URL-safe alphabet: a dash', shaped({ tail: 'AA-A' })],
    ['the URL-safe alphabet: an underscore', shaped({ tail: 'AA_A' })],
    ['a newline inside', shaped({ tail: 'A\nAA' })],
    ['a tab inside', shaped({ tail: 'A\tAA' })],
    ['a space inside', shaped({ tail: 'A AA' })],
    ['a quote inside', shaped({ tail: 'AA"A' })],
    ['an angle bracket inside', shaped({ tail: 'AA<A' })],
    ['script after the picture', shaped({ tail: '<svg>' })],
    ['a non-ASCII letter inside', shaped({ tail: 'AAéA' })],
    ['padding in the middle', shaped({ tail: '==AA' })],
    ['three padding characters', shaped({ tail: 'A===' })],
    ['padding and then more', shaped({ tail: 'A=AA' })],
    ['a second data URL after the first', `${shaped({ total: 503 })}${shaped({ total: 500 })}`],
    ['a link with a picture on the end', `https://example.com/?x=${shaped({ total: 980 })}`],
    ['a plain link in front of a whole picture', `https://example.com/${shaped({ total: 983 })}`],
    ['letters in front of a whole picture', `abc${shaped({ total: 1000 })}`],
  ];
  for (const [what, photoUrl] of cases) {
    assert(photoUrl.length === 1003, `${what}: the case is ${photoUrl.length} characters, not 1003`);
    await wipeCard(U);
    await expectCode(put(owner(), stored({ photoUrl })), 'permission-denied', what);
  }
  for (const photoUrl of [42, true, null, ['x'], { a: 1 }]) {
    await expectCode(put(owner(), stored({ photoUrl })), 'permission-denied', `a photo that is ${JSON.stringify(photoUrl)}`);
  }
  assert((await read(CARD(U))) === undefined, 'nothing was created');
});

check('rules: a card with a photo picture is still held to every other rule', async () => {
  const photoUrl = photoOfLength(30_003);
  await wipeCard(U);
  await seed(CARD(U), stored({ revision: 4, photoUrl }));
  const next = { photoUrl, revision: 5 };
  await expectCode(put(owner(), stored({ ...next, sharingEnabled: true })), 'permission-denied', 'sharingEnabled true');
  await expectCode(put(owner(), { ...stored(next), extra: 'x' }), 'permission-denied', 'an extra field');
  await expectCode(put(owner(), without(stored(next), 'website')), 'permission-denied', 'a missing field');
  await expectCode(put(owner(), stored({ ...next, title: 'x'.repeat(101) })), 'permission-denied', 'a title over its limit');
  await expectCode(put(owner(), stored({ ...next, schemaVersion: 2 })), 'permission-denied', 'schemaVersion 2');
  await expectCode(put(owner(), stored({ ...next, revision: 4 })), 'permission-denied', 'the same revision');
  await expectCode(put(owner(), stored({ ...next, revision: 1 })), 'permission-denied', 'a stale revision');
  await expectCode(put(owner(), stored({ ...next, revision: 7 })), 'permission-denied', 'a skipped revision');
  await expectCode(put(owner(), stored({ ...next, createdAt: '2027-01-01T00:00:00.000Z' })), 'permission-denied', 'a changed createdAt');
  await expectCode(updateDoc(doc(owner(), CARD(U)), { sharingEnabled: true, revision: 5 }), 'permission-denied', 'a partial update to sharingEnabled true');
  await expectCode(deleteDoc(doc(owner(), CARD(U))), 'permission-denied', 'delete');
  for (const [who, db] of [['another signed-in user', other()], ['an anonymous visitor', anon()]]) {
    await expectCode(getDoc(doc(db, CARD(U))), 'permission-denied', `${who} cannot read the picture`);
    await expectCode(put(db, stored({ ...next, title: 'Mallory' })), 'permission-denied', `${who} cannot write one`);
    await expectCode(getDocs(collectionGroup(db, 'card')), 'permission-denied', `${who} cannot find it by searching`);
  }
  assert((await read(CARD(U))).photoUrl === photoUrl && (await read(CARD(U))).revision === 4, 'the stored card is untouched');
  await expectCode(put(owner(), stored(next)), 'ok', 'and the valid next revision, with the picture, is accepted');
});

check('rules: a photo can be added, replaced, swapped for a link and removed, one revision at a time', async () => {
  await wipeCard(U);
  const steps = [
    ['no photo', ''],
    ['a picture', photoOfLength(20_003)],
    ['another picture', photoOfLength(30_003, { fill: 'B' })],
    ['a link', 'https://media.example.com/ada.jpg'],
    ['a picture again', photoOfLength(25_003)],
    ['nothing', ''],
  ];
  let revision = 0;
  for (const [what, photoUrl] of steps) {
    revision += 1;
    await expectCode(put(owner(), stored({ photoUrl, revision })), 'ok', `${what} (revision ${revision})`);
  }
  assert((await read(CARD(U))).photoUrl === '' && (await read(CARD(U))).revision === 6, 'ends with no photo at revision 6');
});

check('rules: the largest card allowed is far below Firestore\'s 1 MiB document limit', async () => {
  await wipeCard(U);
  const biggest = stored({
    photoUrl: photoOfLength(LONGEST), firstName: 'a'.repeat(60), lastName: 'a'.repeat(60), title: 'a'.repeat(100), organization: 'a'.repeat(120),
    email: 'a'.repeat(254), phone: 'a'.repeat(40), linkedinUrl: 'a'.repeat(200), instagram: 'a'.repeat(30), website: 'a'.repeat(200),
  });
  await expectCode(put(owner(), biggest), 'ok', 'a card with everything at its limit');
  const bytes = new TextEncoder().encode(JSON.stringify(await read(CARD(U)))).length;
  assert(bytes < 100_000, `the largest card is ${bytes} bytes`);
});

// A picture the real utility would make: a real JPEG layout of the finished size. (Not a photograph.)
const realPhoto = (length = 20_000, tag = 0) => photoDataUrl(320, length, { tag });

check('service: a photo picture is saved through the rules, replaced, swapped for a link, cleared and kept across a conflict', async () => {
  await wipeCard(U);
  const a = tab();
  const b = tab();
  const one = realPhoto(20_000, 1);
  const first = await a.saveMyCard(goodCard({ photoUrl: one }), { expectedRevision: null });
  assert(first.status === S.SAVED && first.revision === 1 && first.card.photoUrl === one, `first: ${first.status}`);
  assert((await read(CARD(U))).photoUrl === one, 'stored');
  const loaded = await a.loadMyCard();
  assert(loaded.status === S.OK && loaded.card.photoUrl === one, 'loads back exactly');

  const two = realPhoto(30_000, 2);
  const replaced = await a.saveMyCard(goodCard({ photoUrl: two }), { expectedRevision: 1 });
  assert(replaced.status === S.SAVED && replaced.revision === 2 && (await read(CARD(U))).photoUrl === two, 'replaced');

  // Another tab, with the old copy, tries to save its own photo: a conflict, and the stored photo is not touched.
  const lost = await b.saveMyCard(goodCard({ photoUrl: realPhoto(25_000, 3) }), { expectedRevision: 1 });
  assert(lost.status === S.CONFLICT && lost.current.card.photoUrl === two && lost.current.revision === 2, `conflict: ${lost.status}`);
  assert((await read(CARD(U))).photoUrl === two, 'the stored photo survived the conflict');

  const link = await a.saveMyCard(goodCard({ photoUrl: 'https://media.example.com/ada.jpg' }), { expectedRevision: 2 });
  assert(link.status === S.SAVED && (await read(CARD(U))).photoUrl === 'https://media.example.com/ada.jpg', 'swapped for a link');
  const back = await a.saveMyCard(goodCard({ photoUrl: one }), { expectedRevision: 3 });
  assert(back.status === S.SAVED && (await read(CARD(U))).photoUrl === one, 'and back to a picture');
  const cleared = await a.saveMyCard(goodCard({ photoUrl: '' }), { expectedRevision: 4 });
  assert(cleared.status === S.SAVED && (await read(CARD(U))).photoUrl === '' && cleared.revision === 5, 'cleared');
  assert((await read(CARD(U))).sharingEnabled === false, 'sharing stays off throughout');
});

check('service: eight saves racing, each with its own photo: one lands and the rest are conflicts, never "no access"', async () => {
  await wipeCard(U);
  const base = await tab().saveMyCard(goodCard({ photoUrl: realPhoto(20_000, 9) }), { expectedRevision: null });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => tab().saveMyCard(goodCard({ photoUrl: realPhoto(20_000 + i, i) }), { expectedRevision: base.revision })));
  const saved = results.filter((r) => r.status === S.SAVED);
  const conflicts = results.filter((r) => r.status === S.CONFLICT);
  assert(saved.length === 1 && conflicts.length === 7, `saved ${saved.length}, conflicts ${conflicts.length}: ${results.map((r) => r.status).join(',')}`);
  assert((await read(CARD(U))).photoUrl === saved[0].card.photoUrl, 'the winner\'s photo is what is stored');
});

check('service: a picture that is not a finished profile photo is not saved at all, and nothing is written', async () => {
  await wipeCard(U);
  const real = realPhoto(20_000, 5);
  const bad = [photoDataUrl(320, 5000, { extra: EXIF }), photoDataUrl(400, 5000), photoDataUrl(320, 60_000), `data:image/png;base64,${base64Of(real)}`, `${PREFIX}${'A'.repeat(100)}`];
  for (const photoUrl of bad) {
    const result = await tab().saveMyCard(goodCard({ photoUrl }), { expectedRevision: null });
    assert(result.status === S.INVALID && 'photoUrl' in result.errors, `got ${result.status}`);
  }
  assert((await read(CARD(U))) === undefined, 'nothing was written');
});

check('service: cards saved before photos (a link, none, damaged) take a picture, and a stored picture that is not valid loads repaired', async () => {
  for (const [what, legacy] of [
    ['a link', stored({ photoUrl: 'https://media.example.com/ada.jpg', revision: 3 })],
    ['no photo', stored({ photoUrl: '', revision: 3 })],
    ['no revision', without(stored({ photoUrl: '' }), 'revision')],
  ]) {
    await wipeCard(U);
    await seed(CARD(U), legacy);
    const service = tab();
    const loaded = await service.loadMyCard();
    const photoUrl = realPhoto(20_000, 4);
    const saved = await service.saveMyCard({ ...loaded.card, photoUrl }, { expectedRevision: loaded.revision });
    assert(saved.status === S.SAVED && (await read(CARD(U))).photoUrl === photoUrl, `${what}: ${saved.status}`);
  }
  // A picture stored by hand that is not a real photo (the rules cannot walk a JPEG) loads repaired, blank, and saves.
  await wipeCard(U);
  await seed(CARD(U), stored({ photoUrl: photoOfLength(5003), revision: 2 }));
  const service = tab();
  const loaded = await service.loadMyCard();
  assert(loaded.status === S.REPAIRED && loaded.card.photoUrl === '' && 'photoUrl' in loaded.errors, `got ${loaded.status}`);
  const saved = await service.saveMyCard(loaded.card, { expectedRevision: loaded.revision });
  assert(saved.status === S.SAVED && (await read(CARD(U))).photoUrl === '', 'and saving keeps the tidied card');
});

check('rules: the Shared / Private switches are exactly the eight, each true or false', async () => {
  await wipeCard(U);
  for (const key of SHAREABLE_FIELDS) {
    const missing = { ...DEFAULT_SHARE };
    delete missing[key];
    await expectCode(put(owner(), stored({ share: missing })), 'permission-denied', `share without ${key}`);
    for (const value of ['true', 1, null, 'yes']) {
      await expectCode(put(owner(), stored({ share: { ...DEFAULT_SHARE, [key]: value } })), 'permission-denied', `share.${key} as ${JSON.stringify(value)}`);
    }
  }
  for (const share of [{ ...DEFAULT_SHARE, firstName: true }, 'all', null, [], true, {}]) {
    await expectCode(put(owner(), stored({ share })), 'permission-denied', `share ${JSON.stringify(share)}`);
  }
  const everything = Object.fromEntries(SHAREABLE_FIELDS.map((key) => [key, true]));
  await expectCode(put(owner(), stored({ share: everything })), 'ok', 'every switch on');
});

check('rules: the schema version is exactly 1, and a card from a later version is not replaced', async () => {
  await wipeCard(U);
  for (const schemaVersion of [0, 2, -1, '1', 1.5, null]) {
    await expectCode(put(owner(), stored({ schemaVersion })), 'permission-denied', `create at schemaVersion ${JSON.stringify(schemaVersion)}`);
  }
  await expectCode(put(owner(), without(stored(), 'schemaVersion')), 'permission-denied', 'create without a schemaVersion');
  await seed(CARD(U), stored({ schemaVersion: 2, title: 'From the future' }));
  await expectCode(put(owner(), stored({ revision: 2, title: 'Old build' })), 'permission-denied', 'update over a later schema');
  assert((await read(CARD(U))).title === 'From the future', 'the later card is intact');
});

check('rules: the times are times, and createdAt is set once', async () => {
  await wipeCard(U);
  for (const bad of ['yesterday', '2026-11-17', '2026-11-17 10:00:00', '2026-11-17T10:00:00+02:00', '', 20261117, null, true, '2026-11-17T10:00:00.1234567Z']) {
    await expectCode(put(owner(), stored({ createdAt: bad })), 'permission-denied', `createdAt ${JSON.stringify(bad)}`);
    await expectCode(put(owner(), stored({ updatedAt: bad })), 'permission-denied', `updatedAt ${JSON.stringify(bad)}`);
  }
  await expectCode(put(owner(), stored({ createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00.5Z' })), 'ok', 'times without milliseconds and with one digit');
  await expectCode(put(owner(), stored({ revision: 2, createdAt: '2027-01-01T00:00:00.000Z' })), 'permission-denied', 'createdAt changed on update');
  await expectCode(put(owner(), stored({ revision: 2, createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-18T09:00:00.000Z' })), 'ok', 'the same createdAt, a new updatedAt');
});

check('rules: another user and an anonymous visitor cannot write a perfectly valid card', async () => {
  await wipeCard(U);
  await wipeCard(OTHER);
  for (const [who, db] of [['another signed-in user', other()], ['an anonymous visitor', anon()]]) {
    await expectCode(put(db, stored()), 'permission-denied', `${who} create`);
  }
  await expectCode(put(other(), stored(), CARD(OTHER)), 'ok', 'a user\'s own card, as a control');
  await wipeCard(OTHER);
  await seed(CARD(U), stored());
  for (const [who, db] of [['another signed-in user', other()], ['an anonymous visitor', anon()]]) {
    await expectCode(put(db, stored({ revision: 2 })), 'permission-denied', `${who} update`);
    await expectCode(deleteDoc(doc(db, CARD(U))), 'permission-denied', `${who} delete`);
  }
  assert((await read(CARD(U))).revision === 1, 'the card is intact');
});

check('rules: a card from before revisions can be saved, and so can one whose stored values are damaged', async () => {
  // [what, the stored card, the revision the next save must carry]
  const cases = [
    ['no revision, no createdAt', without(without(stored(), 'revision'), 'createdAt'), 1],
    ['an old partial card', { firstName: 'Ada', lastName: 'Lovelace' }, 1],
    ['a revision stored as text', stored({ revision: 'x' }), 1],
    ['a negative stored revision', stored({ revision: -3 }), 1],
    ['a fractional stored revision', stored({ revision: 2.5 }), 1],
    ['a schemaVersion stored as text', stored({ schemaVersion: 'x' }), 2],
    ['sharingEnabled stored true (written before these rules)', stored({ sharingEnabled: true }), 2],
    ['an empty createdAt', stored({ createdAt: '' }), 2],
  ];
  for (const [what, legacy, next] of cases) {
    await wipeCard(U);
    await seed(CARD(U), legacy);
    // createdAt is kept whenever the stored card has one; otherwise the save sets it.
    const createdAt = typeof legacy.createdAt === 'string' && legacy.createdAt ? legacy.createdAt : '2026-11-17T12:00:00.000Z';
    await expectCode(put(owner(), stored({ revision: next, createdAt })), 'ok', `${what}: saved as revision ${next}`);
    assert((await read(CARD(U))).sharingEnabled === false, `${what}: sharing is off after the save`);
  }
  await wipeCard(U);
  await seed(CARD(U), stored({ revision: 4, sharingEnabled: true }));
  await expectCode(put(owner(), stored({ revision: 1 })), 'permission-denied', 'a legacy card at revision 4 does not go back to 1');
  await expectCode(put(owner(), stored({ revision: 5 })), 'ok', 'revision 5');
});

check('rules: the rest of users/{uid} is unchanged: other collections and the server-owned documents behave as before', async () => {
  const db = owner();
  await expectCode(setDoc(doc(db, `users/${U}/contacts/c1`), { name: 'Grace Hopper' }), 'ok', 'a contact');
  await expectCode(updateDoc(doc(db, `users/${U}/contacts/c1`), { name: 'Grace H' }), 'ok', 'a contact update');
  await expectCode(deleteDoc(doc(db, `users/${U}/contacts/c1`)), 'ok', 'a contact delete');
  await expectCode(setDoc(doc(db, `users/${U}/companies/co1`), { name: 'Acme' }), 'ok', 'a company');
  await expectCode(setDoc(doc(db, `users/${U}/cards/x`), { text: 'y' }), 'ok', 'a collection that only starts with "card"');
  await expectCode(setDoc(doc(db, `users/${U}/companies/co1/notes/n1`), { text: 'y' }), 'ok', 'a note two levels deep');
  await expectCode(setDoc(doc(db, `users/${U}/integrations/linkedin`), { status: 'connected' }), 'permission-denied', 'the server-owned LinkedIn document');
  await expectCode(setDoc(doc(db, `users/${U}/lineageEvents/e1`), { type: 'x' }), 'ok', 'a lineage event can be created');
  await expectCode(updateDoc(doc(db, `users/${U}/lineageEvents/e1`), { type: 'y' }), 'permission-denied', 'but not changed');
  await expectCode(setDoc(doc(db, `users/${OTHER}/contacts/c1`), { name: 'x' }), 'permission-denied', 'another user\'s contacts');
});

check('service: a save over a card written before these rules (partial, damaged, sharing on) works and leaves sharing off', async () => {
  await wipeCard(U);
  await seed(CARD(U), { firstName: 'Ada', lastName: 'Lovelace', email: 'nope', sharingEnabled: true, revision: 4, schemaVersion: 1 });
  const service = tab();
  const loaded = await service.loadMyCard();
  assert(loaded.status === S.REPAIRED && loaded.revision === 4, `got ${loaded.status}`);
  const result = await service.saveMyCard(goodCard({ email: 'ada@example.com' }), { expectedRevision: loaded.revision });
  assert(result.status === S.SAVED && result.revision === 5, `got ${JSON.stringify(result).slice(0, 160)}`);
  const after = await read(CARD(U));
  assert(after.sharingEnabled === false && after.revision === 5 && after.email === 'ada@example.com', 'repaired and saved');
});

check('service: a card with no revision at all is saved as revision 1, through the service', async () => {
  await wipeCard(U);
  await seed(CARD(U), { firstName: 'Ada', lastName: 'Lovelace', schemaVersion: 1 });
  const service = tab();
  const loaded = await service.loadMyCard();
  assert(loaded.revision === 0, `legacy revision should read as 0, got ${loaded.revision}`);
  const result = await service.saveMyCard(goodCard(), { expectedRevision: loaded.revision });
  assert(result.status === S.SAVED && result.revision === 1, `got ${JSON.stringify(result).slice(0, 160)}`);
});

// ── Run ─────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
for (const [index, [name, fn]] of CHECKS.entries()) {
  const label = `${String(index + 1).padStart(2, '0')}  ${name}`;
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${label}  — ${String(err.message).split('\n')[0].slice(0, 200)}`);
    fail++;
  }
}
console.log(`\n  my card: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
