/**
 * Rollout parity (ADR-007): the Firestore rules, the stickersConfig endpoint
 * and the app's availability hook give the same answer, for every mode, on
 * the same stored documents, in the Firestore emulator.
 *
 *   rules     a real sticker write by the user, judged by ../../firestore.rules
 *   endpoint  resolveStickersConfig() (netlify/functions/utils/stickersFlags.js),
 *             the function stickersConfig answers with, reading the same
 *             documents through an Admin-SDK-shaped adapter
 *   hook      availabilityFromConfig() (src/components/stickers/
 *             stickersAvailabilityState.js), the decision useStickersAvailability
 *             makes from that answer
 *
 * Also: viewing as another user stays read-only on all three. The hook shows
 * nothing for a read-only answer, and the rules refuse an admin's writes on
 * someone else's data in every mode.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, updateDoc, arrayUnion, Timestamp } from 'firebase/firestore';
import { STICKER_ACCESS_MATRIX, STICKER_MODES } from '../../src/constants/stickersAccess.js';
import { resolveStickersConfig } from '../../netlify/functions/utils/stickersFlags.js';
import { availabilityFromConfig, AVAILABILITY } from '../../src/components/stickers/stickersAvailabilityState.js';

const env = await initializeTestEnvironment({
  projectId: 'demo-sticker-flags',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();

const T0 = Timestamp.fromMillis(1_700_000_000_000);
const sid = (n) => `S${String(n).padStart(19, '0')}`;
async function seed(writes) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [path, data] of writes) {
      if (data === null) await deleteDoc(doc(ctx.firestore(), path));
      else await setDoc(doc(ctx.firestore(), path), data);
    }
  });
}

/** The Admin SDK shape stickersFlags reads through (collection().doc().get()), over the emulator. */
const adminShaped = {
  collection: (collectionName) => ({
    doc: (id) => ({
      get: async () => {
        let snapshot;
        await env.withSecurityRulesDisabled(async (ctx) => { snapshot = await getDoc(doc(ctx.firestore(), collectionName, id)); });
        return { exists: snapshot.exists(), data: () => snapshot.data() };
      },
    }),
  }),
};

const newSticker = (uid) => ({
  schema_version: 1, name: 'Parity', color: 'teal', emoji: null, description: null, status: 'active', archived_at: null,
  created_at: serverTimestamp(), created_by: uid, updated_at: serverTimestamp(),
});
async function rulesAllow(uid, n) {
  try {
    await setDoc(doc(env.authenticatedContext(uid).firestore(), `users/${uid}/stickers/${sid(n)}`), newSticker(uid));
    return true;
  } catch (err) {
    if (err?.code === 'permission-denied' || /PERMISSION_DENIED/.test(String(err?.message))) return false;
    throw err;
  }
}

const rows = [];
let pass = 0;
let fail = 0;
const record = (label, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(64)} ${detail}`);
  if (ok) pass++; else fail++;
  rows.push({ label, ok });
};

// ── Every row of the parity table, on all three ─────────────────────────────
for (const [i, row] of STICKER_ACCESS_MATRIX.entries()) {
  const uid = `P${i}`;
  await seed([
    ['feature_flags/stickers', row.mode === null ? null : { mode: row.mode }],
    [`users/${uid}`, row.role === null ? { email: `${uid}@example.test` } : { email: `${uid}@example.test`, role: row.role }],
    [`sticker_enrollment/${uid}`, row.stage === null ? null : { stage: row.stage }],
  ]);
  const rules = await rulesAllow(uid, 1000 + i);
  const config = await resolveStickersConfig(adminShaped, uid);
  const hook = availabilityFromConfig({ status: 200, body: { ...config, readOnly: false } }) === AVAILABILITY.AVAILABLE;
  const label = `mode=${row.mode ?? '(none)'} role=${row.role ?? '-'} stage=${row.stage ?? '-'}`;
  const agree = rules === row.allowed && config.enabled === row.allowed && hook === row.allowed;
  record(label, agree, `rules=${rules} endpoint=${config.enabled} hook=${hook} expected=${row.allowed}`);
}

// ── Viewing as another user is read-only, in every mode ─────────────────────
await seed([['users/A', { email: 'a@example.test', role: 'admin' }], ['users/U', { email: 'u@example.test' }]]);
await seed([['users/U/contacts/k1', { name: 'Pat' }], [`users/U/stickers/${sid(1)}`, { ...newSticker('U'), created_at: T0, updated_at: T0 }]]);
for (const mode of Object.values(STICKER_MODES)) {
  await seed([['feature_flags/stickers', { mode }]]);
  const config = await resolveStickersConfig(adminShaped, 'U');
  // stickersConfig answers an impersonating admin with the user's config and readOnly: true.
  const hook = availabilityFromConfig({ status: 200, body: { ...config, readOnly: true } });
  const admin = env.authenticatedContext('A').firestore();
  let adminWrote = false;
  try {
    await updateDoc(doc(admin, 'users/U/contacts/k1'), {
      sticker_ids: arrayUnion(sid(1)),
      [`sticker_assignments.${sid(1)}`]: { assigned_at: serverTimestamp(), assigned_by: 'user' },
      sticker_change: { op: 'add', sticker_id: sid(1), at: serverTimestamp() },
    });
    adminWrote = true;
  } catch (err) {
    if (!(err?.code === 'permission-denied' || /PERMISSION_DENIED/.test(String(err?.message)))) throw err;
  }
  let adminCreated = false;
  try {
    await setDoc(doc(admin, `users/U/stickers/${sid(2)}`), newSticker('A'));
    adminCreated = true;
  } catch (err) {
    if (!(err?.code === 'permission-denied' || /PERMISSION_DENIED/.test(String(err?.message)))) throw err;
  }
  record(`viewing as U, mode=${mode}`, hook === AVAILABILITY.UNAVAILABLE && !adminWrote && !adminCreated,
    `hook=${hook} admin membership write=${adminWrote} admin sticker create=${adminCreated}`);
}

// ── A malformed or missing answer never shows controls ──────────────────────
for (const [label, answer] of [
  ['no readOnly field', { status: 200, body: { enabled: true, mode: 'on' } }],
  ['enabled as a string', { status: 200, body: { enabled: 'true', readOnly: false } }],
  ['an error status', { status: 500, body: { error: 'internal_error' } }],
  ['no answer', {}],
]) {
  const hook = availabilityFromConfig(answer);
  record(`hook  ${label}`, hook === AVAILABILITY.UNAVAILABLE, `hook=${hook}`);
}

console.log(`\n  flag parity: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
