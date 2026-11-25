// @vitest-environment node
/**
 * CH-GMAIL-001 — Connect Gmail: gmail-oauth-init, gmail-oauth-callback and
 * gmail-disconnect, end to end against an in-memory Firestore and a mocked
 * Google.
 *
 * Pins the security properties the old flow lacked (it sent the uid as
 * `state` and trusted it): state is random and never the uid, stored only as
 * a hash, bound to the browser that asked for it, single-use, expiring and
 * Gmail-only; the user is taken from a verified ID token, never the body;
 * impersonation and cross-account requests are refused; PKCE is used; the
 * requested scopes are unchanged; a grant without gmail.send is refused; and
 * every outcome redirects to a same-site path rather than rendering a page.
 *
 * Also pins the lifecycle: a successful connect writes the same document
 * every sender reads, a failed attempt leaves an existing connection alone,
 * disconnect is owner-only and idempotent, and a revoked grant (but not a
 * network blip) marks the connection needs_reconnect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import process from 'node:process';

// ─── In-memory Firestore (the subset these functions use) ───────────────────
const store = new Map();
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
function makeRef(path) {
  return {
    path,
    async get() { return snapshot(path); },
    async set(data) { store.set(path, clone(data)); },
    async update(data) {
      if (!store.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
      store.set(path, { ...store.get(path), ...clone(data) });
    },
    async delete() { store.delete(path); },
  };
}
function snapshot(path) {
  const data = store.get(path);
  return { exists: data !== undefined, data: () => clone(data), ref: makeRef(path) };
}
const fakeDb = {
  doc: (path) => makeRef(path),
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => snapshot(ref.path),
      set: (ref, data) => { writes.push(() => store.set(ref.path, clone(data))); },
      delete: (ref) => { writes.push(() => store.delete(ref.path)); },
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  },
};

// tok-<uid> is a valid ID token for <uid>; tok-custom-<uid> an impersonation session.
const verifyIdToken = vi.fn(async (token) => {
  const custom = /^tok-custom-(\w+)$/.exec(token);
  if (custom) return { uid: custom[1], firebase: { sign_in_provider: 'custom' } };
  const m = /^tok-(\w+)$/.exec(token);
  if (!m) throw new Error('bad token');
  return { uid: m[1], firebase: { sign_in_provider: 'password' } };
});
vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken }) },
  db: fakeDb,
}));

const { handler: init } = await import('../../netlify/functions/gmail-oauth-init.js');
const { createGmailOAuthCallbackHandler } = await import('../../netlify/functions/gmail-oauth-callback.js');
const { handler: disconnect } = await import('../../netlify/functions/gmail-disconnect.js');
const oauth = await import('../../netlify/functions/utils/gmailOAuth.js');
const {
  STATE_TTL_MS, BINDING_COOKIE, GMAIL_SCOPES, GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE, USERINFO_EMAIL_SCOPE,
  safeReturnPath, recordGmailRefreshFailure, isRevokedGrant, DEFAULT_RETURN_PATH,
} = oauth;
const { deriveSyncHealth, SYNC_HEALTH } = await import('../utils/gmailSyncHealth.js');

const CLIENT_SECRET = 'google-client-secret-DO-NOT-LEAK';
const REDIRECT_URI = 'https://idynify.com/.netlify/functions/gmail-oauth-callback';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const ALL_SCOPES = GMAIL_SCOPES.join(' ');

// ─── Mock Google (token exchange + userinfo) ────────────────────────────────
let google;
function mockGoogle({ tokens = {}, tokenError = null, info = {}, infoError = null } = {}) {
  google = {
    getToken: vi.fn(async () => {
      if (tokenError) throw tokenError;
      return {
        tokens: {
          access_token: 'ya29.access', refresh_token: '1//refresh', expiry_date: Date.now() + 3_600_000,
          scope: ALL_SCOPES, token_type: 'Bearer', ...tokens,
        },
      };
    }),
    setCredentials: vi.fn(),
  };
  google.info = vi.fn(async () => {
    if (infoError) throw infoError;
    return { email: 'aaron@idynify.com', verified_email: true, ...info };
  });
}
const callback = (event) => createGmailOAuthCallbackHandler({
  db: fakeDb,
  makeOAuthClient: () => google,
  readUserInfo: () => google.info(),
})(event);

// ─── Driving the flow ───────────────────────────────────────────────────────
async function startConnect(uid = 'A', body = {}, token = `tok-${uid}`) {
  const res = await init({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}`, host: 'idynify.com' }, body: JSON.stringify(body) });
  const parsed = JSON.parse(res.body);
  if (res.statusCode !== 200) return { res, parsed };
  const authUrl = new URL(parsed.authUrl);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  return { res, parsed, authUrl, state: authUrl.searchParams.get('state'), cookie };
}

// Pass `code: undefined` to leave the code out (a default parameter would replace it).
async function returnFromGoogle(args) {
  const { state, cookie, extra = {} } = args;
  const code = 'code' in args ? args.code : 'auth-code';
  const query = { ...(state !== undefined && { state }), ...(code !== undefined && { code }), ...extra };
  const res = await callback({ httpMethod: 'GET', queryStringParameters: query, headers: cookie ? { cookie: `other=1; ${cookie}` } : {} });
  const location = new URL(res.headers.Location, 'https://idynify.com');
  return { res, location, outcome: location.searchParams.get('gmail') };
}

const gmailDoc = (uid) => store.get(`users/${uid}/integrations/gmail`);
const statesLeft = () => [...store.keys()].filter((k) => k.startsWith('oauth_states/'));

beforeEach(() => {
  store.clear();
  verifyIdToken.mockClear();
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
  process.env.GOOGLE_REDIRECT_URI = REDIRECT_URI;
  mockGoogle();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ─── init ───────────────────────────────────────────────────────────────────
describe('gmail-oauth-init', () => {
  it('builds Google’s URL with the unchanged scopes, offline access, consent and PKCE', async () => {
    const { res, authUrl } = await startConnect('A');
    expect(res.statusCode).toBe(200);
    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.searchParams.get('scope').split(' ')).toEqual([GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE, USERINFO_EMAIL_SCOPE]);
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    expect(authUrl.searchParams.get('prompt')).toBe('consent');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
  });

  it('never uses the uid as state, and stores only a hash of the state, bound to the user', async () => {
    const uid = 'user_uid_0123456789';
    const { state, authUrl } = await startConnect(uid);
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(state).not.toContain(uid);
    expect(authUrl.toString()).not.toContain(uid);
    expect(authUrl.toString()).not.toContain('|');
    const keys = statesLeft();
    expect(keys).toEqual([`oauth_states/${sha256(state)}`]);
    const record = store.get(keys[0]);
    expect(record).toMatchObject({ provider: 'gmail', uid, returnTo: DEFAULT_RETURN_PATH });
    expect(JSON.stringify(record)).not.toContain(state);
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBe(STATE_TTL_MS);
    // The verifier stays on the server; Google only ever sees its challenge.
    expect(authUrl.toString()).not.toContain(record.codeVerifier);
  });

  it('sets an HttpOnly, Secure, __Host- binding cookie that expires with the state', async () => {
    const { res } = await startConnect('A');
    const cookie = res.headers['Set-Cookie'];
    expect(cookie.startsWith(`${BINDING_COOKIE}=`)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(new RegExp(`Max-Age=${STATE_TTL_MS / 1000}`));
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('keeps a same-site returnTo and replaces anything that could leave the site', async () => {
    await startConnect('A', { returnTo: '/contact-hub?x=1' });
    expect(store.get(statesLeft()[0]).returnTo).toBe('/contact-hub?x=1');
    for (const evil of ['https://evil.com/x', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/ok\nSet-Cookie: x', 42]) {
      store.clear();
      await startConnect('A', { returnTo: evil });
      expect(store.get(statesLeft()[0]).returnTo).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it('requires a valid ID token', async () => {
    expect((await init({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode).toBe(401);
    expect((await init({ httpMethod: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).statusCode).toBe(401);
    expect(statesLeft()).toEqual([]);
  });

  it('still accepts the token in the body, as older clients send it', async () => {
    const res = await init({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: 'A', authToken: 'tok-A' }) });
    expect(res.statusCode).toBe(200);
    expect(store.get(statesLeft()[0]).uid).toBe('A');
  });

  it('refuses a body userId that is not the signed-in user (no admin pass-through)', async () => {
    const { res } = await startConnect('A', { userId: 'B' });
    expect(res.statusCode).toBe(403);
    expect(statesLeft()).toEqual([]);
  });

  it('refuses custom-token (impersonation) sessions', async () => {
    const { res } = await startConnect('A', {}, 'tok-custom-A');
    expect(res.statusCode).toBe(403);
    expect(statesLeft()).toEqual([]);
  });

  it('does not check a plan: a Free (Contact Hub) account can start a connection', async () => {
    store.set('users/FREE', { plan: 'free', email: 'free@example.com' });
    const { res } = await startConnect('FREE');
    expect(res.statusCode).toBe(200);
  });

  it('answers 503 without leaking anything when Google OAuth is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const { res } = await startConnect('A');
    expect(res.statusCode).toBe(503);
    expect(statesLeft()).toEqual([]);
  });

  it('only accepts POST', async () => {
    expect((await init({ httpMethod: 'GET', headers: {} })).statusCode).toBe(405);
  });
});

// ─── callback ───────────────────────────────────────────────────────────────
describe('gmail-oauth-callback — a valid connection', () => {
  it('connects the user who started it, with the same document every sender reads', async () => {
    const { state, cookie } = await startConnect('A');
    const { res, location, outcome } = await returnFromGoogle({ state, cookie });

    expect(res.statusCode).toBe(302);
    expect(outcome).toBe('connected');
    expect(location.searchParams.get('connected')).toBe('true');
    expect(location.pathname + '?tab=' + location.searchParams.get('tab')).toBe(DEFAULT_RETURN_PATH);
    expect(res.headers['Set-Cookie']).toMatch(/Max-Age=0/);

    const doc = gmailDoc('A');
    expect(doc).toMatchObject({
      accessToken: 'ya29.access', refreshToken: '1//refresh', email: 'aaron@idynify.com',
      status: 'connected', scopes: [...GMAIL_SCOPES],
    });
    expect(typeof doc.expiresAt).toBe('number');
    expect(doc.connectedAt).toEqual(doc.updatedAt);
    expect(statesLeft()).toEqual([]);
  });

  it('exchanges the code with the PKCE verifier stored for this attempt', async () => {
    const { state, cookie, authUrl } = await startConnect('A');
    const verifier = store.get(statesLeft()[0]).codeVerifier;
    await returnFromGoogle({ state, cookie });
    expect(google.getToken).toHaveBeenCalledWith({ code: 'auth-code', codeVerifier: verifier });
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authUrl.searchParams.get('code_challenge'));
  });

  it('returns to the page that started the attempt', async () => {
    const { state, cookie } = await startConnect('A', { returnTo: '/scout/cadences/c1' });
    const { location } = await returnFromGoogle({ state, cookie });
    expect(location.pathname).toBe('/scout/cadences/c1');
    expect(location.searchParams.get('gmail')).toBe('connected');
  });

  it('accepts a grant without gmail.readonly: sending still works', async () => {
    mockGoogle({ tokens: { scope: `${GMAIL_SEND_SCOPE} ${USERINFO_EMAIL_SCOPE}` } });
    const { state, cookie } = await startConnect('A');
    expect((await returnFromGoogle({ state, cookie })).outcome).toBe('connected');
    expect(gmailDoc('A').scopes).toEqual([GMAIL_SEND_SCOPE, USERINFO_EMAIL_SCOPE]);
  });

  it('reconnecting replaces the old connection and its stale sync state', async () => {
    store.set('users/A/integrations/gmail', {
      status: 'needs_reconnect', email: 'old@x.com', refreshToken: 'old', lastHistoryId: '999', syncStatus: 'needs_reconnect', authError: 'revoked',
    });
    const { state, cookie } = await startConnect('A');
    await returnFromGoogle({ state, cookie });
    const doc = gmailDoc('A');
    expect(doc.status).toBe('connected');
    expect(doc.refreshToken).toBe('1//refresh');
    expect(doc).not.toHaveProperty('lastHistoryId');
    expect(doc).not.toHaveProperty('authError');
  });

  it('never logs the code, state, tokens or client secret', async () => {
    const logs = [];
    for (const m of ['log', 'warn', 'error']) vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(' ')));
    const { state, cookie } = await startConnect('A');
    await returnFromGoogle({ state, cookie, code: 'SECRET-CODE' });
    const out = logs.join('\n');
    for (const secret of [state, cookie.split('=')[1], 'SECRET-CODE', 'ya29.access', '1//refresh', CLIENT_SECRET]) {
      expect(out).not.toContain(secret);
    }
  });
});

describe('gmail-oauth-callback — rejected attempts', () => {
  const existing = { status: 'connected', email: 'victim@idynify.com', accessToken: 'victim-at', refreshToken: 'victim-rt', lastHistoryId: '42' };

  async function expectRejected(promise, outcome) {
    const { res, outcome: got } = await promise;
    expect(res.statusCode).toBe(302);
    expect(got).toBe(outcome);
    expect(res.headers['Set-Cookie']).toMatch(/Max-Age=0/);
  }

  it('the old attack — state set to the victim’s uid — connects nothing', async () => {
    store.set('users/VICTIM/integrations/gmail', existing);
    await expectRejected(returnFromGoogle({ state: 'VICTIM', cookie: null }), 'invalid_state');
    await expectRejected(returnFromGoogle({ state: 'VICTIM|/hunter', cookie: null }), 'invalid_state');
    expect(gmailDoc('VICTIM')).toEqual(existing);
    expect(google.getToken).not.toHaveBeenCalled();
  });

  it('a manipulated state is refused', async () => {
    const { state, cookie } = await startConnect('A');
    await expectRejected(returnFromGoogle({ state: `${state}x`, cookie }), 'invalid_state');
    await expectRejected(returnFromGoogle({ state: state.slice(0, -1), cookie }), 'invalid_state');
    await expectRejected(returnFromGoogle({ state: undefined, cookie }), 'invalid_state');
    expect(gmailDoc('A')).toBeUndefined();
    expect(google.getToken).not.toHaveBeenCalled();
  });

  it('an expired state is refused and spent', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T12:00:00Z'), toFake: ['Date'] });
    const { state, cookie } = await startConnect('A');
    vi.setSystemTime(Date.now() + STATE_TTL_MS + 1);
    await expectRejected(returnFromGoogle({ state, cookie }), 'expired_state');
    expect(statesLeft()).toEqual([]);
    expect(gmailDoc('A')).toBeUndefined();
  });

  it('a replayed state is refused the second time', async () => {
    const { state, cookie } = await startConnect('A');
    expect((await returnFromGoogle({ state, cookie })).outcome).toBe('connected');
    const first = gmailDoc('A');
    mockGoogle({ info: { email: 'attacker@evil.com' } });
    await expectRejected(returnFromGoogle({ state, cookie }), 'invalid_state');
    expect(gmailDoc('A')).toEqual(first);
    expect(google.getToken).not.toHaveBeenCalled();
  });

  it('cross-account: a valid state carried to another browser is refused and spent', async () => {
    // The victim starts a connection; an attacker who obtains the Google link
    // (state included) completes consent with their own mailbox in their own browser.
    store.set('users/VICTIM/integrations/gmail', existing);
    const { state } = await startConnect('VICTIM');
    mockGoogle({ info: { email: 'attacker@evil.com' } });
    await expectRejected(returnFromGoogle({ state, cookie: null }), 'invalid_state');
    expect(gmailDoc('VICTIM')).toEqual(existing);
    expect(statesLeft()).toEqual([]);
  });

  it('cross-account: one user’s cookie cannot complete another user’s state', async () => {
    const victim = await startConnect('VICTIM');
    const attacker = await startConnect('ATTACKER');
    await expectRejected(returnFromGoogle({ state: victim.state, cookie: attacker.cookie }), 'invalid_state');
    expect(gmailDoc('VICTIM')).toBeUndefined();
    expect(gmailDoc('ATTACKER')).toBeUndefined();
  });

  it('a state issued for another provider (LinkedIn) is refused', async () => {
    const { state, cookie } = await startConnect('A');
    const key = statesLeft()[0];
    store.set(key, { ...store.get(key), provider: 'linkedin' });
    await expectRejected(returnFromGoogle({ state, cookie }), 'invalid_state');
  });

  it('declining on Google’s screen spends the state and changes nothing', async () => {
    store.set('users/A/integrations/gmail', existing);
    const { state, cookie } = await startConnect('A', { returnTo: '/hunter' });
    const { outcome, location } = await returnFromGoogle({ state, cookie, code: undefined, extra: { error: 'access_denied' } });
    expect(outcome).toBe('denied');
    expect(location.pathname).toBe('/hunter');
    expect(statesLeft()).toEqual([]);
    expect(gmailDoc('A')).toEqual(existing);
  });

  it('a grant without gmail.send is refused, leaving an existing connection alone', async () => {
    store.set('users/A/integrations/gmail', existing);
    mockGoogle({ tokens: { scope: `${GMAIL_READONLY_SCOPE} ${USERINFO_EMAIL_SCOPE}` } });
    const { state, cookie } = await startConnect('A');
    await expectRejected(returnFromGoogle({ state, cookie }), 'missing_permission');
    expect(gmailDoc('A')).toEqual(existing);
  });

  it('no refresh token, or a failed exchange, is a token failure', async () => {
    mockGoogle({ tokens: { refresh_token: undefined } });
    let s = await startConnect('A');
    await expectRejected(returnFromGoogle(s), 'token_failed');
    mockGoogle({ tokenError: Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } }) });
    s = await startConnect('A');
    await expectRejected(returnFromGoogle(s), 'token_failed');
    expect(gmailDoc('A')).toBeUndefined();
  });

  it('an unverified or missing Google email is refused', async () => {
    mockGoogle({ info: { verified_email: false } });
    let s = await startConnect('A');
    await expectRejected(returnFromGoogle(s), 'identity_failed');
    mockGoogle({ info: { email: '' } });
    s = await startConnect('A');
    await expectRejected(returnFromGoogle(s), 'identity_failed');
    expect(gmailDoc('A')).toBeUndefined();
  });

  it('a missing code is refused after the state is spent', async () => {
    const { state, cookie } = await startConnect('A');
    await expectRejected(returnFromGoogle({ state, cookie, code: undefined }), 'missing_code');
    expect(statesLeft()).toEqual([]);
  });

  it('never renders a page, so nothing from the request is reflected', async () => {
    const { res } = await returnFromGoogle({ state: '<script>alert(1)</script>', cookie: null, extra: { error: '<img onerror=x>' } });
    expect(res.statusCode).toBe(302);
    expect(res.body).toBe('');
    expect(res.headers.Location).not.toMatch(/[<>]/);
  });
});

// ─── disconnect ─────────────────────────────────────────────────────────────
describe('gmail-disconnect', () => {
  const call = (token, body = {}) => disconnect({ httpMethod: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });

  it('deletes the owner’s connection, tokens included, and is idempotent', async () => {
    store.set('users/A/integrations/gmail', { status: 'connected', refreshToken: 'rt' });
    expect((await call('tok-A')).statusCode).toBe(200);
    expect(gmailDoc('A')).toBeUndefined();
    expect((await call('tok-A')).statusCode).toBe(200);
  });

  it('refuses anyone but the owner', async () => {
    store.set('users/B/integrations/gmail', { status: 'connected', refreshToken: 'rt' });
    expect((await call(null, { userId: 'B' })).statusCode).toBe(401);
    expect((await call('tok-A', { userId: 'B' })).statusCode).toBe(403);
    expect((await call('tok-custom-B', { userId: 'B' })).statusCode).toBe(403);
    expect(gmailDoc('B')).toBeDefined();
  });

  it('then lets the same user connect again', async () => {
    store.set('users/A/integrations/gmail', { status: 'connected', refreshToken: 'old' });
    await call('tok-A');
    const s = await startConnect('A');
    expect((await returnFromGoogle(s)).outcome).toBe('connected');
    expect(gmailDoc('A').refreshToken).toBe('1//refresh');
  });
});

// ─── refresh failures and status ────────────────────────────────────────────
describe('a revoked grant', () => {
  const revoked = Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } });

  it('marks the connection needs_reconnect, so it no longer reads as connected', async () => {
    store.set('users/A/integrations/gmail', { status: 'connected', email: 'a@x.com', refreshToken: 'rt' });
    expect(await recordGmailRefreshFailure(makeRef('users/A/integrations/gmail'), revoked)).toBe(true);
    expect(gmailDoc('A')).toMatchObject({ status: 'needs_reconnect', syncStatus: 'needs_reconnect', authError: 'revoked', email: 'a@x.com' });
    expect(deriveSyncHealth(gmailDoc('A')).status).toBe(SYNC_HEALTH.NEEDS_RECONNECT);
  });

  it('a network error or 5xx changes nothing', async () => {
    const before = { status: 'connected', refreshToken: 'rt' };
    store.set('users/A/integrations/gmail', before);
    for (const err of [new Error('ECONNRESET'), Object.assign(new Error('500'), { response: { status: 500, data: 'oops' } })]) {
      expect(isRevokedGrant(err)).toBe(false);
      expect(await recordGmailRefreshFailure(makeRef('users/A/integrations/gmail'), err)).toBe(false);
    }
    expect(gmailDoc('A')).toEqual(before);
  });

  it('never throws, even if the write fails', async () => {
    await expect(recordGmailRefreshFailure(makeRef('users/NONE/integrations/gmail'), revoked)).resolves.toBe(false);
    await expect(recordGmailRefreshFailure(null, revoked)).resolves.toBe(false);
  });
});

describe('safeReturnPath', () => {
  it('keeps same-site paths and strips leftover outcomes', () => {
    expect(safeReturnPath('/settings?tab=integrations')).toBe('/settings?tab=integrations');
    expect(safeReturnPath('/hunter?gmail=denied&connected=true&tab=x')).toBe('/hunter?tab=x');
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath('/'.padEnd(600, 'a'))).toBe(DEFAULT_RETURN_PATH);
  });
});
