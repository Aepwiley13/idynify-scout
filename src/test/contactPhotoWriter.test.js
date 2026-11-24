import { describe, expect, it, vi } from 'vitest';
import { createContactPhotoWriter } from '../../netlify/functions/utils/contactPhotoWriter.js';
import { EXIF, photoDataUrl } from './helpers/photoFixtures';

function fixture({ enabled = true, user = true, contact = { photo_url: 'https://example.test/original.jpg', photo_source: 'apollo' }, sessions = [] } = {}) {
  const store = new Map();
  if (user) store.set('users/u1', {});
  if (contact) store.set('users/u1/contacts/c1', contact);
  const active = { where: vi.fn(() => active) };
  const ref = (path) => ({
    path,
    collection: (name) => ref(path + '/' + name),
    doc: (id) => ref(path + '/' + id),
  });
  const remove = Symbol('delete');
  let tick = 1;
  const db = {
    doc: ref, collection: () => active,
    runTransaction: vi.fn((fn) => fn({
      get: async (node) => node === active ? { docs: sessions.map((entry) => ({ data: () => entry })) }
        : { exists: store.has(node.path), data: () => store.get(node.path) },
      set: (node, value) => store.set(node.path, value),
      update: (node, value) => {
        const next = { ...store.get(node.path), ...value };
        for (const key of Object.keys(next)) if (next[key] === remove) delete next[key];
        store.set(node.path, next);
      },
      delete: (node) => store.delete(node.path),
    })),
  };
  const verifyToken = vi.fn(async (token) => {
    if (token === 'bad') throw new Error();
    if (token === 'custom') return { uid: 'u1', firebase: { sign_in_provider: 'custom' } };
    return { uid: token };
  });
  const handler = createContactPhotoWriter({
    db, verifyToken, enabled: () => enabled, now: () => 100,
    timestampAfter: () => ({ seconds: tick++, nanoseconds: 0 }),
    deleteField: () => remove,
  });
  const send = ({ token = 'u1', photo = { kind: 'hidden' }, expectedVersion = null, uid = 'u1' } = {}) => handler({
    httpMethod: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ uid, contactId: 'c1', expectedVersion, photo }),
  });
  const undo = (uid = 'u1', token = 'u1') => handler({
    httpMethod: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'undo_company_approval', uid, companyId: 'co', contactId: 'c1' }),
  });
  return { send, undo, db, store, verifyToken };
}

const photoPath = 'users/u1/contacts/c1/private/photo';
const personPath = 'users/u1/contacts/c1';
const body = (response) => JSON.parse(response.body);

describe('trusted contact photo writer', () => {
  it('starts disabled, rejects invalid or custom tokens and refuses a different effective UID', async () => {
    const off = fixture({ enabled: false });
    expect((await off.send()).statusCode).toBe(404);
    expect(off.verifyToken).not.toHaveBeenCalled();
    const active = fixture();
    expect((await active.send({ token: 'bad' })).statusCode).toBe(401);
    expect((await active.send({ token: 'custom' })).statusCode).toBe(403);
    expect((await active.send({ token: 'u2' })).statusCode).toBe(403);
    expect(active.db.runTransaction).not.toHaveBeenCalled();
  });

  it('uses the server session record and denies unavailable or malformed permission checks', async () => {
    expect((await fixture({ sessions: [{ expiresAt: { toMillis: () => 101 } }] }).send()).statusCode).toBe(403);
    expect((await fixture({ sessions: [{}] }).send()).statusCode).toBe(403);
    expect((await fixture({ sessions: [{ expiresAt: { toMillis: () => 99 } }] }).send()).statusCode).toBe(200);
    const fail = fixture();
    fail.db.runTransaction.mockRejectedValue(new Error('read unavailable'));
    expect((await fail.send()).statusCode).toBe(503);
    expect(fail.store.has(photoPath)).toBe(false);
  });

  it.each([
    { kind: 'upload', jpeg: photoDataUrl(320, 50000) },
    { kind: 'upload', jpeg: photoDataUrl(320, 20000, { extra: EXIF }) },
    { kind: 'upload', jpeg: photoDataUrl(321) },
    { kind: 'hidden', jpeg: 'extra field' },
    { kind: 'url', url: 'https://user:secret@example.test/a.jpg' },
  ])('rejects invalid variants before opening the transaction', async (photo) => {
    const state = fixture();
    expect((await state.send({ photo })).statusCode).toBe(400);
    expect(state.db.runTransaction).not.toHaveBeenCalled();
  });

  it('keeps the original and atomically updates the photo and lightweight projection', async () => {
    const state = fixture();
    const jpeg = photoDataUrl();
    const uploaded = await state.send({ photo: { kind: 'upload', jpeg } });
    expect(body(uploaded)).toEqual({ status: 'saved', version: '1:0' });
    expect(state.store.get(photoPath)).toMatchObject({ jpeg, kind: 'upload' });
    expect(state.store.get(personPath)).toEqual({
      photo_url: 'https://example.test/original.jpg', photo_source: 'apollo', contact_hub_photo: 'custom',
    });
    expect((await state.send()).statusCode).toBe(409);
    const hidden = await state.send({ expectedVersion: '1:0' });
    expect(state.store.get(photoPath)).toEqual({ kind: 'hidden', updatedAt: { seconds: 2, nanoseconds: 0 } });
    expect(state.store.get(personPath).contact_hub_photo).toBe('hidden');
    expect((await state.send({ expectedVersion: body(hidden).version, photo: null })).statusCode).toBe(200);
    expect(state.store.has(photoPath)).toBe(false);
    expect(state.store.get(personPath)).toEqual({ photo_url: 'https://example.test/original.jpg', photo_source: 'apollo' });
  });

  it('cleans up only contacts discovered for the undone company, even with photo writes disabled', async () => {
    const state = fixture({ enabled: false, contact: { company_id: 'co', source: 'icp_auto_discovery' } });
    state.store.set(photoPath, { kind: 'hidden' });
    state.store.set('users/u1/companies/co', { status: 'accepted' });
    expect((await state.undo()).statusCode).toBe(409);
    state.store.set('users/u1/companies/co', { status: 'pending' });
    expect((await state.undo('u1', 'u2')).statusCode).toBe(403);
    state.store.get(personPath).source = 'csv';
    expect((await state.undo()).statusCode).toBe(409);
    expect(state.store.has(photoPath)).toBe(true);
    state.store.get(personPath).source = 'icp_auto_discovery';
    expect(body(await state.undo())).toEqual({ status: 'deleted' });
    expect(state.store.has(personPath)).toBe(false);
    expect(state.store.has(photoPath)).toBe(false);
    expect((await state.undo()).statusCode).toBe(200);
  });

  it('will not write a deleted contact or an account without a user document', async () => {
    for (const input of [{ user: false }, { contact: null }]) {
      const state = fixture(input);
      expect((await state.send()).statusCode).toBe(404);
      expect(state.store.has(photoPath)).toBe(false);
    }
  });
});
