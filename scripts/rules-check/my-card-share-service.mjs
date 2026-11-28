/**
 * My Card sharing, the APP'S OWN CODE (src/services/myCard/myCardCore.js) against the REAL rules
 * (../../firestore.rules) in the Firestore emulator on a throwaway `demo-` project.
 *
 * my-card-share.mjs checks the rules with its own writes. This checks that what the service
 * actually writes passes them, end to end: publish, save while live, switching a field Private,
 * save and turn off, unpublish and republish, Reset Link, links, a suspended account, racing
 * publishes, and that a draft can never publish or choose an ID.
 *
 * No production project, no credentials, no real data.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, deleteDoc, runTransaction,
} from 'firebase/firestore';
import { createMyCardService, MY_CARD_STATUS as S, MY_CARD_ERRORS as E } from '../../src/services/myCard/myCardCore.js';
import { isValidPublicId, publicCardDoc, publicCardView } from '../../src/utils/myCardRules.js';
import { photoDataUrl } from '../../src/test/helpers/photoFixtures.js';

const env = await initializeTestEnvironment({
  // The emulator run names a throwaway demo- project (`emulators:exec --project`); there is no fallback.
  projectId: process.env.GCLOUD_PROJECT,
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();

const U = 'U';
const CARD = (uid) => `users/${uid}/card/main`;
const fs = { doc, getDoc, runTransaction };
const asAdmin = async (fn) => {
  let value;
  await env.withSecurityRulesDisabled(async (ctx) => { value = await fn(ctx.firestore()); });
  return value;
};
const read = (path) => asAdmin(async (db) => { const snap = await getDoc(doc(db, path)); return snap.exists() ? snap.data() : undefined; });
const seed = (path, data) => asAdmin((db) => setDoc(doc(db, path), data));
const wipe = (path) => asAdmin((db) => deleteDoc(doc(db, path)));
const owner = () => env.authenticatedContext(U).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const tab = () => createMyCardService({ db: owner(), fs, getSignedInUid: () => U });
const publicRead = async (id) => { const snap = await getDoc(doc(anon(), `publicCards/${id}`)); return snap.exists() ? snap.data() : undefined; };

const CHECKS = [];
const check = (name, fn) => CHECKS.push([name, fn]);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), `${message}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const goodCard = (extra = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', organization: 'Analytical Engines', email: 'ada@example.com', phone: '+1 555 010 0000',
  linkedinUrl: 'https://www.linkedin.com/in/ada', website: 'https://example.com/',
  share: { title: true, organization: true, email: true, linkedinUrl: true }, ...extra,
});
const link = (label, url) => ({ label, url });

async function reset(account = { accountStatus: 'active' }) {
  await asAdmin(async (db) => {
    await deleteDoc(doc(db, CARD(U)));
    await deleteDoc(doc(db, `users/${U}`));
    // Clear anything a previous case published.
    for (const coll of ['publicCards', 'publicIds']) {
      const { getDocs, collection } = await import('firebase/firestore');
      for (const d of (await getDocs(collection(db, coll))).docs) await deleteDoc(d.ref);
    }
  });
  await seed(`users/${U}`, account);
}
/** A saved card, ready to publish: returns its service and revision. */
async function saved(extra = {}) {
  await reset();
  const service = tab();
  const result = await service.saveMyCard(goodCard(extra), { expectedRevision: null });
  assert(result.status === S.SAVED, `setup save: ${JSON.stringify(result).slice(0, 200)}`);
  return { service, revision: result.revision };
}
async function live(extra = {}) {
  const { service, revision } = await saved(extra);
  const result = await service.publishMyCard({ expectedRevision: revision });
  assert(result.status === S.SAVED && result.sharing.live, `setup publish: ${JSON.stringify(result).slice(0, 200)}`);
  return { service, revision: result.revision, id: result.sharing.publicId };
}

check('publish: a saved card goes live with a new random ID, registered to its owner, and the public copy reads without signing in', async () => {
  const { service, revision } = await saved();
  const result = await service.publishMyCard({ expectedRevision: revision });
  assert(result.status === S.SAVED && result.revision === revision + 1 && result.sharing.live === true, JSON.stringify(result).slice(0, 200));
  const id = result.sharing.publicId;
  assert(isValidPublicId(id), `a 22-character base64url ID, got ${id}`);
  const privateCard = await read(CARD(U));
  assert(privateCard.sharingEnabled === true && privateCard.publicId === id && privateCard.publishedAt === result.sharing.publishedAt && privateCard.schemaVersion === 2, 'private card');
  assert((await read(`publicIds/${id}`)).ownerUid === U, 'registered to the owner');
  const seen = await publicRead(id);
  eq(Object.keys(seen).sort(), ['email', 'firstName', 'lastName', 'linkedinUrl', 'organization', 'revision', 'schemaVersion', 'title', 'updatedAt'], 'public keys');
  assert(seen.phone === undefined && seen.website === undefined, 'Private fields are not public');
  eq(seen, publicCardDoc(privateCard, { revision: privateCard.revision, updatedAt: privateCard.updatedAt }), 'the copy is the builder\'s copy');
});

check('publish: the IDs are random: no two cards, and no two resets, share one', async () => {
  const ids = new Set();
  for (let i = 0; i < 4; i += 1) { const { id } = await live(); ids.add(id); }
  assert(ids.size === 4, 'four different IDs');
});

check('publish: refused without a name and a shared contact method, with one-tap fixes, and nothing is written', async () => {
  const { service, revision } = await saved({ share: { title: true }, linkedinUrl: '', website: '' });
  const result = await service.publishMyCard({ expectedRevision: revision });
  assert(result.status === S.GATE, `got ${result.status}`);
  assert(result.fixes.some((f) => f.action === 'share' && f.field === 'email') && result.fixes.some((f) => f.action === 'share' && f.field === 'phone'), `fixes: ${JSON.stringify(result.fixes)}`);
  const privateCard = await read(CARD(U));
  assert(privateCard.sharingEnabled === false && !('publicId' in privateCard), 'nothing published');
});

check('publish: the saved card is what is published; a stale revision is a conflict and writes nothing', async () => {
  const { service, revision } = await saved();
  await service.saveMyCard(goodCard({ title: 'Director' }), { expectedRevision: revision });
  const result = await service.publishMyCard({ expectedRevision: revision });
  assert(result.status === S.CONFLICT, `got ${result.status}`);
  assert((await read(CARD(U))).sharingEnabled === false, 'still private');
});

check('draft: a save cannot publish, choose an ID or name another owner, whatever it carries', async () => {
  const { service, revision } = await saved();
  const result = await service.saveMyCard(goodCard({ sharingEnabled: true, publicId: 'AAAAAAAAAAAAAAAAAAAAAA', publishedAt: '2026-01-01T00:00:00.000Z', ownerUid: 'X' }), { expectedRevision: revision });
  assert(result.status === S.SAVED, `got ${result.status}`);
  const privateCard = await read(CARD(U));
  assert(privateCard.sharingEnabled === false && !('publicId' in privateCard) && !('ownerUid' in privateCard), 'nothing took');
  assert((await read('publicIds/AAAAAAAAAAAAAAAAAAAAAA')) === undefined, 'no registry entry');
  const live1 = await live();
  const result2 = await live1.service.saveMyCard(goodCard({ publicId: 'BBBBBBBBBBBBBBBBBBBBBB' }), { expectedRevision: live1.revision });
  assert(result2.status === S.SAVED && result2.sharing.publicId === live1.id, 'the stored ID is kept, not the draft\'s');
});

check('save while live: the public copy follows in the same write, at the same revision, under the same ID', async () => {
  const { service, revision, id } = await live();
  const result = await service.saveMyCard(goodCard({ title: 'Director', email: 'ada@new.example.com' }), { expectedRevision: revision });
  assert(result.status === S.SAVED && result.sharing.publicId === id && result.sharing.live, JSON.stringify(result).slice(0, 200));
  const seen = await publicRead(id);
  assert(seen.title === 'Director' && seen.email === 'ada@new.example.com' && seen.revision === result.revision, 'copy updated');
});

check('save while live: a field switched to Private is gone from the public copy in the same write', async () => {
  const { service, revision, id } = await live();
  const result = await service.saveMyCard(goodCard({ share: { title: true, organization: true, email: false, phone: true, linkedinUrl: true } }), { expectedRevision: revision });
  assert(result.status === S.SAVED, JSON.stringify(result).slice(0, 200));
  const seen = await publicRead(id);
  assert(seen.email === undefined && seen.phone === '+1 555 010 0000', `email gone, phone there: ${JSON.stringify(seen)}`);
});

check('save while live: removing the last shared contact method is refused with fixes, unless the owner chooses "save and turn off sharing"', async () => {
  const { service, revision, id } = await live({ share: { email: true }, linkedinUrl: '', website: '' });
  const noContact = goodCard({ share: { title: true }, linkedinUrl: '', website: '' });
  const refused = await service.saveMyCard(noContact, { expectedRevision: revision });
  assert(refused.status === S.GATE && refused.fixes.length > 0, `got ${refused.status}`);
  assert((await read(CARD(U))).revision === revision && (await publicRead(id)) !== undefined, 'nothing written, still live');
  const off = await service.saveMyCard(noContact, { expectedRevision: revision, turnOffIfGateFails: true });
  assert(off.status === S.SAVED && off.sharing.live === false && off.sharing.publicId === id, JSON.stringify(off).slice(0, 200));
  assert((await publicRead(id)) === undefined, 'the public copy is gone');
  assert((await read(CARD(U))).sharingEnabled === false && (await read(CARD(U))).publicId === id, 'off, ID kept');
});

check('save while off: private only, and no public copy exists', async () => {
  const { service, revision, id } = await live();
  const off = await service.unpublishMyCard({ expectedRevision: revision });
  const result = await service.saveMyCard(goodCard({ title: 'Quiet edit' }), { expectedRevision: off.revision });
  assert(result.status === S.SAVED && result.sharing.live === false, JSON.stringify(result).slice(0, 200));
  assert((await publicRead(id)) === undefined, 'nothing public');
});

check('unpublish and republish: sharing off removes the public copy and keeps the ID; on again is the same link and QR', async () => {
  const { service, revision, id } = await live();
  const off = await service.unpublishMyCard({ expectedRevision: revision });
  assert(off.status === S.SAVED && off.sharing.live === false && off.sharing.publicId === id, JSON.stringify(off).slice(0, 200));
  assert((await publicRead(id)) === undefined && (await read(`publicIds/${id}`)) !== undefined, 'copy gone, registry kept');
  const again = await service.unpublishMyCard({ expectedRevision: off.revision });
  assert(again.status === S.SAVED && again.revision === off.revision, 'already off is not an error and writes nothing');
  const on = await service.publishMyCard({ expectedRevision: off.revision });
  assert(on.status === S.SAVED && on.sharing.publicId === id && on.sharing.live, JSON.stringify(on).slice(0, 200));
  assert((await publicRead(id)).firstName === 'Ada', 'live again at the same ID');
  const twice = await service.publishMyCard({ expectedRevision: on.revision });
  assert(twice.status === S.SAVED && twice.revision === on.revision, 'already live is not an error and writes nothing');
});

check('Reset Link: a new ID is live, the old one is unavailable, and the old one stays registered to the owner forever', async () => {
  const { service, revision, id } = await live();
  const result = await service.resetMyCardLink({ expectedRevision: revision });
  assert(result.status === S.SAVED && result.sharing.live && result.sharing.publicId !== id && isValidPublicId(result.sharing.publicId), JSON.stringify(result).slice(0, 200));
  assert((await publicRead(id)) === undefined, 'old link unavailable');
  assert((await publicRead(result.sharing.publicId)).firstName === 'Ada', 'new link live');
  assert((await read(`publicIds/${id}`)).ownerUid === U && (await read(`publicIds/${result.sharing.publicId}`)).ownerUid === U, 'both registered');
  assert((await read(CARD(U))).publishedAt === result.sharing.publishedAt, 'publishedAt kept');
  // The old ID cannot be named again, even by a direct write of the stored card.
  const stored = await read(CARD(U));
  await asAdmin((db) => deleteDoc(doc(db, `publicCards/${result.sharing.publicId}`)));
  const { writeBatch } = await import('firebase/firestore');
  const db = owner();
  const batch = writeBatch(db);
  batch.set(doc(db, CARD(U)), { ...stored, publicId: id, revision: stored.revision + 1 });
  let code = 'ok'; try { await batch.commit(); } catch (e) { code = e.code; }
  assert(code === 'permission-denied', `naming the retired ID: ${code}`);
});

check('Reset Link while sharing is off names a new ID, registers it and makes nothing public; a never-published card has no link to reset', async () => {
  const { service, revision } = await saved();
  const none = await service.resetMyCardLink({ expectedRevision: revision });
  assert(none.status === S.ERROR && none.code === E.BAD_REQUEST, `got ${JSON.stringify(none).slice(0, 120)}`);
  const first = await service.publishMyCard({ expectedRevision: revision });
  const off = await service.unpublishMyCard({ expectedRevision: first.revision });
  const result = await service.resetMyCardLink({ expectedRevision: off.revision });
  assert(result.status === S.SAVED && result.sharing.live === false && result.sharing.publicId !== first.sharing.publicId, JSON.stringify(result).slice(0, 200));
  assert((await publicRead(result.sharing.publicId)) === undefined, 'nothing public');
  assert((await read(`publicIds/${result.sharing.publicId}`)).ownerUid === U, 'new ID registered');
});

check('additional links: saved, published as Shared only, and closed up in order with their switches when one is removed', async () => {
  const links = {
    link1: link('Facebook', 'https://facebook.com/ada'), link2: link('Book a meeting', 'https://calendly.com/ada'), link3: link('Launch event', 'https://events.example.com/launch'),
    link4: link('Secret', 'https://secret.example.com/'),
  };
  const { service, revision, id } = await live({ ...links, share: { email: true, link1: true, link2: false, link3: true, link4: false } });
  let seen = await publicRead(id);
  eq([seen.link1, seen.link2, seen.link3, seen.link4], [links.link1, undefined, links.link3, undefined], 'Shared slots only');
  // The owner removes the first link: the rest shift up, each with its own switch.
  const result = await service.saveMyCard(goodCard({
    link1: links.link2, link2: links.link3, link3: links.link4, share: { email: true, link1: false, link2: true, link3: false },
  }), { expectedRevision: revision });
  assert(result.status === S.SAVED, JSON.stringify(result).slice(0, 200));
  seen = await publicRead(id);
  eq([seen.link1, seen.link2, seen.link3], [undefined, links.link3, undefined], 'after removing the first link');
  assert(!JSON.stringify(seen).includes('secret.example.com') && !JSON.stringify(seen).includes('calendly'), 'Private links never leak');
  const stored = await read(CARD(U));
  eq([stored.link1.label, stored.link2.label, stored.link3.label, 'link4' in stored], ['Book a meeting', 'Launch event', 'Secret', false], 'stored in display order');
  eq([stored.share.link1, stored.share.link2, stored.share.link3, stored.share.link4], [false, true, false, false], 'switches travel with their links');
});

check('additional links: a gap is closed, and a bad link is refused before anything is written', async () => {
  const { service, revision } = await saved();
  const gap = await service.saveMyCard(goodCard({ link1: link('', ''), link3: link('Later', 'https://later.example.com/'), share: { email: true, link3: true } }), { expectedRevision: revision });
  assert(gap.status === S.SAVED, JSON.stringify(gap).slice(0, 200));
  const stored = await read(CARD(U));
  assert(stored.link1.label === 'Later' && !('link2' in stored) && !('link3' in stored) && stored.share.link1 === true && stored.share.link3 === false, 'closed up');
  for (const bad of [link('x', 'http://insecure.example.com/'), link('x', 'javascript:alert(1)'), link('x', 'https://user@example.com/'), link('', 'https://example.com/'), link('x', 'https://exa mple.com')]) {
    const result = await service.saveMyCard(goodCard({ link1: bad }), { expectedRevision: gap.revision });
    assert(result.status === S.INVALID && result.errors.link1, `${JSON.stringify(bad)} should be invalid, got ${result.status}`);
  }
  assert((await read(CARD(U))).revision === gap.revision, 'nothing written');
});

check('limits: the heaviest card (every field, five links, a photo) publishes, saves live, resets, turns off and on through the rules', async () => {
  const photoUrl = photoDataUrl();
  const all = {
    photoUrl, instagram: 'ada', website: 'https://example.com/',
    link1: link('One', 'https://one.example.com/'), link2: link('Two', 'https://two.example.com/'), link3: link('Three', 'https://three.example.com/'),
    link4: link('Four', 'https://four.example.com/'), link5: link('Five', 'https://five.example.com/'),
    share: { photoUrl: true, title: true, organization: true, email: true, phone: true, linkedinUrl: true, instagram: true, website: true, link1: true, link2: true, link3: true, link4: true, link5: true },
  };
  const { service, revision, id } = await live(all);
  const seen = await publicRead(id);
  assert(seen.photoUrl === photoUrl && seen.link5.label === 'Five', 'photo and all five links are public');
  const edit = await service.saveMyCard(goodCard({ ...all, title: 'Director' }), { expectedRevision: revision });
  assert(edit.status === S.SAVED, `save live: ${JSON.stringify(edit).slice(0, 160)}`);
  const reset2 = await service.resetMyCardLink({ expectedRevision: edit.revision });
  assert(reset2.status === S.SAVED, `reset: ${JSON.stringify(reset2).slice(0, 160)}`);
  const off = await service.unpublishMyCard({ expectedRevision: reset2.revision });
  assert(off.status === S.SAVED, `off: ${JSON.stringify(off).slice(0, 160)}`);
  const on = await service.publishMyCard({ expectedRevision: off.revision });
  assert(on.status === S.SAVED, `on: ${JSON.stringify(on).slice(0, 160)}`);
});

check('v1 cards: a card saved before sharing loads unchanged, stays private, and is upgraded by publishing; nothing is auto-published', async () => {
  await reset();
  await seed(CARD(U), {
    firstName: 'Ada', lastName: 'Lovelace', photoUrl: '', title: 'Analyst', organization: '', email: 'ada@example.com', phone: '', linkedinUrl: '', instagram: '', website: '',
    share: { photoUrl: true, title: true, organization: true, email: true, phone: false, linkedinUrl: true, instagram: false, website: false },
    sharingEnabled: false, schemaVersion: 1, revision: 3, createdAt: '2026-11-17T10:00:00.000Z', updatedAt: '2026-11-17T10:00:00.000Z',
  });
  const service = tab();
  const loaded = await service.loadMyCard();
  assert(loaded.status === S.OK && loaded.sharing.live === false && loaded.card.share.email === true && loaded.card.share.link1 === false, JSON.stringify(loaded).slice(0, 200));
  const result = await service.publishMyCard({ expectedRevision: loaded.revision });
  assert(result.status === S.SAVED && result.revision === 4, JSON.stringify(result).slice(0, 200));
  const stored = await read(CARD(U));
  assert(stored.schemaVersion === 2 && stored.share.email === true && stored.share.phone === false, 'privacy choices preserved');
});

check('v1 cards: an old build (schema 1) cannot overwrite a published card, drop its ID or roll it back', async () => {
  const { id, revision } = await live();
  const old = {
    firstName: 'Ada', lastName: 'Lovelace', photoUrl: '', title: '', organization: '', email: 'ada@example.com', phone: '', linkedinUrl: '', instagram: '', website: '',
    share: { photoUrl: false, title: false, organization: false, email: true, phone: false, linkedinUrl: false, instagram: false, website: false },
    sharingEnabled: false, schemaVersion: 1, revision: revision + 1, createdAt: '2026-11-17T10:00:00.000Z', updatedAt: '2026-11-28T10:00:00.000Z',
  };
  let code = 'ok'; try { await setDoc(doc(owner(), CARD(U)), old); } catch (e) { code = e.code; }
  assert(code === 'permission-denied', `got ${code}`);
  assert((await publicRead(id)) !== undefined && (await read(CARD(U))).publicId === id, 'still live under its ID');
});

check('suspended account: cannot publish, save live, reset or turn back on; can always turn sharing off', async () => {
  const { service, revision, id } = await live();
  await seed(`users/${U}`, { accountStatus: 'suspended' });
  const blocked = await service.saveMyCard(goodCard({ title: 'Edit while suspended' }), { expectedRevision: revision });
  assert(blocked.status === S.ERROR && blocked.code === E.SHARING_BLOCKED, `save: ${JSON.stringify(blocked).slice(0, 160)}`);
  const resetResult = await service.resetMyCardLink({ expectedRevision: revision });
  assert(resetResult.status === S.ERROR && resetResult.code === E.SHARING_BLOCKED, `reset: ${JSON.stringify(resetResult).slice(0, 160)}`);
  const off = await service.unpublishMyCard({ expectedRevision: revision });
  assert(off.status === S.SAVED && off.sharing.live === false, `off: ${JSON.stringify(off).slice(0, 160)}`);
  const on = await service.publishMyCard({ expectedRevision: off.revision });
  assert(on.status === S.ERROR && on.code === E.SHARING_BLOCKED, `on: ${JSON.stringify(on).slice(0, 160)}`);
  assert((await publicRead(id)) === undefined, 'nothing public');
});

check('taken-down account: the block survives, publishing and Reset Link are refused', async () => {
  const { service, revision } = await saved();
  await seed(`users/${U}`, { accountStatus: 'active', myCardPublishBlocked: true });
  const result = await service.publishMyCard({ expectedRevision: revision });
  assert(result.status === S.ERROR && result.code === E.SHARING_BLOCKED, `got ${JSON.stringify(result).slice(0, 160)}`);
});

check('racing: eight publishes at one revision: exactly one lands, the rest are conflicts, and one ID is registered', async () => {
  const { revision } = await saved();
  const results = await Promise.all(Array.from({ length: 8 }, () => tab().publishMyCard({ expectedRevision: revision })));
  const won = results.filter((r) => r.status === S.SAVED);
  const conflicts = results.filter((r) => r.status === S.CONFLICT);
  assert(won.length === 1 && conflicts.length === 7, `won ${won.length}, conflicts ${conflicts.length}: ${results.map((r) => r.status + (r.code ? `:${r.code}` : '')).join(',')}`);
  const privateCard = await read(CARD(U));
  assert((await publicRead(privateCard.publicId)) !== undefined, 'one live copy');
});

check('racing: a save and a reset at one revision: one wins, and the card, copy and registry agree afterwards', async () => {
  const { service, revision, id } = await live();
  const results = await Promise.all([
    service.saveMyCard(goodCard({ title: 'Raced' }), { expectedRevision: revision }),
    tab().resetMyCardLink({ expectedRevision: revision }),
  ]);
  assert(results.filter((r) => r.status === S.SAVED).length === 1, `got ${results.map((r) => r.status).join(',')}`);
  const stored = await read(CARD(U));
  const seen = await publicRead(stored.publicId);
  assert(seen && seen.revision === stored.revision, 'the live copy is at the card\'s revision');
  if (stored.publicId !== id) assert((await publicRead(id)) === undefined, 'a reset left no old copy');
});

check('the public copy is exactly publicCardDoc(card): the app\'s builder and the rules agree for every combination of switches', async () => {
  const fields = ['photoUrl', 'title', 'organization', 'email', 'phone', 'linkedinUrl', 'instagram', 'website'];
  // Every field on its own as the only shared contact (or title/org/photo alongside email): 2^8 is covered in pieces.
  for (let mask = 0; mask < 32; mask += 1) {
    const share = {};
    fields.forEach((f, i) => { share[f] = Boolean((mask >> (i % 5)) & 1) && (i < 5 || mask % 2 === 0); });
    share.email = true;
    const { id } = await live({ photoUrl: '', instagram: 'ada', website: 'https://example.com/', share });
    const privateCard = await read(CARD(U));
    const seen = await publicRead(id);
    eq(seen, publicCardDoc(privateCard, { revision: privateCard.revision, updatedAt: privateCard.updatedAt }), `switches ${JSON.stringify(share)}`);
    const view = publicCardView(privateCard);
    for (const f of fields) assert((f in seen) === (f in view), `${f} public iff the view shows it`);
  }
});

// ── Run ─────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
for (const [index, [name, fn]] of CHECKS.entries()) {
  const label = `${String(index + 1).padStart(2, '0')}  ${name}`;
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    pass += 1;
  } catch (err) {
    console.log(`  ✗ ${label}\n        ${String(err.message).split('\n')[0].slice(0, 300)}`);
    fail += 1;
  }
}
console.log(`\n  my card sharing service: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
