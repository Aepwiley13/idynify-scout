/**
 * My Card sharing (MY-CARD-SHARE-001), against the REAL rules (../../firestore.rules, the live
 * file) in the Firestore emulator on a throwaway `demo-` project.
 *
 * One named case for each security invariant in the approved plan:
 *   S1  a public ID belongs only to its owner, forever
 *   S2  no one can claim, overwrite or delete another user's ID
 *   S3  Reset Link retires the old ID atomically, and a retired ID can never come back
 *   S4  no standalone public deletion leaves an inconsistent state
 *   S5  a live card never has a stale or missing public copy
 *   S6  stale builds and revisions cannot bypass the checks
 *   S7  a suspended or taken-down account cannot publish
 *   S8  suspension and takedown remove public access
 *   P1  anonymous visitors cannot read private cards
 *   P2  a public copy holds exactly the authorized fields
 *   P3  making a field Private removes it from the public copy
 *   P4  nothing must stay public
 * plus the additional links, the signup attribution field and the access-call limits.
 *
 * This file writes with Firestore's own batches against the rules, with its own independent copy
 * builder (publicOf below), so the rules are checked on their own and not through app code. The
 * app's code is checked against the same rules in my-card-share-service.mjs.
 *
 * No production project, no credentials, no real data.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, collection, collectionGroup, writeBatch,
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  // The emulator run names a throwaway demo- project (`emulators:exec --project`); there is no fallback.
  projectId: process.env.GCLOUD_PROJECT,
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();

const U = 'U';
const OTHER = 'OTHER';
const CARD = (uid) => `users/${uid}/card/main`;
const PUB = (id) => `publicCards/${id}`;
const REG = (id) => `publicIds/${id}`;
const ID1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const ID2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const ID3 = 'Cc_-Cc_-Cc_-Cc_-Cc_-Cc';
const T0 = '2026-11-28T10:00:00.000Z';
const T1 = '2026-11-28T11:00:00.000Z';

const asAdmin = async (fn) => {
  let value;
  await env.withSecurityRulesDisabled(async (ctx) => { value = await fn(ctx.firestore()); });
  return value;
};
const read = (path) => asAdmin(async (db) => { const snap = await getDoc(doc(db, path)); return snap.exists() ? snap.data() : undefined; });
const seed = (path, data) => asAdmin((db) => setDoc(doc(db, path), data));
const wipe = (path) => asAdmin((db) => deleteDoc(doc(db, path)));
const owner = () => env.authenticatedContext(U).firestore();
const other = () => env.authenticatedContext(OTHER).firestore();
const anon = () => env.unauthenticatedContext().firestore();

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
const ok = (promise, what) => expectCode(promise, 'ok', what);
const denied = (promise, what) => expectCode(promise, 'permission-denied', what);

// ── Fixtures ────────────────────────────────────────────────────────────────

const SHARE_OFF = {
  photoUrl: false, title: false, organization: false, email: false, phone: false, linkedinUrl: false,
  instagram: false, website: false, link1: false, link2: false, link3: false, link4: false, link5: false,
};
const FIELDS = ['photoUrl', 'title', 'organization', 'email', 'phone', 'linkedinUrl', 'instagram', 'website'];
const LINKS = ['link1', 'link2', 'link3', 'link4', 'link5'];

/** A schema 2 card as the service stores it: unpublished, with a shared email and title. */
const card2 = (extra = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', photoUrl: '', title: 'Analyst', organization: 'Analytical Engines', email: 'ada@example.com',
  phone: '+1 555 010 0000', linkedinUrl: 'https://www.linkedin.com/in/ada', instagram: 'ada', website: 'https://example.com/',
  share: { ...SHARE_OFF, title: true, email: true }, sharingEnabled: false,
  schemaVersion: 2, revision: 1, createdAt: T0, updatedAt: T0, ...extra,
});
/** An independent copy of what the public document must be, for a live card. */
const publicOf = (card) => {
  const out = { firstName: card.firstName, lastName: card.lastName, revision: card.revision, schemaVersion: 2, updatedAt: card.updatedAt };
  for (const f of FIELDS) if (card.share[f] === true && card[f] !== '') out[f] = card[f];
  for (const f of LINKS) if (card.share[f] === true && card[f]) out[f] = card[f];
  return out;
};
/** The card after a publish at `id`. */
const published = (card, id, extra = {}) => ({
  ...card, sharingEnabled: true, publicId: id, publishedAt: card.publishedAt ?? T1, revision: card.revision + 1, updatedAt: T1, ...extra,
});
const reg = (uid = U) => ({ ownerUid: uid, createdAt: T1 });

/** Every owner action is one batch, like the transaction the service will use. */
const batch = (db, ops) => {
  const b = writeBatch(db);
  for (const [kind, path, data] of ops) {
    if (kind === 'set') b.set(doc(db, path), data);
    else b.delete(doc(db, path));
  }
  return b.commit();
};
const publishOps = (card, id, extra = {}) => {
  const next = published(card, id, extra);
  return { next, ops: [['set', CARD(U), next], ['set', REG(id), reg()], ['set', PUB(id), publicOf(next)]] };
};

const ACTIVE = { accountStatus: 'active', displayName: 'Ada' };
async function reset({ account = ACTIVE, card = card2() } = {}) {
  await asAdmin(async (db) => {
    for (const path of [CARD(U), CARD(OTHER), PUB(ID1), PUB(ID2), PUB(ID3), REG(ID1), REG(ID2), REG(ID3), `users/${U}`, `users/${OTHER}`]) {
      await deleteDoc(doc(db, path));
    }
  });
  await seed(`users/${U}`, account);
  await seed(`users/${OTHER}`, ACTIVE);
  if (card) await seed(CARD(U), card);
}
/** A card that is live at ID1, seeded as the rules would have left it. */
async function live({ card = card2(), id = ID1 } = {}) {
  await reset({ card });
  const next = published(card, id);
  await seed(CARD(U), next);
  await seed(REG(id), reg());
  await seed(PUB(id), publicOf(next));
  return next;
}

// ── S1, S2: ownership ───────────────────────────────────────────────────────

check('S1: publishing is one write of the card, the registry entry and the public copy, and the public copy then reads', async () => {
  await reset();
  const { next, ops } = publishOps(card2(), ID1);
  await ok(batch(owner(), ops), 'owner publishes');
  assert((await read(REG(ID1))).ownerUid === U, 'the registry names the owner');
  const seen = await read(PUB(ID1));
  assert(seen.firstName === 'Ada' && seen.email === 'ada@example.com' && seen.title === 'Analyst', 'public copy has the shared fields');
  assert(!('phone' in seen) && !('website' in seen) && !('linkedinUrl' in seen) && !('instagram' in seen), 'and not the private ones');
  assert(next.sharingEnabled === true && (await read(CARD(U))).publicId === ID1, 'the private card names the ID');
});

check('S1: the registry is create-once with its owner, and no client reads, updates or deletes it', async () => {
  await live();
  await denied(setDoc(doc(owner(), REG(ID1)), reg()), 'owner overwrite of a registry entry');
  await denied(updateDoc(doc(owner(), REG(ID1)), { createdAt: T0 }), 'owner update of a registry entry');
  await denied(deleteDoc(doc(owner(), REG(ID1))), 'owner delete of a registry entry');
  await denied(getDoc(doc(owner(), REG(ID1))), 'owner read of a registry entry');
  await denied(getDocs(collection(owner(), 'publicIds')), 'owner list of the registry');
  await denied(getDoc(doc(anon(), REG(ID1))), 'anonymous read of a registry entry');
  await denied(getDocs(collection(other(), 'publicIds')), 'other list of the registry');
  assert((await read(REG(ID1))).ownerUid === U, 'the entry is intact');
});

check('S1: a registry entry names its writer, has exactly its two fields, and needs a real ID', async () => {
  await reset();
  const next = published(card2(), ID1);
  const withCard = (path, data) => batch(owner(), [['set', CARD(U), next], ['set', path, data]]);
  await denied(withCard(REG(ID1), { ownerUid: OTHER, createdAt: T1 }), 'registered to someone else');
  await denied(withCard(REG(ID1), { ownerUid: U }), 'no createdAt');
  await denied(withCard(REG(ID1), { ownerUid: U, createdAt: T1, extra: 1 }), 'an extra field');
  await denied(withCard(REG(ID1), { ownerUid: U, createdAt: 'yesterday' }), 'a createdAt that is not a time');
  await denied(batch(owner(), [['set', CARD(U), published(card2(), 'short')], ['set', REG('short'), reg()]]), 'an ID that is not 22 characters');
  await denied(batch(owner(), [['set', CARD(U), published(card2(), `${ID1.slice(0, 21)}!`)], ['set', REG(`${ID1.slice(0, 21)}!`), reg()]]), 'an ID with a character outside base64url');
  assert((await read(CARD(U))).revision === 1, 'the card is unchanged');
});

check('S1: an ID cannot be registered ahead of time: the registry entry needs the card to name it in the same write', async () => {
  await reset();
  await denied(setDoc(doc(owner(), REG(ID2)), reg()), 'a registry entry on its own');
  await denied(batch(owner(), [['set', CARD(U), published(card2(), ID1)], ['set', REG(ID2), reg()]]), 'a registry entry for an ID the card does not name');
  assert((await read(REG(ID2))) === undefined, 'nothing registered');
});

check('S2: another user cannot create, overwrite or delete a public copy, or register an ID that is taken', async () => {
  await live();
  const before = await read(PUB(ID1));
  const tampered = { ...before, firstName: 'Mallory' };
  await denied(setDoc(doc(other(), PUB(ID1)), tampered), 'other overwrite');
  await denied(updateDoc(doc(other(), PUB(ID1)), { firstName: 'Mallory' }), 'other update');
  await denied(deleteDoc(doc(other(), PUB(ID1))), 'other delete');
  await denied(setDoc(doc(anon(), PUB(ID1)), tampered), 'anonymous overwrite');
  await denied(deleteDoc(doc(anon(), PUB(ID1))), 'anonymous delete');
  // Another account naming an ID that is already registered to the owner.
  await seed(CARD(OTHER), card2({ firstName: 'Mallory' }));
  const claim = published(card2({ firstName: 'Mallory' }), ID1);
  await denied(batch(other(), [['set', CARD(OTHER), claim], ['set', REG(ID1), reg(OTHER)], ['set', PUB(ID1), publicOf(claim)]]), 'registering a taken ID');
  await denied(batch(other(), [['set', CARD(OTHER), claim], ['set', PUB(ID1), publicOf(claim)]]), 'naming a taken ID without registering it');
  assert(JSON.stringify(await read(PUB(ID1))) === JSON.stringify(before), 'the owner\'s public copy is unchanged');
  assert((await read(REG(ID1))).ownerUid === U, 'and the ID is still the owner\'s');
});

check('S2: the owner\'s public copy cannot be written under an ID the registry gives to someone else', async () => {
  await live();
  await seed(REG(ID3), reg(OTHER));
  const next = published(card2(), ID3, { revision: 3 });
  await denied(batch(owner(), [['set', CARD(U), next], ['set', PUB(ID3), publicOf(next)]]), 'owner writing at another user\'s ID');
});

// ── S3: Reset Link ──────────────────────────────────────────────────────────

check('S3: Reset Link is one write: a new ID, the old public copy gone, the new one live; the old registry entry stays', async () => {
  const before = await live();
  const next = { ...before, publicId: ID2, revision: 3, updatedAt: T1 };
  await ok(batch(owner(), [['set', CARD(U), next], ['set', REG(ID2), reg()], ['delete', PUB(ID1)], ['set', PUB(ID2), publicOf(next)]]), 'reset');
  assert((await read(PUB(ID1))) === undefined, 'the old public copy is gone');
  assert((await read(PUB(ID2))).firstName === 'Ada', 'the new one is live');
  assert((await read(REG(ID1))).ownerUid === U && (await read(REG(ID2))).ownerUid === U, 'both IDs stay registered');
  assert((await read(CARD(U))).publishedAt === before.publishedAt, 'publishedAt keeps the first publish time');
});

check('S3: Reset Link that leaves the old public copy behind, or skips the new one, is refused', async () => {
  const before = await live();
  const next = { ...before, publicId: ID2, revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), next], ['set', REG(ID2), reg()], ['set', PUB(ID2), publicOf(next)]]), 'old public copy left behind');
  await denied(batch(owner(), [['set', CARD(U), next], ['set', REG(ID2), reg()], ['delete', PUB(ID1)]]), 'no new public copy');
  await denied(batch(owner(), [['set', CARD(U), next], ['delete', PUB(ID1)], ['set', PUB(ID2), publicOf(next)]]), 'no registry entry for the new ID');
  assert((await read(PUB(ID1))).firstName === 'Ada' && (await read(CARD(U))).publicId === ID1, 'nothing changed');
});

check('S3: a retired ID can never be named again, live or off, by reset or by a plain save', async () => {
  const before = await live();
  const next = { ...before, publicId: ID2, revision: 3, updatedAt: T1 };
  await batch(owner(), [['set', CARD(U), next], ['set', REG(ID2), reg()], ['delete', PUB(ID1)], ['set', PUB(ID2), publicOf(next)]]);
  const back = { ...next, publicId: ID1, revision: 4 };
  await denied(batch(owner(), [['set', CARD(U), back], ['delete', PUB(ID2)], ['set', PUB(ID1), publicOf(back)]]), 'resetting back to the retired ID');
  await denied(batch(owner(), [['set', CARD(U), back], ['delete', PUB(ID2)], ['set', REG(ID1), reg()], ['set', PUB(ID1), publicOf(back)]]), 'resetting back and re-registering it');
  await denied(setDoc(doc(owner(), PUB(ID1)), publicOf(next)), 'writing a public copy at the retired ID');
  const off = { ...next, sharingEnabled: false, publicId: ID1, revision: 4 };
  await denied(batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID2)]]), 'switching off while naming the retired ID');
  assert((await read(CARD(U))).publicId === ID2, 'the card still names the current ID');
});

check('S3: Reset Link also works while sharing is off, and the new ID is registered too', async () => {
  const before = await live();
  const off = { ...before, sharingEnabled: false, revision: 3 };
  await ok(batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID1)]]), 'turn off');
  const next = { ...off, publicId: ID2, revision: 4 };
  await ok(batch(owner(), [['set', CARD(U), next], ['set', REG(ID2), reg()]]), 'reset while off');
  assert((await read(PUB(ID2))) === undefined && (await read(CARD(U))).publicId === ID2, 'new ID named, nothing public');
});

// ── S4: public deletion ─────────────────────────────────────────────────────

check('S4: a public copy cannot be deleted on its own while the card is live', async () => {
  await live();
  await denied(deleteDoc(doc(owner(), PUB(ID1))), 'standalone delete');
  assert((await read(PUB(ID1))) !== undefined, 'still there');
});

check('S4: turning sharing off is one write that deletes the public copy; leaving the copy behind is refused', async () => {
  const before = await live();
  const off = { ...before, sharingEnabled: false, revision: 3, updatedAt: T1 };
  await denied(setDoc(doc(owner(), CARD(U)), off), 'off without deleting the public copy');
  await ok(batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID1)]]), 'off and delete');
  assert((await read(PUB(ID1))) === undefined && (await read(CARD(U))).sharingEnabled === false, 'off and gone');
  assert((await read(CARD(U))).publicId === ID1 && (await read(REG(ID1))) !== undefined, 'the ID is kept');
});

check('S4: a public copy can be deleted on its own once the card is off', async () => {
  const before = await live();
  await seed(CARD(U), { ...before, sharingEnabled: false, revision: 3 });
  await ok(deleteDoc(doc(owner(), PUB(ID1))), 'tidy up a leftover copy');
});

check('S4: turning back on recreates the public copy at the same ID', async () => {
  const before = await live();
  const off = { ...before, sharingEnabled: false, revision: 3, updatedAt: T1 };
  await batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID1)]]);
  const on = { ...off, sharingEnabled: true, revision: 4, updatedAt: T1 };
  await denied(setDoc(doc(owner(), CARD(U)), on), 'on without a public copy');
  await ok(batch(owner(), [['set', CARD(U), on], ['set', PUB(ID1), publicOf(on)]]), 'on again');
  assert((await read(CARD(U))).publicId === ID1 && (await read(PUB(ID1))).revision === 4, 'same ID, current revision');
});

// ── S5: no stale or missing public copy ─────────────────────────────────────

check('S5: a live card cannot be saved without its public copy moving to the same revision', async () => {
  const before = await live();
  const edit = { ...before, title: 'Director', share: { ...before.share }, revision: 3, updatedAt: T1 };
  await denied(setDoc(doc(owner(), CARD(U)), edit), 'save without the public copy');
  await denied(batch(owner(), [['set', CARD(U), edit], ['set', PUB(ID1), { ...publicOf(edit), revision: 2 }]]), 'public copy at the old revision');
  await denied(batch(owner(), [['set', CARD(U), edit], ['set', PUB(ID1), { ...publicOf(edit), title: 'Analyst' }]]), 'public copy with the old title');
  await ok(batch(owner(), [['set', CARD(U), edit], ['set', PUB(ID1), publicOf(edit)]]), 'save with the public copy');
  assert((await read(PUB(ID1))).title === 'Director', 'the public copy follows');
});

check('S5: a public copy cannot be rewritten by itself to differ from the card, or ahead of it', async () => {
  const before = await live();
  await denied(setDoc(doc(owner(), PUB(ID1)), { ...publicOf(before), title: 'CEO' }), 'a different title');
  await denied(setDoc(doc(owner(), PUB(ID1)), { ...publicOf(before), revision: 9 }), 'a revision the card has not reached');
  await ok(setDoc(doc(owner(), PUB(ID1)), publicOf(before)), 'rewriting it exactly as it is');
});

check('S5: the public copy is created only while the card is live, at its own ID', async () => {
  await reset();
  await denied(setDoc(doc(owner(), PUB(ID1)), publicOf(published(card2(), ID1))), 'a public copy for an unpublished card');
  const { next, ops } = publishOps(card2(), ID1);
  await denied(batch(owner(), [ops[0], ops[1], ['set', PUB(ID2), publicOf(next)]]), 'a public copy at an ID the card does not name');
  await denied(batch(owner(), [['set', CARD(U), { ...next, sharingEnabled: false }], ops[1], ops[2]]), 'a public copy for a card that is off');
});

// ── S6: stale builds and revisions ──────────────────────────────────────────

check('S6: sharing needs schema 2 and the next revision', async () => {
  await reset({ card: null });
  await seed(CARD(U), card2({ schemaVersion: 1, share: { photoUrl: false, title: true, organization: false, email: true, phone: false, linkedinUrl: false, instagram: false, website: false } }));
  const v1 = (await read(CARD(U)));
  const asV1 = { ...v1, sharingEnabled: true, publicId: ID1, publishedAt: T1, revision: 2 };
  await denied(batch(owner(), [['set', CARD(U), asV1], ['set', REG(ID1), reg()], ['set', PUB(ID1), publicOf(published(card2(), ID1, { revision: 2 }))]]), 'publishing a schema 1 card');
  const skip = published(card2({ revision: 1 }), ID1, { revision: 5 });
  await seed(CARD(U), card2());
  await denied(batch(owner(), [['set', CARD(U), skip], ['set', REG(ID1), reg()], ['set', PUB(ID1), publicOf(skip)]]), 'publishing at a revision that is not the next');
  assert((await read(REG(ID1))) === undefined, 'nothing registered');
});

check('S6: an old build cannot drop the public ID, roll the schema back or turn sharing off without the public copy', async () => {
  const before = await live();
  const old = {
    firstName: 'Ada', lastName: 'Lovelace', photoUrl: '', title: 'Analyst', organization: '', email: 'ada@example.com', phone: '', linkedinUrl: '', instagram: '', website: '',
    share: { photoUrl: false, title: true, organization: false, email: true, phone: false, linkedinUrl: false, instagram: false, website: false },
    sharingEnabled: false, schemaVersion: 1, revision: 3, createdAt: T0, updatedAt: T1,
  };
  await denied(setDoc(doc(owner(), CARD(U)), old), 'a schema 1 save over a published card');
  await denied(batch(owner(), [['set', CARD(U), old], ['delete', PUB(ID1)]]), 'a schema 1 save that also deletes the public copy');
  const dropped = { ...before, revision: 3 }; delete dropped.publicId; delete dropped.publishedAt;
  await denied(batch(owner(), [['set', CARD(U), { ...dropped, sharingEnabled: false }], ['delete', PUB(ID1)]]), 'a schema 2 save without publicId');
  await denied(setDoc(doc(owner(), CARD(U)), { ...before, schemaVersion: 1, revision: 3 }), 'schema 2 to 1');
  await denied(updateDoc(doc(owner(), CARD(U)), { revision: 3, schemaVersion: 3 }), 'a partial update that changes the schema');
  assert((await read(CARD(U))).publicId === ID1, 'the card still names its ID');
});

check('S6: the first publish time is kept, and stays with the card through a reset', async () => {
  const before = await live();
  const edit = { ...before, publishedAt: '2026-12-01T00:00:00.000Z', revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), edit], ['set', PUB(ID1), publicOf(edit)]]), 'changing publishedAt');
  const noTime = { ...before, revision: 3 }; delete noTime.publishedAt;
  await denied(batch(owner(), [['set', CARD(U), noTime], ['set', PUB(ID1), publicOf(noTime)]]), 'dropping publishedAt');
});

check('S6: a card names an ID and a publish time together, never one without the other', async () => {
  await reset();
  const next = published(card2(), ID1);
  const noTime = { ...next }; delete noTime.publishedAt;
  await denied(batch(owner(), [['set', CARD(U), noTime], ['set', REG(ID1), reg()], ['set', PUB(ID1), publicOf(next)]]), 'publicId without publishedAt');
  const noId = { ...card2(), publishedAt: T1, revision: 2 };
  await denied(setDoc(doc(owner(), CARD(U)), noId), 'publishedAt without publicId');
  await denied(setDoc(doc(owner(), CARD(U)), card2({ sharingEnabled: true, revision: 2 })), 'sharing on with no ID');
});

check('S6: a new card starts private and unpublished', async () => {
  await reset({ card: null });
  await denied(setDoc(doc(owner(), CARD(U)), card2({ sharingEnabled: true, publicId: ID1, publishedAt: T1 })), 'created live');
  await denied(setDoc(doc(owner(), CARD(U)), card2({ publicId: ID1, publishedAt: T1 })), 'created with an ID');
  await ok(setDoc(doc(owner(), CARD(U)), card2()), 'created private');
});

// ── S7, S8: suspension and takedown ─────────────────────────────────────────

check('S7: a suspended account cannot publish, turn back on or reset, but can always turn sharing off', async () => {
  const before = await live();
  await seed(`users/${U}`, { ...ACTIVE, accountStatus: 'suspended' });
  const edit = { ...before, title: 'Director', revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), edit], ['set', PUB(ID1), publicOf(edit)]]), 'saving a live card');
  const reset2 = { ...before, publicId: ID2, revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), reset2], ['set', REG(ID2), reg()], ['delete', PUB(ID1)], ['set', PUB(ID2), publicOf(reset2)]]), 'Reset Link');
  const off = { ...before, sharingEnabled: false, revision: 3, updatedAt: T1 };
  await ok(batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID1)]]), 'turning off');
  const on = { ...off, sharingEnabled: true, revision: 4 };
  await denied(batch(owner(), [['set', CARD(U), on], ['set', PUB(ID1), publicOf(on)]]), 're-enabling');
  await reset({ account: { ...ACTIVE, accountStatus: 'suspended' } });
  const first = publishOps(card2(), ID1);
  await denied(batch(owner(), first.ops), 'a first publish');
});

check('S7: a taken-down card cannot be republished or reset, and the owner cannot lift the block', async () => {
  const before = await live();
  await seed(`users/${U}`, { ...ACTIVE, myCardPublishBlocked: true });
  const reset2 = { ...before, publicId: ID2, revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), reset2], ['set', REG(ID2), reg()], ['delete', PUB(ID1)], ['set', PUB(ID2), publicOf(reset2)]]), 'Reset Link');
  await denied(updateDoc(doc(owner(), `users/${U}`), { myCardPublishBlocked: false }), 'owner lifting the block');
  await denied(updateDoc(doc(owner(), `users/${U}`), { myCardPublishBlocked: deleteField() }), 'owner removing the block');
  await seed(`users/${U}`, { ...ACTIVE, accountStatus: 'suspended', myCardPublishBlocked: true });
  await denied(updateDoc(doc(owner(), `users/${U}`), { accountStatus: 'active' }), 'owner reactivating themselves');
  await ok(updateDoc(doc(owner(), `users/${U}`), { displayName: 'Ada L.' }), 'an ordinary profile write still works');
  assert((await read(`users/${U}`)).myCardPublishBlocked === true, 'the block survives ordinary user writes');
});

check('S7: myCardPublishBlocked is server-controlled: a user cannot set it on their own account, new or existing', async () => {
  await reset();
  await denied(updateDoc(doc(owner(), `users/${U}`), { myCardPublishBlocked: true }), 'update');
  await denied(setDoc(doc(owner(), `users/${U}`), { ...ACTIVE, myCardPublishBlocked: false }), 'overwrite');
  const fresh = env.authenticatedContext('FRESH').firestore();
  await denied(setDoc(doc(fresh, 'users/FRESH'), { displayName: 'New', myCardPublishBlocked: false }), 'create');
});

check('S8: suspension and takedown, done by the admin functions (Admin SDK), leave no public card; republishing is then refused', async () => {
  const before = await live();
  // What adminSuspendAccount / adminTakedownMyCard do: public copy deleted, card switched off, flag set.
  await asAdmin(async (db) => {
    await deleteDoc(doc(db, PUB(ID1)));
    await setDoc(doc(db, CARD(U)), { ...before, sharingEnabled: false, revision: 3 });
    await setDoc(doc(db, `users/${U}`), { ...ACTIVE, accountStatus: 'suspended', myCardPublishBlocked: true });
  });
  assert(!(await getDoc(doc(anon(), PUB(ID1)))).exists(), 'a visitor finds nothing at the removed copy');
  assert((await read(PUB(ID1))) === undefined, 'the public copy is gone');
  const on = { ...before, sharingEnabled: true, revision: 4, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), on], ['set', PUB(ID1), publicOf(on)]]), 'republishing');
  assert((await read(REG(ID1))).ownerUid === U, 'the ID stays bound to its owner');
});

// ── P1–P4: what is public ───────────────────────────────────────────────────

check('P1: anonymous visitors and strangers cannot read private cards; the public copy reads by ID but cannot be listed', async () => {
  await live();
  for (const [who, db] of [['anonymous', anon()], ['other', other()]]) {
    await denied(getDoc(doc(db, CARD(U))), `${who} private card`);
    await denied(getDocs(collection(db, `users/${U}/card`)), `${who} card folder`);
    await denied(getDocs(collectionGroup(db, 'card')), `${who} collection-group search`);
    await ok(getDoc(doc(db, PUB(ID1))), `${who} public copy by ID`);
    await denied(getDocs(collection(db, 'publicCards')), `${who} listing public cards`);
    await denied(getDocs(collectionGroup(db, 'publicCards')), `${who} collection-group listing`);
  }
  const seen = (await getDoc(doc(anon(), PUB(ID1)))).data();
  assert(seen.firstName === 'Ada' && !('ownerUid' in seen) && !('publicId' in seen) && !('sharingEnabled' in seen), 'the public copy names no owner and has no private fields');
});

check('P1: a public copy is not readable at an ID that is not a well-formed ID', async () => {
  await seed(PUB('short'), { firstName: 'x' });
  await denied(getDoc(doc(anon(), PUB('short'))), 'a short ID');
  await asAdmin((db) => deleteDoc(doc(db, PUB('short'))));
});

check('P2: the public copy holds exactly the Shared, non-empty fields: each of the eight, in both directions', async () => {
  for (const field of FIELDS) {
    // Private: the field must be absent. Shared: it must be present and equal.
    const value = field === 'photoUrl' ? 'https://example.com/ada.jpg' : card2()[field];
    const hidden = card2({ [field]: value, share: { ...SHARE_OFF, email: true, [field]: false } });
    if (field === 'email') hidden.share.phone = true;
    await reset({ card: hidden });
    const hiddenPublish = publishOps(hidden, ID1);
    await ok(batch(owner(), hiddenPublish.ops), `${field} Private, absent`);
    await reset({ card: hidden });
    await denied(batch(owner(), [hiddenPublish.ops[0], hiddenPublish.ops[1], ['set', PUB(ID1), { ...publicOf(hiddenPublish.next), [field]: value }]]), `${field} Private but present`);

    const shared = card2({ [field]: value, share: { ...SHARE_OFF, email: true, [field]: true } });
    await reset({ card: shared });
    const sharedPublish = publishOps(shared, ID1);
    await ok(batch(owner(), sharedPublish.ops), `${field} Shared, present`);
    await reset({ card: shared });
    const missing = publicOf(sharedPublish.next); if (field !== 'email') delete missing[field];
    if (field !== 'email') await denied(batch(owner(), [sharedPublish.ops[0], sharedPublish.ops[1], ['set', PUB(ID1), missing]]), `${field} Shared but missing`);
    await denied(batch(owner(), [sharedPublish.ops[0], sharedPublish.ops[1], ['set', PUB(ID1), { ...publicOf(sharedPublish.next), [field]: `${value}x` }]]), `${field} Shared but altered`);
  }
});

check('P2: a Shared field with no value is absent, never an empty string', async () => {
  const noTitle = card2({ title: '', share: { ...SHARE_OFF, email: true, title: true } });
  await reset({ card: noTitle });
  const p = publishOps(noTitle, ID1);
  await ok(batch(owner(), p.ops), 'absent');
  await reset({ card: noTitle });
  await denied(batch(owner(), [p.ops[0], p.ops[1], ['set', PUB(ID1), { ...publicOf(p.next), title: '' }]]), 'empty string');
});

check('P2: the public copy has exactly its key set: nothing extra, nothing from the private card, and the name always', async () => {
  await reset();
  const p = publishOps(card2(), ID1);
  for (const [what, extra] of [
    ['ownerUid', { ownerUid: U }], ['sharingEnabled', { sharingEnabled: true }], ['share', { share: SHARE_OFF }], ['publicId', { publicId: ID1 }],
    ['createdAt', { createdAt: T0 }], ['unknown', { notes: 'private' }], ['a private field', { phone: '+1 555 010 0000' }],
  ]) {
    await denied(batch(owner(), [p.ops[0], p.ops[1], ['set', PUB(ID1), { ...publicOf(p.next), ...extra }]]), `extra: ${what}`);
  }
  for (const key of ['firstName', 'lastName', 'revision', 'schemaVersion', 'updatedAt']) {
    const missing = publicOf(p.next); delete missing[key];
    await denied(batch(owner(), [p.ops[0], p.ops[1], ['set', PUB(ID1), missing]]), `missing: ${key}`);
  }
  await denied(batch(owner(), [p.ops[0], p.ops[1], ['set', PUB(ID1), { ...publicOf(p.next), firstName: 'Grace' }]]), 'a different name');
  await denied(batch(owner(), [p.ops[0], p.ops[1], ['set', PUB(ID1), { ...publicOf(p.next), schemaVersion: 1 }]]), 'schema 1');
  await ok(batch(owner(), p.ops), 'the exact copy');
});

check('P3: switching a field to Private removes it from the public copy in the same save, and the save is refused otherwise', async () => {
  const before = await live();
  const next = { ...before, share: { ...before.share, email: false, phone: true }, revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), next], ['set', PUB(ID1), publicOf(before)]]), 'the old copy, email still public');
  await denied(batch(owner(), [['set', CARD(U), next], ['set', PUB(ID1), { ...publicOf(next), email: before.email }]]), 'email kept in the new copy');
  await ok(batch(owner(), [['set', CARD(U), next], ['set', PUB(ID1), publicOf(next)]]), 'the copy follows the switch');
  const seen = await read(PUB(ID1));
  assert(!('email' in seen) && seen.phone === next.phone, 'email is gone and phone is there');
});

check('P3: clearing a shared value removes it from the public copy; a changed value is the new value', async () => {
  const before = await live();
  const cleared = { ...before, title: '', revision: 3, updatedAt: T1 };
  await ok(batch(owner(), [['set', CARD(U), cleared], ['set', PUB(ID1), publicOf(cleared)]]), 'cleared');
  assert(!('title' in (await read(PUB(ID1)))), 'title is gone');
  const changed = { ...cleared, email: 'ada@new.example.com', revision: 4 };
  await ok(batch(owner(), [['set', CARD(U), changed], ['set', PUB(ID1), publicOf(changed)]]), 'changed');
  assert((await read(PUB(ID1))).email === 'ada@new.example.com', 'the new email');
});

check('P4: the publish gate: a name and one Shared contact method, only while live; turning off is always allowed', async () => {
  const noContact = card2({ share: { ...SHARE_OFF, title: true } });
  await reset({ card: noContact });
  await denied(batch(owner(), publishOps(noContact, ID1).ops), 'no Shared contact method');
  const linksOnly = card2({ share: { ...SHARE_OFF, title: true, link1: true }, link1: { label: 'Book', url: 'https://cal.example.com/ada' } });
  await reset({ card: linksOnly });
  await denied(batch(owner(), publishOps(linksOnly, ID1).ops), 'additional links alone do not count');
  const noName = card2({ firstName: '', lastName: '' });
  await reset({ card: noName });
  await denied(batch(owner(), publishOps(noName, ID1).ops), 'no name');
  const lastOnly = card2({ firstName: '' });
  await reset({ card: lastOnly });
  await ok(batch(owner(), publishOps(lastOnly, ID1).ops), 'one name part is enough');

  const before = await live();
  const lost = { ...before, share: { ...before.share, email: false }, revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), lost], ['set', PUB(ID1), publicOf(lost)]]), 'removing the last contact method while live');
  await ok(batch(owner(), [['set', CARD(U), { ...lost, sharingEnabled: false }], ['delete', PUB(ID1)]]), 'save and turn off sharing');
  assert((await read(CARD(U))).share.email === false && (await read(PUB(ID1))) === undefined, 'saved, and nothing public');
});

check('P4: information never has to stay public: an off card keeps every value private and may have any switches', async () => {
  const before = await live();
  const off = { ...before, sharingEnabled: false, share: { ...SHARE_OFF }, revision: 3, updatedAt: T1 };
  await ok(batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID1)]]), 'everything private');
});

// ── Additional links ────────────────────────────────────────────────────────

const link = (label = 'Book a meeting', url = 'https://calendly.com/ada') => ({ label, url });
const withLink = (l, extra = {}) => card2({ link1: l, share: { ...SHARE_OFF, email: true, link1: true }, ...extra });

check('links: a valid link is saved, published, and public only while its own switch is on', async () => {
  const c = withLink(link());
  await reset({ card: c });
  const p = publishOps(c, ID1);
  await ok(batch(owner(), p.ops), 'a Shared link');
  assert(JSON.stringify((await read(PUB(ID1))).link1) === JSON.stringify(link()), 'the link is public');

  const hidden = card2({ link1: link(), share: { ...SHARE_OFF, email: true, link1: false } });
  await reset({ card: hidden });
  const hp = publishOps(hidden, ID1);
  await denied(batch(owner(), [hp.ops[0], hp.ops[1], ['set', PUB(ID1), { ...publicOf(hp.next), link1: link() }]]), 'a Private link in the public copy');
  await ok(batch(owner(), hp.ops), 'a Private link left out');
  assert(!('link1' in (await read(PUB(ID1)))), 'and it is absent');
});

check('links: all five slots, each with its own switch', async () => {
  const c = card2({
    link1: link('One', 'https://one.example.com/'), link2: link('Two', 'https://two.example.com/a?b=c#d'), link3: link('Three', 'https://three.example.com'),
    link4: link('Four', 'https://four.example.com:8443/x'), link5: link('Five', 'https://five.example.com/'),
    share: { ...SHARE_OFF, email: true, link1: true, link2: false, link3: true, link4: false, link5: true },
  });
  await reset({ card: c });
  const p = publishOps(c, ID1);
  await ok(batch(owner(), p.ops), 'publish');
  const seen = await read(PUB(ID1));
  assert('link1' in seen && 'link3' in seen && 'link5' in seen && !('link2' in seen) && !('link4' in seen), 'only the Shared slots are public');
});

check('links: a Private link cannot become public when the slots are rearranged', async () => {
  const before = await live({ card: withLink(link('Public one', 'https://public.example.com/'), { link2: link('Secret', 'https://secret.example.com/'), share: { ...SHARE_OFF, email: true, link1: true, link2: false } }) });
  // Moving the secret link into slot 1 without its switch would publish it: the copy must say so, and the copy is checked field by field.
  const swapped = { ...before, link1: before.link2, link2: before.link1, revision: 3, updatedAt: T1 };
  await denied(batch(owner(), [['set', CARD(U), swapped], ['set', PUB(ID1), { ...publicOf(before), revision: 3, updatedAt: T1 }]]), 'the old copy after a swap');
  await ok(batch(owner(), [['set', CARD(U), swapped], ['set', PUB(ID1), publicOf(swapped)]]), 'a swap whose switches the copy follows exactly');
  // A copy that carries the Private slot's link into a Shared slot of its own is refused.
  const wrong = { ...publicOf(swapped), link2: swapped.link2 };
  await denied(setDoc(doc(owner(), PUB(ID1)), wrong), 'the Private slot written to the copy');
});

check('links: shape: https only, no spaces, no user@ credentials, label 1 to 40, url 500, exactly two keys', async () => {
  const bad = [
    ['http', link('x', 'http://example.com/')], ['javascript', link('x', 'javascript:alert(1)')], ['data', link('x', 'data:text/html,hi')],
    ['mailto', link('x', 'mailto:a@example.com')], ['no scheme', link('x', 'example.com')], ['space in url', link('x', 'https://exa mple.com/')],
    ['space after host', link('x', 'https://example.com/a b')], ['credentials', link('x', 'https://user@example.com/')],
    ['credentials with a password', link('x', 'https://user:pw@example.com/')], ['empty host', link('x', 'https:///path')],
    ['empty label', link('', 'https://example.com/')], ['blank label', link('   ', 'https://example.com/')], ['41-character label', link('x'.repeat(41), 'https://example.com/')],
    ['501-character url', link('x', `https://example.com/${'a'.repeat(501 - 'https://example.com/'.length)}`)], ['a label with a line break', link('a\nb', 'https://example.com/')],
    ['an extra key', { ...link(), icon: 'x' }], ['no url', { label: 'x' }], ['no label', { url: 'https://example.com/' }],
    ['a url that is not text', link('x', 42)], ['a label that is not text', link(7, 'https://example.com/')], ['a text link', 'https://example.com/'],
  ];
  for (const [what, value] of bad) {
    await reset();
    await denied(setDoc(doc(owner(), CARD(U)), card2({ link1: value, revision: 2 })), `link: ${what}`);
  }
  const good = [
    ['a plain https link', link('x', 'https://example.com/')], ['a 40-character label', link('x'.repeat(40), 'https://example.com/')],
    ['a 500-character url', link('x', `https://example.com/${'a'.repeat(500 - 'https://example.com/'.length)}`)],
    ['a query and fragment', link('x', 'https://example.com/a?b=c&d=e#f')], ['a port', link('x', 'https://example.com:8443/')],
    ['an @ in the query, not the host', link('x', 'https://example.com/?email=a@b.co')], ['a label with spaces and punctuation', link('Book a 30-min call', 'https://example.com/')],
    ['a non-Latin label', link('予約する', 'https://example.com/')],
  ];
  for (const [what, value] of good) {
    await reset();
    await ok(setDoc(doc(owner(), CARD(U)), card2({ link1: value, revision: 2 })), `link: ${what}`);
  }
  await reset();
  await denied(setDoc(doc(owner(), CARD(U)), card2({ link6: link(), revision: 2 })), 'a sixth slot');
  await denied(setDoc(doc(owner(), CARD(U)), card2({ links: [link()], revision: 2 })), 'a list of links');
  await denied(setDoc(doc(owner(), CARD(U)), card2({ share: { ...SHARE_OFF, link6: true }, revision: 2 })), 'a sixth switch');
  const noLinkSwitches = card2({ revision: 2 }); for (const l of LINKS) delete noLinkSwitches.share[l];
  await denied(setDoc(doc(owner(), CARD(U)), noLinkSwitches), 'a schema 2 card without the five link switches');
  await denied(setDoc(doc(owner(), CARD(U)), card2({ share: { ...SHARE_OFF, link3: 'yes' }, revision: 2 })), 'a link switch that is not true or false');
});

// ── Attribution and limits ──────────────────────────────────────────────────

check('attribution: signupSource "card" is accepted on a new account, with the billing shape unchanged', async () => {
  const fresh = env.authenticatedContext('SIGNUP1').firestore();
  await ok(setDoc(doc(fresh, 'users/SIGNUP1'), { email: 'new@example.com', signupSource: 'card' }), 'a new user with signupSource');
  assert((await read('users/SIGNUP1')).signupSource === 'card', 'stored');
  const free = env.authenticatedContext('SIGNUP2').firestore();
  await denied(setDoc(doc(free, 'users/SIGNUP2'), { email: 'x@example.com', signupSource: 'card', credits: 999999 }), 'but not a billing field alongside it');
});

check('limits: the heaviest write (Reset Link while live, all five links, a photo) stays inside Firestore\'s access-call limits', async () => {
  const photo = `data:image/jpeg;base64,/9j/${'A'.repeat(2000)}`;
  const trimmed = photo.slice(0, 23 + Math.floor((photo.length - 23) / 4) * 4);
  const c = card2({
    photoUrl: trimmed, link1: link('One'), link2: link('Two'), link3: link('Three'), link4: link('Four'), link5: link('Five'),
    share: { ...SHARE_OFF, photoUrl: true, title: true, organization: true, email: true, phone: true, linkedinUrl: true, instagram: true, website: true, link1: true, link2: true, link3: true, link4: true, link5: true },
  });
  await reset({ card: c });
  const first = publishOps(c, ID1);
  await ok(batch(owner(), first.ops), 'full publish');
  const next = { ...first.next, publicId: ID2, revision: 3, updatedAt: T1 };
  await ok(batch(owner(), [['set', CARD(U), next], ['set', REG(ID2), reg()], ['delete', PUB(ID1)], ['set', PUB(ID2), publicOf(next)]]), 'full reset');
  const off = { ...next, sharingEnabled: false, revision: 4 };
  await ok(batch(owner(), [['set', CARD(U), off], ['delete', PUB(ID2)]]), 'off');
  const on = { ...off, sharingEnabled: true, revision: 5 };
  await ok(batch(owner(), [['set', CARD(U), on], ['set', PUB(ID2), publicOf(on)]]), 'on');
});

check('rules: the other collections under users/{uid}, and the card\'s own v1 shape, are unchanged', async () => {
  await reset({ card: null });
  const v1 = {
    firstName: 'Ada', lastName: 'Lovelace', photoUrl: '', title: '', organization: '', email: '', phone: '', linkedinUrl: '', instagram: '', website: '',
    share: { photoUrl: true, title: true, organization: true, email: false, phone: false, linkedinUrl: true, instagram: false, website: false },
    sharingEnabled: false, schemaVersion: 1, revision: 1, createdAt: T0, updatedAt: T0,
  };
  await ok(setDoc(doc(owner(), CARD(U)), v1), 'a schema 1 card is still accepted');
  await ok(setDoc(doc(owner(), CARD(U)), { ...v1, title: 'x', revision: 2 }), 'and still saved');
  await ok(setDoc(doc(owner(), CARD(U)), card2({ revision: 3 })), 'and upgraded to schema 2');
  await ok(setDoc(doc(owner(), `users/${U}/contacts/c1`), { name: 'x' }), 'contacts still writable');
});

// ── Run ─────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const only = process.env.ONLY;
for (const [name, fn] of CHECKS) {
  if (only && !name.includes(only)) continue;
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${String(passed + failed).padStart(2)}  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${String(passed + failed).padStart(2)}  ${name}\n        ${err.message}`);
  }
}
console.log(`\n  my card sharing: ${passed} passed, ${failed} failed`);
await env.cleanup();
process.exit(failed === 0 ? 0 : 1);
