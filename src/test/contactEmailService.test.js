/**
 * saveContactEmailEdit (src/services/contactEmailService.js): one email edit,
 * applied in a transaction to the contact as stored, written with email and
 * email_normalized.
 *
 * firebase/firestore is an in-memory store whose runTransaction retries when a
 * document it read changed before the commit, as Firestore does, so the
 * concurrent-edit cases are real interleavings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mem = vi.hoisted(() => ({ docs: new Map(), versions: new Map(), beforeCommit: null, writes: 0 }));

vi.mock('firebase/firestore', () => {
  const bump = (path) => mem.versions.set(path, (mem.versions.get(path) ?? 0) + 1);
  const snapshot = (path) => {
    const data = mem.docs.get(path);
    return { exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
  };
  return {
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    runTransaction: async (_db, fn) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const read = new Map();
        const pending = [];
        const tx = {
          get: async (ref) => { await Promise.resolve(); read.set(ref.path, mem.versions.get(ref.path) ?? 0); return snapshot(ref.path); },
          update: (ref, patch) => pending.push([ref.path, patch]),
        };
        const result = await fn(tx);
        if (mem.beforeCommit) { const hook = mem.beforeCommit; mem.beforeCommit = null; await hook(); }
        if ([...read].some(([path, version]) => (mem.versions.get(path) ?? 0) !== version)) continue;
        for (const [path, patch] of pending) {
          mem.docs.set(path, { ...mem.docs.get(path), ...structuredClone(patch) });
          bump(path);
          mem.writes += 1;
        }
        return result;
      }
      throw new Error('transaction failed');
    },
    __write: (path, patch) => { mem.docs.set(path, { ...mem.docs.get(path), ...patch }); bump(path); },
  };
});
vi.mock('../firebase/config', () => ({ db: {} }));

const firestore = await import('firebase/firestore');
const { saveContactEmailEdit, ContactEmailError } = await import('../services/contactEmailService');
const { emailIdentityDrift } = await import('../utils/contactEmails');

const PATH = 'users/u1/contacts/c1';
const stored = () => mem.docs.get(PATH);
const now = () => '2026-11-04T12:00:00.000Z';

beforeEach(() => {
  mem.docs.clear();
  mem.versions.clear();
  mem.beforeCommit = null;
  mem.writes = 0;
});

describe('saveContactEmailEdit', () => {
  it('changing the primary writes all three fields, and returns the stored contact', async () => {
    mem.docs.set(PATH, { name: 'Jane', email: 'old@acme.test', email_normalized: 'old@acme.test' });
    const saved = await saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: '0', value: 'Jane@Acme.test', label: 'work' } }, { now });
    expect(stored()).toEqual({
      name: 'Jane',
      email: 'Jane@Acme.test',
      email_normalized: 'jane@acme.test',
      emails: [{ id: '0', value: 'Jane@Acme.test', label: 'work' }],
      updated_at: now(),
    });
    expect(saved).toEqual({ ...stored(), id: 'c1' });
    expect(emailIdentityDrift(stored())).toEqual([]);
  });

  it('adding a secondary keeps the primary and its key', async () => {
    mem.docs.set(PATH, { email: 'a@x.test', email_normalized: 'a@x.test' });
    await saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: 'n1', value: 'b@x.test', label: 'personal' } }, { now });
    expect(stored()).toMatchObject({ email: 'a@x.test', email_normalized: 'a@x.test' });
    expect(stored().emails.map((e) => e.value)).toEqual(['a@x.test', 'b@x.test']);
  });

  it('removing the only address clears email and email_normalized', async () => {
    mem.docs.set(PATH, { email: 'a@x.test', email_normalized: 'a@x.test', emails: [{ id: '1', value: 'a@x.test', label: 'work' }] });
    await saveContactEmailEdit('u1', 'c1', { type: 'remove', id: '1' }, { now });
    expect(stored()).toMatchObject({ emails: [], email: null, email_normalized: null });
  });

  it('repairs a contact the old ContactInfo path left inconsistent', async () => {
    mem.docs.set(PATH, { emails: [{ id: '1', value: 'a@x.test', label: 'work' }] });
    await saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: '2', value: 'b@x.test', label: 'other' } }, { now });
    expect(stored()).toMatchObject({ email: 'a@x.test', email_normalized: 'a@x.test' });
    expect(emailIdentityDrift(stored())).toEqual([]);
  });

  it('refuses a contact that does not exist, and writes nothing', async () => {
    await expect(saveContactEmailEdit('u1', 'c1', { type: 'remove', id: '1' })).rejects.toMatchObject({ code: 'contact_not_found' });
    await expect(saveContactEmailEdit('', 'c1', { type: 'remove', id: '1' })).rejects.toBeInstanceOf(ContactEmailError);
    expect(mem.writes).toBe(0);
  });
});

describe('concurrent edits', () => {
  it('an address another tab added meanwhile is kept', async () => {
    mem.docs.set(PATH, { email: 'a@x.test', email_normalized: 'a@x.test', emails: [{ id: '1', value: 'a@x.test', label: 'work' }] });
    mem.beforeCommit = () => firestore.__write(PATH, {
      emails: [{ id: '1', value: 'a@x.test', label: 'work' }, { id: 't2', value: 'tab2@x.test', label: 'other' }],
    });
    await saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: 't1', value: 'tab1@x.test', label: 'personal' } }, { now });
    expect(stored().emails.map((e) => e.value)).toEqual(['a@x.test', 'tab2@x.test', 'tab1@x.test']);
  });

  it('an email Barry Enrich filled meanwhile becomes the primary the edit builds on', async () => {
    mem.docs.set(PATH, { name: 'Jane' });
    mem.beforeCommit = () => firestore.__write(PATH, { email: 'enriched@acme.test' });
    await saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: 'n1', value: 'home@x.test', label: 'personal' } }, { now });
    expect(stored()).toMatchObject({ email: 'enriched@acme.test', email_normalized: 'enriched@acme.test' });
    expect(stored().emails.map((e) => e.value)).toEqual(['enriched@acme.test', 'home@x.test']);
  });

  it('a removal in another tab is not undone by an edit to a different address', async () => {
    mem.docs.set(PATH, { email: 'a@x.test', email_normalized: 'a@x.test', emails: [{ id: '1', value: 'a@x.test', label: 'work' }, { id: '2', value: 'b@x.test', label: 'other' }] });
    mem.beforeCommit = () => firestore.__write(PATH, { emails: [{ id: '1', value: 'a@x.test', label: 'work' }] });
    await saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: '1', value: 'a@x.test', label: 'personal' } }, { now });
    expect(stored().emails).toEqual([{ id: '1', value: 'a@x.test', label: 'personal' }]);
  });

  it('two saves at once both land', async () => {
    mem.docs.set(PATH, { email: 'a@x.test', email_normalized: 'a@x.test' });
    await Promise.all([
      saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: 'x', value: 'x@x.test', label: 'other' } }, { now }),
      saveContactEmailEdit('u1', 'c1', { type: 'upsert', entry: { id: 'y', value: 'y@x.test', label: 'other' } }, { now }),
    ]);
    expect(stored().emails.map((e) => e.value).sort()).toEqual(['a@x.test', 'x@x.test', 'y@x.test']);
  });
});
