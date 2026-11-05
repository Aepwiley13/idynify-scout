/**
 * Sticker rules (ADR-007), against a REAL Firestore emulator.
 *
 * Every case runs TWICE, against two rule sets built from ../../firestore.rules
 * (the live file):
 *
 *   live      the file as it is
 *   lockdown  the same file with stickerRulesEnabled() returning false: the
 *             documented rollback
 *
 * Each case declares its kind. In lockdown a sticker write must be DENIED, and
 * every other case must get exactly the live answer. The runner then checks
 * the observed outcomes directly: lockdown is never more permissive than live
 * in any case, so the rollback cannot relax a permission.
 *
 * What is checked:
 *   - the registry: create-only auto-IDs, field validation, no delete
 *   - membership: exactly one sticker per write, only an existing active
 *     sticker of the same user, 50 at most, stale writes refused, concurrent
 *     atomic writes
 *   - malformed or legacy stored data: refused safely, with a repair path
 *   - archived stickers
 *   - cross-user access, including an admin writing into someone else's data
 *     (viewing as another user is read-only)
 *   - feature shutdown, for every kind of sticker write
 *   - the rollout modes (STICKER_ACCESS_MATRIX, which stickersConfig is also
 *     tested against)
 *   - the server-only rollout documents
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, arrayUnion, Timestamp,
} from 'firebase/firestore';
import { STICKER_ACCESS_MATRIX } from '../../src/constants/stickersAccess.js';

const LIVE = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const SWITCH = /function stickerRulesEnabled\(\) \{\s*return true;\s*\}/g;
const switches = LIVE.match(SWITCH) ?? [];
if (switches.length !== 1) {
  console.error(`  ✗ expected exactly one stickerRulesEnabled() returning true, found ${switches.length}`);
  process.exit(1);
}
const LOCKDOWN = LIVE.replace(SWITCH, 'function stickerRulesEnabled() {\n      return false;\n    }');

const emulator = { host: '127.0.0.1', port: 8080 };
const ENVS = {
  live: await initializeTestEnvironment({ projectId: 'demo-stickers', firestore: { rules: LIVE, ...emulator } }),
  lockdown: await initializeTestEnvironment({ projectId: 'demo-stickers-lockdown', firestore: { rules: LOCKDOWN, ...emulator } }),
};
// Start from empty data in both demo projects, so the suite can be re-run in one emulator session.
for (const env of Object.values(ENVS)) await env.clearFirestore();

// Sticker IDs are Firestore auto-IDs: 20 letters and digits.
const sid = (n) => `S${String(n).padStart(19, '0')}`;
const U = 'U';
const S_ACTIVE = sid(1);
const S_ARCHIVED = sid(2);
const S_OTHER_USERS = sid(3);
const S_SECOND = sid(4);
const S_NO_STATUS = sid(5);
const S_ODD_STATUS = sid(6);

const T0 = Timestamp.fromMillis(1_700_000_000_000);
const assignment = (by = 'user') => ({ assigned_at: T0, assigned_by: by });
const membership = (ids) => ({
  sticker_ids: ids,
  sticker_assignments: Object.fromEntries(ids.map((id) => [id, assignment()])),
  ...(ids.length ? { sticker_change: { op: 'add', sticker_id: ids[ids.length - 1], at: T0 } } : {}),
});
const storedSticker = (over = {}) => ({
  schema_version: 1, name: 'Board', color: 'teal', emoji: null, description: null,
  status: 'active', archived_at: null, created_at: T0, created_by: U, updated_at: T0, ...over,
});
const newSticker = (over = {}) => ({
  schema_version: 1, name: 'Donor', color: 'amber', emoji: null, description: null,
  status: 'active', archived_at: null, created_at: serverTimestamp(), created_by: U, updated_at: serverTimestamp(), ...over,
});
const addWrite = (ids, id, { by = 'user', named = id } = {}) => ({
  sticker_ids: [...ids, id],
  [`sticker_assignments.${id}`]: { assigned_at: serverTimestamp(), assigned_by: by },
  sticker_change: { op: 'add', sticker_id: named, at: serverTimestamp() },
});
const atomicAdd = (id) => ({
  sticker_ids: arrayUnion(id),
  [`sticker_assignments.${id}`]: { assigned_at: serverTimestamp(), assigned_by: 'user' },
  sticker_change: { op: 'add', sticker_id: id, at: serverTimestamp() },
});
const removeWrite = (ids, id) => ({
  sticker_ids: ids.filter((x) => x !== id),
  [`sticker_assignments.${id}`]: deleteField(),
  sticker_change: { op: 'remove', sticker_id: id, at: serverTimestamp() },
});
const many = (n, from = 100) => Array.from({ length: n }, (_, i) => sid(from + i));
const rename = (name = 'Renamed') => ({ name, updated_at: serverTimestamp() });
const archive = () => ({ status: 'archived', archived_at: serverTimestamp(), updated_at: serverTimestamp() });
const restore = () => ({ status: 'active', archived_at: null, updated_at: serverTimestamp() });

async function seedInto(env, writes) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of writes) {
      if (data === null) await deleteDoc(doc(db, path));
      else await setDoc(doc(db, path), data);
    }
  });
}
async function readFrom(env, path) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => { data = (await getDoc(doc(ctx.firestore(), path))).data(); });
  return data;
}

/** Everything a case needs, bound to one environment. */
function contextFor(env) {
  let seq = 0;
  const as = (uid) => env.authenticatedContext(uid).firestore();
  const c = {
    env,
    as,
    me: as(U),
    other: as('OTHER'),
    admin: as('A'),
    anon: env.unauthenticatedContext().firestore(),
    seed: (writes) => seedInto(env, writes),
    read: (path) => readFrom(env, path),
    setMode: (mode) => seedInto(env, [['feature_flags/stickers', mode === null ? null : { mode }]]),
    /** A fresh contact, so no case depends on another's writes. `ids` null = no sticker fields. */
    contactWith: async (ids, uid = U, extra = {}) => {
      const path = `users/${uid}/contacts/k${++seq}`;
      await seedInto(env, [[path, { name: 'Pat', ...(ids ? membership(ids) : {}), ...extra }]]);
      return path;
    },
    rawContact: async (data, uid = U) => {
      const path = `users/${uid}/contacts/k${++seq}`;
      await seedInto(env, [[path, { name: 'Pat', ...data }]]);
      return path;
    },
    freshSticker: async (over = {}, uid = U) => {
      const path = `users/${uid}/stickers/${sid(10_000 + ++seq)}`;
      await seedInto(env, [[path, storedSticker({ created_by: uid, ...over })]]);
      return path;
    },
  };
  return c;
}

const baseSeed = [
  ['feature_flags/stickers', { mode: 'on' }],
  ['users/A', { email: 'a@example.test', role: 'admin' }],
  ['sticker_enrollment/E', { stage: 'beta' }],
  [`users/${U}/stickers/${S_ACTIVE}`, storedSticker()],
  [`users/${U}/stickers/${S_SECOND}`, storedSticker({ name: 'Volunteer', color: 'green' })],
  [`users/${U}/stickers/${S_ARCHIVED}`, storedSticker({ name: 'Old', status: 'archived', archived_at: T0 })],
  [`users/${U}/stickers/${S_NO_STATUS}`, (() => { const s = storedSticker({ name: 'Legacy' }); delete s.status; return s; })()],
  [`users/${U}/stickers/${S_ODD_STATUS}`, storedSticker({ name: 'Odd', status: 'deleted' })],
  [`users/OTHER/stickers/${S_OTHER_USERS}`, storedSticker({ created_by: 'OTHER' })],
  [`users/${U}/companies/c1`, { status: 'pending' }],
  [`users/${U}/lineageEvents/e1`, { eventType: 'x' }],
];
for (const env of Object.values(ENVS)) await seedInto(env, baseSeed);

const stickerPath = (id, uid = U) => `users/${uid}/stickers/${id}`;

// kind: 'write' (a sticker or membership write) | 'other' (reads, unrelated writes, rollout documents)
const CASES = [];
const write = (name, expect, run) => CASES.push({ name, kind: 'write', expect, run });
const other = (name, expect, run) => CASES.push({ name, kind: 'other', expect, run });

// ── Registry ────────────────────────────────────────────────────────────────
write('registry  owner creates a sticker', 'ALLOW', (c) => setDoc(doc(c.me, stickerPath(sid(10))), newSticker()));
other('registry  owner reads own sticker', 'ALLOW', (c) => getDoc(doc(c.me, stickerPath(S_ACTIVE))));
write('registry  ID not a 20-character auto-ID', 'DENY', (c) => setDoc(doc(c.me, stickerPath('stk_100')), newSticker()));
write('registry  created_by someone else', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(11))), newSticker({ created_by: 'OTHER' })));
write('registry  created archived', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(12))), newSticker({ status: 'archived', archived_at: serverTimestamp() })));
write('registry  extra field', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(13))), newSticker({ external_ids: { hub: 'stk_1' } })));
write('registry  missing field', 'DENY', (c) => { const s = newSticker(); delete s.emoji; return setDoc(doc(c.me, stickerPath(sid(14))), s); });
write('registry  unknown color', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(15))), newSticker({ color: 'red' })));
write('registry  empty name', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(16))), newSticker({ name: '' })));
write('registry  61-character name', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(17))), newSticker({ name: 'x'.repeat(61) })));
write('registry  60-character name', 'ALLOW', (c) => setDoc(doc(c.me, stickerPath(sid(18))), newSticker({ name: 'x'.repeat(60) })));
write('registry  client-chosen created_at', 'DENY', (c) => setDoc(doc(c.me, stickerPath(sid(19))), newSticker({ created_at: T0 })));
write('registry  set() over an existing sticker (takeover)', 'DENY', (c) => setDoc(doc(c.me, stickerPath(S_ACTIVE)), newSticker({ name: 'Advisory Board' })));
write('registry  rename, recolor, emoji', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.freshSticker()), { name: 'Volunteers', color: 'blue', emoji: '🙌', updated_at: serverTimestamp() }));
write('registry  update without updated_at', 'DENY', async (c) => updateDoc(doc(c.me, await c.freshSticker()), { name: 'No time' }));
write('registry  archive', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.freshSticker()), archive()));
write('registry  archive without archived_at', 'DENY', async (c) => updateDoc(doc(c.me, await c.freshSticker()), { status: 'archived', updated_at: serverTimestamp() }));
write('registry  restore', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.freshSticker({ status: 'archived', archived_at: T0 })), restore()));
write('registry  rename an archived sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.freshSticker({ status: 'archived', archived_at: T0 })), rename()));
write('registry  change created_by', 'DENY', async (c) => updateDoc(doc(c.me, await c.freshSticker()), { created_by: 'OTHER', updated_at: serverTimestamp() }));
write('registry  change created_at', 'DENY', async (c) => updateDoc(doc(c.me, await c.freshSticker()), { created_at: serverTimestamp(), updated_at: serverTimestamp() }));
write('registry  delete', 'DENY', (c) => deleteDoc(doc(c.me, stickerPath(S_SECOND))));
write('registry  write beneath a sticker', 'DENY', (c) => setDoc(doc(c.me, `${stickerPath(S_ACTIVE)}/x/y`), { a: 1 }));
write('registry  a stored sticker with no status cannot be edited', 'DENY', (c) => updateDoc(doc(c.me, stickerPath(S_NO_STATUS)), rename()));
other('registry  OTHER reads U\'s sticker', 'DENY', (c) => getDoc(doc(c.other, stickerPath(S_ACTIVE))));
write('registry  OTHER creates under U', 'DENY', (c) => setDoc(doc(c.other, stickerPath(sid(22))), newSticker({ created_by: 'OTHER' })));
write('registry  OTHER updates U\'s sticker', 'DENY', async (c) => updateDoc(doc(c.other, await c.freshSticker()), rename()));
write('registry  an admin creates under U (viewing as is read-only)', 'DENY', (c) => setDoc(doc(c.admin, stickerPath(sid(23))), newSticker({ created_by: 'A' })));
write('registry  an admin archives U\'s sticker', 'DENY', async (c) => updateDoc(doc(c.admin, await c.freshSticker()), archive()));
write('registry  signed out creates', 'DENY', (c) => setDoc(doc(c.anon, stickerPath(sid(24))), newSticker()));

// ── Membership ──────────────────────────────────────────────────────────────
write('member  add an active sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_ACTIVE)));
write('member  add to a contact with no sticker fields', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith(null)), addWrite([], S_ACTIVE)));
write('member  add a second sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), addWrite([S_ACTIVE], S_SECOND)));
write('member  add atomically (arrayUnion)', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), atomicAdd(S_SECOND)));
write('member  add an archived sticker', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_ARCHIVED)));
write('member  add a sticker that does not exist', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], sid(99))));
write('member  add a stored sticker with no status', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_NO_STATUS)));
write('member  add a sticker with an unknown status', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_ODD_STATUS)));
write('member  add another user\'s sticker', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_OTHER_USERS)));
write('member  add two stickers in one write', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), {
  sticker_ids: [S_ACTIVE, S_SECOND],
  sticker_assignments: { [S_ACTIVE]: { assigned_at: serverTimestamp(), assigned_by: 'user' }, [S_SECOND]: { assigned_at: serverTimestamp(), assigned_by: 'user' } },
  sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
write('member  add without sticker_change', 'DENY', async (c) => {
  const w = addWrite([], S_ACTIVE);
  delete w.sticker_change;
  return updateDoc(doc(c.me, await c.contactWith(null)), w);
});
write('member  sticker_change names another sticker', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_ACTIVE, { named: S_SECOND })));
write('member  sticker_change with a client time', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), {
  ...addWrite([], S_ACTIVE), sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: T0 },
}));
write('member  sticker_change with an unknown op', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), {
  ...addWrite([], S_ACTIVE), sticker_change: { op: 'replace', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
write('member  assigned_by not allowed', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), addWrite([], S_ACTIVE, { by: 'migration' })));
write('member  add without its assignment', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([])), {
  sticker_ids: [S_ACTIVE], sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
write('member  the same sticker twice in the list', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), addWrite([S_ACTIVE], S_ACTIVE)));
write('member  change another sticker\'s assignment while adding', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), {
  ...addWrite([S_ACTIVE], S_SECOND), [`sticker_assignments.${S_ACTIVE}`]: { assigned_at: serverTimestamp(), assigned_by: 'csv_import' },
}));
write('member  remove a sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE, S_SECOND])), removeWrite([S_ACTIVE, S_SECOND], S_ACTIVE)));
write('member  remove an archived sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ARCHIVED])), removeWrite([S_ARCHIVED], S_ARCHIVED)));
write('member  remove but keep its assignment', 'DENY', async (c) => {
  const w = removeWrite([S_ACTIVE], S_ACTIVE);
  delete w[`sticker_assignments.${S_ACTIVE}`];
  return updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), w);
});
write('member  remove two at once', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE, S_SECOND])), {
  sticker_ids: [], sticker_assignments: {}, sticker_change: { op: 'remove', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
write('member  touch sticker_change alone', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), {
  sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
write('member  create a contact with stickers', 'DENY', (c) => setDoc(doc(c.me, `users/${U}/contacts/created-with`), { name: 'New', ...membership([S_ACTIVE]) }));
write('member  create a contact with an empty sticker list', 'DENY', (c) => setDoc(doc(c.me, `users/${U}/contacts/created-empty`), { name: 'New', sticker_ids: [] }));
write('member  overwrite a contact without its stickers', 'DENY', async (c) => setDoc(doc(c.me, await c.contactWith([S_ACTIVE])), { name: 'Replaced' }));

// ── The 50-sticker limit ────────────────────────────────────────────────────
write('limit  50th sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith(many(49))), addWrite(many(49), S_ACTIVE)));
write('limit  51st sticker', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith(many(50))), addWrite(many(50), S_ACTIVE)));
write('limit  51st sticker added atomically', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith(many(50))), atomicAdd(S_ACTIVE)));

// ── Simultaneous changes ────────────────────────────────────────────────────
write('concurrent  a stale add that would drop another tab\'s add', 'DENY', async (c) => {
  const path = await c.contactWith([]);
  await c.seed([[path, { name: 'Pat', ...membership([S_ACTIVE]) }]]); // tab A's add landed first
  return updateDoc(doc(c.me, path), {
    sticker_ids: [S_SECOND],
    sticker_assignments: { [S_SECOND]: { assigned_at: serverTimestamp(), assigned_by: 'user' } },
    sticker_change: { op: 'add', sticker_id: S_SECOND, at: serverTimestamp() },
  });
});
write('concurrent  a stale remove that would undo another tab\'s add', 'DENY', async (c) => {
  const path = await c.contactWith([S_ACTIVE, S_SECOND]);
  await c.seed([[path, { name: 'Pat', ...membership([S_ACTIVE, S_SECOND, S_ARCHIVED]) }]]); // tab A changed it first
  return updateDoc(doc(c.me, path), removeWrite([S_ACTIVE, S_SECOND], S_SECOND));
});
write('concurrent  two atomic adds of different stickers both land', 'ALLOW', async (c) => {
  const path = await c.contactWith([]);
  await Promise.all([updateDoc(doc(c.me, path), atomicAdd(S_ACTIVE)), updateDoc(doc(c.me, path), atomicAdd(S_SECOND))]);
  const stored = await c.read(path);
  if (!(stored.sticker_ids.includes(S_ACTIVE) && stored.sticker_ids.includes(S_SECOND))) throw new Error('an add was lost');
});

// ── Malformed or legacy stored data: refused safely, with a repair path ─────
write('legacy  add when sticker_ids is not a list', 'DENY', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: 'x' })), atomicAdd(S_ACTIVE)));
write('legacy  add when sticker_assignments is not a map', 'DENY', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [], sticker_assignments: 'x' })), atomicAdd(S_ACTIVE)));
write('legacy  add when the stored list repeats a sticker', 'DENY', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [S_SECOND, S_SECOND], sticker_assignments: { [S_SECOND]: assignment() } })), atomicAdd(S_ACTIVE)));
write('legacy  repair: remove the repeated sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [S_SECOND, S_SECOND], sticker_assignments: { [S_SECOND]: assignment() } })), removeWrite([S_SECOND, S_SECOND], S_SECOND)));
write('legacy  add when a stored sticker has no assignment', 'DENY', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [S_SECOND, sid(98)], sticker_assignments: { [S_SECOND]: assignment() } })), atomicAdd(S_ACTIVE)));
write('legacy  repair: remove the unassigned sticker', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [S_SECOND, sid(98)], sticker_assignments: { [S_SECOND]: assignment() } })), removeWrite([S_SECOND, sid(98)], sid(98))));
write('legacy  add to a contact stored with 51 stickers', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith(many(51))), atomicAdd(S_ACTIVE)));
write('legacy  repair: remove one of 51', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith(many(51))), removeWrite(many(51), many(51)[0])));
// An orphan assignment (a key in sticker_assignments for a sticker not in the list) can only be
// written by the Admin SDK. It blocks adds: clients cannot repair it, an operator can.
write('legacy  an orphan assignment blocks an add', 'DENY', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [S_SECOND], sticker_assignments: { [S_SECOND]: assignment(), [sid(97)]: assignment() } })), atomicAdd(S_ACTIVE)));
// Without the no-repeats check this crafted write would pass: the orphan key makes the assignment
// count match a list that repeats a sticker.
write('legacy  a repeated sticker hidden behind an orphan assignment', 'DENY', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: [S_SECOND], sticker_assignments: { [S_SECOND]: assignment(), [sid(97)]: assignment() } })), {
  sticker_ids: [S_SECOND, S_SECOND, S_ACTIVE],
  [`sticker_assignments.${S_ACTIVE}`]: { assigned_at: serverTimestamp(), assigned_by: 'user' },
  sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
other('legacy  an unrelated edit to a malformed contact still works', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.rawContact({ sticker_ids: 'x', sticker_assignments: 7 })), { title: 'CEO' }));

// ── Cross-user ──────────────────────────────────────────────────────────────
write('cross-user  OTHER adds a sticker to U\'s contact', 'DENY', async (c) => updateDoc(doc(c.other, await c.contactWith([])), addWrite([], S_ACTIVE)));
write('cross-user  OTHER removes a sticker from U\'s contact', 'DENY', async (c) => updateDoc(doc(c.other, await c.contactWith([S_ACTIVE])), removeWrite([S_ACTIVE], S_ACTIVE)));
write('cross-user  U writes membership on OTHER\'s contact', 'DENY', async (c) => updateDoc(doc(c.me, await c.contactWith([], 'OTHER')), addWrite([], S_OTHER_USERS)));
write('cross-user  an admin adds a sticker to U\'s contact', 'DENY', async (c) => updateDoc(doc(c.admin, await c.contactWith([])), addWrite([], S_ACTIVE)));
other('cross-user  OTHER reads U\'s contact', 'DENY', async (c) => getDoc(doc(c.other, await c.contactWith([S_ACTIVE]))));

// ── Writes that do not touch stickers behave as before ──────────────────────
other('unchanged  update a contact that has stickers', 'ALLOW', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), { name: 'Renamed', title: 'CEO' }));
other('unchanged  merge-write a contact that has stickers', 'ALLOW', async (c) => setDoc(doc(c.me, await c.contactWith([S_ACTIVE])), { notes: [] }, { merge: true }));
other('unchanged  create a contact', 'ALLOW', (c) => setDoc(doc(c.me, `users/${U}/contacts/new-plain`), { name: 'New', is_archived: false }));
other('unchanged  delete a contact that has stickers', 'ALLOW', async (c) => deleteDoc(doc(c.me, await c.contactWith([S_ACTIVE]))));
other('unchanged  timeline event under a contact', 'ALLOW', async (c) => setDoc(doc(c.me, `${await c.contactWith([S_ACTIVE])}/timeline/t1`), { type: 'note' }));
other('unchanged  update companies/c1 (case 09)', 'ALLOW', (c) => updateDoc(doc(c.me, `users/${U}/companies/c1`), { status: 'accepted' }));
other('unchanged  create lineageEvents (append-only kept)', 'ALLOW', (c) => setDoc(doc(c.me, `users/${U}/lineageEvents/e2`), { eventType: 'x' }));
other('unchanged  update lineageEvents (still denied)', 'DENY', (c) => updateDoc(doc(c.me, `users/${U}/lineageEvents/e1`), { eventType: 'y' }));

// ── Feature shutdown: every kind of sticker write stops; reads and the rest keep working ──
const off = (mode, fn) => async (c) => { await c.setMode(mode); return fn(c); };
write('shutdown off  create', 'DENY', off('off', (c) => setDoc(doc(c.me, stickerPath(sid(40))), newSticker())));
write('shutdown off  rename', 'DENY', off('off', async (c) => updateDoc(doc(c.me, await c.freshSticker()), rename())));
write('shutdown off  archive', 'DENY', off('off', async (c) => updateDoc(doc(c.me, await c.freshSticker()), archive())));
write('shutdown off  restore', 'DENY', off('off', async (c) => updateDoc(doc(c.me, await c.freshSticker({ status: 'archived', archived_at: T0 })), restore())));
write('shutdown off  add to a contact', 'DENY', off('off', async (c) => updateDoc(doc(c.me, await c.contactWith([])), atomicAdd(S_ACTIVE))));
write('shutdown off  remove from a contact', 'DENY', off('off', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), removeWrite([S_ACTIVE], S_ACTIVE))));
other('shutdown off  owner still reads own stickers', 'ALLOW', off('off', (c) => getDoc(doc(c.me, stickerPath(S_ACTIVE)))));
other('shutdown off  unrelated contact edits still work', 'ALLOW', off('off', async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), { title: 'CEO' })));
write('shutdown no flag document  rename', 'DENY', off(null, async (c) => updateDoc(doc(c.me, await c.freshSticker()), rename())));
write('shutdown no flag document  remove', 'DENY', off(null, async (c) => updateDoc(doc(c.me, await c.contactWith([S_ACTIVE])), removeWrite([S_ACTIVE], S_ACTIVE))));
write('shutdown mode "On" (not exact)  add', 'DENY', off('On', async (c) => updateDoc(doc(c.me, await c.contactWith([])), atomicAdd(S_ACTIVE))));

// ── Rollout documents are server-only ───────────────────────────────────────
other('rollout  read feature_flags/stickers', 'DENY', (c) => getDoc(doc(c.me, 'feature_flags/stickers')));
other('rollout  turn the feature on from a client', 'DENY', (c) => setDoc(doc(c.me, 'feature_flags/stickers'), { mode: 'on' }));
other('rollout  an admin turns it on from a client', 'DENY', (c) => setDoc(doc(c.admin, 'feature_flags/stickers'), { mode: 'on' }));
other('rollout  read own enrollment', 'DENY', (c) => getDoc(doc(c.as('E'), 'sticker_enrollment/E')));
other('rollout  enroll oneself', 'DENY', (c) => setDoc(doc(c.me, `sticker_enrollment/${U}`), { stage: 'beta' }));
other('rollout  the Admin SDK sets the mode', 'ALLOW', (c) => c.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'feature_flags/stickers'), { mode: 'on' })));

// ── Rollout modes: the parity table stickersConfig is tested against ────────
STICKER_ACCESS_MATRIX.forEach((row, i) => {
  const uid = `M${i}`;
  const expect = row.allowed ? 'ALLOW' : 'DENY';
  const label = `mode=${row.mode ?? '(none)'} role=${row.role ?? '-'} stage=${row.stage ?? '-'}`;
  const prepare = async (c) => {
    await c.seed([
      ['feature_flags/stickers', row.mode === null ? null : { mode: row.mode }],
      [`users/${uid}`, row.role === null ? { email: `${uid}@example.test` } : { email: `${uid}@example.test`, role: row.role }],
      [`sticker_enrollment/${uid}`, row.stage === null ? null : { stage: row.stage }],
      [stickerPath(S_ACTIVE, uid), storedSticker({ created_by: uid })],
    ]);
    return c.as(uid);
  };
  write(`mode  create   ${label}`, expect, async (c) => setDoc(doc(await prepare(c), stickerPath(sid(500 + i), uid)), newSticker({ created_by: uid })));
  write(`mode  member   ${label}`, expect, async (c) => {
    const db = await prepare(c);
    return updateDoc(doc(db, await c.contactWith([], uid)), atomicAdd(S_ACTIVE));
  });
});

// ── Runner ──────────────────────────────────────────────────────────────────
const denied = (err) => err?.code === 'permission-denied' || /PERMISSION_DENIED|permission[- ]denied/i.test(String(err?.message));
async function outcomeOf(run, c) {
  try {
    await run(c);
    return 'ALLOW';
  } catch (err) {
    return denied(err) ? 'DENY' : `ERROR(${err?.code ?? String(err?.message).split('\n')[0].slice(0, 80)})`;
  }
}

const observed = { live: [], lockdown: [] };
let pass = 0;
let fail = 0;
const failures = [];
for (const [envName, env] of Object.entries(ENVS)) {
  console.log(`\n  ── ${envName} rules ──`);
  const c = contextFor(env);
  for (const [index, kase] of CASES.entries()) {
    await c.setMode('on');
    const expect = envName === 'lockdown' && kase.kind === 'write' ? 'DENY' : kase.expect;
    const got = await outcomeOf(kase.run, c);
    observed[envName][index] = got;
    const label = `${String(index + 1).padStart(3, '0')}  ${kase.name}`;
    if (got === expect) {
      console.log(`  ✓ ${label.padEnd(74)} ${expect}`);
      pass++;
    } else {
      console.log(`  ✗ ${label.padEnd(74)} ${expect}  — got ${got}`);
      failures.push(`${envName} ${label}`);
      fail++;
    }
  }
}

// The rollback may only ever be stricter: check the observed outcomes, not just the expectations.
let stricter = 0;
let looser = 0;
for (const [index, kase] of CASES.entries()) {
  const liveAllowed = observed.live[index] === 'ALLOW';
  const lockAllowed = observed.lockdown[index] === 'ALLOW';
  if (lockAllowed && !liveAllowed) { looser++; fail++; failures.push(`rollback LOOSER than live: ${kase.name}`); }
  if (kase.kind === 'write' && lockAllowed) { fail++; failures.push(`rollback allowed a sticker write: ${kase.name}`); }
  if (liveAllowed && !lockAllowed) stricter++;
}
console.log(`\n  rollback: stricter than live in ${stricter} case(s), looser in ${looser} (checked on observed outcomes)`);
console.log(`  stickers: ${pass} passed, ${fail} failed  (${CASES.length} cases × 2 rule sets)`);
if (fail) console.log('  FAILED:', failures.join(' | '));
for (const env of Object.values(ENVS)) await env.cleanup();
process.exit(fail ? 1 : 0);
