/**
 * stickerCore (src/services/stickers/stickerCore.js): the one writer of
 * stickers and sticker membership.
 *
 * The core takes Firestore as an adapter, so these tests give it an in-memory
 * one with optimistic transactions: a transaction whose documents changed
 * between its reads and its commit is retried, as Firestore does. That is what
 * makes the concurrency cases below real interleavings rather than mocks
 * asserting what we already believe. The same code runs against the real
 * rules in scripts/rules-check/sticker-services.mjs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createStickerStore,
  StickerError,
  STICKER_ERRORS,
  STICKER_LIMIT,
  MEMBERSHIP_ATTEMPTS,
  DENIAL_REASONS,
  cleanStickerName,
  stickerNameKey,
  isStickerId,
  storedStickerIds,
  visibleStickers,
  sortStickers,
  toStickerError,
} from '../services/stickers/stickerCore.js';
import { mergeIdentifiers } from '../utils/identityResolution.js';
import { enrichmentPatch } from '../utils/contactProtection.js';

const here = dirname(fileURLToPath(import.meta.url));

// ── An in-memory Firestore adapter ───────────────────────────────────────────
const SERVER_TIME = Symbol('serverTimestamp');
const DELETE = Symbol('deleteField');
const UNION = Symbol('arrayUnion');
const REMOVE = Symbol('arrayRemove');

function createMemoryFirestore() {
  const docs = new Map();
  const versions = new Map();
  let clock = 1_700_000_000_000;
  let autoId = 0;
  const hooks = { beforeCommit: null, denyCommits: 0, commitAttempts: 0, onDeny: null, denyRead: null, abortCommits: 0, attempted: [] };
  const writes = [];

  const resolveValue = (value, now) => {
    if (value === SERVER_TIME) return { __ts: now };
    if (Array.isArray(value)) return value.map((v) => resolveValue(v, now));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, now)]));
    return value;
  };
  const snapshot = (path) => {
    const data = docs.get(path);
    return { id: path.split('/').pop(), exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
  };
  const bump = (path) => versions.set(path, (versions.get(path) ?? 0) + 1);

  function applyUpdate(path, patch) {
    if (!docs.has(path)) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
    const now = ++clock;
    const next = structuredClone(docs.get(path));
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = next;
      for (const part of parts.slice(0, -1)) target = (target[part] ??= {});
      const last = parts[parts.length - 1];
      if (value === DELETE) delete target[last];
      else if (value?.[UNION]) target[last] = [...(target[last] ?? []), ...value[UNION].filter((v) => !(target[last] ?? []).includes(v))];
      else if (value?.[REMOVE]) target[last] = (target[last] ?? []).filter((v) => !value[REMOVE].includes(v));
      else target[last] = resolveValue(value, now);
    }
    checkMembershipInvariants(path, next);
    docs.set(path, next);
    bump(path);
    writes.push({ path, keys: Object.keys(patch) });
  }

  const fs = {
    doc: (first, ...segments) => {
      if (first?.kind === 'collection') return { kind: 'doc', path: `${first.path}/${segments[0] ?? `AUTO${String(++autoId).padStart(16, '0')}`}`, get id() { return this.path.split('/').pop(); } };
      return { kind: 'doc', path: segments.join('/'), get id() { return this.path.split('/').pop(); } };
    },
    collection: (_db, ...segments) => ({ kind: 'collection', path: segments.join('/') }),
    setDoc: async (ref, data) => {
      docs.set(ref.path, resolveValue(data, ++clock));
      bump(ref.path);
      writes.push({ path: ref.path, keys: Object.keys(data) });
    },
    updateDoc: async (ref, patch) => applyUpdate(ref.path, patch),
    serverTimestamp: () => SERVER_TIME,
    deleteField: () => DELETE,
    arrayUnion: (...values) => ({ [UNION]: values }),
    arrayRemove: (...values) => ({ [REMOVE]: values }),
    onSnapshot: (ref, next) => {
      const prefix = `${ref.path}/`;
      next({ docs: [...docs.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(snapshot) });
      return () => {};
    },
    runTransaction: async (_db, fn) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const read = new Map();
        const pending = [];
        const tx = {
          get: async (ref) => {
            await Promise.resolve(); // yield, so concurrent transactions interleave
            if (hooks.denyRead?.(ref.path)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
            read.set(ref.path, versions.get(ref.path) ?? 0);
            return snapshot(ref.path);
          },
          update: (ref, patch) => pending.push([ref.path, patch]),
        };
        const result = await fn(tx);
        await Promise.resolve();
        if (hooks.beforeCommit) {
          const hook = hooks.beforeCommit;
          hooks.beforeCommit = null;
          await hook();
        }
        const stale = [...read].some(([path, version]) => (versions.get(path) ?? 0) !== version);
        if (stale) continue; // Firestore retries a transaction whose reads changed
        hooks.commitAttempts += 1;
        if (pending.length) hooks.attempted.push(structuredClone(pending.map(([path, patch]) => [path, Object.keys(patch).sort()])));
        if (pending.length && hooks.abortCommits > 0) {
          hooks.abortCommits -= 1;
          throw Object.assign(new Error('Transaction aborted.'), { code: 'aborted' });
        }
        if (pending.length && hooks.denyCommits > 0) {
          // The server refusing a write: judged on newer data (contention), or a real refusal.
          hooks.denyCommits -= 1;
          if (hooks.onDeny) await hooks.onDeny();
          throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        }
        for (const [path, patch] of pending) applyUpdate(path, patch);
        return result;
      }
      throw Object.assign(new Error('Transaction failed after retries'), { code: 'aborted' });
    },
  };
  return { fs, db: {}, docs, writes, hooks, seed: (path, data) => { docs.set(path, structuredClone(data)); bump(path); } };
}

/** What firestore.rules enforce on a contact, checked after every write here too. */
function checkMembershipInvariants(path, data) {
  if (!path.includes('/contacts/') || data.sticker_ids === undefined) return;
  const ids = data.sticker_ids;
  if (!Array.isArray(ids)) throw new Error('sticker_ids must be a list');
  if (ids.length > STICKER_LIMIT) throw new Error('more than 50 stickers');
  if (new Set(ids).size !== ids.length) throw new Error('a sticker appears twice');
  const keys = Object.keys(data.sticker_assignments ?? {});
  if (keys.length !== ids.length || !ids.every((id) => keys.includes(id))) throw new Error('assignments do not match sticker_ids');
}

const UID = 'U';
const sid = (n) => `S${String(n).padStart(19, '0')}`;
const S1 = sid(1);
const S2 = sid(2);
const S3 = sid(3);
const ARCHIVED = sid(9);
const sticker = (over = {}) => ({ schema_version: 1, name: 'Board', color: 'teal', emoji: null, description: null, status: 'active', archived_at: null, created_by: UID, ...over });
const assignment = { assigned_at: { __ts: 1 }, assigned_by: 'user' };
const withStickers = (ids, extra = {}) => ({ name: 'Pat', ...extra, sticker_ids: ids, sticker_assignments: Object.fromEntries(ids.map((id) => [id, assignment])) });

let mem;
let store;
const contact = (id) => mem.docs.get(`users/${UID}/contacts/${id}`);
beforeEach(() => {
  mem = createMemoryFirestore();
  store = createStickerStore({ db: mem.db, fs: mem.fs });
  mem.seed(`users/${UID}/stickers/${S1}`, sticker());
  mem.seed(`users/${UID}/stickers/${S2}`, sticker({ name: 'Volunteer' }));
  mem.seed(`users/${UID}/stickers/${S3}`, sticker({ name: 'Donor' }));
  mem.seed(`users/${UID}/stickers/${ARCHIVED}`, sticker({ name: 'Old', status: 'archived', archived_at: { __ts: 1 } }));
  mem.seed(`users/${UID}/contacts/k1`, { name: 'Pat' });
});

const expectCode = async (promise, code) => {
  await expect(promise).rejects.toBeInstanceOf(StickerError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('the sticker registry', () => {
  it('creates a sticker with a fresh ID and exactly the stored fields', async () => {
    const { id } = await store.createSticker(UID, { name: '  Board   member ', color: 'teal', emoji: '🏛' });
    const stored = mem.docs.get(`users/${UID}/stickers/${id}`);
    expect(Object.keys(stored).sort()).toEqual(['archived_at', 'color', 'created_at', 'created_by', 'description', 'emoji', 'name', 'schema_version', 'status', 'updated_at']);
    expect(stored).toMatchObject({ schema_version: 1, name: 'Board member', color: 'teal', emoji: '🏛', description: null, status: 'active', archived_at: null, created_by: UID });
  });

  it('defaults to gray with no emoji or description', async () => {
    const { id } = await store.createSticker(UID, { name: 'Donor' });
    expect(mem.docs.get(`users/${UID}/stickers/${id}`)).toMatchObject({ color: 'gray', emoji: null, description: null });
  });

  it.each([
    ['an empty name', { name: '   ' }, STICKER_ERRORS.INVALID_NAME],
    ['a 61-character name', { name: 'x'.repeat(61) }, STICKER_ERRORS.INVALID_NAME],
    ['a name that is not text', { name: 42 }, STICKER_ERRORS.INVALID_NAME],
    ['an unknown color', { name: 'Donor', color: 'red' }, STICKER_ERRORS.INVALID_COLOR],
    ['a long emoji', { name: 'Donor', emoji: 'x'.repeat(17) }, STICKER_ERRORS.INVALID_EMOJI],
    ['a long description', { name: 'Donor', description: 'x'.repeat(281) }, STICKER_ERRORS.INVALID_DESCRIPTION],
  ])('refuses %s, and writes nothing', async (_label, input, code) => {
    const before = mem.writes.length;
    await expectCode(store.createSticker(UID, input), code);
    expect(mem.writes.length).toBe(before);
  });

  it('needs a signed-in user', async () => {
    await expectCode(store.createSticker('', { name: 'Donor' }), STICKER_ERRORS.NOT_SIGNED_IN);
  });

  it('updates only name, color, emoji and description, always with updated_at', async () => {
    await store.updateSticker(UID, S2, { name: 'Volunteers', color: 'blue' });
    expect(mem.writes.at(-1).keys.sort()).toEqual(['color', 'name', 'updated_at']);
    expect(mem.docs.get(`users/${UID}/stickers/${S2}`)).toMatchObject({ name: 'Volunteers', color: 'blue' });
    await expectCode(store.updateSticker(UID, S2, { status: 'archived' }), STICKER_ERRORS.INVALID_CHANGE);
    await expectCode(store.updateSticker(UID, S2, { created_by: 'OTHER' }), STICKER_ERRORS.INVALID_CHANGE);
    await expectCode(store.updateSticker(UID, S2, {}), STICKER_ERRORS.INVALID_CHANGE);
    await expectCode(store.updateSticker(UID, 'stk_100', { name: 'x' }), STICKER_ERRORS.INVALID_STICKER_ID);
  });

  it('archives and restores without touching any contact', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S2]));
    await store.archiveSticker(UID, S2);
    expect(mem.docs.get(`users/${UID}/stickers/${S2}`)).toMatchObject({ status: 'archived', archived_at: expect.any(Object) });
    await store.restoreSticker(UID, S2);
    expect(mem.docs.get(`users/${UID}/stickers/${S2}`)).toMatchObject({ status: 'active', archived_at: null });
    expect(contact('k2').sticker_ids).toEqual([S2]);
    expect(mem.writes.every((w) => w.path.includes('/stickers/'))).toBe(true);
  });

  it('lists stickers sorted by name', async () => {
    let list;
    store.subscribeStickers(UID, (next) => { list = next; });
    expect(list.map((s) => s.name)).toEqual(['Board', 'Donor', 'Old', 'Volunteer']);
  });

  it('maps a Firestore permission error to permission_denied', () => {
    expect(toStickerError(Object.assign(new Error('x'), { code: 'permission-denied' })).code).toBe(STICKER_ERRORS.PERMISSION_DENIED);
    expect(toStickerError(new Error('x')).code).toBe(STICKER_ERRORS.WRITE_FAILED);
  });
});

describe('adding and removing stickers on a contact', () => {
  it('adds a sticker with its assignment and the change record', async () => {
    await expect(store.addSticker(UID, 'k1', S1)).resolves.toEqual({ status: 'added' });
    expect(contact('k1')).toMatchObject({
      name: 'Pat',
      sticker_ids: [S1],
      sticker_assignments: { [S1]: { assigned_by: 'user', assigned_at: expect.any(Object) } },
      sticker_change: { op: 'add', sticker_id: S1, at: expect.any(Object) },
    });
  });

  it('records a CSV import as the source when asked', async () => {
    await store.addSticker(UID, 'k1', S1, { assignedBy: 'csv_import' });
    expect(contact('k1').sticker_assignments[S1].assigned_by).toBe('csv_import');
    await expectCode(store.addSticker(UID, 'k1', S2, { assignedBy: 'migration' }), STICKER_ERRORS.INVALID_CHANGE);
  });

  it('writes nothing when the contact already has the sticker', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S1]));
    const before = mem.writes.length;
    await expect(store.addSticker(UID, 'k2', S1)).resolves.toEqual({ status: 'already' });
    expect(mem.writes.length).toBe(before);
  });

  it('keeps the stored list exactly, adding one at the end', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S2, sid(77)]));
    await store.addSticker(UID, 'k2', S1);
    expect(contact('k2').sticker_ids).toEqual([S2, sid(77), S1]);
  });

  it.each([
    ['an archived sticker', ARCHIVED, 'k1', STICKER_ERRORS.STICKER_ARCHIVED],
    ['a sticker that does not exist', sid(99), 'k1', STICKER_ERRORS.STICKER_NOT_FOUND],
    ['a contact that does not exist', S1, 'nobody', STICKER_ERRORS.CONTACT_NOT_FOUND],
    ['an ID that is not a sticker ID', 'stk_100', 'k1', STICKER_ERRORS.INVALID_STICKER_ID],
    ['a contact ID with a slash', S1, 'a/b', STICKER_ERRORS.INVALID_CONTACT_ID],
  ])('refuses %s, and writes nothing', async (_label, stickerId, contactId, code) => {
    const before = mem.writes.length;
    await expectCode(store.addSticker(UID, contactId, stickerId), code);
    expect(mem.writes.length).toBe(before);
  });

  it('allows the 50th sticker and refuses the 51st', async () => {
    const fortyNine = Array.from({ length: 49 }, (_, i) => sid(100 + i));
    mem.seed(`users/${UID}/contacts/k49`, withStickers(fortyNine));
    await expect(store.addSticker(UID, 'k49', S1)).resolves.toEqual({ status: 'added' });
    expect(contact('k49').sticker_ids).toHaveLength(50);
    const before = mem.writes.length;
    await expectCode(store.addSticker(UID, 'k49', S2), STICKER_ERRORS.LIMIT_REACHED);
    expect(mem.writes.length).toBe(before);
    expect(contact('k49').sticker_ids).toHaveLength(50);
  });

  it('removes a sticker and its assignment, keeping the others', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S1, S2]));
    await expect(store.removeSticker(UID, 'k2', S1)).resolves.toEqual({ status: 'removed' });
    expect(contact('k2').sticker_ids).toEqual([S2]);
    expect(Object.keys(contact('k2').sticker_assignments)).toEqual([S2]);
    expect(contact('k2').sticker_change).toMatchObject({ op: 'remove', sticker_id: S1 });
  });

  it('removes an archived sticker', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([ARCHIVED]));
    await expect(store.removeSticker(UID, 'k2', ARCHIVED)).resolves.toEqual({ status: 'removed' });
    expect(contact('k2').sticker_ids).toEqual([]);
  });

  it('writes nothing when removing a sticker the contact does not have', async () => {
    const before = mem.writes.length;
    await expect(store.removeSticker(UID, 'k1', S1)).resolves.toEqual({ status: 'absent' });
    expect(mem.writes.length).toBe(before);
  });
});

describe('concurrent changes', () => {
  it('two tabs adding different stickers at once both keep theirs', async () => {
    const results = await Promise.all([store.addSticker(UID, 'k1', S1), store.addSticker(UID, 'k1', S2), store.addSticker(UID, 'k1', S3)]);
    expect(results.map((r) => r.status)).toEqual(['added', 'added', 'added']);
    expect([...contact('k1').sticker_ids].sort()).toEqual([S1, S2, S3].sort());
  });

  it('two tabs adding the same sticker at once add it once', async () => {
    const results = await Promise.all([store.addSticker(UID, 'k1', S1), store.addSticker(UID, 'k1', S1)]);
    expect(results.map((r) => r.status).sort()).toEqual(['added', 'already']);
    expect(contact('k1').sticker_ids).toEqual([S1]);
  });

  it('an archive that lands mid-add makes the add fail, and the contact is unchanged', async () => {
    mem.hooks.beforeCommit = () => mem.fs.updateDoc({ path: `users/${UID}/stickers/${S1}` }, { status: 'archived', archived_at: mem.fs.serverTimestamp() });
    await expectCode(store.addSticker(UID, 'k1', S1), STICKER_ERRORS.STICKER_ARCHIVED);
    expect(contact('k1')).toEqual({ name: 'Pat' });
  });

  it('an unrelated edit that lands mid-add is kept, and the sticker is added', async () => {
    mem.hooks.beforeCommit = () => mem.fs.updateDoc({ path: `users/${UID}/contacts/k1` }, { title: 'CEO' });
    await expect(store.addSticker(UID, 'k1', S1)).resolves.toEqual({ status: 'added' });
    expect(contact('k1')).toMatchObject({ name: 'Pat', title: 'CEO', sticker_ids: [S1] });
  });

  it('a removal that lands mid-add is kept', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S2]));
    mem.hooks.beforeCommit = () => store.removeSticker(UID, 'k2', S2);
    await store.addSticker(UID, 'k2', S1);
    expect(contact('k2').sticker_ids).toEqual([S1]);
  });

  it('at 49, two concurrent adds: one is added, the other hits the limit', async () => {
    mem.seed(`users/${UID}/contacts/k49`, withStickers(Array.from({ length: 49 }, (_, i) => sid(100 + i))));
    const results = await Promise.allSettled([store.addSticker(UID, 'k49', S1), store.addSticker(UID, 'k49', S2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe(STICKER_ERRORS.LIMIT_REACHED);
    expect(contact('k49').sticker_ids).toHaveLength(50);
  });
});

describe('a refusal from the server: contention or authorization', () => {
  // Another tab's change, landing exactly when this write is refused.
  let n = 0;
  const concurrentAdd = () => {
    const path = `users/${UID}/contacts/k1`;
    const current = mem.docs.get(path);
    const id = sid(700 + ++n);
    mem.seed(path, { ...current, sticker_ids: [...(current.sticker_ids ?? []), id], sticker_assignments: { ...(current.sticker_assignments ?? {}), [id]: assignment } });
  };
  const rejection = async (promise) => {
    try { await promise; } catch (err) { return err; }
    throw new Error('expected a rejection');
  };

  it('contention: refused once while another tab changed the contact, then re-read and added', async () => {
    mem.hooks.denyCommits = 1;
    mem.hooks.onDeny = concurrentAdd;
    await expect(store.addSticker(UID, 'k1', S1)).resolves.toEqual({ status: 'added' });
    expect(mem.hooks.commitAttempts).toBe(2);
    expect(contact('k1').sticker_ids).toEqual([sid(701), S1]);
  });

  it('authorization: refused again on the same data (feature off, access revoked) stops at the second attempt', async () => {
    mem.hooks.denyCommits = 100;
    const err = await rejection(store.addSticker(UID, 'k1', S1));
    expect(err).toMatchObject({ code: STICKER_ERRORS.PERMISSION_DENIED, reason: DENIAL_REASONS.WRITE_DENIED, attempts: 2 });
    expect(mem.hooks.commitAttempts).toBe(2);
    expect(contact('k1')).toEqual({ name: 'Pat' });
  });

  it('revoked after contention: one contended refusal, then the same data refused again', async () => {
    mem.hooks.denyCommits = 100;
    mem.hooks.onDeny = () => { concurrentAdd(); mem.hooks.onDeny = null; };
    const err = await rejection(store.addSticker(UID, 'k1', S1));
    expect(err).toMatchObject({ reason: DENIAL_REASONS.WRITE_DENIED, attempts: 3 });
  });

  it('contention that never settles is reported after a fixed number of attempts', async () => {
    mem.hooks.denyCommits = 100;
    mem.hooks.onDeny = concurrentAdd;
    const err = await rejection(store.addSticker(UID, 'k1', S1));
    expect(err).toMatchObject({ code: STICKER_ERRORS.PERMISSION_DENIED, reason: DENIAL_REASONS.CONTENTION_EXHAUSTED, attempts: MEMBERSHIP_ATTEMPTS });
    expect(mem.hooks.commitAttempts).toBe(MEMBERSHIP_ATTEMPTS);
  });

  it('a refused READ (someone else\'s contact) is final at once, and nothing is written', async () => {
    mem.hooks.denyRead = (path) => path.includes('/contacts/');
    const err = await rejection(store.addSticker(UID, 'k1', S1));
    expect(err).toMatchObject({ code: STICKER_ERRORS.PERMISSION_DENIED, reason: DENIAL_REASONS.READ_DENIED, attempts: 1 });
    expect(mem.hooks.commitAttempts).toBe(0);
  });

  it('an aborted commit is contention: retried, then reported if it never settles', async () => {
    mem.hooks.abortCommits = 2;
    await expect(store.addSticker(UID, 'k1', S1)).resolves.toEqual({ status: 'added' });
    mem.seed(`users/${UID}/contacts/k2`, { name: 'Sam' });
    mem.hooks.abortCommits = 100;
    const err = await rejection(store.addSticker(UID, 'k2', S1));
    expect(err).toMatchObject({ code: STICKER_ERRORS.WRITE_FAILED, reason: DENIAL_REASONS.CONTENTION_EXHAUSTED, attempts: MEMBERSHIP_ATTEMPTS });
  });

  it('removal is classified the same way', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S1]));
    mem.hooks.denyCommits = 100;
    const err = await rejection(store.removeSticker(UID, 'k2', S1));
    expect(err).toMatchObject({ reason: DENIAL_REASONS.WRITE_DENIED, attempts: 2 });
    expect(contact('k2').sticker_ids).toEqual([S1]);
  });

  it('a retry never sends a weaker write: every attempt carries the full membership change', async () => {
    mem.hooks.denyCommits = 100;
    mem.hooks.onDeny = concurrentAdd;
    await rejection(store.addSticker(UID, 'k1', S1));
    expect(mem.hooks.attempted).toHaveLength(MEMBERSHIP_ATTEMPTS);
    for (const attempt of mem.hooks.attempted) {
      expect(attempt).toEqual([[`users/${UID}/contacts/k1`, [`sticker_assignments.${S1}`, 'sticker_change', 'sticker_ids']]]);
    }
  });

  it('a failure the service decided from fresh data is not retried', async () => {
    await expectCode(store.addSticker(UID, 'k1', ARCHIVED), STICKER_ERRORS.STICKER_ARCHIVED);
    expect(mem.hooks.commitAttempts).toBe(0);
  });
});

describe('adding one sticker to many contacts', () => {
  it('reports each contact, and one failure never blocks the rest', async () => {
    mem.seed(`users/${UID}/contacts/k2`, withStickers([S1]));
    mem.seed(`users/${UID}/contacts/full`, withStickers(Array.from({ length: 50 }, (_, i) => sid(200 + i))));
    mem.seed(`users/${UID}/contacts/k3`, { name: 'Sam' });
    const result = await store.addStickerToContacts(UID, ['k1', 'k2', 'gone', 'full', 'k3', 'k1'], S1);
    expect(result).toEqual({
      added: ['k1', 'k3'],
      already: ['k2'],
      failed: [
        { contactId: 'gone', code: STICKER_ERRORS.CONTACT_NOT_FOUND, reason: null },
        { contactId: 'full', code: STICKER_ERRORS.LIMIT_REACHED, reason: null },
      ],
    });
    expect(contact('k3').sticker_ids).toEqual([S1]);
  });

  it('reports progress as each contact finishes', async () => {
    const seen = [];
    await store.addStickerToContacts(UID, ['k1', 'gone', 'k1', 'k3'], S1, { onProgress: (done, total) => seen.push([done, total]) });
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('a refusal keeps its reason, so the screen can tell revoked access from contention', async () => {
    mem.hooks.denyCommits = 100;
    const result = await store.addStickerToContacts(UID, ['k1'], S1);
    expect(result.failed).toEqual([{ contactId: 'k1', code: STICKER_ERRORS.PERMISSION_DENIED, reason: DENIAL_REASONS.WRITE_DENIED }]);
  });
});

describe('pure helpers', () => {
  it('cleans names and builds a comparison key', () => {
    expect(cleanStickerName('  Board \n member ')).toBe('Board member');
    expect(stickerNameKey(' Board  MEMBER ')).toBe('board member');
    expect(() => cleanStickerName('')).toThrow(StickerError);
  });

  it('recognizes only 20-character auto-IDs', () => {
    expect(isStickerId(S1)).toBe(true);
    for (const id of ['stk_100', 'board', `${S1}x`, 'a/b'.padEnd(20, 'x'), null]) expect(isStickerId(id)).toBe(false);
  });

  it('reads stored IDs as stored, and an absent field as none', () => {
    expect(storedStickerIds({ sticker_ids: [S2, S1] })).toEqual([S2, S1]);
    expect(storedStickerIds({})).toEqual([]);
    expect(storedStickerIds({ sticker_ids: 'x' })).toEqual([]);
  });

  it('shows only known active stickers, once each, by name', () => {
    const byId = new Map([[S1, { id: S1, name: 'Volunteer', status: 'active' }], [S2, { id: S2, name: 'board', status: 'active' }], [ARCHIVED, { id: ARCHIVED, name: 'Old', status: 'archived' }]]);
    expect(visibleStickers({ sticker_ids: [S1, sid(55), ARCHIVED, S2, S1] }, byId).map((s) => s.id)).toEqual([S2, S1]);
    expect(sortStickers([{ id: 'b', name: 'X' }, { id: 'a', name: 'x' }]).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('contact protection: no other path writes stickers', () => {
  const stickerKeys = (patch) => Object.keys(patch).filter((key) => key.startsWith('sticker_'));

  it('an identity merge never writes sticker fields', () => {
    const patch = mergeIdentifiers({ name: 'Pat' }, { email: 'pat@example.test', sticker_ids: [S1], sticker_assignments: { [S1]: assignment }, sticker_change: { op: 'add' } });
    expect(patch.email).toBe('pat@example.test');
    expect(stickerKeys(patch)).toEqual([]);
  });

  it('enrichment never writes sticker fields', () => {
    const { patch } = enrichmentPatch({ name: 'Pat' }, { title: 'CEO', sticker_ids: [S1], sticker_assignments: {}, sticker_change: {} });
    expect(stickerKeys(patch)).toEqual([]);
  });

  it('the core imports no Firebase SDK', () => {
    const source = readFileSync(resolve(here, '../services/stickers/stickerCore.js'), 'utf8');
    expect(source).not.toMatch(/from ['"]firebase/);
    expect(source).not.toMatch(/\bimport\b[^;]*from/);
  });
});
