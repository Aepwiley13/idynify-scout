/**
 * H2-1 — useContactIdentityEdit: the controller behind the header's name, title and organization edits.
 *
 * Not connected to PersonHeader or any screen yet. It is driven here through a small stand-in for Contact Hub's list:
 * one state holding every contact, and an id-addressed onPatch(contactId, fields) that merges ONLY those fields into
 * ONLY that contact (as Contact Hub's updateContact does with { id, ...fields }).
 *
 * The writes go through the real saveContactFields; the Firestore write is a stand-in whose results the test settles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, useCallback } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

const fake = vi.hoisted(() => ({ writes: [] }));
const viewer = vi.hoisted(() => ({ value: { uid: 'u1' } }));

vi.mock('../firebase/config', () => ({ db: { __db: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  updateDoc: (ref, data) => new Promise((resolve, reject) => { fake.writes.push({ path: ref.path, data, resolve, reject }); }),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => viewer.value,
  useImpersonation: () => ({ isImpersonating: Boolean(viewer.value?._isImpersonated) }),
}));

import { useContactIdentityEdit } from '../components/contacts/personHeader/useContactIdentityEdit';

const CSV = { id: 'c1', first_name: 'Jane', last_name: 'Doe', title: 'Analyst', company_name: 'Acme', stickers: 'kept' };
const ANA = { id: 'c2', name: 'Ana Lopez', title: 'Director', company_name: 'Globex' };
const LINKED = { id: 'c3', name: 'Lee Park', title: 'CTO', company_name: 'Initech', company_id: 'co9' };

let patches;
function useHarness(initial, { withPatch = true } = {}) {
  const [contacts, setContacts] = useState(initial);
  const [currentId, setCurrentId] = useState(Object.keys(initial)[0]);
  const onPatch = useCallback((id, fields) => {
    patches.push([id, { ...fields }]);
    setContacts((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } }));
  }, []);
  const api = useContactIdentityEdit({ contact: contacts[currentId], onPatch: withPatch ? onPatch : undefined });
  return { api, contacts, currentId, setCurrentId };
}
const setup = (initial, options) => renderHook(() => useHarness(initial, options));
const byId = (list) => Object.fromEntries(list.map((c) => [c.id, c]));

const ok = (i) => act(async () => { fake.writes[i].resolve(); });
const fail = (i, code = 'unavailable') => act(async () => { const e = new Error('x'); e.code = code; fake.writes[i].reject(e); });

beforeEach(() => {
  fake.writes = [];
  patches = [];
  viewer.value = { uid: 'u1' };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('who may edit', () => {
  it('a signed-in owner may edit name and title, and organization when the contact is not linked to a company', () => {
    const { result } = setup(byId([ANA]));
    expect(result.current.api.canEdit).toBe(true);
    expect(result.current.api.editable('name')).toBe(true);
    expect(result.current.api.editable('title')).toBe(true);
    expect(result.current.api.editable('organization')).toBe(true);
  });

  it('a contact linked to a company has a read-only organization', () => {
    const { result } = setup(byId([LINKED]));
    expect(result.current.api.editable('organization')).toBe(false);
    expect(result.current.api.editable('name')).toBe(true);
  });

  it.each([
    ['an impersonated session', { uid: 'target', _isImpersonated: true }],
    ['no signed-in user', null],
  ])('nothing is editable for %s', (_label, user) => {
    viewer.value = user;
    const { result } = setup(byId([ANA]));
    expect(result.current.api.canEdit).toBe(false);
    expect(result.current.api.editable('name')).toBe(false);
    expect(result.current.api.start('name')).toBe(false);
    expect(result.current.api.editing).toBeNull();
  });

  it('nothing is editable without an id-addressed onPatch (it fails closed rather than writing blind)', () => {
    const { result } = setup(byId([ANA]), { withPatch: false });
    expect(result.current.api.canEdit).toBe(false);
  });

  it('nothing is editable for a contact with no id', () => {
    const { result } = setup({ x: { name: 'No id' } });
    expect(result.current.api.canEdit).toBe(false);
  });
});

describe('the edit session: start, change, commit, cancel', () => {
  it('starts with the displayed value: a CSV contact starts with first and last name', () => {
    const { result } = setup(byId([CSV]));
    act(() => { expect(result.current.api.start('name')).toBe(true); });
    expect(result.current.api.editing).toEqual({ field: 'name', value: 'Jane Doe' });
  });

  it('refuses to start on a read-only field', () => {
    const { result } = setup(byId([LINKED]));
    act(() => { expect(result.current.api.start('organization')).toBe(false); });
    expect(result.current.api.editing).toBeNull();
  });

  it('commit saves the typed value once; Enter then blur is one write', async () => {
    const { result } = setup(byId([ANA]));
    act(() => { result.current.api.start('title'); });
    act(() => { result.current.api.setValue('  Head of Sales '); });
    let first; let second;
    await act(async () => { first = result.current.api.commit(); second = result.current.api.commit(); await Promise.resolve(); });
    expect(await second).toEqual({ status: 'ignored' });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].data).toMatchObject({ title: 'Head of Sales' });
    expect(result.current.api.editing).toBeNull();
    await ok(0);
    expect((await first).status).toBe('saved');
  });

  it('Escape cancels, and the blur that follows writes nothing', async () => {
    const { result } = setup(byId([ANA]));
    act(() => { result.current.api.start('title'); });
    act(() => { result.current.api.setValue('Changed'); });
    act(() => { result.current.api.cancel(); });
    let late;
    await act(async () => { late = await result.current.api.commit(); });
    expect(late).toEqual({ status: 'ignored' });
    expect(fake.writes).toEqual([]);
    expect(patches).toEqual([]);
    expect(result.current.api.editing).toBeNull();
  });

  it('a commit with no session is ignored, and a new session works after a commit', async () => {
    const { result } = setup(byId([ANA]));
    let r;
    await act(async () => { r = await result.current.api.commit(); });
    expect(r).toEqual({ status: 'ignored' });
    act(() => { result.current.api.start('title'); });
    act(() => { result.current.api.setValue('A'); });
    await act(async () => { result.current.api.commit(); await Promise.resolve(); });
    act(() => { result.current.api.start('title'); });
    expect(result.current.api.editing).toEqual({ field: 'title', value: 'A' });
  });

  it('closes an open edit when the person moves to another contact, writing nothing', () => {
    const { result } = setup(byId([ANA, CSV]));
    act(() => { result.current.api.start('title'); });
    expect(result.current.api.editing).not.toBeNull();
    act(() => { result.current.setCurrentId('c1'); });
    expect(result.current.api.editing).toBeNull();
    expect(fake.writes).toEqual([]);
  });
});

describe('what a save writes', () => {
  it('a CSV contact: only name (and updated_at) is written; first_name, last_name and everything else are untouched', async () => {
    const { result } = setup(byId([CSV]));
    await act(async () => { result.current.api.save('name', 'Jane Q. Doe'); await Promise.resolve(); });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].path).toBe('users/u1/contacts/c1');
    expect(Object.keys(fake.writes[0].data).sort()).toEqual(['name', 'updated_at']);
    expect(fake.writes[0].data.name).toBe('Jane Q. Doe');
    await ok(0);
    expect(result.current.contacts.c1).toMatchObject({ first_name: 'Jane', last_name: 'Doe', name: 'Jane Q. Doe', stickers: 'kept' });
  });

  it('organization is written as company_name', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('organization', 'Initech'); await Promise.resolve(); });
    expect(Object.keys(fake.writes[0].data).sort()).toEqual(['company_name', 'updated_at']);
    expect(patches).toEqual([['c2', { company_name: 'Initech' }]]);
  });

  it('refuses a blank name: no write, no patch, the old name stays', async () => {
    const { result } = setup(byId([ANA]));
    let r;
    await act(async () => { r = await result.current.api.save('name', '   '); });
    expect(r).toEqual({ status: 'refused', reason: 'blank_name' });
    expect(fake.writes).toEqual([]);
    expect(patches).toEqual([]);
    expect(result.current.contacts.c2.name).toBe('Ana Lopez');
  });

  it('an unchanged value is a no-op, including saving a CSV contact\'s displayed name', async () => {
    const { result } = setup(byId([CSV, ANA]));
    let a; let b;
    await act(async () => { a = await result.current.api.save('name', 'Jane Doe'); });
    expect(a).toEqual({ status: 'unchanged' });
    act(() => { result.current.setCurrentId('c2'); });
    await act(async () => { b = await result.current.api.save('title', ' Director '); });
    expect(b).toEqual({ status: 'unchanged' });
    expect(fake.writes).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('refuses the organization of a linked contact, writing nothing', async () => {
    const { result } = setup(byId([LINKED]));
    let r;
    await act(async () => { r = await result.current.api.save('organization', 'Other'); });
    expect(r).toEqual({ status: 'refused', reason: 'not_editable' });
    expect(fake.writes).toEqual([]);
  });
});

describe('optimistic update, success and failure', () => {
  it('applies the new value at once, before the write finishes, and keeps it on success', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    expect(result.current.contacts.c2.title).toBe('VP');
    expect(result.current.api.isSaving('title')).toBe(true);
    await ok(0);
    expect(result.current.contacts.c2.title).toBe('VP');
    expect(result.current.api.isSaving('title')).toBe(false);
    expect(result.current.api.error).toBeNull();
    expect(patches).toEqual([['c2', { title: 'VP' }]]);
  });

  it('on failure restores ONLY that field, and says which field failed and why', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    await fail(0, 'permission-denied');
    expect(result.current.contacts.c2).toEqual(ANA);
    expect(patches).toEqual([['c2', { title: 'VP' }], ['c2', { title: 'Director' }]]);
    expect(result.current.api.error).toEqual({ field: 'title', code: 'permission-denied' });
    expect(result.current.api.isSaving('title')).toBe(false);
  });

  it('on failure of a CSV name edit, the name goes back to "not set", leaving first and last name', async () => {
    const { result } = setup(byId([CSV]));
    await act(async () => { result.current.api.save('name', 'Jane Q. Doe'); await Promise.resolve(); });
    await fail(0);
    expect(result.current.contacts.c1.name).toBeUndefined();
    expect(result.current.contacts.c1).toMatchObject({ first_name: 'Jane', last_name: 'Doe' });
  });

  it('recovers: the next save clears the error and works', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    await fail(0);
    expect(result.current.api.error).not.toBeNull();
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    expect(result.current.api.error).toBeNull();
    await ok(1);
    expect(result.current.contacts.c2.title).toBe('VP');
    expect(fake.writes).toHaveLength(2);
  });

  it('the failure message carries a code only, never contact data', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'Secret Title'); await Promise.resolve(); });
    await fail(0, 'unavailable');
    const logged = JSON.stringify(console.warn.mock.calls);
    expect(logged).not.toContain('Secret Title');
    expect(logged).not.toContain('Ana');
  });
});

describe('overlapping saves', () => {
  it('two different fields saved while both are pending do not overwrite each other', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('name', 'Ana M. Lopez'); await Promise.resolve(); });
    expect(result.current.contacts.c2).toMatchObject({ title: 'VP', name: 'Ana M. Lopez' });
    await ok(1);
    await ok(0);
    expect(result.current.contacts.c2).toMatchObject({ title: 'VP', name: 'Ana M. Lopez' });
  });

  it('when one of two different fields fails, only that field goes back; the other stays', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('name', 'Ana M. Lopez'); await Promise.resolve(); });
    await fail(1);
    expect(result.current.contacts.c2).toMatchObject({ title: 'VP', name: 'Ana Lopez' });
    await ok(0);
    expect(result.current.contacts.c2).toMatchObject({ title: 'VP', name: 'Ana Lopez' });
    expect(result.current.api.error).toEqual({ field: 'name', code: 'unavailable' });
  });

  it('same field twice: if the FIRST fails after the second was made, the newer value stays and nothing is rolled back', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'First'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('title', 'Second'); await Promise.resolve(); });
    await fail(0);
    expect(result.current.contacts.c2.title).toBe('Second');
    expect(patches.filter(([, f]) => f.title === 'Director')).toEqual([]);
    expect(result.current.api.error).toBeNull();
    await ok(1);
    expect(result.current.contacts.c2.title).toBe('Second');
  });

  it('same field twice: if the SECOND fails after the first succeeded, it goes back to the first value, not the original', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'First'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('title', 'Second'); await Promise.resolve(); });
    await ok(0);
    await fail(1);
    expect(result.current.contacts.c2.title).toBe('First');
  });

  it('same field twice: if BOTH fail, it ends at the original', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'First'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('title', 'Second'); await Promise.resolve(); });
    await fail(0);
    await fail(1);
    expect(result.current.contacts.c2.title).toBe('Director');
  });

  it('same field twice, finishing out of order (second succeeds, then the first fails): the second stays', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'First'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('title', 'Second'); await Promise.resolve(); });
    await ok(1);
    await fail(0);
    expect(result.current.contacts.c2.title).toBe('Second');
  });

  it('same field twice, finishing out of order (second succeeds, then the first succeeds late): a later failure restores the SECOND value', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'First'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('title', 'Second'); await Promise.resolve(); });
    await act(async () => { result.current.api.save('title', 'Third'); await Promise.resolve(); });
    await ok(1);
    await ok(0);
    await fail(2);
    expect(result.current.contacts.c2.title).toBe('Second');
  });

  it('after everything has settled, the next edit starts from the contact as it is then', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    await ok(0);
    await act(async () => { result.current.api.save('title', 'SVP'); await Promise.resolve(); });
    await fail(1);
    expect(result.current.contacts.c2.title).toBe('VP');
  });
});

describe('the right contact', () => {
  it('a failure that arrives after moving to another contact restores the contact it was for, and touches no other', async () => {
    const { result } = setup(byId([ANA, CSV]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    act(() => { result.current.setCurrentId('c1'); });
    await fail(0);
    expect(result.current.contacts.c2.title).toBe('Director');
    expect(result.current.contacts.c1).toEqual(CSV);
    expect(patches.every(([id]) => id === 'c2')).toBe(true);
  });

  it('a success that arrives after moving on changes nothing further, and the error of one contact is not shown on the next', async () => {
    const { result } = setup(byId([ANA, CSV]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    act(() => { result.current.setCurrentId('c1'); });
    await fail(0);
    expect(result.current.api.error).toBeNull();
    act(() => { result.current.setCurrentId('c2'); });
    expect(result.current.api.error).toEqual({ field: 'title', code: 'unavailable' });
  });

  it('the same field on two contacts is tracked separately', async () => {
    const { result } = setup(byId([ANA, CSV]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    act(() => { result.current.setCurrentId('c1'); });
    await act(async () => { result.current.api.save('title', 'Lead'); await Promise.resolve(); });
    expect(fake.writes.map((w) => w.path)).toEqual(['users/u1/contacts/c2', 'users/u1/contacts/c1']);
    await fail(1);
    expect(result.current.contacts.c1.title).toBe('Analyst');
    expect(result.current.contacts.c2.title).toBe('VP');
    await ok(0);
    expect(result.current.contacts.c2.title).toBe('VP');
  });
});

describe('the right account', () => {
  it('refuses a save, writing nothing, once the effective account is not the one the contact was shown under', async () => {
    const { result } = setup(byId([ANA]));
    viewer.value = { uid: 'u2' };
    let r;
    await act(async () => { r = await result.current.api.save('title', 'VP'); });
    expect(r).toEqual({ status: 'refused', reason: 'account_changed' });
    expect(fake.writes).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('after sign-out a save is refused, and a commit of an open edit writes nothing', async () => {
    const { result } = setup(byId([ANA]));
    act(() => { result.current.api.start('title'); });
    act(() => { result.current.api.setValue('VP'); });
    viewer.value = null;
    let r;
    await act(async () => { r = await result.current.api.commit(); });
    expect(r).toMatchObject({ status: 'refused' });
    expect(fake.writes).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('impersonation started after the screen was drawn is refused at the write, whatever the controls showed', async () => {
    const { result } = setup(byId([ANA]));
    viewer.value = { uid: 'target', _isImpersonated: true };
    let r;
    await act(async () => { r = await result.current.api.save('title', 'VP'); });
    expect(r).toEqual({ status: 'refused', reason: 'read_only' });
    expect(fake.writes).toEqual([]);
  });

  it('a failure that arrives after the account changed restores nothing and reports nothing (fail closed)', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    viewer.value = { uid: 'u2' };
    await fail(0);
    expect(patches).toEqual([['c2', { title: 'VP' }]]);
    expect(result.current.api.error).toBeNull();
  });

  it('a success that arrives after the account changed does nothing further', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    viewer.value = { uid: 'u2' };
    await ok(0);
    expect(patches).toEqual([['c2', { title: 'VP' }]]);
  });

  it('a different account that comes back to the same uid is the same account', async () => {
    const { result } = setup(byId([ANA]));
    viewer.value = { uid: 'u2' };
    viewer.value = { uid: 'u1' };
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    expect(fake.writes).toHaveLength(1);
  });

  it('the write itself is addressed to the signed-in account\'s own contact document', async () => {
    const { result } = setup(byId([ANA]));
    await act(async () => { result.current.api.save('title', 'VP'); await Promise.resolve(); });
    expect(fake.writes[0].path).toBe('users/u1/contacts/c2');
  });
});

describe('the result of a save', () => {
  it('is saved, failed (with the code), unchanged or refused, so a caller can tell', async () => {
    const { result } = setup(byId([ANA]));
    let p1; let p2;
    await act(async () => { p1 = result.current.api.save('title', 'VP'); await Promise.resolve(); });
    await ok(0);
    expect(await p1).toEqual({ status: 'saved' });
    await act(async () => { p2 = result.current.api.save('title', 'SVP'); await Promise.resolve(); });
    await fail(1, 'unavailable');
    expect(await p2).toEqual({ status: 'failed', reason: 'unavailable' });
    await waitFor(() => expect(result.current.api.isSaving('title')).toBe(false));
  });
});
