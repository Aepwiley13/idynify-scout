/**
 * The sticker services (src/services/stickers/stickerCore.js) against the REAL
 * rules (../../firestore.rules) in the Firestore emulator.
 *
 * The core takes Firestore as an adapter, so this runs the app's own code with
 * this package's copy of the web SDK. Every write below therefore goes through
 * both the service's transaction and the server-side rules, and the checks are
 * on what Firestore actually stored.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp, deleteField, onSnapshot, arrayUnion, arrayRemove, Timestamp,
} from 'firebase/firestore';
import { createStickerStore, STICKER_ERRORS, DENIAL_REASONS, MEMBERSHIP_ATTEMPTS } from '../../src/services/stickers/stickerCore.js';

const env = await initializeTestEnvironment({
  projectId: 'demo-sticker-services',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();

const fs = { doc, collection, setDoc, updateDoc, runTransaction, serverTimestamp, deleteField, onSnapshot, arrayUnion, arrayRemove };
const U = 'U';
const storeFor = (uid) => createStickerStore({ db: env.authenticatedContext(uid).firestore(), fs });
const me = storeFor(U);
// withSecurityRulesDisabled does not return the callback's value, so it is captured.
const asAdmin = async (fn) => {
  let value;
  await env.withSecurityRulesDisabled(async (ctx) => { value = await fn(ctx.firestore()); });
  return value;
};
const read = (path) => asAdmin(async (db) => (await getDoc(doc(db, path))).data());
const setMode = (mode) => asAdmin((db) => setDoc(doc(db, 'feature_flags/stickers'), { mode }));
const sid = (n) => `S${String(n).padStart(19, '0')}`;
const T0 = Timestamp.fromMillis(1_700_000_000_000);
let seq = 0;
async function newContact(ids = null, uid = U) {
  const id = `c${++seq}`;
  await asAdmin((db) => setDoc(doc(db, `users/${uid}/contacts/${id}`), {
    name: 'Pat',
    ...(ids ? { sticker_ids: ids, sticker_assignments: Object.fromEntries(ids.map((s) => [s, { assigned_at: T0, assigned_by: 'user' }])) } : {}),
  }));
  return id;
}
const codeOf = async (promise) => {
  try { await promise; return 'ok'; } catch (err) { return err.code ?? err.message; }
};
/** code / reason / attempts of a refusal, or 'ok'. */
const refusalOf = async (promise) => {
  try { await promise; return 'ok'; } catch (err) { return `${err.code}/${err.reason}/${err.attempts}`; }
};

const CHECKS = [];
const check = (name, fn) => CHECKS.push([name, fn]);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

await setMode('on');

check('create, rename, archive and restore a sticker', async () => {
  const { id } = await me.createSticker(U, { name: 'Board', color: 'teal', emoji: '🏛' });
  assert(/^[A-Za-z0-9]{20}$/.test(id), 'auto-ID');
  await me.updateSticker(U, id, { name: 'Board members', color: 'blue' });
  await me.archiveSticker(U, id);
  assert((await read(`users/${U}/stickers/${id}`)).status === 'archived', 'archived');
  await me.restoreSticker(U, id);
  const stored = await read(`users/${U}/stickers/${id}`);
  assert(stored.status === 'active' && stored.archived_at === null && stored.name === 'Board members', 'restored');
});

check('list stickers live, sorted by name', async () => {
  await me.createSticker(U, { name: 'zebra' });
  await me.createSticker(U, { name: 'Alpha' });
  const names = await new Promise((resolve, reject) => {
    const stop = me.subscribeStickers(U, (list) => { stop(); resolve(list.map((s) => s.name)); }, reject);
  });
  assert(names[0] === 'Alpha' && names.at(-1) === 'zebra', `sorted: ${names.join(', ')}`);
});

check('add and remove stickers on a contact', async () => {
  const { id: a } = await me.createSticker(U, { name: 'A' });
  const { id: b } = await me.createSticker(U, { name: 'B' });
  const c = await newContact();
  assert((await me.addSticker(U, c, a)).status === 'added', 'add a');
  assert((await me.addSticker(U, c, b)).status === 'added', 'add b');
  assert((await me.addSticker(U, c, a)).status === 'already', 'already');
  assert((await me.removeSticker(U, c, a)).status === 'removed', 'remove a');
  assert((await me.removeSticker(U, c, a)).status === 'absent', 'absent');
  const stored = await read(`users/${U}/contacts/${c}`);
  assert(JSON.stringify(stored.sticker_ids) === JSON.stringify([b]), 'ids');
  assert(Object.keys(stored.sticker_assignments).join() === b, 'assignments');
  assert(stored.name === 'Pat', 'other fields untouched');
});

check('concurrent adds of different stickers all land', async () => {
  const ids = [];
  for (const name of ['C1', 'C2', 'C3', 'C4', 'C5']) ids.push((await me.createSticker(U, { name })).id);
  const c = await newContact();
  const results = await Promise.all(ids.map((id) => me.addSticker(U, c, id)));
  assert(results.every((r) => r.status === 'added'), JSON.stringify(results));
  const stored = await read(`users/${U}/contacts/${c}`);
  assert(stored.sticker_ids.length === 5 && ids.every((id) => stored.sticker_ids.includes(id)), 'all five present');
});

check('concurrent adds of the same sticker add it once', async () => {
  const { id } = await me.createSticker(U, { name: 'Same' });
  const c = await newContact();
  const results = await Promise.all([1, 2, 3].map(() => me.addSticker(U, c, id)));
  assert(results.filter((r) => r.status === 'added').length === 1, JSON.stringify(results));
  assert((await read(`users/${U}/contacts/${c}`)).sticker_ids.length === 1, 'once');
});

check('concurrent add and remove of different stickers both land', async () => {
  const { id: keep } = await me.createSticker(U, { name: 'Keep' });
  const { id: drop } = await me.createSticker(U, { name: 'Drop' });
  const c = await newContact();
  await me.addSticker(U, c, drop);
  await Promise.all([me.addSticker(U, c, keep), me.removeSticker(U, c, drop)]);
  const stored = await read(`users/${U}/contacts/${c}`);
  assert(JSON.stringify(stored.sticker_ids) === JSON.stringify([keep]), JSON.stringify(stored.sticker_ids));
});

check('an add racing an archive never adds to an archived sticker after the archive', async () => {
  for (let i = 0; i < 5; i += 1) {
    const { id } = await me.createSticker(U, { name: `Race ${i}` });
    const c = await newContact();
    const [added] = await Promise.all([codeOf(me.addSticker(U, c, id)), me.archiveSticker(U, id)]);
    const stored = await read(`users/${U}/contacts/${c}`);
    assert(added === 'ok' || added === STICKER_ERRORS.STICKER_ARCHIVED, `unexpected: ${added}`);
    assert((added === 'ok') === (stored.sticker_ids?.includes(id) ?? false), 'stored state matches the outcome');
  }
});

check('the 50th sticker is added; the 51st is refused by the service, and by the rules', async () => {
  const { id: last } = await me.createSticker(U, { name: 'Fiftieth' });
  const { id: extra } = await me.createSticker(U, { name: 'Fifty-first' });
  const c = await newContact(Array.from({ length: 49 }, (_, i) => sid(100 + i)));
  assert((await me.addSticker(U, c, last)).status === 'added', '50th');
  assert(await codeOf(me.addSticker(U, c, extra)) === STICKER_ERRORS.LIMIT_REACHED, 'service refuses 51st');
  const direct = await codeOf(updateDoc(doc(env.authenticatedContext(U).firestore(), `users/${U}/contacts/${c}`), {
    sticker_ids: [...(await read(`users/${U}/contacts/${c}`)).sticker_ids, extra],
    [`sticker_assignments.${extra}`]: { assigned_at: serverTimestamp(), assigned_by: 'user' },
    sticker_change: { op: 'add', sticker_id: extra, at: serverTimestamp() },
  }));
  assert(direct === 'permission-denied', `rules refuse 51st: ${direct}`);
});

check('at 49, concurrent adds: exactly one lands', async () => {
  const ids = [];
  for (const name of ['L1', 'L2', 'L3']) ids.push((await me.createSticker(U, { name })).id);
  const c = await newContact(Array.from({ length: 49 }, (_, i) => sid(300 + i)));
  const outcomes = await Promise.all(ids.map((id) => codeOf(me.addSticker(U, c, id))));
  assert(outcomes.filter((o) => o === 'ok').length === 1, outcomes.join());
  assert(outcomes.filter((o) => o === STICKER_ERRORS.LIMIT_REACHED).length === 2, outcomes.join());
  assert((await read(`users/${U}/contacts/${c}`)).sticker_ids.length === 50, 'exactly 50');
});

check('bulk add reports each contact', async () => {
  const { id } = await me.createSticker(U, { name: 'Bulk' });
  const ok1 = await newContact();
  const ok2 = await newContact();
  const full = await newContact(Array.from({ length: 50 }, (_, i) => sid(500 + i)));
  const result = await me.addStickerToContacts(U, [ok1, 'missing', ok2, full], id);
  assert(result.added.length === 2 && result.failed.length === 2, JSON.stringify(result));
  assert(result.failed.find((f) => f.contactId === full).code === STICKER_ERRORS.LIMIT_REACHED, 'limit');
  assert(result.failed.find((f) => f.contactId === 'missing').code === STICKER_ERRORS.CONTACT_NOT_FOUND, 'missing');
});

check('another user cannot use or change U\'s stickers', async () => {
  const { id } = await me.createSticker(U, { name: 'Mine' });
  const c = await newContact();
  const other = storeFor('OTHER');
  assert(await codeOf(other.addSticker(U, c, id)) === STICKER_ERRORS.PERMISSION_DENIED, 'add to U\'s contact');
  assert(await codeOf(other.updateSticker(U, id, { name: 'Theirs' })) === STICKER_ERRORS.PERMISSION_DENIED, 'rename');
  assert(await codeOf(other.archiveSticker(U, id)) === STICKER_ERRORS.PERMISSION_DENIED, 'archive');
  const theirContact = await newContact(null, 'OTHER');
  assert(await codeOf(other.addSticker('OTHER', theirContact, id)) === STICKER_ERRORS.STICKER_NOT_FOUND, 'U\'s sticker is not theirs');
});

check('a direct write that skips the service is refused', async () => {
  const { id } = await me.createSticker(U, { name: 'Direct' });
  const c = await newContact();
  const db = env.authenticatedContext(U).firestore();
  const noChange = await codeOf(updateDoc(doc(db, `users/${U}/contacts/${c}`), { sticker_ids: [id], [`sticker_assignments.${id}`]: { assigned_at: serverTimestamp(), assigned_by: 'user' } }));
  assert(noChange === 'permission-denied', `without sticker_change: ${noChange}`);
  const created = await codeOf(setDoc(doc(db, `users/${U}/contacts/new-with-stickers`), { name: 'New', sticker_ids: [id] }));
  assert(created === 'permission-denied', `create with stickers: ${created}`);
});

check('rollout modes: off and un-enrolled beta refuse; enrolled beta and internal admins work', async () => {
  const { id } = await me.createSticker(U, { name: 'Before off' });
  const c = await newContact();
  await setMode('off');
  assert(await codeOf(me.createSticker(U, { name: 'x' })) === STICKER_ERRORS.PERMISSION_DENIED, 'off: create');
  assert(await codeOf(me.addSticker(U, c, id)) === STICKER_ERRORS.PERMISSION_DENIED, 'off: add');
  await setMode('beta');
  assert(await codeOf(me.addSticker(U, c, id)) === STICKER_ERRORS.PERMISSION_DENIED, 'beta, not enrolled');
  await asAdmin((db) => setDoc(doc(db, `sticker_enrollment/${U}`), { stage: 'beta' }));
  assert(await codeOf(me.addSticker(U, c, id)) === 'ok', 'beta, enrolled');
  await setMode('internal');
  assert(await codeOf(me.removeSticker(U, c, id)) === STICKER_ERRORS.PERMISSION_DENIED, 'internal, not admin');
  await asAdmin((db) => setDoc(doc(db, `users/${U}`), { role: 'admin' }));
  assert(await codeOf(me.removeSticker(U, c, id)) === 'ok', 'internal, admin');
  await asAdmin((db) => setDoc(doc(db, `users/${U}`), { email: 'u@example.test' }));
  await setMode('on');
});

check('a cross-user write is refused at the read: final at once, never retried', async () => {
  const { id } = await me.createSticker(U, { name: 'Private' });
  const c = await newContact();
  const got = await refusalOf(storeFor('OTHER').addSticker(U, c, id));
  assert(got === `${STICKER_ERRORS.PERMISSION_DENIED}/${DENIAL_REASONS.READ_DENIED}/1`, got);
  assert(!(await read(`users/${U}/contacts/${c}`)).sticker_ids, 'nothing written');
});

check('feature turned off: an authorization refusal, stopped at the second attempt (not retried as contention)', async () => {
  const { id } = await me.createSticker(U, { name: 'Shutdown' });
  const c = await newContact();
  const k = await newContact([]);
  await setMode('off');
  const add = await refusalOf(me.addSticker(U, c, id));
  const remove = await refusalOf(me.removeSticker(U, k, id));
  await setMode('on');
  assert(add === `${STICKER_ERRORS.PERMISSION_DENIED}/${DENIAL_REASONS.WRITE_DENIED}/2`, `add ${add}`);
  assert(remove === 'ok', `remove of an absent sticker writes nothing: ${remove}`);
});

check('access revoked between two changes: the second is refused as authorization', async () => {
  const { id: a } = await me.createSticker(U, { name: 'Before' });
  const { id: b } = await me.createSticker(U, { name: 'After' });
  const c = await newContact();
  assert((await me.addSticker(U, c, a)).status === 'added', 'first add');
  await asAdmin((db) => setDoc(doc(db, 'feature_flags/stickers'), { mode: 'internal' })); // U is not an admin
  const got = await refusalOf(me.addSticker(U, c, b));
  await setMode('on');
  assert(got === `${STICKER_ERRORS.PERMISSION_DENIED}/${DENIAL_REASONS.WRITE_DENIED}/2`, got);
  assert(JSON.stringify((await read(`users/${U}/contacts/${c}`)).sticker_ids) === JSON.stringify([a]), 'only the first add');
});

check('adding an archived sticker is refused by the service from fresh data, not retried', async () => {
  const { id } = await me.createSticker(U, { name: 'Gone' });
  await me.archiveSticker(U, id);
  const got = await refusalOf(me.addSticker(U, await newContact(), id));
  assert(got === `${STICKER_ERRORS.STICKER_ARCHIVED}/null/null`, got);
});

check('stress: ten concurrent adds of different stickers to one contact all land', async () => {
  const ids = [];
  for (let i = 0; i < 10; i += 1) ids.push((await me.createSticker(U, { name: `Stress ${i}` })).id);
  const c = await newContact();
  const outcomes = await Promise.all(ids.map((id) => refusalOf(me.addSticker(U, c, id))));
  assert(outcomes.every((o) => o === 'ok'), outcomes.join());
  const stored = await read(`users/${U}/contacts/${c}`);
  assert(stored.sticker_ids.length === 10 && Object.keys(stored.sticker_assignments).length === 10, 'all ten, with assignments');
});

check(`stress: concurrent adds racing an archive end consistent (at most ${MEMBERSHIP_ATTEMPTS} attempts each)`, async () => {
  const { id } = await me.createSticker(U, { name: 'Contended' });
  const contacts = [];
  for (let i = 0; i < 8; i += 1) contacts.push(await newContact());
  const [results] = await Promise.all([
    Promise.all(contacts.map((c) => refusalOf(me.addSticker(U, c, id)))),
    me.archiveSticker(U, id),
  ]);
  for (const [i, outcome] of results.entries()) {
    const stored = await read(`users/${U}/contacts/${contacts[i]}`);
    const added = stored.sticker_ids?.includes(id) ?? false;
    assert(outcome === 'ok' ? added : (!added && outcome.startsWith(STICKER_ERRORS.STICKER_ARCHIVED)), `contact ${i}: ${outcome}, stored ${added}`);
  }
});

let pass = 0;
let fail = 0;
for (const [index, [name, fn]] of CHECKS.entries()) {
  const label = `${String(index + 1).padStart(2, '0')}  ${name}`;
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${label}  — ${String(err.message).split('\n')[0].slice(0, 140)}`);
    fail++;
  }
}
console.log(`\n  sticker services: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
