/**
 * The My Card storage service, against an in-memory Firestore that behaves the
 * way the real one does where it matters here: a transaction reads, then
 * writes only if nothing it read has changed, and otherwise runs again.
 *
 * The rules themselves (who may read and write) are tested against the real
 * emulator in scripts/rules-check/my-card.mjs; this file tests what the
 * service decides.
 */
import { describe, it, expect } from 'vitest';
import { createMyCardService, MY_CARD_STATUS as S, MY_CARD_ERRORS as E } from '../services/myCard/myCardCore';
import { CARD_SCHEMA_VERSION, DEFAULT_SHARE, newCard } from '../utils/myCardRules';

const CARD_PATH = (uid) => `users/${uid}/card/main`;

/** An in-memory Firestore with transactions that retry when what they read changes. */
function fakeFirestore() {
  const docs = new Map();      // path -> data
  const versions = new Map();  // path -> number, bumped on every write
  const log = { reads: [], writes: [], transactions: 0 };
  const hooks = { afterRead: null, failGet: null, failSet: null, failTransaction: null };

  const version = (path) => versions.get(path) || 0;
  const write = (path, data) => { docs.set(path, structuredClone(data)); versions.set(path, version(path) + 1); };
  const snapshot = (path) => ({
    exists: () => docs.has(path),
    data: () => structuredClone(docs.get(path)),
  });
  const maybeFail = (hook, path) => {
    const failure = hooks[hook];
    if (failure && (!failure.path || failure.path === path)) throw failure.error;
  };

  const fs = {
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    getDoc: async (ref) => {
      log.reads.push(ref.path);
      maybeFail('failGet', ref.path);
      return snapshot(ref.path);
    },
    runTransaction: async (_db, body) => {
      log.transactions += 1;
      if (hooks.failTransaction) throw hooks.failTransaction;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const seen = new Map();
        const pending = [];
        const tx = {
          get: async (ref) => {
            log.reads.push(ref.path);
            maybeFail('failGet', ref.path);
            seen.set(ref.path, version(ref.path));
            return snapshot(ref.path);
          },
          set: (ref, data) => { pending.push([ref.path, data]); },
        };
        const result = await body(tx);
        // Somebody else wrote between our read and our commit: run again, as Firestore does.
        if (hooks.afterRead) { const hook = hooks.afterRead; hooks.afterRead = null; hook(); }
        const changed = [...seen].some(([path, v]) => version(path) !== v);
        if (changed) continue;
        for (const [path, data] of pending) {
          maybeFail('failSet', path);
          log.writes.push(path);
          write(path, data);
        }
        return result;
      }
      throw Object.assign(new Error('too much contention'), { code: 'aborted' });
    },
  };
  return { fs, docs, log, hooks, put: write, read: (path) => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) };
}

const FIXED_TIME = '2026-11-17T10:00:00.000Z';

function setup({ uid = 'A', now = FIXED_TIME } = {}) {
  const firestore = fakeFirestore();
  const auth = { uid };
  const service = createMyCardService({ db: {}, fs: firestore.fs, getSignedInUid: () => auth.uid, now: () => now });
  return { ...firestore, auth, service };
}

const goodCard = (extra = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', email: 'ada@example.com',
  share: { ...DEFAULT_SHARE }, ...extra,
});
const stored = (extra = {}) => ({
  ...newCard(), firstName: 'Ada', lastName: 'Lovelace', revision: 3, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', ...extra,
});
const error = (code, retryable) => ({ status: S.ERROR, code, message: expect.any(String), retryable });

describe('loading the card', () => {
  it('returns a card that exists, with its revision', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ title: 'Analyst' }));
    const result = await t.service.loadMyCard();
    expect(result).toMatchObject({ status: S.OK, revision: 3 });
    expect(result.card).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', sharingEnabled: false });
  });

  it('does not hand the editor the service\'s own bookkeeping', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored());
    const { card } = await t.service.loadMyCard();
    for (const key of ['revision', 'createdAt', 'updatedAt']) expect(card).not.toHaveProperty(key);
  });

  it('says "missing" only for a card that was read and is not there', async () => {
    const t = setup();
    const result = await t.service.loadMyCard();
    expect(result).toEqual({ status: S.MISSING, card: newCard(), revision: null });
    expect(t.log.reads).toEqual([CARD_PATH('A')]);
  });

  it('never calls a failed read "missing"', async () => {
    for (const [code, expected] of [
      ['permission-denied', E.PERMISSION_DENIED], ['unavailable', E.UNAVAILABLE], ['deadline-exceeded', E.UNAVAILABLE],
      ['unauthenticated', E.SIGNED_OUT], ['internal', E.FAILED], [undefined, E.FAILED],
    ]) {
      const t = setup();
      t.put(CARD_PATH('A'), stored());
      t.hooks.failGet = { error: Object.assign(new Error('x'), { code }) };
      const result = await t.service.loadMyCard();
      expect(result.status, String(code)).toBe(S.ERROR);
      expect(result.code, String(code)).toBe(expected);
      expect(result).not.toHaveProperty('card');
      expect(typeof result.message).toBe('string');
    }
  });

  it('says whether trying again can help', async () => {
    const t = setup();
    t.hooks.failGet = { error: Object.assign(new Error('x'), { code: 'unavailable' }) };
    expect(await t.service.loadMyCard()).toEqual(error(E.UNAVAILABLE, true));
    t.hooks.failGet = { error: Object.assign(new Error('x'), { code: 'permission-denied' }) };
    expect(await t.service.loadMyCard()).toEqual(error(E.PERMISSION_DENIED, false));
  });

  it('is an error, not a card, when nobody is signed in', async () => {
    const t = setup({ uid: null });
    expect(await t.service.loadMyCard()).toEqual(error(E.SIGNED_OUT, false));
    expect(t.log.reads).toEqual([]);
  });

  it('repairs a damaged card and says what it dropped', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ email: 'not-an-email', website: 'javascript:alert(1)', title: 'Analyst' }));
    const result = await t.service.loadMyCard();
    expect(result.status).toBe(S.REPAIRED);
    expect(result.card).toMatchObject({ email: '', website: '', title: 'Analyst', firstName: 'Ada' });
    expect(Object.keys(result.errors).sort()).toEqual(['email', 'website']);
    expect(result.repairs).toEqual(expect.arrayContaining(['email', 'website']));
    expect(result.revision).toBe(3);
  });

  it('repairs a card with no name, or wrongly typed values, without throwing', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), { revision: 1, firstName: 7, lastName: ['x'], share: 'everything', title: { a: 1 }, schemaVersion: 1 });
    const result = await t.service.loadMyCard();
    expect(result.status).toBe(S.REPAIRED);
    expect(result.card).toMatchObject({ firstName: '', lastName: '', title: '' });
    expect(result.errors).toHaveProperty('name');
    expect(result.repairs).toContain('share');
    expect(Object.values(result.card.share).every((on) => on === false)).toBe(true);
  });

  it('treats a card from before revisions as revision 0', async () => {
    const t = setup();
    const { revision, ...old } = stored();
    expect(revision).toBe(3);
    t.put(CARD_PATH('A'), old);
    expect(await t.service.loadMyCard()).toMatchObject({ status: S.OK, revision: 0 });
  });

  it('shows sharing as off whatever is stored, and says it was changed', async () => {
    const t = setup();
    for (const sharingEnabled of [true, 'true', 1, {}]) {
      t.put(CARD_PATH('A'), stored({ sharingEnabled }));
      const result = await t.service.loadMyCard();
      expect(result.card.sharingEnabled, String(sharingEnabled)).toBe(false);
      expect(result.status).toBe(S.REPAIRED);
      expect(result.repairs).toContain('sharingEnabled');
    }
  });

  it('will not edit a card a newer version wrote', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ schemaVersion: CARD_SCHEMA_VERSION + 1 }));
    expect(await t.service.loadMyCard()).toEqual(error(E.NEWER_VERSION, false));
  });
});

describe('saving the card', () => {
  it('creates a first card when told there is none, as revision 1', async () => {
    const t = setup();
    const result = await t.service.saveMyCard(goodCard(), { expectedRevision: null });
    expect(result).toMatchObject({ status: S.SAVED, revision: 1 });
    expect(t.read(CARD_PATH('A'))).toMatchObject({
      firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', email: 'ada@example.com',
      revision: 1, createdAt: FIXED_TIME, updatedAt: FIXED_TIME, sharingEnabled: false, schemaVersion: CARD_SCHEMA_VERSION,
    });
    expect(t.log.writes).toEqual([CARD_PATH('A')]);
  });

  it('stores the normalized card and these three fields, and nothing else', async () => {
    const t = setup();
    await t.service.saveMyCard(goodCard({
      email: '  ADA@Example.com ', suggestions: { title: 'x' }, source: 'linkedin', uid: 'B', notes: 'secret', _token: 't', revision: 99, createdAt: 'forged',
    }), { expectedRevision: null });
    const data = t.read(CARD_PATH('A'));
    expect(Object.keys(data).sort()).toEqual([
      'createdAt', 'email', 'firstName', 'instagram', 'lastName', 'linkedinUrl', 'organization', 'phone',
      'photoUrl', 'revision', 'schemaVersion', 'share', 'sharingEnabled', 'title', 'updatedAt', 'website',
    ]);
    expect(data.email).toBe('ada@example.com');
    expect(data.revision).toBe(1);
    expect(data.createdAt).toBe(FIXED_TIME);
    expect(JSON.stringify(data)).not.toMatch(/secret|linkedin"|forged|suggest/);
  });

  it('writes sharingEnabled false, every time, whatever it is given', async () => {
    const t = setup();
    for (const sharingEnabled of [true, 'true', 1, undefined]) {
      const loaded = await t.service.loadMyCard();
      const result = await t.service.saveMyCard(goodCard({ sharingEnabled }), { expectedRevision: loaded.revision });
      expect(result.status).toBe(S.SAVED);
      expect(result.card.sharingEnabled).toBe(false);
      expect(t.read(CARD_PATH('A')).sharingEnabled).toBe(false);
    }
  });

  it('saves the owner\'s switches as they set them', async () => {
    const t = setup();
    await t.service.saveMyCard(goodCard({ share: { ...DEFAULT_SHARE, email: true, title: false } }), { expectedRevision: null });
    expect(t.read(CARD_PATH('A')).share).toMatchObject({ email: true, title: false, phone: false });
  });

  it('updates a card at its revision: one higher, createdAt kept, updatedAt moved', async () => {
    const t = setup({ now: '2026-11-17T12:00:00.000Z' });
    t.put(CARD_PATH('A'), stored());
    const result = await t.service.saveMyCard(goodCard({ title: 'Director' }), { expectedRevision: 3 });
    expect(result).toMatchObject({ status: S.SAVED, revision: 4 });
    expect(t.read(CARD_PATH('A'))).toMatchObject({
      title: 'Director', revision: 4, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-17T12:00:00.000Z',
    });
  });

  it('replaces the stored card whole: a value cleared in the editor is cleared', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ phone: '555 010 2000', title: 'Analyst' }));
    await t.service.saveMyCard(goodCard({ title: '' }), { expectedRevision: 3 });
    expect(t.read(CARD_PATH('A'))).toMatchObject({ title: '', phone: '' });
  });

  it('keeps saving, one revision at a time, from what each save returns', async () => {
    const t = setup();
    let loaded = await t.service.loadMyCard();
    for (let i = 1; i <= 3; i += 1) {
      const saved = await t.service.saveMyCard(goodCard({ title: `v${i}` }), { expectedRevision: loaded.revision });
      expect(saved).toMatchObject({ status: S.SAVED, revision: i });
      loaded = saved;
    }
    expect(t.read(CARD_PATH('A')).title).toBe('v3');
  });

  it('refuses a card with a refused value or no name, and writes nothing', async () => {
    const t = setup();
    const bad = await t.service.saveMyCard(goodCard({ email: 'nope', website: 'javascript:alert(1)' }), { expectedRevision: null });
    expect(bad.status).toBe(S.INVALID);
    expect(Object.keys(bad.errors).sort()).toEqual(['email', 'website']);
    const nameless = await t.service.saveMyCard(goodCard({ firstName: '', lastName: '' }), { expectedRevision: null });
    expect(nameless.status).toBe(S.INVALID);
    expect(nameless.errors).toHaveProperty('name');
    expect(await t.service.saveMyCard(null, { expectedRevision: null })).toMatchObject({ status: S.INVALID });
    expect(t.log.writes).toEqual([]);
    expect(t.log.transactions).toBe(0);
  });

  it('will not save without saying which card it was based on', async () => {
    const t = setup();
    for (const options of [undefined, {}, { expectedRevision: undefined }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: '1' }, { expectedRevision: NaN }]) {
      expect(await t.service.saveMyCard(goodCard(), options), JSON.stringify(options)).toEqual(error(E.BAD_REQUEST, false));
    }
    expect(t.log.transactions).toBe(0);
    expect(t.log.writes).toEqual([]);
  });

  it('is an error when nobody is signed in', async () => {
    const t = setup({ uid: null });
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: null })).toEqual(error(E.SIGNED_OUT, false));
    expect(t.log.writes).toEqual([]);
  });
});

describe('a second tab cannot silently overwrite a newer card', () => {
  it('gets a conflict, with the newer card, and writes nothing', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 1, title: 'From tab A' }));
    const tabA = await t.service.loadMyCard();
    const tabB = await t.service.loadMyCard();

    const savedByA = await t.service.saveMyCard(goodCard({ title: 'Tab A edit' }), { expectedRevision: tabA.revision });
    expect(savedByA).toMatchObject({ status: S.SAVED, revision: 2 });

    const writesBefore = t.log.writes.length;
    const savedByB = await t.service.saveMyCard(goodCard({ title: 'Tab B edit' }), { expectedRevision: tabB.revision });
    expect(savedByB.status).toBe(S.CONFLICT);
    expect(savedByB.current).toMatchObject({ status: S.OK, revision: 2 });
    expect(savedByB.current.card.title).toBe('Tab A edit');
    expect(t.log.writes).toHaveLength(writesBefore);
    expect(t.read(CARD_PATH('A'))).toMatchObject({ title: 'Tab A edit', revision: 2 });
  });

  it('lets the second tab save after it takes the newer card', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 1 }));
    await t.service.saveMyCard(goodCard({ title: 'A' }), { expectedRevision: 1 });
    const conflict = await t.service.saveMyCard(goodCard({ title: 'B' }), { expectedRevision: 1 });
    const retry = await t.service.saveMyCard(goodCard({ title: 'B' }), { expectedRevision: conflict.current.revision });
    expect(retry).toMatchObject({ status: S.SAVED, revision: 3 });
  });

  it('notices a change made between its read and its write', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 1 }));
    // Another tab saves in the middle of this transaction.
    t.hooks.afterRead = () => t.put(CARD_PATH('A'), stored({ revision: 2, title: 'Won the race' }));
    const result = await t.service.saveMyCard(goodCard({ title: 'Lost the race' }), { expectedRevision: 1 });
    expect(result.status).toBe(S.CONFLICT);
    expect(result.current.card.title).toBe('Won the race');
    expect(t.read(CARD_PATH('A'))).toMatchObject({ title: 'Won the race', revision: 2 });
    expect(t.log.writes).toEqual([]);
  });

  it('conflicts when a first card is saved while one already exists', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 1, title: 'Real card' }));
    const result = await t.service.saveMyCard(goodCard({ title: 'Blank draft' }), { expectedRevision: null });
    expect(result.status).toBe(S.CONFLICT);
    expect(t.read(CARD_PATH('A')).title).toBe('Real card');
  });

  it('cannot let a blank draft replace a real card after a failed load', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 5, title: 'Real card' }));
    t.hooks.failGet = { path: CARD_PATH('A'), error: Object.assign(new Error('x'), { code: 'unavailable' }) };
    const failed = await t.service.loadMyCard();
    expect(failed.status).toBe(S.ERROR);
    t.hooks.failGet = null;
    // The editor has no revision to give; the only thing it could say is "no card yet".
    const result = await t.service.saveMyCard(goodCard({ title: 'Blank draft' }), { expectedRevision: null });
    expect(result.status).toBe(S.CONFLICT);
    expect(t.read(CARD_PATH('A'))).toMatchObject({ title: 'Real card', revision: 5 });
  });

  it('conflicts when the card was deleted since it was loaded', async () => {
    const t = setup();
    const result = await t.service.saveMyCard(goodCard(), { expectedRevision: 2 });
    expect(result.status).toBe(S.CONFLICT);
    expect(result.current).toEqual({ status: S.MISSING, card: newCard(), revision: null });
    expect(t.log.writes).toEqual([]);
  });

  it('does not overwrite a card a newer version of the app wrote', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 3, schemaVersion: CARD_SCHEMA_VERSION + 1, futureField: 'keep me' }));
    const result = await t.service.saveMyCard(goodCard(), { expectedRevision: 3 });
    expect(result).toEqual(error(E.NEWER_VERSION, false));
    expect(t.read(CARD_PATH('A')).futureField).toBe('keep me');
  });

  it('gives up cleanly when it keeps losing the race', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 1 }));
    t.hooks.failTransaction = Object.assign(new Error('contention'), { code: 'aborted' });
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: 1 })).toEqual(error(E.UNAVAILABLE, true));
    expect(t.log.writes).toEqual([]);
  });
});

describe('when a save fails', () => {
  it.each([
    ['permission-denied', E.PERMISSION_DENIED, false],
    ['unavailable', E.UNAVAILABLE, true],
    ['deadline-exceeded', E.UNAVAILABLE, true],
    ['unauthenticated', E.SIGNED_OUT, false],
    ['data-loss', E.FAILED, true],
  ])('reports %s as %s', async (code, expectedCode, retryable) => {
    const t = setup();
    t.hooks.failSet = { error: Object.assign(new Error('x'), { code }) };
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: null })).toEqual(error(expectedCode, retryable));
    expect(t.read(CARD_PATH('A'))).toBeUndefined();
  });

  it('reports a failed read inside the save', async () => {
    const t = setup();
    t.hooks.failGet = { error: Object.assign(new Error('x'), { code: 'unavailable' }) };
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: null })).toEqual(error(E.UNAVAILABLE, true));
  });

  it('never throws, and never puts a raw Firestore message in front of the owner', async () => {
    const t = setup();
    t.hooks.failTransaction = new Error('Missing or insufficient permissions: path users/A/card/main');
    const result = await t.service.saveMyCard(goodCard(), { expectedRevision: null });
    expect(result.status).toBe(S.ERROR);
    expect(result.message).not.toMatch(/users\/A|Missing or insufficient/);
  });
});

describe('a save the card rules refuse because the card moved', () => {
  // The rules take only the NEXT revision. When two saves land at the same moment the loser is refused at
  // the server as permission-denied, before Firestore can retry it; nothing was written. The service looks
  // again: if the card moved on that is a conflict, and a refusal for any other reason stays a refusal.
  const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

  it('is a conflict, with the newer card, when the card has moved on', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 4, title: 'Newer' }));
    t.hooks.failTransaction = refused();
    const result = await t.service.saveMyCard(goodCard({ title: 'Mine' }), { expectedRevision: 3 });
    expect(result.status).toBe(S.CONFLICT);
    expect(result.current).toMatchObject({ status: S.OK, revision: 4, card: { title: 'Newer' } });
    expect(t.read(CARD_PATH('A')).title).toBe('Newer');
  });

  it('is a conflict when a first card is refused because one now exists', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 1, title: 'Already here' }));
    t.hooks.failTransaction = refused();
    const result = await t.service.saveMyCard(goodCard(), { expectedRevision: null });
    expect(result.status).toBe(S.CONFLICT);
    expect(result.current.revision).toBe(1);
  });

  it('is a conflict when the card was removed since it was loaded', async () => {
    const t = setup();
    t.hooks.failTransaction = refused();
    const result = await t.service.saveMyCard(goodCard(), { expectedRevision: 3 });
    expect(result.status).toBe(S.CONFLICT);
    expect(result.current.status).toBe(S.MISSING);
  });

  it('stays a refusal when the card is exactly as it was: it was not about the revision', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 3 }));
    t.hooks.failTransaction = refused();
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: 3 })).toEqual(error(E.PERMISSION_DENIED, false));
  });

  it('stays a refusal when the card cannot be read again', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 4 }));
    t.hooks.failTransaction = refused();
    t.hooks.failGet = { error: Object.assign(new Error('x'), { code: 'permission-denied' }) };
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: 3 })).toEqual(error(E.PERMISSION_DENIED, false));
  });

  it('stays a refusal for a card a newer version of the app wrote', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 4, schemaVersion: CARD_SCHEMA_VERSION + 1 }));
    t.hooks.failTransaction = refused();
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: 3 })).toEqual(error(E.PERMISSION_DENIED, false));
  });

  it('does not look again for any other failure', async () => {
    const t = setup();
    t.put(CARD_PATH('A'), stored({ revision: 4 }));
    t.hooks.failTransaction = Object.assign(new Error('x'), { code: 'unavailable' });
    expect(await t.service.saveMyCard(goodCard(), { expectedRevision: 3 })).toEqual(error(E.UNAVAILABLE, true));
    expect(t.log.reads).toEqual([]);
  });
});

describe('whose card it is', () => {
  it('always uses the signed-in account\'s uid, and takes no uid from the caller', async () => {
    const t = setup({ uid: 'A' });
    t.put(CARD_PATH('B'), stored({ title: 'B\'s card' }));
    // Extra arguments are ignored: there is no way to name another account.
    expect((await t.service.loadMyCard('B', { uid: 'B' })).status).toBe(S.MISSING);
    await t.service.saveMyCard(goodCard({ uid: 'B', userId: 'B' }), { expectedRevision: null, uid: 'B' });
    expect(t.read(CARD_PATH('A'))).toBeDefined();
    expect(t.read(CARD_PATH('B'))).toMatchObject({ title: 'B\'s card', revision: 3 });
    expect(t.log.reads.every((path) => !path.includes('/B/'))).toBe(true);
    expect(t.log.writes).toEqual([CARD_PATH('A')]);
  });

  it('follows the signed-in account when it changes, and keeps the two cards apart', async () => {
    const t = setup({ uid: 'A' });
    await t.service.saveMyCard(goodCard({ title: 'A\'s title' }), { expectedRevision: null });
    t.auth.uid = 'B';
    expect((await t.service.loadMyCard()).status).toBe(S.MISSING);
    await t.service.saveMyCard(goodCard({ title: 'B\'s title' }), { expectedRevision: null });
    expect(t.read(CARD_PATH('A')).title).toBe('A\'s title');
    expect(t.read(CARD_PATH('B')).title).toBe('B\'s title');
  });

  it('reads the signed-in account\'s own uid, which is what the app binds it to', async () => {
    // The binding passes auth.currentUser.uid, not the impersonated user's (see myCardService.js).
    const t = setup({ uid: 'ADMIN_REAL_UID' });
    await t.service.saveMyCard(goodCard(), { expectedRevision: null });
    expect(t.log.writes).toEqual([CARD_PATH('ADMIN_REAL_UID')]);
  });
});

describe('suggestions, read-only', () => {
  const account = {
    displayName: 'Ada Lovelace', email: 'ada@example.com',
    section1Answers: { role: 'Analyst', companyName: 'Analytical Engines', ninetyDayGoal: 'secret goal' },
    credits: 400, stripeCustomerId: 'cus_123', subscriptionTier: 'pro',
  };
  const linkedin = {
    status: 'connected', givenName: 'Ada', familyName: 'Lovelace', email: 'ada@linkedin.example.com', emailVerified: true,
    pictureUrl: 'https://media.example.com/ada.jpg', linkedinMemberId: 'sub-123', scopes: ['openid'],
  };

  it('reads the account and LinkedIn documents of the signed-in user, and only those', async () => {
    const t = setup({ uid: 'A' });
    t.put('users/A', account);
    t.put('users/A/integrations/linkedin', linkedin);
    t.put('users/B', { displayName: 'Someone Else' });
    const { suggestions, unavailable } = await t.service.loadCardSuggestions();
    expect(t.log.reads.sort()).toEqual(['users/A', 'users/A/integrations/linkedin']);
    expect(unavailable).toEqual([]);
    expect(Object.fromEntries(Object.entries(suggestions).map(([f, s]) => [f, s.value]))).toEqual({
      firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', photoUrl: 'https://media.example.com/ada.jpg',
      title: 'Analyst', organization: 'Analytical Engines',
    });
  });

  it('follows the suggestion rules: Settings name first, unverified LinkedIn email unused', async () => {
    const t = setup();
    t.put('users/A', { displayName: 'Countess Ada' });
    t.put('users/A/integrations/linkedin', { ...linkedin, emailVerified: 'true' });
    const { suggestions } = await t.service.loadCardSuggestions();
    expect(suggestions.firstName).toEqual({ value: 'Countess', source: 'settings' });
    expect(suggestions).not.toHaveProperty('email');
  });

  it('passes on nothing from the account document beyond the few fields it uses', async () => {
    const t = setup();
    t.put('users/A', account);
    t.put('users/A/integrations/linkedin', linkedin);
    const { suggestions } = await t.service.loadCardSuggestions();
    expect(JSON.stringify(suggestions)).not.toMatch(/secret goal|cus_123|pro|400|sub-123/);
  });

  it('writes nothing and creates no card', async () => {
    const t = setup();
    t.put('users/A', account);
    const before = t.log.writes.length;
    await t.service.loadCardSuggestions();
    await t.service.loadMyCard();
    expect(t.log.writes).toHaveLength(before);
    expect(t.log.transactions).toBe(0);
    expect(t.read(CARD_PATH('A'))).toBeUndefined();
  });

  it('keeps going when one source cannot be read, and says which', async () => {
    const t = setup();
    t.put('users/A', account);
    t.hooks.failGet = { path: 'users/A/integrations/linkedin', error: Object.assign(new Error('x'), { code: 'permission-denied' }) };
    const { suggestions, unavailable } = await t.service.loadCardSuggestions();
    expect(unavailable).toEqual(['linkedin']);
    expect(suggestions.firstName).toMatchObject({ value: 'Ada', source: 'settings' });
    expect(suggestions).not.toHaveProperty('photoUrl');
  });

  it('is empty, not an error, when both sources fail or there is nothing', async () => {
    const t = setup();
    expect(await t.service.loadCardSuggestions()).toEqual({ suggestions: {}, unavailable: [] });
    t.hooks.failGet = { error: Object.assign(new Error('x'), { code: 'unavailable' }) };
    expect(await t.service.loadCardSuggestions()).toEqual({ suggestions: {}, unavailable: ['account', 'linkedin'] });
  });

  it('reads nothing when nobody is signed in', async () => {
    const t = setup({ uid: null });
    expect(await t.service.loadCardSuggestions()).toEqual({ suggestions: {}, unavailable: ['account', 'linkedin'] });
    expect(t.log.reads).toEqual([]);
  });

  it('never saves what it suggests: a card is only written by a save', async () => {
    const t = setup();
    t.put('users/A', account);
    await t.service.loadCardSuggestions();
    const loaded = await t.service.loadMyCard();
    expect(loaded.status).toBe(S.MISSING);
    expect(loaded.card.firstName).toBe('');
    expect(t.log.writes).toEqual([]);
  });

  it('does not let a suggestion reach a saved card: only the owner\'s card is saved', async () => {
    const t = setup();
    t.put('users/A', account);
    t.put(CARD_PATH('A'), stored({ firstName: 'Countess', title: '' }));
    await t.service.loadCardSuggestions();
    const loaded = await t.service.loadMyCard();
    expect(loaded.card).toMatchObject({ firstName: 'Countess', title: '' });
    expect(t.read(CARD_PATH('A'))).toMatchObject({ firstName: 'Countess', title: '', revision: 3 });
  });
});
