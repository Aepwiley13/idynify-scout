/**
 * H2-1 — saveContactFields: the one write for a contact's identity lines. It writes the existing contact document
 * (users/{uid}/contacts/{id}) and refuses, before any write, unless this is the account that began the edit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({ calls: [], impl: null }));
const viewer = vi.hoisted(() => ({ value: { uid: 'u1' } }));

vi.mock('../firebase/config', () => ({ db: { __db: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  updateDoc: (...args) => { fake.calls.push(args); return fake.impl(...args); },
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => viewer.value }));

import { saveContactFields, CONTACT_FIELD_WRITES } from '../services/contactFields';

beforeEach(() => {
  fake.calls = [];
  fake.impl = async () => undefined;
  viewer.value = { uid: 'u1' };
});

const codeOf = async (promise) => { try { await promise; } catch (e) { return e.code; } return null; };

describe('saveContactFields', () => {
  it('writes the given fields and updated_at to users/{uid}/contacts/{id}, and nothing else', async () => {
    await saveContactFields('c1', { title: 'VP' }, { expectUid: 'u1' });
    expect(fake.calls).toHaveLength(1);
    const [ref, data] = fake.calls[0];
    expect(ref.path).toBe('users/u1/contacts/c1');
    expect(Object.keys(data).sort()).toEqual(['title', 'updated_at']);
    expect(data.title).toBe('VP');
    expect(Number.isNaN(Date.parse(data.updated_at))).toBe(false);
  });

  it('allows exactly the identity, location, and photo fields', () => {
    expect([...CONTACT_FIELD_WRITES].sort()).toEqual(['company_name', 'location', 'name', 'photo_source', 'photo_url', 'title']);
  });

  it.each([
    ['first_name'], ['last_name'], ['email'], ['company_id'], ['sticker_ids'], ['sticker_assignments'], ['photo_thumb'], ['street_address'], ['id'], ['updated_at'],
  ])('refuses %s, writing nothing', async (field) => {
    expect(await codeOf(saveContactFields('c1', { [field]: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(await codeOf(saveContactFields('c1', { title: 'ok', [field]: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(fake.calls).toEqual([]);
  });

  it('refuses an empty patch, a non-text value, and a missing contact id', async () => {
    expect(await codeOf(saveContactFields('c1', {}, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(await codeOf(saveContactFields('c1', { title: 42 }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(await codeOf(saveContactFields('c1', { title: undefined }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(await codeOf(saveContactFields('', { title: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(await codeOf(saveContactFields(undefined, { title: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(fake.calls).toEqual([]);
  });

  it('fails closed with no signed-in user', async () => {
    viewer.value = null;
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, { expectUid: 'u1' }))).toBe('no_user');
    expect(fake.calls).toEqual([]);
  });

  it('fails closed when the effective account is not the one that began the edit', async () => {
    viewer.value = { uid: 'u2' };
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, { expectUid: 'u1' }))).toBe('account_changed');
    expect(fake.calls).toEqual([]);
  });

  it('fails closed when it is not told which account began the edit', async () => {
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, {}))).toBe('account_changed');
    expect(await codeOf(saveContactFields('c1', { title: 'x' }))).toBe('account_changed');
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, { expectUid: '' }))).toBe('account_changed');
    expect(fake.calls).toEqual([]);
  });

  it('refuses any impersonated session, even for the matching uid', async () => {
    viewer.value = { uid: 'target', _isImpersonated: true };
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, { expectUid: 'target' }))).toBe('read_only');
    expect(fake.calls).toEqual([]);
  });

  it('fails closed when the account lookup itself throws', async () => {
    viewer.value = { get uid() { throw new Error('no session'); } };
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, { expectUid: 'u1' }))).toBe('no_user');
    expect(fake.calls).toEqual([]);
  });

  it('lets a failed write reach the caller, with its own code', async () => {
    fake.impl = async () => { const e = new Error('denied'); e.code = 'permission-denied'; throw e; };
    expect(await codeOf(saveContactFields('c1', { title: 'x' }, { expectUid: 'u1' }))).toBe('permission-denied');
  });

  it('refuses a contact id that would change the path, writing nothing', async () => {
    expect(await codeOf(saveContactFields('a/b', { title: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(await codeOf(saveContactFields('..', { title: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(fake.calls).toEqual([]);
  });
});
