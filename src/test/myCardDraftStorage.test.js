/**
 * My Card's draft storage, on its own, against a fake of the browser's
 * sessionStorage and a fixed clock: what is kept, for whom, for how long, how
 * it is thrown away, and that nothing it does can fail the page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DRAFT_KEY_PREFIX, DRAFT_MAX_AGE_MS, DRAFT_MAX_BYTES, DRAFT_PHOTO_KEY_PREFIX, DRAFT_PHOTO_MAX_BYTES, DRAFT_VERSION,
  buildDraftPayload, clearAllMyCardDrafts, clearDraft, draftKey, draftPhotoKey, draftPhotoOf, purgeOtherAccounts, readDraft, saveDraft,
} from '../pages/ContactHub/myCard/state/myCardDraftStorage';
import { EXIF, fingerprintOf, photoDataUrl } from './helpers/photoFixtures';
import { ALL_SHARE_KEYS, CARD_FIELDS, DEFAULT_LINK_SHARE, DEFAULT_SHARE, SHAREABLE_FIELDS, newCard } from '../utils/myCardRules';

/** The parts of sessionStorage this module uses, with ways to make each fail. */
class FakeStorage {
  constructor({ failOn = [], failSetKeys = [] } = {}) { this.map = new Map(); this.failOn = new Set(failOn); this.failSetKeys = new Set(failSetKeys); }
  get length() { if (this.failOn.has('length')) throw new Error('denied'); return this.map.size; }
  key(index) { if (this.failOn.has('key')) throw new Error('denied'); return [...this.map.keys()][index] ?? null; }
  getItem(key) { if (this.failOn.has('getItem')) throw new Error('denied'); return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.failOn.has('setItem') || [...this.failSetKeys].some((k) => key.startsWith(k))) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); this.map.set(key, String(value)); }
  removeItem(key) { if (this.failOn.has('removeItem')) throw new Error('denied'); this.map.delete(key); }
}

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const card = (extra = {}) => ({ ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', email: 'ada@example.com', ...extra });
const draft = (extra = {}) => ({ uid: 'U', card: card(), baseRevision: 3, ...extra });
const put = (storage, uid, value) => storage.setItem(`${DRAFT_KEY_PREFIX}${uid}`, typeof value === 'string' ? value : JSON.stringify(value));
const stored = (storage, uid = 'U') => JSON.parse(storage.getItem(`${DRAFT_KEY_PREFIX}${uid}`));
/** A payload exactly as this module writes it, for tests that damage one part. */
const goodPayload = (extra = {}) => ({ ...buildDraftPayload({ uid: 'U', card: card(), baseRevision: 3, now: NOW }), ...extra });

describe('the key', () => {
  it('is the account\'s uid under one prefix', () => {
    expect(draftKey('abc123')).toBe(`${DRAFT_KEY_PREFIX}abc123`);
    expect(DRAFT_KEY_PREFIX).toBe('idynify.myCardDraft.v1:');
  });

  it('refuses anything that is not a plausible uid', () => {
    for (const bad of ['', ' ', 'a b', 'a/b', '../x', 'a:b', 'a\nb', 'é', 'x'.repeat(129), null, undefined, 7, {}, ['a']]) {
      expect(draftKey(bad), String(bad)).toBeNull();
    }
    expect(draftKey('x'.repeat(128))).not.toBeNull();
  });
});

describe('keeping a draft', () => {
  it('keeps what the draft holds, and reads it back as a draft would be', () => {
    const storage = new FakeStorage();
    expect(saveDraft(draft({ card: card({ share: { ...DEFAULT_SHARE, email: true } }) }), { storage, now: NOW })).toEqual({ ok: true });
    const result = readDraft('U', { storage, now: NOW + 1000 });
    expect(result.status).toBe('ok');
    expect(result.draft).toMatchObject({ baseRevision: 3, savedAt: NOW });
    expect(result.draft.card).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', email: 'ada@example.com', sharingEnabled: false });
    expect(result.draft.card.share).toEqual({ ...DEFAULT_SHARE, ...DEFAULT_LINK_SHARE, email: true });
  });

  it('keeps text as it was typed, including text the card would refuse', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ card: card({ email: 'ada@', website: 'not a web address', phone: '  call me  ' }) }), { storage, now: NOW });
    expect(readDraft('U', { storage, now: NOW }).draft.card).toMatchObject({ email: 'ada@', website: 'not a web address', phone: '  call me  ' });
  });

  it('keeps the base revision: a number, or null for "nothing saved yet"', () => {
    const storage = new FakeStorage();
    for (const baseRevision of [0, 1, 99, null]) {
      saveDraft(draft({ baseRevision }), { storage, now: NOW });
      expect(readDraft('U', { storage, now: NOW }).draft.baseRevision).toBe(baseRevision);
    }
  });

  it('keeps nothing but the allowlist: no suggestions, no sharing setting, no account details, no token', () => {
    const storage = new FakeStorage();
    saveDraft(draft({
      card: {
        ...card(),
        sharingEnabled: true, suggestions: { title: { value: 'Boss', source: 'recon' } }, source: 'linkedin',
        accountEmail: 'login@example.com', token: 'tok_secret', idToken: 'jwt', uid: 'OTHER', revision: 99, createdAt: 'x',
        notes: 'private notes', schemaVersion: 1, linkedinMemberId: 'sub-123',
      },
    }), { storage, now: NOW });
    const raw = storage.getItem(draftKey('U'));
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(['baseRevision', 'fields', 'savedAt', 'share', 'uid', 'v']);
    expect(Object.keys(parsed.fields).sort()).toEqual([...CARD_FIELDS].sort());
    expect(Object.keys(parsed.share).sort()).toEqual([...ALL_SHARE_KEYS].sort());
    expect(raw).not.toMatch(/sharingEnabled|suggest|source|accountEmail|login@|token|tok_secret|idToken|jwt|OTHER|revision":99|createdAt|notes|schemaVersion|sub-123/);
    expect(parsed.v).toBe(DRAFT_VERSION);
    expect(parsed.uid).toBe('U');
  });

  it('keeps a switch as on only when it is exactly true', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ card: { ...card(), share: { email: 'true', phone: 1, title: {}, website: [], instagram: null, photoUrl: true, organization: false, linkedinUrl: undefined } } }), { storage, now: NOW });
    expect(stored(storage).share).toEqual({ photoUrl: true, title: false, organization: false, email: false, phone: false, linkedinUrl: false, instagram: false, website: false, ...DEFAULT_LINK_SHARE });
  });

  it('keeps a field that is not text as empty, and ignores inherited properties', () => {
    const storage = new FakeStorage();
    const inherited = Object.create({ firstName: 'Inherited', share: { email: true } });
    saveDraft(draft({ card: { ...inherited, title: 42, email: ['a@b.co'], phone: { n: 1 } } }), { storage, now: NOW });
    const { fields, share } = stored(storage);
    for (const field of CARD_FIELDS) expect(fields[field], field).toBe('');
    expect(Object.values(share).every((on) => on === false)).toBe(true);
  });

  it('keeps nothing for a card that is not a card', () => {
    const storage = new FakeStorage();
    for (const bad of [null, undefined, 'card', 7, []]) {
      expect(saveDraft(draft({ card: bad }), { storage, now: NOW })).toEqual({ ok: true });
      expect(Object.values(stored(storage).fields).every((value) => value === '')).toBe(true);
    }
  });

  it('refuses a draft with no usable account or base revision, and writes nothing', () => {
    const storage = new FakeStorage();
    for (const options of [{ uid: '' }, { uid: 'a/b' }, { uid: null }, { baseRevision: -1 }, { baseRevision: 1.5 }, { baseRevision: '3' }, { baseRevision: undefined }, { baseRevision: NaN }]) {
      expect(saveDraft(draft(options), { storage, now: NOW }), JSON.stringify(options)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(storage.map.size).toBe(0);
  });

  it('says so when there is no storage', () => {
    expect(saveDraft(draft(), { storage: null, now: NOW })).toEqual({ ok: false, reason: 'unavailable' });
    expect(readDraft('U', { storage: null })).toEqual({ status: 'none' });
    expect(clearDraft('U', { storage: null })).toBe(false);
    expect(purgeOtherAccounts('U', { storage: null })).toBe(0);
    expect(clearAllMyCardDrafts({ storage: null })).toBe(0);
  });

  it('replaces the earlier draft for the account', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ card: card({ title: 'First' }) }), { storage, now: NOW });
    saveDraft(draft({ card: card({ title: 'Second' }) }), { storage, now: NOW + 1000 });
    expect(storage.map.size).toBe(1);
    expect(readDraft('U', { storage, now: NOW + 2000 }).draft.card.title).toBe('Second');
  });
});

describe('the size limit: 8 KB', () => {
  it('keeps a draft under it', () => {
    const storage = new FakeStorage();
    expect(saveDraft(draft({ card: card({ title: 'a'.repeat(6000) }) }), { storage, now: NOW })).toEqual({ ok: true });
    expect(storage.getItem(draftKey('U')).length).toBeLessThanOrEqual(DRAFT_MAX_BYTES);
  });

  it('does not keep a draft over it, and drops the older one rather than leave it to come back', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ card: card({ title: 'older and smaller' }) }), { storage, now: NOW });
    expect(saveDraft(draft({ card: card({ title: 'a'.repeat(9000) }) }), { storage, now: NOW })).toEqual({ ok: false, reason: 'too-large' });
    expect(storage.map.size).toBe(0);
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'none' });
  });

  it('counts bytes, not characters', () => {
    const storage = new FakeStorage();
    // 3000 characters of CJK is about 9 KB in UTF-8.
    expect(saveDraft(draft({ card: card({ title: '李'.repeat(3000) }) }), { storage, now: NOW })).toEqual({ ok: false, reason: 'too-large' });
  });

  it('throws away an entry over it that this module did not write', () => {
    const storage = new FakeStorage();
    put(storage, 'U', JSON.stringify(goodPayload({ fields: { ...goodPayload().fields, title: 'a'.repeat(9000) } })));
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'too-large' });
    expect(storage.map.size).toBe(0);
  });
});

describe('twelve hours', () => {
  it('returns a draft up to twelve hours old, exactly', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    expect(readDraft('U', { storage, now: NOW + DRAFT_MAX_AGE_MS }).status).toBe('ok');
  });

  it('throws away an older one, and says why', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    expect(readDraft('U', { storage, now: NOW + DRAFT_MAX_AGE_MS + 1 })).toEqual({ status: 'discarded', reason: 'expired' });
    expect(storage.map.size).toBe(0);
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'none' });
  });

  it('forgives a clock a few minutes ahead, not one far ahead', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW + 4 * 60 * 1000 });
    expect(readDraft('U', { storage, now: NOW }).status).toBe('ok');
    saveDraft(draft(), { storage, now: NOW + HOUR });
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'expired' });
  });
});

describe('what is thrown away on reading', () => {
  const discards = (value, reason) => {
    const storage = new FakeStorage();
    put(storage, 'U', value);
    expect(readDraft('U', { storage, now: NOW }), JSON.stringify(value).slice(0, 80)).toEqual({ status: 'discarded', reason });
    expect(storage.map.size).toBe(0);
  };

  it('says "none" for nothing', () => {
    expect(readDraft('U', { storage: new FakeStorage(), now: NOW })).toEqual({ status: 'none' });
    expect(readDraft('not a uid', { storage: new FakeStorage(), now: NOW })).toEqual({ status: 'none' });
  });

  it('text that is not JSON, and JSON that is not an object', () => {
    for (const text of ['', 'not json', '{', '[1,2]', '"string"', '7', 'null', 'true']) discards(text, 'malformed');
  });

  it('another version of the format', () => {
    for (const v of [0, 2, '1', null, undefined]) discards({ ...goodPayload(), v }, 'version');
    discards({ nothing: 'here' }, 'version');
  });

  it('a key too many or too few at the top', () => {
    discards({ ...goodPayload(), extra: 'x' }, 'malformed');
    discards({ ...goodPayload(), sharingEnabled: true }, 'malformed');
    discards({ ...goodPayload(), suggestions: {} }, 'malformed');
    const { share, ...withoutShare } = goodPayload();
    expect(share).toBeDefined();
    discards(withoutShare, 'malformed');
  });

  it('a draft written for another account', () => {
    const storage = new FakeStorage();
    put(storage, 'U', goodPayload({ uid: 'SOMEONE_ELSE' }));
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'uid' });
    expect(storage.map.size).toBe(0);
  });

  it('a field list with a field too many or too few, or a field that is not text', () => {
    const { fields } = goodPayload();
    discards(goodPayload({ fields: { ...fields, notes: 'x' } }), 'malformed');
    const { title, ...withoutTitle } = fields;
    expect(title).toBeDefined();
    discards(goodPayload({ fields: withoutTitle }), 'malformed');
    discards(goodPayload({ fields: { ...fields, title: 5 } }), 'malformed');
    discards(goodPayload({ fields: { ...fields, email: null } }), 'malformed');
    discards(goodPayload({ fields: { ...fields, phone: ['x'] } }), 'malformed');
    discards(goodPayload({ fields: 'fields' }), 'malformed');
    discards(goodPayload({ fields: [] }), 'malformed');
  });

  it('switches that are not exactly the eight, each exactly true or false', () => {
    const { share } = goodPayload();
    discards(goodPayload({ share: { ...share, sharingEnabled: true } }), 'malformed');
    discards(goodPayload({ share: { ...share, email: 'true' } }), 'malformed');
    discards(goodPayload({ share: { ...share, email: 1 } }), 'malformed');
    discards(goodPayload({ share: { ...share, email: null } }), 'malformed');
    const { email, ...withoutEmail } = share;
    expect(email).toBeDefined();
    discards(goodPayload({ share: withoutEmail }), 'malformed');
    discards(goodPayload({ share: true }), 'malformed');
  });

  it('a base revision that is not a whole number or null, and a time that is not a number', () => {
    for (const baseRevision of [-1, 1.5, '3', undefined, {}, true]) discards({ ...goodPayload(), baseRevision }, 'malformed');
    for (const savedAt of ['now', null, {}, [], true]) discards({ ...goodPayload(), savedAt }, 'malformed');
  });

  it('a key that tries to rewrite the prototype', () => {
    discards('{"v":1,"uid":"U","savedAt":1,"baseRevision":null,"fields":{},"share":{},"__proto__":{"polluted":true}}', 'malformed');
    expect({}.polluted).toBeUndefined();
  });

  it('does not let a damaged draft stop a good one that is saved next', () => {
    const storage = new FakeStorage();
    put(storage, 'U', 'garbage');
    expect(readDraft('U', { storage, now: NOW }).status).toBe('discarded');
    saveDraft(draft(), { storage, now: NOW });
    expect(readDraft('U', { storage, now: NOW }).status).toBe('ok');
  });

  it('returns a copy: changing what was read does not change what is kept', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    const first = readDraft('U', { storage, now: NOW }).draft;
    first.card.title = 'changed';
    first.card.share.email = true;
    const second = readDraft('U', { storage, now: NOW }).draft;
    expect(second.card.title).toBe('Analyst');
    expect(second.card.share.email).toBe(false);
  });
});

describe('one account at a time', () => {
  it('keeps each account\'s draft apart', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ uid: 'A', card: card({ title: 'A\'s title' }) }), { storage, now: NOW });
    saveDraft(draft({ uid: 'B', card: card({ title: 'B\'s title' }) }), { storage, now: NOW });
    expect(readDraft('A', { storage, now: NOW }).draft.card.title).toBe('A\'s title');
    expect(readDraft('B', { storage, now: NOW }).draft.card.title).toBe('B\'s title');
    expect(readDraft('C', { storage, now: NOW })).toEqual({ status: 'none' });
  });

  it('will not hand one account a draft stored under another\'s key', () => {
    const storage = new FakeStorage();
    // As if the key had been tampered with: B's draft under A's key.
    put(storage, 'A', goodPayload({ uid: 'B' }));
    expect(readDraft('A', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'uid' });
  });

  it('clears one account\'s draft and leaves the others', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ uid: 'A' }), { storage, now: NOW });
    saveDraft(draft({ uid: 'B' }), { storage, now: NOW });
    expect(clearDraft('A', { storage })).toBe(true);
    expect(readDraft('A', { storage, now: NOW })).toEqual({ status: 'none' });
    expect(readDraft('B', { storage, now: NOW }).status).toBe('ok');
  });

  it('on opening, forgets every draft but this account\'s, and leaves other keys alone', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ uid: 'A' }), { storage, now: NOW });
    saveDraft(draft({ uid: 'B' }), { storage, now: NOW });
    saveDraft(draft({ uid: 'C' }), { storage, now: NOW });
    storage.setItem('barry_mission_visited', 'true');
    storage.setItem('idynify.somethingElse', 'x');
    expect(purgeOtherAccounts('A', { storage })).toBe(2);
    expect([...storage.map.keys()].sort()).toEqual(['barry_mission_visited', 'idynify.somethingElse', draftKey('A')].sort());
    expect(purgeOtherAccounts('A', { storage })).toBe(0);
  });

  it('with no signed-in account, purging forgets every draft', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ uid: 'A' }), { storage, now: NOW });
    expect(purgeOtherAccounts(null, { storage })).toBe(1);
    expect(storage.map.size).toBe(0);
  });
});

describe('signing out', () => {
  it('forgets every My Card draft in the tab, whoever\'s, and nothing else', () => {
    const storage = new FakeStorage();
    for (const uid of ['A', 'B', 'C']) saveDraft(draft({ uid }), { storage, now: NOW });
    storage.setItem('idynify_theme', 'mission');
    storage.setItem('something', 'else');
    expect(clearAllMyCardDrafts({ storage })).toBe(3);
    expect([...storage.map.keys()].sort()).toEqual(['idynify_theme', 'something']);
  });

  it('is nothing to do when there is nothing', () => {
    expect(clearAllMyCardDrafts({ storage: new FakeStorage() })).toBe(0);
  });

  it('removes a draft that is damaged or expired as well', () => {
    const storage = new FakeStorage();
    put(storage, 'A', 'garbage');
    put(storage, 'B', goodPayload({ uid: 'B', savedAt: 1 }));
    expect(clearAllMyCardDrafts({ storage })).toBe(2);
    expect(storage.map.size).toBe(0);
  });

  it('removes what it can when storage refuses some of it, and never throws', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ uid: 'A' }), { storage, now: NOW });
    storage.failOn.add('removeItem');
    expect(() => clearAllMyCardDrafts({ storage })).not.toThrow();
    expect(clearAllMyCardDrafts({ storage })).toBe(0);
  });
});

describe('when storage fails, the page does not', () => {
  it('a full storage is a result, not an error', () => {
    const storage = new FakeStorage({ failOn: ['setItem'] });
    expect(saveDraft(draft(), { storage, now: NOW })).toEqual({ ok: false, reason: 'error' });
  });

  it('refused reads are "none"', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    storage.failOn.add('getItem');
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'none' });
  });

  it('a refused removal still reports why the draft was thrown away', () => {
    const storage = new FakeStorage();
    put(storage, 'U', 'garbage');
    storage.failOn.add('removeItem');
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'malformed' });
    expect(clearDraft('U', { storage })).toBe(false);
  });

  it('a refused walk of the keys finds nothing and removes nothing', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    storage.failOn.add('length');
    expect(purgeOtherAccounts('other', { storage })).toBe(0);
    expect(clearAllMyCardDrafts({ storage })).toBe(0);
  });

  it('uses the tab\'s sessionStorage by default, and not localStorage', () => {
    globalThis.sessionStorage.clear();
    globalThis.localStorage.clear();
    expect(saveDraft(draft(), { now: NOW })).toEqual({ ok: true });
    expect(globalThis.sessionStorage.getItem(draftKey('U'))).not.toBeNull();
    expect(globalThis.localStorage.getItem(draftKey('U'))).toBeNull();
    expect(readDraft('U', { now: NOW }).status).toBe('ok');
    expect(clearAllMyCardDrafts()).toBe(1);
    expect(globalThis.sessionStorage.length).toBe(0);
  });
});

describe('an uploaded photo', () => {
  const photo = photoDataUrl(320, 40_000, { tag: 1 });
  const other = photoDataUrl(320, 30_000, { tag: 2 });
  const withPhoto = (photoUrl = photo, extra = {}) => draft({ card: card({ photoUrl }), ...extra });
  const photoStored = (storage, uid = 'U') => JSON.parse(storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}${uid}`));
  const keysOf = (storage) => [...storage.map.keys()].sort();
  afterEach(() => { vi.restoreAllMocks(); });

  it('has its own key, per account, beside the draft\'s', () => {
    expect(draftPhotoKey('abc123')).toBe(`${DRAFT_PHOTO_KEY_PREFIX}abc123`);
    expect(DRAFT_PHOTO_KEY_PREFIX).toBe('idynify.myCardDraftPhoto.v1:');
    expect(DRAFT_PHOTO_KEY_PREFIX.startsWith(DRAFT_KEY_PREFIX)).toBe(false);
    for (const bad of ['', 'a b', 'a/b', 'a:b', null, undefined, 7, {}]) expect(draftPhotoKey(bad), String(bad)).toBeNull();
  });

  it('is kept apart from the draft, which stays small, and says where it is', () => {
    const storage = new FakeStorage();
    expect(saveDraft(withPhoto(), { storage, now: NOW })).toEqual({ ok: true, photoKept: true });
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}U`, `${DRAFT_PHOTO_KEY_PREFIX}U`]);
    const main = storage.getItem(`${DRAFT_KEY_PREFIX}U`);
    expect(main.length).toBeLessThan(DRAFT_MAX_BYTES);
    expect(main).not.toContain(fingerprintOf(photo));
    expect(stored(storage)).toMatchObject({ photo: 'separate', fields: { photoUrl: '' } });
    expect(photoStored(storage)).toEqual({ v: DRAFT_VERSION, uid: 'U', savedAt: NOW, dataUrl: photo });
    expect(photo.length).toBeGreaterThan(DRAFT_MAX_BYTES);
  });

  it('comes back with the draft, exactly, and says nothing was lost', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(), { storage, now: NOW });
    const result = readDraft('U', { storage, now: NOW + 1000 });
    expect(result.status).toBe('ok');
    expect(result.draft.card.photoUrl).toBe(photo);
    expect(result.draft.card).toMatchObject({ firstName: 'Ada', title: 'Analyst', sharingEnabled: false });
    expect(result.draft).toMatchObject({ baseRevision: 3, savedAt: NOW, photoLost: false });
  });

  it('keeps nothing but the allowlist in the photo key too: the picture, the account and the moment', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(photo, { card: card({ photoUrl: photo, share: { ...DEFAULT_SHARE, email: true } }) }), { storage, now: NOW });
    expect(Object.keys(photoStored(storage)).sort()).toEqual(['dataUrl', 'savedAt', 'uid', 'v']);
    const raw = storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}U`);
    expect(raw).not.toMatch(/ada@example|Lovelace|Analyst|share|sharingEnabled/);
  });

  it('is a draft with no photo field when there is no picture: exactly what it always was', () => {
    const storage = new FakeStorage();
    expect(saveDraft(draft(), { storage, now: NOW })).toEqual({ ok: true });
    expect(Object.keys(stored(storage)).sort()).toEqual(['baseRevision', 'fields', 'savedAt', 'share', 'uid', 'v']);
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}U`]);
    expect(readDraft('U', { storage, now: NOW }).draft.photoLost).toBe(false);
  });

  it('is replaced by the next picture, and by a link, and gone when the photo is cleared', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(photo), { storage, now: NOW });
    saveDraft(withPhoto(other), { storage, now: NOW + 1000 });
    expect(photoStored(storage)).toMatchObject({ dataUrl: other, savedAt: NOW + 1000 });
    expect(readDraft('U', { storage, now: NOW + 2000 }).draft.card.photoUrl).toBe(other);

    saveDraft(withPhoto('https://media.example.com/ada.jpg'), { storage, now: NOW + 3000 });
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}U`]);
    expect(readDraft('U', { storage, now: NOW + 3500 }).draft.card.photoUrl).toBe('https://media.example.com/ada.jpg');

    saveDraft(withPhoto(photo), { storage, now: NOW + 4000 });
    saveDraft(withPhoto(''), { storage, now: NOW + 5000 });
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}U`]);
    expect(readDraft('U', { storage, now: NOW + 5500 }).draft.card.photoUrl).toBe('');
  });

  it('lasts as long as the draft and no longer: a draft that has expired takes its picture with it', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(), { storage, now: NOW });
    expect(readDraft('U', { storage, now: NOW + DRAFT_MAX_AGE_MS }).status).toBe('ok');
    expect(readDraft('U', { storage, now: NOW + DRAFT_MAX_AGE_MS + 1 })).toEqual({ status: 'discarded', reason: 'expired' });
    expect(storage.map.size).toBe(0);
    // A draft dated in the future is not believed either.
    saveDraft(withPhoto(), { storage, now: NOW + 10 * HOUR });
    expect(readDraft('U', { storage, now: NOW }).status).toBe('discarded');
    expect(storage.map.size).toBe(0);
  });

  it('is one account\'s: another account reads nothing, and cannot reach it', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(), { storage, now: NOW });
    expect(readDraft('B', { storage, now: NOW })).toEqual({ status: 'none' });
    expect(keysOf(storage)).toHaveLength(2);
    // Even with the keys swapped about: a draft written for A is not B's, whatever key it is found under.
    storage.setItem(`${DRAFT_KEY_PREFIX}B`, storage.getItem(`${DRAFT_KEY_PREFIX}U`));
    storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}B`, storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}U`));
    expect(readDraft('B', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'uid' });
    expect(storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}B`)).toBeNull();
    expect(readDraft('U', { storage, now: NOW }).draft.card.photoUrl).toBe(photo);
  });

  it('is forgotten with the draft: clearing an account takes both keys, and only that account\'s', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(photo, { uid: 'A' }), { storage, now: NOW });
    saveDraft(withPhoto(other, { uid: 'B' }), { storage, now: NOW });
    expect(clearDraft('A', { storage })).toBe(true);
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}B`, `${DRAFT_PHOTO_KEY_PREFIX}B`]);
  });

  it('is removed when another account opens My Card, and kept for the account that did', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(photo, { uid: 'A' }), { storage, now: NOW });
    saveDraft(withPhoto(other, { uid: 'B' }), { storage, now: NOW });
    expect(purgeOtherAccounts('B', { storage })).toBe(2);
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}B`, `${DRAFT_PHOTO_KEY_PREFIX}B`]);
    expect(readDraft('B', { storage, now: NOW }).draft.card.photoUrl).toBe(other);
    expect(purgeOtherAccounts('nobody', { storage })).toBe(2);
    expect(storage.map.size).toBe(0);
  });

  it('is removed at sign-out, for every account in the tab, with the drafts', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(photo, { uid: 'A' }), { storage, now: NOW });
    saveDraft(withPhoto(other, { uid: 'B' }), { storage, now: NOW });
    saveDraft(draft({ uid: 'C' }), { storage, now: NOW });
    storage.setItem('something.else', 'stays');
    expect(clearAllMyCardDrafts({ storage })).toBe(5);
    expect(keysOf(storage)).toEqual(['something.else']);
  });

  it('is said to be lost, not dropped silently, when storage will not take it: the draft is kept without it', () => {
    const storage = new FakeStorage({ failSetKeys: [DRAFT_PHOTO_KEY_PREFIX] });
    expect(saveDraft(withPhoto(), { storage, now: NOW })).toEqual({ ok: true, photoKept: false });
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}U`]);
    expect(stored(storage)).toMatchObject({ photo: 'lost', fields: { photoUrl: '', title: 'Analyst' } });
    const result = readDraft('U', { storage, now: NOW });
    expect(result.status).toBe('ok');
    expect(result.draft).toMatchObject({ photoLost: true, card: { photoUrl: '', title: 'Analyst' } });
  });

  it('takes the older picture out when a newer one will not fit, so the old one cannot come back in its place', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(photo), { storage, now: NOW });
    storage.failSetKeys = new Set([DRAFT_PHOTO_KEY_PREFIX]);
    expect(saveDraft(withPhoto(other), { storage, now: NOW + 1000 })).toEqual({ ok: true, photoKept: false });
    expect(storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}U`)).toBeNull();
    expect(readDraft('U', { storage, now: NOW + 2000 }).draft).toMatchObject({ photoLost: true, card: { photoUrl: '' } });
  });

  it('leaves no picture behind when the draft itself cannot be kept', () => {
    const storage = new FakeStorage({ failSetKeys: [DRAFT_KEY_PREFIX] });
    expect(saveDraft(withPhoto(), { storage, now: NOW })).toEqual({ ok: false, reason: 'error', photoKept: false });
    expect(storage.map.size).toBe(0);
    const tooBig = new FakeStorage();
    expect(saveDraft(withPhoto(photo, { card: card({ photoUrl: photo, title: 'a'.repeat(9000) }) }), { storage: tooBig, now: NOW })).toEqual({ ok: false, reason: 'too-large', photoKept: false });
    expect(tooBig.map.size).toBe(0);
  });

  it('says it was not kept when there is no storage at all, and when the draft is unusable', () => {
    expect(saveDraft(withPhoto(), { storage: null, now: NOW })).toEqual({ ok: false, reason: 'unavailable', photoKept: false });
    expect(saveDraft(withPhoto(photo, { uid: '' }), { storage: new FakeStorage(), now: NOW })).toEqual({ ok: false, reason: 'invalid', photoKept: false });
  });

  it('says it was lost when its key is gone, or is not exactly what this module wrote', () => {
    const damage = {
      'removed': (storage) => storage.removeItem(`${DRAFT_PHOTO_KEY_PREFIX}U`),
      'not JSON': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, '{not json'),
      'not an object': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, '[1,2]'),
      'an extra key': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), extra: 1 })),
      'a missing key': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ v: 1, uid: 'U', savedAt: NOW })),
      'another version': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), v: 2 })),
      'another account': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), uid: 'X' })),
      'another moment (not the draft\'s)': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), savedAt: NOW - 1 })),
      'a picture that is not a finished photo': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), dataUrl: photoDataUrl(320, 5000, { extra: EXIF }) })),
      'a picture that is not a JPEG': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })),
      'a link instead of a picture': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), dataUrl: 'https://evil.example.com/a.jpg' })),
      'a picture that is not text': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), dataUrl: 42 })),
      'over its size': (storage) => storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ ...photoStored(storage), dataUrl: photoDataUrl(320, 120_000) })),
    };
    for (const [what, harm] of Object.entries(damage)) {
      const storage = new FakeStorage();
      saveDraft(withPhoto(), { storage, now: NOW });
      harm(storage);
      const result = readDraft('U', { storage, now: NOW });
      expect(result.status, what).toBe('ok');
      expect(result.draft.photoLost, what).toBe(true);
      expect(result.draft.card.photoUrl, what).toBe('');
      expect(result.draft.card.title, `${what}: the rest of the draft is still there`).toBe('Analyst');
      expect(storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}U`), `${what}: nothing is left behind`).toBeNull();
    }
  });

  it('discards a draft whose photo field is not one of the three states, and takes the picture with it', () => {
    const storage = new FakeStorage();
    saveDraft(withPhoto(), { storage, now: NOW });
    put(storage, 'U', { ...stored(storage), photo: 'somewhere else' });
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'malformed' });
    expect(storage.map.size).toBe(0);
  });

  it('forgets a picture that belongs to no draft: found beside a draft that has none, or with no draft', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, JSON.stringify({ v: 1, uid: 'U', savedAt: NOW, dataUrl: photo }));
    const result = readDraft('U', { storage, now: NOW });
    expect(result.draft.card.photoUrl).toBe('');
    expect(result.draft.photoLost).toBe(false);
    expect(storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}U`)).toBeNull();
    // And saving a draft with no picture forgets one left from before.
    storage.setItem(`${DRAFT_PHOTO_KEY_PREFIX}U`, 'stale');
    saveDraft(draft(), { storage, now: NOW });
    expect(storage.getItem(`${DRAFT_PHOTO_KEY_PREFIX}U`)).toBeNull();
  });

  it('never accepts a picture inside the draft\'s own text fields: a draft that holds one was not written by this module', () => {
    const storage = new FakeStorage();
    saveDraft(draft(), { storage, now: NOW });
    put(storage, 'U', { ...stored(storage), fields: { ...stored(storage).fields, photoUrl: photo } });
    expect(readDraft('U', { storage, now: NOW })).toEqual({ status: 'discarded', reason: 'too-large' });
    const small = new FakeStorage();
    saveDraft(draft(), { storage: small, now: NOW });
    put(small, 'U', { ...stored(small), fields: { ...stored(small).fields, photoUrl: `data:${'a'.repeat(900)}` } });
    expect(readDraft('U', { storage: small, now: NOW })).toEqual({ status: 'discarded', reason: 'malformed' });
  });

  it('keeps short text typed into the link box as typed, even if it starts with "data:", and drops a long one that is not a photo', () => {
    const storage = new FakeStorage();
    saveDraft(draft({ card: card({ photoUrl: 'data:image/png;base64,AAAA' }) }), { storage, now: NOW });
    expect(readDraft('U', { storage, now: NOW }).draft.card.photoUrl).toBe('data:image/png;base64,AAAA');
    // Long, and not a finished photo: not kept, as text or as a picture. (The form refuses it anyway.)
    const bad = photoDataUrl(320, 5000, { extra: EXIF });
    expect(draftPhotoOf({ photoUrl: bad })).toBeNull();
    expect(saveDraft(draft({ card: card({ photoUrl: bad }) }), { storage, now: NOW + 1 })).toEqual({ ok: true });
    expect(keysOf(storage)).toEqual([`${DRAFT_KEY_PREFIX}U`]);
    expect(storage.getItem(`${DRAFT_KEY_PREFIX}U`)).not.toContain('Exif');
    expect(readDraft('U', { storage, now: NOW + 2 }).draft.card.photoUrl).toBe('');
  });

  it('only ever picks a finished profile photo out of a card to keep', () => {
    expect(draftPhotoOf({ photoUrl: photo })).toBe(photo);
    for (const value of ['', 'https://example.com/a.jpg', 'data:image/png;base64,AAAA', photoDataUrl(400, 5000), photoDataUrl(320, 60_000), 42, null, undefined]) {
      expect(draftPhotoOf({ photoUrl: value }), String(value).slice(0, 30)).toBeNull();
    }
    expect(draftPhotoOf(null)).toBeNull();
    expect(draftPhotoOf({})).toBeNull();
    expect(DRAFT_PHOTO_MAX_BYTES).toBeGreaterThan(65_536);
  });

  it('builds its payload with the picture left out, whatever the card holds', () => {
    const payload = buildDraftPayload({ uid: 'U', card: card({ photoUrl: photo }), baseRevision: 3, now: NOW });
    expect(JSON.stringify(payload)).not.toContain(fingerprintOf(photo));
    expect(payload.photo).toBe('separate');
    expect(payload.fields.photoUrl).toBe('');
    expect(buildDraftPayload({ uid: 'U', card: card({ photoUrl: photo }), baseRevision: 3, now: NOW, photo: 'lost' }).photo).toBe('lost');
  });

  it('reads a draft from before photos as it always did', () => {
    const storage = new FakeStorage();
    put(storage, 'U', goodPayload());
    const result = readDraft('U', { storage, now: NOW });
    expect(result.status).toBe('ok');
    expect(result.draft.photoLost).toBe(false);
  });

  it('never writes the picture, or any part of it, to the console', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const storage = new FakeStorage({ failSetKeys: [DRAFT_PHOTO_KEY_PREFIX] });
    saveDraft(withPhoto(), { storage, now: NOW });
    saveDraft(withPhoto(), { storage: new FakeStorage(), now: NOW });
    readDraft('U', { storage, now: NOW });
    clearDraft('U', { storage });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
