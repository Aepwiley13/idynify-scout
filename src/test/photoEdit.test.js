/**
 * Photo editing foundation: the pure rules (photoEditRules), the https check (photoUrl), and the one write
 * (saveContactFields) widened to photo_url and photo_source, and only to the values the existing card writes.
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

import { isHttpsPhotoUrl } from '../utils/photoUrl';
import { planPhotoSet, planPhotoRemove, PHOTO_SOURCE_MANUAL } from '../components/contacts/personHeader/photoEditRules';
import { saveContactFields } from '../services/contactFields';

const WITH = { id: 'c1', photo_url: 'https://media.example.com/a.jpg', photo_source: 'apollo' };
const WITHOUT = { id: 'c2', name: 'No Photo' };

describe('isHttpsPhotoUrl', () => {
  it.each([
    ['https://images.example.com/p.jpg', true],
    ['https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_200_200/0/1?e=1&v=beta&t=sig', true],
    ['http://images.example.com/p.jpg', false],
    ['//images.example.com/p.jpg', false],
    ['javascript:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['https://user:pass@images.example.com/p.jpg', false],
    ['https://', false],
    ['https://exa mple.com/p.jpg', false],
    ['https://example.com/p.jpg\nhttps://evil.example', false],
    ['', false],
    [null, false],
    [42, false],
  ])('%j → %s', (value, ok) => { expect(isHttpsPhotoUrl(value)).toBe(ok); });

  it('refuses an address over 2000 characters', () => {
    expect(isHttpsPhotoUrl(`https://example.com/${'a'.repeat(2000)}`)).toBe(false);
  });
});

describe('planPhotoSet', () => {
  it('writes photo_url and photo_source "manual_url", and keeps what was there to put back', () => {
    expect(planPhotoSet(WITH, '  https://images.example.com/new.jpg ')).toEqual({
      ok: true,
      patch: { photo_url: 'https://images.example.com/new.jpg', photo_source: PHOTO_SOURCE_MANUAL },
      previous: { photo_url: 'https://media.example.com/a.jpg', photo_source: 'apollo' },
    });
    expect(planPhotoSet(WITHOUT, 'https://images.example.com/n.jpg').previous).toEqual({ photo_url: undefined, photo_source: undefined });
  });

  it('keeps the address as the person typed it (a signed address is not re-encoded)', () => {
    const url = 'https://media.licdn.com/x?e=1&v=beta&t=Ab-_';
    expect(planPhotoSet(WITHOUT, url).patch.photo_url).toBe(url);
  });

  it.each([
    ['http://images.example.com/p.jpg', 'not_https'],
    ['not a url', 'not_https'],
    ['javascript:alert(1)', 'not_https'],
    ['', 'blank'],
    ['   ', 'blank'],
    ['https://static.licdn.com/sc/h/9c8pery4andzj6ohjkjp54ma2', 'not_a_photo'],
    ['https://images.example.com/ghost-person.png', 'not_a_photo'],
  ])('refuses %j (%s)', (raw, reason) => { expect(planPhotoSet(WITHOUT, raw)).toEqual({ ok: false, reason }); });

  it('is a no-op for the address already on the contact', () => {
    expect(planPhotoSet(WITH, ' https://media.example.com/a.jpg ')).toEqual({ ok: false, reason: 'unchanged' });
  });

  it('refuses a value that is not text and a contact with no id', () => {
    expect(planPhotoSet(WITH, 7)).toEqual({ ok: false, reason: 'not_text' });
    expect(planPhotoSet(WITH, null)).toEqual({ ok: false, reason: 'not_text' });
    expect(planPhotoSet({ photo_url: 'x' }, 'https://a.example/p.jpg')).toEqual({ ok: false, reason: 'no_contact' });
    expect(planPhotoSet(null, 'https://a.example/p.jpg')).toEqual({ ok: false, reason: 'no_contact' });
  });
});

describe('planPhotoRemove', () => {
  it('writes an empty photo_url only, and leaves photo_source as it was', () => {
    expect(planPhotoRemove(WITH)).toEqual({ ok: true, patch: { photo_url: '' }, previous: { photo_url: 'https://media.example.com/a.jpg' } });
  });
  it('has nothing to remove for a contact with no real photo', () => {
    expect(planPhotoRemove(WITHOUT)).toEqual({ ok: false, reason: 'no_photo' });
    expect(planPhotoRemove({ id: 'c3', photo_url: 'https://static.licdn.com/sc/h/abc' })).toEqual({ ok: false, reason: 'no_photo' });
    expect(planPhotoRemove(null)).toEqual({ ok: false, reason: 'no_contact' });
  });
});

describe('saveContactFields and the photo fields', () => {
  beforeEach(() => { fake.calls = []; fake.impl = async () => undefined; viewer.value = { uid: 'u1' }; });
  const codeOf = async (p) => { try { await p; } catch (e) { return e.code; } return null; };

  it('writes photo_url with photo_source "manual_url", and nothing else', async () => {
    await saveContactFields('c1', { photo_url: 'https://images.example.com/p.jpg', photo_source: 'manual_url' }, { expectUid: 'u1' });
    const [ref, data] = fake.calls[0];
    expect(ref.path).toBe('users/u1/contacts/c1');
    expect(Object.keys(data).sort()).toEqual(['photo_source', 'photo_url', 'updated_at']);
  });

  it('writes an empty photo_url (removing the photo)', async () => {
    await saveContactFields('c1', { photo_url: '' }, { expectUid: 'u1' });
    expect(fake.calls[0][1].photo_url).toBe('');
  });

  it.each([
    [{ photo_url: 'http://images.example.com/p.jpg' }],
    [{ photo_url: 'javascript:alert(1)' }],
    [{ photo_url: 'data:image/png;base64,AAAA' }],
    [{ photo_url: 'https://images.example.com/p.jpg\nhttps://evil.example' }],
    [{ photo_source: 'linkedin' }],
    [{ photo_source: 'apollo' }],
    [{ photo_source: '' }],
    [{ photo_url: 'https://images.example.com/p.jpg', photo_source: 'apollo' }],
  ])('refuses %j, writing nothing', async (patch) => {
    expect(await codeOf(saveContactFields('c1', patch, { expectUid: 'u1' }))).toBe('invalid_write');
    expect(fake.calls).toEqual([]);
  });

  it('still refuses every other field, and still fails closed for the account', async () => {
    for (const field of ['first_name', 'email', 'company_id', 'sticker_ids', 'photo_thumb']) {
      expect(await codeOf(saveContactFields('c1', { [field]: 'x' }, { expectUid: 'u1' }))).toBe('invalid_write');
    }
    viewer.value = { uid: 'u2' };
    expect(await codeOf(saveContactFields('c1', { photo_url: '' }, { expectUid: 'u1' }))).toBe('account_changed');
    viewer.value = { uid: 'u1', _isImpersonated: true };
    expect(await codeOf(saveContactFields('c1', { photo_url: '' }, { expectUid: 'u1' }))).toBe('read_only');
    expect(fake.calls).toEqual([]);
  });
});
