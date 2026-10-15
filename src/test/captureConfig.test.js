/**
 * captureConfig — is Relationship Capture enabled for this user?
 *
 * Pins who may ask (the user, or an admin impersonating exactly that user),
 * the answer for each CAPTURE_MODE, the safe default (off), and that nothing
 * identifying reaches a log or an error body.
 *
 * firebase-admin and the existing admin and impersonation checks are mocked;
 * the handler and captureFlags are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format } from 'node:util';

const verifyIdToken = vi.hoisted(() => vi.fn());
const checkAdminAccess = vi.hoisted(() => vi.fn());
const checkSuperAdminAccess = vi.hoisted(() => vi.fn());
const validateImpersonationSession = vi.hoisted(() => vi.fn());
const enrollment = vi.hoisted(() => new Map());
const reads = vi.hoisted(() => []);

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken }) },
  db: {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          reads.push(`${name}/${id}`);
          const data = name === 'capture_enrollment' ? enrollment.get(id) : undefined;
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  },
}));
vi.mock('../../netlify/functions/utils/adminAuth.js', () => ({ checkAdminAccess }));
vi.mock('../../netlify/functions/utils/superAdminAuth.js', () => ({ checkSuperAdminAccess }));
vi.mock('../../netlify/functions/utils/impersonation.js', () => ({ validateImpersonationSession }));

import { handler, CODES } from '../../netlify/functions/captureConfig.js';

const USER = 'uid_user_7g5g';
const OTHER = 'uid_other_q9w8';
const ADMIN = 'uid_admin_5x';
const SUPER = 'uid_super_9z';
const TOKENS = {
  tok_SECRET_user: USER, tok_SECRET_other: OTHER, tok_SECRET_admin: ADMIN, tok_SECRET_super: SUPER,
};

const ADMINS = new Set([ADMIN]);
const SUPERS = new Set([SUPER]);

function request(userId, token, { method = 'POST', body } = {}) {
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body ?? JSON.stringify({ userId }),
  };
}

async function call(...args) {
  const response = await handler(request(...args));
  return { status: response.statusCode, headers: response.headers, body: JSON.parse(response.body) };
}

const DISABLED = { enabled: false, stage: null, witnessEnabled: false, reportEnabled: false };

let logs;
beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    vi.spyOn(console, level).mockImplementation((...args) => logs.push(format(...args)));
  }
  verifyIdToken.mockImplementation(async (token) => {
    if (!TOKENS[token]) throw new Error(`invalid token ${token}`);
    return { uid: TOKENS[token] };
  });
  checkAdminAccess.mockImplementation(async uid => ADMINS.has(uid));
  checkSuperAdminAccess.mockImplementation(async uid => SUPERS.has(uid));
  validateImpersonationSession.mockResolvedValue(null);
  enrollment.clear();
  reads.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('request handling', () => {
  it('answers a CORS preflight', async () => {
    const response = await handler({ httpMethod: 'OPTIONS', headers: {} });
    expect(response.statusCode).toBe(204);
  });

  it.each(['GET', 'PUT', 'DELETE'])('refuses %s', async (method) => {
    const { status, body } = await call(USER, 'tok_SECRET_user', { method });
    expect(status).toBe(405);
    expect(body).toEqual({ error: CODES.METHOD_NOT_ALLOWED });
  });

  it.each([
    ['malformed JSON', '{"userId":'],
    ['no userId', JSON.stringify({})],
    ['a numeric userId', JSON.stringify({ userId: 42 })],
    ['a path in userId', JSON.stringify({ userId: 'a/../b' })],
  ])('refuses %s with 400', async (_, body) => {
    const { status, body: payload } = await call(USER, 'tok_SECRET_user', { body });
    expect(status).toBe(400);
    expect(payload).toEqual({ error: CODES.INVALID_REQUEST });
  });

  it('refuses a missing token with 401', async () => {
    expect((await call(USER, null)).status).toBe(401);
  });

  it('refuses an invalid token with 401', async () => {
    expect((await call(USER, 'tok_SECRET_forged')).status).toBe(401);
  });

  it('is never cached', async () => {
    const { headers } = await call(USER, 'tok_SECRET_user');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('who may ask', () => {
  beforeEach(() => vi.stubEnv('CAPTURE_MODE', 'on'));

  it('the user themselves', async () => {
    expect(await call(USER, 'tok_SECRET_user')).toMatchObject({ status: 200, body: { enabled: true } });
  });

  it('not another user', async () => {
    const { status, body } = await call(USER, 'tok_SECRET_other');
    expect(status).toBe(403);
    expect(body).toEqual({ error: CODES.FORBIDDEN });
  });

  it('not an admin without an impersonation session', async () => {
    expect((await call(USER, 'tok_SECRET_admin')).status).toBe(403);
  });

  it('not an admin impersonating someone else', async () => {
    validateImpersonationSession.mockResolvedValue(OTHER);
    expect((await call(USER, 'tok_SECRET_admin')).status).toBe(403);
  });

  it('not a super admin who is not an admin, even with a session', async () => {
    validateImpersonationSession.mockResolvedValue(USER);
    expect((await call(USER, 'tok_SECRET_super')).status).toBe(403);
  });

  it("an admin impersonating exactly this user gets that user's answer", async () => {
    vi.stubEnv('CAPTURE_MODE', 'internal');
    validateImpersonationSession.mockImplementation(async uid => (uid === ADMIN ? USER : null));
    const { status, body } = await call(USER, 'tok_SECRET_admin');
    expect(status).toBe(200);
    // The target is not an admin, so internal mode says no, although the caller is an admin.
    expect(body).toEqual(DISABLED);
    expect(checkAdminAccess).toHaveBeenCalledWith(USER);
  });
});

describe('the answer for each mode', () => {
  it('CAPTURE_MODE unset is off, and nothing is read', async () => {
    vi.stubEnv('CAPTURE_MODE', undefined);
    enrollment.set(USER, { stage: 'beta' });
    expect(await call(USER, 'tok_SECRET_user')).toEqual(expect.objectContaining({ status: 200, body: DISABLED }));
    expect(await call(ADMIN, 'tok_SECRET_admin')).toEqual(expect.objectContaining({ status: 200, body: DISABLED }));
    expect(reads).toEqual([]);
    expect(checkAdminAccess).not.toHaveBeenCalled();
  });

  it.each(['', 'ON', 'On', ' on', 'true', 'enabled'])('CAPTURE_MODE=%j is off', async (value) => {
    vi.stubEnv('CAPTURE_MODE', value);
    expect((await call(ADMIN, 'tok_SECRET_admin')).body).toEqual(DISABLED);
  });

  it('internal: admins and super admins only', async () => {
    vi.stubEnv('CAPTURE_MODE', 'internal');
    enrollment.set(USER, { stage: 'beta' });
    expect((await call(ADMIN, 'tok_SECRET_admin')).body).toEqual({ enabled: true, stage: 'internal', witnessEnabled: false, reportEnabled: false });
    expect((await call(SUPER, 'tok_SECRET_super')).body).toMatchObject({ enabled: true, stage: 'internal' });
    expect((await call(USER, 'tok_SECRET_user')).body).toEqual(DISABLED);
    expect(reads).toEqual([]);
  });

  it('beta: admins, plus users enrolled with stage beta', async () => {
    vi.stubEnv('CAPTURE_MODE', 'beta');
    enrollment.set(USER, { stage: 'beta', enrolledBy: ADMIN });
    enrollment.set(OTHER, { stage: 'waitlist' });
    expect((await call(USER, 'tok_SECRET_user')).body).toEqual({ enabled: true, stage: 'beta', witnessEnabled: false, reportEnabled: false });
    expect((await call(OTHER, 'tok_SECRET_other')).body).toEqual(DISABLED);
    expect((await call(ADMIN, 'tok_SECRET_admin')).body).toMatchObject({ enabled: true, stage: 'beta' });
    expect(reads).toEqual([`capture_enrollment/${USER}`, `capture_enrollment/${OTHER}`]);
  });

  it('on: every signed-in user', async () => {
    vi.stubEnv('CAPTURE_MODE', 'on');
    expect((await call(OTHER, 'tok_SECRET_other')).body).toMatchObject({ enabled: true, stage: 'on' });
  });

  it('witness and report switches only when enabled', async () => {
    vi.stubEnv('CAPTURE_MODE', 'internal');
    vi.stubEnv('CAPTURE_WITNESS', 'on');
    vi.stubEnv('CAPTURE_REPORTS', 'on');
    expect((await call(ADMIN, 'tok_SECRET_admin')).body).toEqual({ enabled: true, stage: 'internal', witnessEnabled: true, reportEnabled: true });
    expect((await call(USER, 'tok_SECRET_user')).body).toEqual(DISABLED);
  });
});

describe('failures and logs', () => {
  it('an internal failure is a generic 500', async () => {
    vi.stubEnv('CAPTURE_MODE', 'internal');
    checkAdminAccess.mockRejectedValue(new Error(`firestore unavailable for ${USER}`));
    const { status, body } = await call(USER, 'tok_SECRET_user');
    expect(status).toBe(500);
    expect(body).toEqual({ error: CODES.INTERNAL_ERROR });
  });

  it('no token, user ID or error message ever reaches a log or a response', async () => {
    const responses = [];
    const scenarios = [
      [USER, 'tok_SECRET_user'], [USER, 'tok_SECRET_other'], [USER, 'tok_SECRET_admin'],
      [USER, 'tok_SECRET_forged'], [USER, null],
    ];
    for (const mode of ['off', 'internal', 'beta', 'on']) {
      vi.stubEnv('CAPTURE_MODE', mode);
      for (const args of scenarios) responses.push(JSON.stringify(await call(...args)));
    }
    vi.stubEnv('CAPTURE_MODE', 'beta');
    checkAdminAccess.mockRejectedValue(new Error(`firestore unavailable for ${USER}`));
    responses.push(JSON.stringify(await call(USER, 'tok_SECRET_user')));

    const output = [...logs, ...responses].join('\n');
    for (const secret of [...Object.keys(TOKENS), 'tok_SECRET_forged', USER, OTHER, ADMIN, 'firestore unavailable']) {
      expect(output, secret).not.toContain(secret);
    }
    expect(logs.length).toBeGreaterThan(0);
  });
});
