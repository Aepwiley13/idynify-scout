/**
 * Sticker rules (ADR-007), against a REAL Firestore emulator.
 *
 * Two rule sets, both built from ../../firestore.rules, the live file:
 *
 *   live      the file as it is
 *   lockdown  the same file with stickerRulesEnabled() returning false: the
 *             documented rollback. It must deny every sticker write and
 *             leave every other write exactly as it was.
 *
 * What is checked: the sticker registry (create-only IDs, no delete, field
 * validation), contact membership (one sticker per write, only an existing
 * active sticker of the same user, 50 at most, stale writes refused), the
 * rollout modes (the STICKER_ACCESS_MATRIX the stickersConfig tests also run),
 * cross-user isolation, and the server-only rollout documents.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, Timestamp } from 'firebase/firestore';
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
const live = await initializeTestEnvironment({ projectId: 'demo-stickers', firestore: { rules: LIVE, ...emulator } });
const lockdown = await initializeTestEnvironment({ projectId: 'demo-stickers-lockdown', firestore: { rules: LOCKDOWN, ...emulator } });
// Start from empty data in both demo projects, so the suite can be re-run in one emulator session.
await live.clearFirestore();
await lockdown.clearFirestore();

// Sticker IDs are Firestore auto-IDs: 20 letters and digits.
const sid = (n) => `S${String(n).padStart(19, '0')}`;
const U = 'U';
const S_ACTIVE = sid(1);
const S_ARCHIVED = sid(2);
const S_OTHER_USERS = sid(3);
const S_SECOND = sid(4);

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
const removeWrite = (ids, id) => ({
  sticker_ids: ids.filter((x) => x !== id),
  [`sticker_assignments.${id}`]: deleteField(),
  sticker_change: { op: 'remove', sticker_id: id, at: serverTimestamp() },
});
const many = (n, from = 100) => Array.from({ length: n }, (_, i) => sid(from + i));

async function seed(env, writes) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of writes) {
      if (data === null) await deleteDoc(doc(db, path));
      else await setDoc(doc(db, path), data);
    }
  });
}

let contactSeq = 0;
/** A fresh contact for one case, so no case depends on another's writes. */
async function contactWith(env, ids, uid = U) {
  const id = `k${++contactSeq}`;
  await seed(env, [[`users/${uid}/contacts/${id}`, { name: 'Pat', ...(ids ? membership(ids) : {}) }]]);
  return `users/${uid}/contacts/${id}`;
}

const baseSeed = [
  ['feature_flags/stickers', { mode: 'on' }],
  [`users/${U}/stickers/${S_ACTIVE}`, storedSticker()],
  [`users/${U}/stickers/${S_SECOND}`, storedSticker({ name: 'Volunteer', color: 'green' })],
  [`users/${U}/stickers/${S_ARCHIVED}`, storedSticker({ name: 'Old', status: 'archived', archived_at: T0 })],
  [`users/OTHER/stickers/${S_OTHER_USERS}`, storedSticker({ created_by: 'OTHER' })],
  [`users/${U}/companies/c1`, { status: 'pending' }],
  [`users/${U}/contacts/plain`, { name: 'x' }],
  ['sticker_enrollment/E', { stage: 'beta' }],
];
await seed(live, baseSeed);
await seed(lockdown, baseSeed);

const me = live.authenticatedContext(U).firestore();
const other = live.authenticatedContext('OTHER').firestore();
const unauthenticated = live.unauthenticatedContext().firestore();
const stickerPath = (id, uid = U) => `users/${uid}/stickers/${id}`;

const CASES = [];
const add = (name, expect, run) => CASES.push([name, expect, run]);

// ── Registry ────────────────────────────────────────────────────────────────
add('registry  owner creates a sticker', 'ALLOW', () => setDoc(doc(me, stickerPath(sid(10))), newSticker()));
add('registry  owner reads own sticker', 'ALLOW', () => getDoc(doc(me, stickerPath(S_ACTIVE))));
add('registry  ID not a 20-character auto-ID', 'DENY', () => setDoc(doc(me, stickerPath('stk_100')), newSticker()));
add('registry  created_by someone else', 'DENY', () => setDoc(doc(me, stickerPath(sid(11))), newSticker({ created_by: 'OTHER' })));
add('registry  created archived', 'DENY', () => setDoc(doc(me, stickerPath(sid(12))), newSticker({ status: 'archived', archived_at: serverTimestamp() })));
add('registry  extra field', 'DENY', () => setDoc(doc(me, stickerPath(sid(13))), newSticker({ external_ids: { hub: 'stk_1' } })));
add('registry  missing field', 'DENY', () => { const s = newSticker(); delete s.emoji; return setDoc(doc(me, stickerPath(sid(14))), s); });
add('registry  unknown color', 'DENY', () => setDoc(doc(me, stickerPath(sid(15))), newSticker({ color: 'red' })));
add('registry  empty name', 'DENY', () => setDoc(doc(me, stickerPath(sid(16))), newSticker({ name: '' })));
add('registry  61-character name', 'DENY', () => setDoc(doc(me, stickerPath(sid(17))), newSticker({ name: 'x'.repeat(61) })));
add('registry  60-character name', 'ALLOW', () => setDoc(doc(me, stickerPath(sid(18))), newSticker({ name: 'x'.repeat(60) })));
add('registry  client-chosen created_at', 'DENY', () => setDoc(doc(me, stickerPath(sid(19))), newSticker({ created_at: T0 })));
add('registry  set() over an existing sticker (takeover)', 'DENY', () => setDoc(doc(me, stickerPath(S_ACTIVE)), newSticker({ name: 'Advisory Board' })));
add('registry  rename, recolor, emoji', 'ALLOW', () => updateDoc(doc(me, stickerPath(S_SECOND)), { name: 'Volunteers', color: 'blue', emoji: '🙌', updated_at: serverTimestamp() }));
add('registry  update without updated_at', 'DENY', () => updateDoc(doc(me, stickerPath(S_SECOND)), { name: 'No time' }));
add('registry  archive', 'ALLOW', async () => {
  await seed(live, [[stickerPath(sid(20)), storedSticker()]]);
  return updateDoc(doc(me, stickerPath(sid(20))), { status: 'archived', archived_at: serverTimestamp(), updated_at: serverTimestamp() });
});
add('registry  archive without archived_at', 'DENY', () => updateDoc(doc(me, stickerPath(S_SECOND)), { status: 'archived', updated_at: serverTimestamp() }));
add('registry  restore', 'ALLOW', async () => {
  await seed(live, [[stickerPath(sid(21)), storedSticker({ status: 'archived', archived_at: T0 })]]);
  return updateDoc(doc(me, stickerPath(sid(21))), { status: 'active', archived_at: null, updated_at: serverTimestamp() });
});
add('registry  change created_by', 'DENY', () => updateDoc(doc(me, stickerPath(S_SECOND)), { created_by: 'OTHER', updated_at: serverTimestamp() }));
add('registry  change created_at', 'DENY', () => updateDoc(doc(me, stickerPath(S_SECOND)), { created_at: serverTimestamp(), updated_at: serverTimestamp() }));
add('registry  delete', 'DENY', () => deleteDoc(doc(me, stickerPath(S_SECOND))));
add('registry  write beneath a sticker', 'DENY', () => setDoc(doc(me, `${stickerPath(S_ACTIVE)}/x/y`), { a: 1 }));
add('registry  OTHER reads U\'s sticker', 'DENY', () => getDoc(doc(other, stickerPath(S_ACTIVE))));
add('registry  OTHER creates under U', 'DENY', () => setDoc(doc(other, stickerPath(sid(22))), newSticker({ created_by: 'OTHER' })));
add('registry  OTHER updates U\'s sticker', 'DENY', () => updateDoc(doc(other, stickerPath(S_SECOND)), { name: 'x', updated_at: serverTimestamp() }));
add('registry  signed out creates', 'DENY', () => setDoc(doc(unauthenticated, stickerPath(sid(23))), newSticker()));

// ── Membership ──────────────────────────────────────────────────────────────
add('member  add an active sticker', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, [])), addWrite([], S_ACTIVE)));
add('member  add to a contact with no sticker fields', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, null)), addWrite([], S_ACTIVE)));
add('member  add a second sticker', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE])), addWrite([S_ACTIVE], S_SECOND)));
add('member  add an archived sticker', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), addWrite([], S_ARCHIVED)));
add('member  add a sticker that does not exist', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), addWrite([], sid(99))));
add('member  add another user\'s sticker', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), addWrite([], S_OTHER_USERS)));
add('member  add two stickers in one write', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), {
  sticker_ids: [S_ACTIVE, S_SECOND],
  sticker_assignments: { [S_ACTIVE]: { assigned_at: serverTimestamp(), assigned_by: 'user' }, [S_SECOND]: { assigned_at: serverTimestamp(), assigned_by: 'user' } },
  sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
add('member  add without sticker_change', 'DENY', async () => {
  const w = addWrite([], S_ACTIVE);
  delete w.sticker_change;
  return updateDoc(doc(me, await contactWith(live, null)), w);
});
add('member  sticker_change names another sticker', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), addWrite([], S_ACTIVE, { named: S_SECOND })));
add('member  sticker_change with a client time', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), {
  ...addWrite([], S_ACTIVE), sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: T0 },
}));
add('member  assigned_by not allowed', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), addWrite([], S_ACTIVE, { by: 'migration' })));
add('member  add without its assignment', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [])), {
  sticker_ids: [S_ACTIVE], sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
add('member  the same sticker twice in the list', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE])), {
  ...addWrite([S_ACTIVE], S_ACTIVE),
}));
add('member  change another sticker\'s assignment while adding', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE])), {
  ...addWrite([S_ACTIVE], S_SECOND), [`sticker_assignments.${S_ACTIVE}`]: { assigned_at: serverTimestamp(), assigned_by: 'csv_import' },
}));
add('member  remove a sticker', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE, S_SECOND])), removeWrite([S_ACTIVE, S_SECOND], S_ACTIVE)));
add('member  remove an archived sticker', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, [S_ARCHIVED])), removeWrite([S_ARCHIVED], S_ARCHIVED)));
add('member  remove but keep its assignment', 'DENY', async () => {
  const w = removeWrite([S_ACTIVE], S_ACTIVE);
  delete w[`sticker_assignments.${S_ACTIVE}`];
  return updateDoc(doc(me, await contactWith(live, [S_ACTIVE])), w);
});
add('member  remove two at once', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE, S_SECOND])), {
  sticker_ids: [], sticker_assignments: {}, sticker_change: { op: 'remove', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
add('member  touch sticker_change alone', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE])), {
  sticker_change: { op: 'add', sticker_id: S_ACTIVE, at: serverTimestamp() },
}));
add('member  50th sticker', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, many(49))), addWrite(many(49), S_ACTIVE)));
add('member  51st sticker', 'DENY', async () => updateDoc(doc(me, await contactWith(live, many(50))), addWrite(many(50), S_ACTIVE)));
add('member  stale write that would drop a concurrent add', 'DENY', async () => {
  // Two tabs both read [] ; tab A adds S_ACTIVE first; tab B then writes [S_SECOND] from its stale read.
  const path = await contactWith(live, []);
  await updateDoc(doc(me, path), addWrite([], S_ACTIVE));
  return updateDoc(doc(me, path), {
    sticker_ids: [S_SECOND],
    sticker_assignments: { [S_SECOND]: { assigned_at: serverTimestamp(), assigned_by: 'user' } },
    sticker_change: { op: 'add', sticker_id: S_SECOND, at: serverTimestamp() },
  });
});
add('member  create a contact with stickers', 'DENY', () => setDoc(doc(me, `users/${U}/contacts/created-with`), { name: 'New', ...membership([S_ACTIVE]) }));
add('member  OTHER adds a sticker to U\'s contact', 'DENY', async () => updateDoc(doc(other, await contactWith(live, [])), addWrite([], S_ACTIVE)));
add('member  U writes membership on OTHER\'s contact', 'DENY', async () => updateDoc(doc(me, await contactWith(live, [], 'OTHER')), addWrite([], S_OTHER_USERS)));
add('member  overwrite a contact without its stickers', 'DENY', async () => setDoc(doc(me, await contactWith(live, [S_ACTIVE])), { name: 'Replaced' }));

// ── Writes that do not touch stickers behave as before ──────────────────────
add('unchanged  update a contact that has stickers', 'ALLOW', async () => updateDoc(doc(me, await contactWith(live, [S_ACTIVE])), { name: 'Renamed', title: 'CEO' }));
add('unchanged  merge-write a contact that has stickers', 'ALLOW', async () => setDoc(doc(me, await contactWith(live, [S_ACTIVE])), { notes: [] }, { merge: true }));
add('unchanged  create a contact', 'ALLOW', () => setDoc(doc(me, `users/${U}/contacts/new-plain`), { name: 'New', is_archived: false }));
add('unchanged  delete a contact that has stickers', 'ALLOW', async () => deleteDoc(doc(me, await contactWith(live, [S_ACTIVE]))));
add('unchanged  timeline event under a contact', 'ALLOW', async () => setDoc(doc(me, `${await contactWith(live, [S_ACTIVE])}/timeline/t1`), { type: 'note' }));
add('unchanged  update companies/c1 (case 09)', 'ALLOW', () => updateDoc(doc(me, `users/${U}/companies/c1`), { status: 'accepted' }));

// ── Rollout documents are server-only ───────────────────────────────────────
add('rollout  read feature_flags/stickers', 'DENY', () => getDoc(doc(me, 'feature_flags/stickers')));
add('rollout  turn the feature on', 'DENY', () => setDoc(doc(me, 'feature_flags/stickers'), { mode: 'on' }));
add('rollout  read own enrollment', 'DENY', () => getDoc(doc(live.authenticatedContext('E').firestore(), 'sticker_enrollment/E')));
add('rollout  enroll oneself', 'DENY', () => setDoc(doc(me, `sticker_enrollment/${U}`), { stage: 'beta' }));
add('rollout  admin SDK sets the mode', 'ALLOW', () => live.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'feature_flags/stickers'), { mode: 'on' })));

// ── Rollout modes: the parity table stickersConfig is tested against ────────
STICKER_ACCESS_MATRIX.forEach((row, i) => {
  const uid = `M${i}`;
  const expect = row.allowed ? 'ALLOW' : 'DENY';
  const label = `mode=${row.mode ?? '(none)'} role=${row.role ?? '-'} stage=${row.stage ?? '-'}`;
  const prepare = async () => {
    await seed(live, [
      ['feature_flags/stickers', row.mode === null ? null : { mode: row.mode }],
      [`users/${uid}`, row.role === null ? { email: `${uid}@example.test` } : { email: `${uid}@example.test`, role: row.role }],
      [`sticker_enrollment/${uid}`, row.stage === null ? null : { stage: row.stage }],
      [stickerPath(S_ACTIVE, uid), storedSticker({ created_by: uid })],
    ]);
    return live.authenticatedContext(uid).firestore();
  };
  add(`mode  create   ${label}`, expect, async () => {
    const db = await prepare();
    return setDoc(doc(db, stickerPath(sid(500 + i), uid)), newSticker({ created_by: uid }));
  });
  add(`mode  member   ${label}`, expect, async () => {
    const db = await prepare();
    return updateDoc(doc(db, await contactWith(live, [], uid)), addWrite([], S_ACTIVE));
  });
});
add('mode  (reset to on)', 'ALLOW', () => live.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'feature_flags/stickers'), { mode: 'on' })));

// ── The rollback variant: every sticker write denied, nothing else changed ──
const lme = lockdown.authenticatedContext(U).firestore();
add('lockdown  create a sticker', 'DENY', () => setDoc(doc(lme, stickerPath(sid(30))), newSticker()));
add('lockdown  rename a sticker', 'DENY', () => updateDoc(doc(lme, stickerPath(S_SECOND)), { name: 'x', updated_at: serverTimestamp() }));
add('lockdown  add a sticker to a contact', 'DENY', async () => updateDoc(doc(lme, await contactWith(lockdown, [])), addWrite([], S_ACTIVE)));
add('lockdown  remove a sticker from a contact', 'DENY', async () => updateDoc(doc(lme, await contactWith(lockdown, [S_ACTIVE])), removeWrite([S_ACTIVE], S_ACTIVE)));
add('lockdown  read own sticker', 'ALLOW', () => getDoc(doc(lme, stickerPath(S_ACTIVE))));
add('lockdown  update a contact that has stickers', 'ALLOW', async () => updateDoc(doc(lme, await contactWith(lockdown, [S_ACTIVE])), { name: 'Renamed' }));
add('lockdown  create a contact', 'ALLOW', () => setDoc(doc(lme, `users/${U}/contacts/lock-new`), { name: 'New' }));
add('lockdown  delete a contact', 'ALLOW', async () => deleteDoc(doc(lme, await contactWith(lockdown, [S_ACTIVE]))));
add('lockdown  timeline event under a contact', 'ALLOW', async () => setDoc(doc(lme, `${await contactWith(lockdown, [])}/timeline/t1`), { type: 'note' }));
add('lockdown  update companies/c1 (case 09)', 'ALLOW', () => updateDoc(doc(lme, `users/${U}/companies/c1`), { status: 'accepted' }));
add('lockdown  create lineageEvents (append-only kept)', 'ALLOW', () => setDoc(doc(lme, `users/${U}/lineageEvents/e1`), { eventType: 'x' }));
add('lockdown  update lineageEvents (still denied)', 'DENY', () => updateDoc(doc(lme, `users/${U}/lineageEvents/e1`), { eventType: 'y' }));
add('lockdown  turn the feature on from a client', 'DENY', () => setDoc(doc(lme, 'feature_flags/stickers'), { mode: 'on' }));

let pass = 0;
let fail = 0;
const failures = [];
for (const [index, [name, expect, run]] of CASES.entries()) {
  const label = `${String(index + 1).padStart(2, '0')}  ${name}`;
  try {
    await (expect === 'ALLOW' ? assertSucceeds(run()) : assertFails(run()));
    console.log(`  ✓ ${label.padEnd(72)} ${expect}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${label.padEnd(72)} ${expect}  — ${String(err.message).split('\n')[0].slice(0, 110)}`);
    failures.push(label);
    fail++;
  }
}

console.log(`\n  stickers: ${pass} passed, ${fail} failed`);
if (fail) console.log('  FAILED:', failures.join(' | '));
await live.cleanup();
await lockdown.cleanup();
process.exit(fail ? 1 : 0);
