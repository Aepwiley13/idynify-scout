/**
 * stickersConfig — may this user use stickers? (ADR-007)
 *
 * Pins who may ask (the user, or an admin impersonating exactly that user,
 * read-only), the answer for every row of STICKER_ACCESS_MATRIX (the same rows
 * scripts/rules-check/stickers.mjs runs against the real rules), that the
 * environment admin lists are NOT honoured (the rules cannot see them), the
 * safe default (off), and that nothing identifying reaches a log or a body.
 *
 * firebase-admin and the existing admin and impersonation checks are mocked;
 * the handler, stickersFlags and stickersAccess are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format } from 'node:util';
import { STICKER_ACCESS_MATRIX } from '../constants/stickersAccess.js';

const verifyIdToken = vi.hoisted(() => vi.fn());
const checkAdminAccess = vi.hoisted(() => vi.fn());
const validateImpersonationSession = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ docs: new Map(), reads: [], failReads: false }));

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken }) },
  db: {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          store.reads.push(`${name}/${id}`);
          if (store.failReads) throw new Error('firestore unavailable for uid_user_7g5g');
          const data = store.docs.get(`${name}/${id}`);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  },
}));
vi.mock('../../netlify/functions/utils/adminAuth.js', () => ({ checkAdminAccess }));
vi.mock('../../netlify/functions/utils/impersonation.js', () => ({ validateImpersonationSession }));

import { handler, CODES } from '../../netlify/functions/stickersConfig.js';
import { resolveStickersConfig } from '../../netlify/functions/utils/stickersFlags.js';

const USER = 'uid_user_7g5g';
const OTHER = 'uid_other_q9w8';
const ADMIN = 'uid_admin_5x';
const TOKENS = { tok_SECRET_user: USER, tok_SECRET_other: OTHER, tok_SECRET_admin: ADMIN };

const request = (userId, token, { method = 'POST', body } = {}) => ({
  httpMethod: method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: body ?? JSON.stringify({ userId }),
});
async function call(...args) {
  const response = await handler(request(...args));
  return { status: response.statusCode, headers: response.headers, body: JSON.parse(response.body) };
}
const setMode = (mode) => (mode === null ? store.docs.delete('feature_flags/stickers') : store.docs.set('feature_flags/stickers', { mode }));
const setRole = (uid, role) => store.docs.set(`users/${uid}`, role === null ? { email: 'x@example.test' } : { email: 'x@example.test', role });
const setStage = (uid, stage) => (stage === null ? store.docs.delete(`sticker_enrollment/${uid}`) : store.docs.set(`sticker_enrollment/${uid}`, { stage }));

let logs;
beforeEach(() => {
  vi.clearAllMocks();
  store.docs.clear();
  store.reads.length = 0;
  store.failReads = false;
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    vi.spyOn(console, level).mockImplementation((...args) => logs.push(format(...args)));
  }
  verifyIdToken.mockImplementation(async (token) => {
    if (!TOKENS[token]) throw new Error(`invalid token ${token}`);
    return { uid: TOKENS[token] };
  });
  checkAdminAccess.mockImplementation(async (uid) => uid === ADMIN);
  validateImpersonationSession.mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('request handling', () => {
  it('answers a CORS preflight', async () => {
    expect((await handler({ httpMethod: 'OPTIONS', headers: {} })).statusCode).toBe(204);
  });

  it.each(['GET', 'PUT', 'DELETE'])('refuses %s', async (method) => {
    expect(await call(USER, 'tok_SECRET_user', { method })).toMatchObject({ status: 405, body: { error: CODES.METHOD_NOT_ALLOWED } });
  });

  it.each([
    ['malformed JSON', '{"userId":'],
    ['no userId', JSON.stringify({})],
    ['a numeric userId', JSON.stringify({ userId: 42 })],
    ['a path in userId', JSON.stringify({ userId: 'a/../b' })],
  ])('refuses %s with 400', async (_label, body) => {
    expect(await call(USER, 'tok_SECRET_user', { body })).toMatchObject({ status: 400, body: { error: CODES.INVALID_REQUEST } });
  });

  it('refuses a missing or invalid token with 401', async () => {
    expect((await call(USER, null)).status).toBe(401);
    expect((await call(USER, 'tok_SECRET_forged')).status).toBe(401);
  });

  it('is never cached', async () => {
    const { headers } = await call(USER, 'tok_SECRET_user');
    expect(headers['Cache-Control']).toBe('no-store');
  });
});

describe('the answer matches the rules, row by row', () => {
  it.each(STICKER_ACCESS_MATRIX.map((row) => [row]))('%o', async (row) => {
    setMode(row.mode);
    setRole(USER, row.role);
    setStage(USER, row.stage);
    const { status, body } = await call(USER, 'tok_SECRET_user');
    expect(status).toBe(200);
    expect(body.enabled).toBe(row.allowed);
    expect(body.readOnly).toBe(false);
  });

  it('is off when the flag document does not exist', async () => {
    expect((await call(USER, 'tok_SECRET_user')).body).toEqual({ enabled: false, mode: 'off', readOnly: false });
  });

  it('does not honour ADMIN_USER_IDS or SUPER_ADMIN_USER_IDS, because the rules cannot', async () => {
    vi.stubEnv('ADMIN_USER_IDS', USER);
    vi.stubEnv('SUPER_ADMIN_USER_IDS', USER);
    setMode('internal');
    setRole(USER, null);
    expect((await call(USER, 'tok_SECRET_user')).body.enabled).toBe(false);
  });

  it('reads exactly the three documents the rules read', async () => {
    setMode('on');
    await resolveStickersConfig((await import('../../netlify/functions/firebase-admin.js')).db, USER);
    expect(store.reads.sort()).toEqual(['feature_flags/stickers', `sticker_enrollment/${USER}`, `users/${USER}`]);
  });
});

describe('who may ask', () => {
  beforeEach(() => setMode('on'));

  it('the user themselves', async () => {
    expect((await call(USER, 'tok_SECRET_user')).body).toEqual({ enabled: true, mode: 'on', readOnly: false });
  });

  it('not another user', async () => {
    expect(await call(USER, 'tok_SECRET_other')).toMatchObject({ status: 403, body: { error: CODES.FORBIDDEN } });
  });

  it('not an admin who is not impersonating that user', async () => {
    expect((await call(USER, 'tok_SECRET_admin')).status).toBe(403);
    validateImpersonationSession.mockResolvedValue(OTHER);
    expect((await call(USER, 'tok_SECRET_admin')).status).toBe(403);
  });

  it('an admin impersonating exactly that user gets their answer, read-only', async () => {
    validateImpersonationSession.mockResolvedValue(USER);
    expect((await call(USER, 'tok_SECRET_admin')).body).toEqual({ enabled: true, mode: 'on', readOnly: true });
  });
});

describe('failures and privacy', () => {
  it('a Firestore failure is a 500 with no detail', async () => {
    store.failReads = true;
    expect(await call(USER, 'tok_SECRET_user')).toEqual({ status: 500, headers: expect.any(Object), body: { error: CODES.INTERNAL_ERROR } });
  });

  it('logs and bodies carry no token and no user id', async () => {
    setMode('beta');
    await call(USER, 'tok_SECRET_user');
    await call(USER, 'tok_SECRET_other');
    await call(USER, 'tok_SECRET_forged');
    store.failReads = true;
    const failed = await call(USER, 'tok_SECRET_user');
    const text = logs.join('\n') + JSON.stringify(failed.body);
    for (const secret of ['tok_SECRET', USER, OTHER]) expect(text).not.toContain(secret);
  });
});
