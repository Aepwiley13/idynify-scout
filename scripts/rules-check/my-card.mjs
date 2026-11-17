/**
 * My Card storage, against the REAL rules (../../firestore.rules, the live
 * file) in the Firestore emulator on a throwaway `demo-` project.
 *
 * Two things are checked:
 *   - the rules: the owner can read and write users/{uid}/card/main, and
 *     another signed-in user and an anonymous visitor can do nothing with it;
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
import { DEFAULT_SHARE, newCard } from '../../src/utils/myCardRules.js';

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

check('rules: the owner can create, read, update and delete their card', async () => {
  const db = owner();
  await expectCode(setDoc(doc(db, CARD(U)), { firstName: 'Ada', revision: 1 }), 'ok', 'owner create');
  await expectCode(getDoc(doc(db, CARD(U))), 'ok', 'owner get');
  await expectCode(updateDoc(doc(db, CARD(U)), { firstName: 'Ada L' }), 'ok', 'owner update');
  await expectCode(getDocs(collection(db, `users/${U}/card`)), 'ok', 'owner list');
  await expectCode(deleteDoc(doc(db, CARD(U))), 'ok', 'owner delete');
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

check('rules: KNOWN GAP, the rules do not check a card\'s shape, so an owner could write sharingEnabled directly', async () => {
  // Documented, not endorsed. Nothing reads sharingEnabled publicly yet, and the service always
  // writes it false. A public page must read through the server and check it there, never trust
  // these rules; a rule that validates cards is a separate, deliberate change to firestore.rules.
  await expectCode(setDoc(doc(owner(), CARD(U)), { firstName: 'Ada', sharingEnabled: true }), 'ok', 'direct owner write');
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
