/**
 * My Card takedown (MY-CARD-SHARE-001 PR 6): adminTakedownMyCard, and adminSuspendAccount taking
 * the public card down. The Admin SDK is faked in memory: documents by path, with batches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
const calls = { deletes: [], failCard: false };
const authMock = {
  verifyIdToken: vi.fn(),
  getUser: vi.fn(),
  revokeRefreshTokens: vi.fn(async () => {}),
  updateUser: vi.fn(async () => {}),
};
const makeDoc = (path) => ({
  path,
  get: async () => {
    if (calls.failCard && path.endsWith('/card/main')) throw new Error('boom');
    return { exists: store.has(path), data: () => store.get(path) };
  },
  set: async (data, opts) => { store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data); },
  collection: (name) => ({ doc: (id) => makeDoc(`${path}/${name}/${id}`) }),
});
const fakeDb = {
  collection: (name) => ({ doc: (id) => makeDoc(`${name}/${id}`) }),
  batch: () => {
    const ops = [];
    return {
      delete: (ref) => ops.push(['delete', ref.path]),
      update: (ref, data) => ops.push(['update', ref.path, data]),
      commit: async () => {
        for (const [kind, path, data] of ops) {
          if (kind === 'delete') { store.delete(path); calls.deletes.push(path); } else store.set(path, { ...store.get(path), ...data });
        }
      },
    };
  },
};

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ db: fakeDb, admin: { auth: () => authMock } }));
const adminIds = new Set(['ADMIN']);
vi.mock('../../netlify/functions/utils/adminAuth.js', () => ({ checkAdminAccess: async (uid) => adminIds.has(uid) }));
vi.mock('../../netlify/functions/utils/extractAuthToken.js', () => ({ extractAuthToken: (e) => e.headers?.authorization || null }));
const audit = vi.fn(async () => 'id');
vi.mock('../../netlify/functions/utils/auditLog.js', () => ({
  logAuditEvent: (...a) => audit(...a), getIpAddress: () => '1.1.1.1', getUserAgent: () => 'test', AUDIT_ACTIONS: { ACCOUNT_SUSPENDED: 'account_suspended' },
}));

const { handler: takedown } = await import('../../netlify/functions/adminTakedownMyCard.js');
const { handler: suspend } = await import('../../netlify/functions/adminSuspendAccount.js');

const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const liveCard = (extra = {}) => ({ firstName: 'Ada', sharingEnabled: true, publicId: ID, publishedAt: 't', schemaVersion: 2, revision: 4, ...extra });
const call = (handler, body, token = 'tok') => handler({ httpMethod: 'POST', headers: { authorization: token }, body: JSON.stringify(body) });
const parse = (r) => JSON.parse(r.body);

beforeEach(() => {
  store.clear(); calls.deletes = []; calls.failCard = false; audit.mockClear();
  authMock.verifyIdToken.mockImplementation(async (t) => ({ uid: t === 'tok' ? 'ADMIN' : 'USER' }));
  authMock.getUser.mockImplementation(async (uid) => ({ uid, email: `${uid}@example.com` }));
  authMock.updateUser.mockClear(); authMock.revokeRefreshTokens.mockClear();
  store.set('users/U', { accountStatus: 'active' });
  store.set(`publicCards/${ID}`, { firstName: 'Ada' });
  store.set(`publicIds/${ID}`, { ownerUid: 'U' });
  store.set('users/U/card/main', liveCard());
});

describe('adminTakedownMyCard', () => {
  it('refuses a missing token, a non-admin, a missing uid and a missing reason', async () => {
    expect((await takedown({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode).toBe(401);
    expect((await call(takedown, { uid: 'U', reason: 'x' }, 'user')).statusCode).toBe(403);
    expect((await call(takedown, { reason: 'x' })).statusCode).toBe(400);
    expect((await call(takedown, { uid: 'U', reason: '  ' })).statusCode).toBe(400);
    expect(store.has(`publicCards/${ID}`)).toBe(true);
    expect(store.get('users/U').myCardPublishBlocked).toBeUndefined();
  });

  it('blocks publishing, deletes the public copy, switches the card off and keeps the registry', async () => {
    const r = await call(takedown, { uid: 'U', reason: 'abuse report' });
    expect(r.statusCode).toBe(200);
    expect(parse(r).myCard).toEqual({ takenDown: true });
    const user = store.get('users/U');
    expect(user.myCardPublishBlocked).toBe(true);
    expect(user.myCardPublishBlockedBy).toBe('ADMIN');
    expect(user.myCardPublishBlockedReason).toBe('abuse report');
    expect(user.accountStatus).toBe('active');
    expect(store.has(`publicCards/${ID}`)).toBe(false);
    const card = store.get('users/U/card/main');
    expect(card.sharingEnabled).toBe(false);
    expect(card.revision).toBe(5);
    expect(card.publicId).toBe(ID);
    expect(card.schemaVersion).toBe(2);
    expect(store.has(`publicIds/${ID}`)).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'my_card_takedown', status: 'success' }));
  });

  it('is idempotent: a second takedown changes nothing more', async () => {
    await call(takedown, { uid: 'U', reason: 'abuse' });
    const after = JSON.stringify(store.get('users/U/card/main'));
    const r = await call(takedown, { uid: 'U', reason: 'abuse' });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(store.get('users/U/card/main'))).toBe(after);
    expect(store.get('users/U').myCardPublishBlocked).toBe(true);
  });

  it('is fine for a user with no card, or a card that was never published', async () => {
    store.delete('users/U/card/main');
    expect(parse(await call(takedown, { uid: 'U', reason: 'x' })).myCard).toEqual({ takenDown: false });
    store.set('users/U/card/main', { firstName: 'Ada', sharingEnabled: false, revision: 1 });
    expect((await call(takedown, { uid: 'U', reason: 'x' })).statusCode).toBe(200);
    expect(store.get('users/U/card/main').revision).toBe(1);
  });

  it('restore clears only the block and republishes nothing', async () => {
    await call(takedown, { uid: 'U', reason: 'abuse' });
    const card = JSON.stringify(store.get('users/U/card/main'));
    const r = await call(takedown, { uid: 'U', action: 'restore' });
    expect(r.statusCode).toBe(200);
    expect(store.get('users/U').myCardPublishBlocked).toBe(false);
    expect(store.has(`publicCards/${ID}`)).toBe(false);
    expect(JSON.stringify(store.get('users/U/card/main'))).toBe(card);
    expect((await call(takedown, { uid: 'U', action: 'restore' }, 'user')).statusCode).toBe(403);
  });

  it('keeps the block in place and reports it when the card step fails', async () => {
    calls.failCard = true;
    const r = await call(takedown, { uid: 'U', reason: 'x' });
    expect(r.statusCode).toBe(500);
    expect(parse(r).myCard.error).toBe('boom');
    expect(store.get('users/U').myCardPublishBlocked).toBe(true);
  });
});

describe('adminSuspendAccount and the public card', () => {
  const suspendBody = { targetUserId: 'U', reason: 'policy' };

  it('deletes the public copy and switches the card off, keeping publicId and the registry', async () => {
    const r = await call(suspend, suspendBody);
    expect(r.statusCode).toBe(200);
    expect(parse(r).myCard).toEqual({ takenDown: true });
    expect(store.get('users/U').accountStatus).toBe('suspended');
    expect(store.has(`publicCards/${ID}`)).toBe(false);
    const card = store.get('users/U/card/main');
    expect(card.sharingEnabled).toBe(false);
    expect(card.revision).toBe(5);
    expect(card.publicId).toBe(ID);
    expect(store.has(`publicIds/${ID}`)).toBe(true);
    expect(authMock.updateUser).toHaveBeenCalledWith('U', { disabled: true });
  });

  it('still suspends a user with no card', async () => {
    store.delete('users/U/card/main');
    const r = await call(suspend, suspendBody);
    expect(r.statusCode).toBe(200);
    expect(parse(r).myCard).toEqual({ takenDown: false });
    expect(store.get('users/U').accountStatus).toBe('suspended');
  });

  it('still suspends when the card step throws, and reports it', async () => {
    calls.failCard = true;
    const r = await call(suspend, suspendBody);
    expect(r.statusCode).toBe(200);
    expect(parse(r).success).toBe(true);
    expect(parse(r).myCard).toEqual({ takenDown: false, error: 'boom' });
    expect(store.get('users/U').accountStatus).toBe('suspended');
    expect(authMock.revokeRefreshTokens).toHaveBeenCalledWith('U');
  });

  it('keeps refusing non-admins and a missing reason', async () => {
    expect((await call(suspend, suspendBody, 'user')).statusCode).toBe(403);
    expect((await call(suspend, { targetUserId: 'U' })).statusCode).toBe(400);
    expect(store.has(`publicCards/${ID}`)).toBe(true);
  });
});
