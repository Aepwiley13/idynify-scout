/**
 * useContactPhotoEdit: adding, replacing and removing a contact's photo from the header. One change at a time,
 * optimistic through an id-addressed onPatch, restored on failure, and fail-closed for the account, as the
 * identity hook is. The write is the real saveContactFields; the Firestore write is a stand-in the test settles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, useCallback } from 'react';
import { renderHook, act } from '@testing-library/react';

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

import { useContactPhotoEdit } from '../components/contacts/personHeader/useContactPhotoEdit';

const WITH = { id: 'c1', name: 'Has Photo', photo_url: 'https://media.example.com/a.jpg', photo_source: 'apollo', title: 'Keep' };
const WITHOUT = { id: 'c2', name: 'No Photo' };
const NEW = 'https://images.example.com/new.jpg';

let patches;
function useHarness(initial, { withPatch = true } = {}) {
  const [contacts, setContacts] = useState(initial);
  const [currentId, setCurrentId] = useState(Object.keys(initial)[0]);
  const onPatch = useCallback((id, fields) => { patches.push([id, { ...fields }]); setContacts((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } })); }, []);
  const api = useContactPhotoEdit({ contact: contacts[currentId], onPatch: withPatch ? onPatch : undefined });
  return { api, contacts, setCurrentId };
}
const setup = (list, options) => renderHook(() => useHarness(Object.fromEntries(list.map((c) => [c.id, c])), options));
const ok = (i) => act(async () => { fake.writes[i].resolve(); });
const fail = (i, code = 'unavailable') => act(async () => { const e = new Error('x'); e.code = code; fake.writes[i].reject(e); });
// Starts a change and returns { promise } (not the promise itself, so awaiting this does not wait for the write).
const start = async (result, fn) => { let promise; await act(async () => { promise = fn(); await Promise.resolve(); }); return { promise }; };
const settled = async (result, fn) => (await start(result, fn)).promise;

beforeEach(() => { fake.writes = []; patches = []; viewer.value = { uid: 'u1' }; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('who may change a photo', () => {
  it('a signed-in owner may, and the hook says whether there is a photo to view', () => {
    expect(setup([WITH]).result.current.api).toMatchObject({ canEdit: true, hasPhoto: true });
    expect(setup([WITHOUT]).result.current.api).toMatchObject({ canEdit: true, hasPhoto: false });
  });
  it.each([
    ['an impersonated session', { uid: 't', _isImpersonated: true }],
    ['no signed-in user', null],
  ])('nobody may for %s', (_label, user) => {
    viewer.value = user;
    expect(setup([WITH]).result.current.api.canEdit).toBe(false);
  });
  it('nobody may without an id-addressed onPatch, or for a contact with no id', () => {
    expect(setup([WITH], { withPatch: false }).result.current.api.canEdit).toBe(false);
    expect(setup([{ name: 'No id' }].map((c, i) => ({ ...c, id: undefined, key: i }))).result.current.api.canEdit).toBe(false);
  });
});

describe('adding and replacing', () => {
  it('writes photo_url and photo_source "manual_url", applies them at once, and keeps them on success', async () => {
    const { result } = setup([WITHOUT]);
    const { promise: p } = await start(result, () => result.current.api.setUrl(`  ${NEW} `));
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].path).toBe('users/u1/contacts/c2');
    expect(Object.keys(fake.writes[0].data).sort()).toEqual(['photo_source', 'photo_url', 'updated_at']);
    expect(fake.writes[0].data).toMatchObject({ photo_url: NEW, photo_source: 'manual_url' });
    expect(result.current.contacts.c2).toMatchObject({ photo_url: NEW, photo_source: 'manual_url' });
    expect(result.current.api.saving).toBe(true);
    await ok(0);
    expect(await p).toEqual({ status: 'saved' });
    expect(result.current.api.saving).toBe(false);
    expect(result.current.api.hasPhoto).toBe(true);
    expect(result.current.api.error).toBeNull();
  });

  it('replacing keeps every other field of the contact', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.setUrl(NEW));
    await ok(0);
    expect(result.current.contacts.c1).toMatchObject({ name: 'Has Photo', title: 'Keep', photo_url: NEW, photo_source: 'manual_url' });
  });

  it.each([
    ['http://images.example.com/p.jpg', 'not_https'],
    ['not a url', 'not_https'],
    ['   ', 'blank'],
    ['https://images.example.com/ghost-person.png', 'not_a_photo'],
    ['https://media.example.com/a.jpg', 'unchanged'],
  ])('refuses %j (%s), writing nothing', async (raw, reason) => {
    const { result } = setup([WITH]);
    const r = await settled(result, () => result.current.api.setUrl(raw));
    expect(r).toEqual({ status: reason === 'unchanged' ? 'unchanged' : 'refused', reason: reason === 'unchanged' ? undefined : reason });
    expect(fake.writes).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('on failure puts back exactly the two fields it changed, says why, and a retry writes again', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.setUrl(NEW));
    await fail(0, 'permission-denied');
    expect(result.current.contacts.c1).toEqual(WITH);
    expect(patches).toEqual([['c1', { photo_url: NEW, photo_source: 'manual_url' }], ['c1', { photo_url: WITH.photo_url, photo_source: 'apollo' }]]);
    expect(result.current.api.error).toEqual({ code: 'permission-denied' });
    expect(result.current.api.saving).toBe(false);
    await start(result, () => result.current.api.setUrl(NEW));
    expect(result.current.api.error).toBeNull();
    await ok(1);
    expect(result.current.contacts.c1.photo_url).toBe(NEW);
  });

  it('a failed first photo goes back to "no photo", not to an empty string', async () => {
    const { result } = setup([WITHOUT]);
    await start(result, () => result.current.api.setUrl(NEW));
    await fail(0);
    expect(result.current.contacts.c2.photo_url).toBeUndefined();
    expect(result.current.contacts.c2.photo_source).toBeUndefined();
  });
});

describe('removing', () => {
  it('writes an empty photo_url only, shows no photo at once, and leaves photo_source and the rest alone', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.remove());
    expect(Object.keys(fake.writes[0].data).sort()).toEqual(['photo_url', 'updated_at']);
    expect(fake.writes[0].data.photo_url).toBe('');
    expect(result.current.api.hasPhoto).toBe(false);
    await ok(0);
    expect(result.current.contacts.c1).toMatchObject({ photo_source: 'apollo', title: 'Keep', photo_url: '' });
  });
  it('on failure the photo comes back', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.remove());
    await fail(0);
    expect(result.current.contacts.c1.photo_url).toBe(WITH.photo_url);
    expect(result.current.api.hasPhoto).toBe(true);
    expect(result.current.api.error).toEqual({ code: 'unavailable' });
  });
  it('has nothing to remove when there is no photo', async () => {
    const { result } = setup([WITHOUT]);
    const r = await settled(result, () => result.current.api.remove());
    expect(r).toEqual({ status: 'refused', reason: 'no_photo' });
    expect(fake.writes).toEqual([]);
  });
});

describe('one change at a time', () => {
  it('a second change while one is in flight is refused, not queued, and writes nothing', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.setUrl(NEW));
    const r = await settled(result, () => result.current.api.remove());
    expect(r).toEqual({ status: 'refused', reason: 'busy' });
    const r2 = await settled(result, () => result.current.api.setUrl('https://images.example.com/other.jpg'));
    expect(r2).toEqual({ status: 'refused', reason: 'busy' });
    expect(fake.writes).toHaveLength(1);
    await ok(0);
    await start(result, () => result.current.api.remove());
    expect(fake.writes).toHaveLength(2);
  });
  it('a failure frees it for the next try', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.setUrl(NEW));
    await fail(0);
    await start(result, () => result.current.api.setUrl(NEW));
    expect(fake.writes).toHaveLength(2);
  });
});

describe('the right contact and the right account', () => {
  it('a result after moving to another contact is applied to the contact it was for, and the error is not shown on the next', async () => {
    const { result } = setup([WITH, WITHOUT]);
    await start(result, () => result.current.api.setUrl(NEW));
    act(() => result.current.setCurrentId('c2'));
    await fail(0);
    expect(result.current.contacts.c1.photo_url).toBe(WITH.photo_url);
    expect(result.current.contacts.c2).toEqual(WITHOUT);
    expect(patches.every(([id]) => id === 'c1')).toBe(true);
    expect(result.current.api.error).toBeNull();
    act(() => result.current.setCurrentId('c1'));
    expect(result.current.api.error).toEqual({ code: 'unavailable' });
  });
  it('is refused, writing nothing, once the account is not the one the contact was shown under', async () => {
    const { result } = setup([WITH]);
    viewer.value = { uid: 'u2' };
    expect(await settled(result, () => result.current.api.setUrl(NEW))).toEqual({ status: 'refused', reason: 'account_changed' });
    expect(await settled(result, () => result.current.api.remove())).toEqual({ status: 'refused', reason: 'account_changed' });
    expect(fake.writes).toEqual([]);
  });
  it('is refused for an impersonated session even if the controls were drawn before it began', async () => {
    const { result } = setup([WITH]);
    viewer.value = { uid: 'target', _isImpersonated: true };
    expect(await settled(result, () => result.current.api.remove())).toEqual({ status: 'refused', reason: 'read_only' });
    expect(fake.writes).toEqual([]);
  });
  it('a failure after the account changed restores nothing and reports nothing', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.setUrl(NEW));
    viewer.value = { uid: 'u2' };
    await fail(0);
    expect(patches).toHaveLength(1);
    expect(result.current.api.error).toBeNull();
  });
  it('the error text carries a code only, never the address', async () => {
    const { result } = setup([WITH]);
    await start(result, () => result.current.api.setUrl(NEW));
    await fail(0);
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain('images.example.com');
  });
});
