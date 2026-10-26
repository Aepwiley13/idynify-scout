// @vitest-environment node
/**
 * Connect LinkedIn: linkedin-oauth-init, linkedin-oauth-callback and
 * linkedin-disconnect, end to end against an in-memory Firestore and a mocked
 * LinkedIn.
 *
 * Pins the security properties: state is random, never the uid, stored only
 * as a hash, bound to the browser that asked for it, and accepted once —
 * missing, unknown, reused, expired or cross-browser states are refused. Also
 * pins the scopes, the token exchange, the identity checks (nonce, audience,
 * userinfo subject), that no LinkedIn token is stored, that one LinkedIn
 * account maps to one Idynify user, and that every outcome returns to
 * Settings rather than a raw response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';

// ─── In-memory Firestore (the subset the Admin SDK calls here use) ──────────
const store = new Map();
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
function makeRef(path) {
  return {
    path,
    async get() { return snapshot(path); },
    async set(data) { store.set(path, clone(data)); },
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
    writes.forEach(w => w());
    return result;
  },
};

const verifyIdToken = vi.fn(async (token) => {
  const m = /^tok-(\w+)$/.exec(token);
  if (!m) throw new Error('bad token');
  return { uid: m[1] };
});
vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  admin: { auth: () => ({ verifyIdToken }) },
  db: fakeDb,
}));

const { handler: init } = await import('../../netlify/functions/linkedin-oauth-init.js');
const { handler: callback } = await import('../../netlify/functions/linkedin-oauth-callback.js');
const { handler: disconnect } = await import('../../netlify/functions/linkedin-disconnect.js');
const { STATE_TTL_MS, BINDING_COOKIE, LINKEDIN_TOKEN_URL, LINKEDIN_USERINFO_URL } =
  await import('../../netlify/functions/utils/linkedinOAuth.js');

const CLIENT_ID = 'li-client-id';
const CLIENT_SECRET = 'li-client-secret-DO-NOT-LEAK';
const REDIRECT_URI = 'https://idynify.com/.netlify/functions/linkedin-oauth-callback';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ─── Mock LinkedIn ──────────────────────────────────────────────────────────
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;

/** LinkedIn's token and userinfo endpoints for member `sub`. Overrides change one answer. */
function mockLinkedIn({ sub = 'member-1', tokenStatus = 200, claims = {}, userinfo = {}, userinfoStatus = 200 } = {}) {
  const fetchMock = vi.fn(async (url, init) => {
    if (url === LINKEDIN_TOKEN_URL) {
      if (tokenStatus !== 200) return { ok: false, status: tokenStatus, json: async () => ({ error: 'invalid_request' }) };
      const nonce = fetchMock.nonce;
      return {
        ok: true, status: 200,
        json: async () => ({
          access_token: 'li-access-token',
          expires_in: 5184000,
          id_token: idToken({ iss: 'https://www.linkedin.com/oauth', aud: CLIENT_ID, sub, nonce, exp: Math.floor(Date.now() / 1000) + 3600, ...claims }),
        }),
      };
    }
    if (url === LINKEDIN_USERINFO_URL) {
      expect(init.headers.Authorization).toBe('Bearer li-access-token');
      return {
        ok: userinfoStatus === 200, status: userinfoStatus,
        json: async () => ({ sub, name: 'Jimmy Choi', given_name: 'Jimmy', family_name: 'Choi', email: 'jimmy@bridge.com', email_verified: true, picture: 'https://media.licdn.com/p.jpg', locale: { country: 'US', language: 'en' }, ...userinfo }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ─── Driving the flow ───────────────────────────────────────────────────────
async function startConnect(uid = 'A') {
  const res = await init({ httpMethod: 'POST', headers: { authorization: `Bearer tok-${uid}` }, body: '{}' });
  const authUrl = new URL(JSON.parse(res.body).authUrl);
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  return { res, authUrl, state: authUrl.searchParams.get('state'), nonce: authUrl.searchParams.get('nonce'), cookie };
}

// Pass `code: undefined` to leave the code out (a default parameter would replace it).
async function returnFromLinkedIn(args) {
  const { state, cookie, extra = {} } = args;
  const code = 'code' in args ? args.code : 'auth-code';
  const query = { ...(state !== undefined && { state }), ...(code !== undefined && { code }), ...extra };
  const res = await callback({ httpMethod: 'GET', queryStringParameters: query, headers: cookie ? { cookie: `other=1; ${cookie}` } : {} });
  return { res, outcome: new URL(res.headers.Location, 'https://idynify.com').searchParams.get('linkedin') };
}

async function connect(uid, linkedIn = {}) {
  const flow = await startConnect(uid);
  const fetchMock = mockLinkedIn(linkedIn);
  fetchMock.nonce = flow.nonce;
  return { ...flow, fetchMock, ...(await returnFromLinkedIn(flow)) };
}

const stateDocs = () => [...store.keys()].filter(k => k.startsWith('oauth_states/'));

beforeEach(() => {
  store.clear();
  vi.unstubAllGlobals();
  process.env.LINKEDIN_CLIENT_ID = CLIENT_ID;
  process.env.LINKEDIN_CLIENT_SECRET = CLIENT_SECRET;
  process.env.LINKEDIN_REDIRECT_URI = REDIRECT_URI;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ─── Authorization URL ──────────────────────────────────────────────────────

describe('linkedin-oauth-init', () => {
  it('builds the LinkedIn authorization URL with exactly openid, profile and email', async () => {
    const { res, authUrl } = await startConnect('A');
    expect(res.statusCode).toBe(200);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email');
    expect(res.body).not.toContain(CLIENT_SECRET);
  });

  it('state is random, not the uid, stored only as a hash, expiring in ten minutes', async () => {
    const now = Date.now();
    const a = await startConnect('uidAlpha');
    const b = await startConnect('uidAlpha');

    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/);                // 32 random bytes
    expect(a.state).not.toBe(b.state);
    expect(a.state).not.toContain('uidAlpha');
    expect(a.authUrl.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const record = store.get(`oauth_states/${sha256(a.state)}`);
    expect(record).toMatchObject({ provider: 'linkedin', uid: 'uidAlpha' });
    expect(JSON.stringify(record)).not.toContain(a.state);
    expect(new Date(record.expiresAt).getTime() - now).toBeGreaterThanOrEqual(STATE_TTL_MS - 1000);
    expect(new Date(record.expiresAt).getTime() - now).toBeLessThanOrEqual(STATE_TTL_MS + 1000);
  });

  it('ties the state to this browser with a __Host-, HttpOnly, Secure, Lax cookie', async () => {
    const { res } = await startConnect('A');
    const cookie = res.headers['Set-Cookie'];
    expect(cookie.startsWith(`${BINDING_COOKIE}=`)).toBe(true);
    expect(cookie).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  });

  it('acts for the token holder only; a userId in the body is ignored', async () => {
    const res = await init({ httpMethod: 'POST', headers: { authorization: 'Bearer tok-A' }, body: JSON.stringify({ userId: 'B' }) });
    const state = new URL(JSON.parse(res.body).authUrl).searchParams.get('state');
    expect(store.get(`oauth_states/${sha256(state)}`).uid).toBe('A');
  });

  it('refuses a missing or invalid Firebase token, and says when LinkedIn is not configured', async () => {
    expect((await init({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode).toBe(401);
    expect((await init({ httpMethod: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).statusCode).toBe(401);
    expect((await init({ httpMethod: 'GET', headers: {} })).statusCode).toBe(405);
    delete process.env.LINKEDIN_CLIENT_SECRET;
    const res = await init({ httpMethod: 'POST', headers: { authorization: 'Bearer tok-A' }, body: '{}' });
    expect(res.statusCode).toBe(503);
    expect(stateDocs()).toHaveLength(0);
  });
});

// ─── Callback ───────────────────────────────────────────────────────────────

describe('linkedin-oauth-callback', () => {
  it('a valid state: exchanges the code, verifies the identity, saves the integration, returns to Settings', async () => {
    const { res, outcome, fetchMock } = await connect('A');

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe('/settings?tab=integrations&linkedin=connected');
    expect(outcome).toBe('connected');
    expect(res.headers['Set-Cookie']).toMatch(new RegExp(`^${BINDING_COOKIE}=; .*Max-Age=0$`));

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe(LINKEDIN_TOKEN_URL);
    const form = new URLSearchParams(tokenInit.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code', code: 'auth-code', redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    });

    expect(store.get('users/A/integrations/linkedin')).toMatchObject({
      provider: 'linkedin', status: 'connected', linkedinMemberId: 'member-1',
      name: 'Jimmy Choi', email: 'jimmy@bridge.com', emailVerified: true, pictureUrl: 'https://media.licdn.com/p.jpg',
      scopes: ['openid', 'profile', 'email'],
    });
    const saved = store.get('users/A/integrations/linkedin');
    expect(saved.connectedAt).toBe(saved.lastSyncedAt);
    expect(stateDocs()).toHaveLength(0);                         // consumed
  });

  it('stores no LinkedIn token and never touches the Idynify profile', async () => {
    store.set('users/A', { displayName: 'Aaron', email: 'aaron@idynify.com' });
    await connect('A');
    const everything = JSON.stringify([...store.values()]);
    expect(everything).not.toContain('li-access-token');
    expect(everything).not.toContain('id_token');
    expect(everything).not.toContain(CLIENT_SECRET);
    expect(store.get('users/A')).toEqual({ displayName: 'Aaron', email: 'aaron@idynify.com' });
  });

  it('rejects an unknown state without calling LinkedIn', async () => {
    const fetchMock = mockLinkedIn();
    const { cookie } = await startConnect('A');
    const { outcome } = await returnFromLinkedIn({ state: 'made-up-state', cookie });
    expect(outcome).toBe('invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.has('users/A/integrations/linkedin')).toBe(false);
  });

  it('rejects a missing state', async () => {
    const fetchMock = mockLinkedIn();
    const { cookie } = await startConnect('A');
    expect((await returnFromLinkedIn({ state: undefined, cookie })).outcome).toBe('invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an expired state, and consumes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const flow = await startConnect('A');
    const fetchMock = mockLinkedIn();
    vi.setSystemTime(Date.now() + STATE_TTL_MS + 1);
    expect((await returnFromLinkedIn(flow)).outcome).toBe('expired_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateDocs()).toHaveLength(0);
  });

  it('rejects a reused state', async () => {
    const first = await connect('A');
    expect(first.outcome).toBe('connected');
    const again = await returnFromLinkedIn({ state: first.state, cookie: first.cookie, code: 'replayed-code' });
    expect(again.outcome).toBe('invalid_state');
    expect(first.fetchMock).toHaveBeenCalledTimes(2);              // token + userinfo, once
  });

  it('rejects a valid state from a different browser (no or wrong binding cookie), and burns it', async () => {
    const flow = await startConnect('A');
    const fetchMock = mockLinkedIn();
    expect((await returnFromLinkedIn({ state: flow.state, cookie: null })).outcome).toBe('invalid_state');
    expect(stateDocs()).toHaveLength(0);

    const flow2 = await startConnect('A');
    const other = await startConnect('A');
    expect((await returnFromLinkedIn({ state: flow2.state, cookie: other.cookie })).outcome).toBe('invalid_state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the user declining returns "denied", consumes the state, and calls nothing', async () => {
    const flow = await startConnect('A');
    const fetchMock = mockLinkedIn();
    const { outcome } = await returnFromLinkedIn({ ...flow, code: undefined, extra: { error: 'user_cancelled_authorize', error_description: 'The user cancelled' } });
    expect(outcome).toBe('denied');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateDocs()).toHaveLength(0);
    expect(store.has('users/A/integrations/linkedin')).toBe(false);
  });

  it('a missing code returns "missing_code"', async () => {
    const flow = await startConnect('A');
    mockLinkedIn();
    expect((await returnFromLinkedIn({ ...flow, code: undefined })).outcome).toBe('missing_code');
  });

  it('a failed token exchange returns "token_failed" and saves nothing', async () => {
    const { outcome } = await connect('A', { tokenStatus: 400 });
    expect(outcome).toBe('token_failed');
    expect(store.has('users/A/integrations/linkedin')).toBe(false);
  });

  it.each([
    ['a nonce from another attempt', { claims: { nonce: 'someone-elses-nonce' } }],
    ['an ID token with no subject', { claims: { sub: '' } }],
    ['an ID token for another app', { claims: { aud: 'other-client' } }],
    ['an ID token from another issuer', { claims: { iss: 'https://evil.example' } }],
    ['an expired ID token', { claims: { exp: 1 } }],
    ['userinfo naming another member', { userinfo: { sub: 'member-2' } }],
    ['a userinfo failure', { userinfoStatus: 500 }],
  ])('%s returns "identity_failed" and saves nothing', async (_name, linkedIn) => {
    const { outcome } = await connect('A', linkedIn);
    expect(outcome).toBe('identity_failed');
    expect(store.has('users/A/integrations/linkedin')).toBe(false);
  });

  it('an ID token without a nonce is accepted (LinkedIn may not echo it); email_verified may be a string', async () => {
    const { outcome } = await connect('A', { claims: { nonce: undefined }, userinfo: { email_verified: 'true' } });
    expect(outcome).toBe('connected');
    expect(store.get('users/A/integrations/linkedin').emailVerified).toBe(true);
  });

  it('a LinkedIn account already connected to another user is refused', async () => {
    expect((await connect('A', { sub: 'member-1' })).outcome).toBe('connected');
    expect((await connect('B', { sub: 'member-1' })).outcome).toBe('already_connected');
    expect(store.has('users/B/integrations/linkedin')).toBe(false);
    expect(store.get('users/A/integrations/linkedin').status).toBe('connected');
  });

  it('reconnect: the same account refreshes; a different account releases the old one', async () => {
    expect((await connect('A', { sub: 'member-1' })).outcome).toBe('connected');
    expect((await connect('A', { sub: 'member-1', userinfo: { name: 'Jimmy C.' } })).outcome).toBe('connected');
    expect(store.get('users/A/integrations/linkedin').name).toBe('Jimmy C.');

    expect((await connect('A', { sub: 'member-2' })).outcome).toBe('connected');
    expect(store.get('users/A/integrations/linkedin').linkedinMemberId).toBe('member-2');
    expect((await connect('B', { sub: 'member-1' })).outcome).toBe('connected');   // released
  });

  it('every failure lands back on Settings, never a raw function response', async () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    const { res, outcome } = await returnFromLinkedIn({ state: 'x', cookie: null });
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location.startsWith('/settings?tab=integrations&linkedin=')).toBe(true);
    expect(outcome).toBe('not_configured');
  });

  it('never logs the code, state, tokens or client secret', async () => {
    const lines = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a) => lines.push(a.join(' ')));
    const ok = await connect('A');
    await connect('B', { tokenStatus: 400 });
    const logged = lines.join('\n');
    for (const secret of [ok.state, 'auth-code', 'li-access-token', CLIENT_SECRET, ok.nonce, ok.cookie.split('=')[1]]) {
      expect(logged).not.toContain(secret);
    }
  });
});

// ─── Disconnect ─────────────────────────────────────────────────────────────

describe('linkedin-disconnect', () => {
  it('removes the integration and frees the LinkedIn account for another user', async () => {
    await connect('A', { sub: 'member-1' });
    const res = await disconnect({ httpMethod: 'POST', headers: { authorization: 'Bearer tok-A' }, body: '{}' });
    expect(res.statusCode).toBe(200);
    expect(store.has('users/A/integrations/linkedin')).toBe(false);
    expect([...store.keys()].some(k => k.startsWith('linkedin_member_claims/'))).toBe(false);
    expect((await connect('B', { sub: 'member-1' })).outcome).toBe('connected');
  });

  it('acts only for the token holder and needs a valid token', async () => {
    await connect('A');
    expect((await disconnect({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode).toBe(401);
    await disconnect({ httpMethod: 'POST', headers: { authorization: 'Bearer tok-B' }, body: JSON.stringify({ userId: 'A' }) });
    expect(store.get('users/A/integrations/linkedin').status).toBe('connected');
  });

  it('disconnecting when not connected is a no-op success', async () => {
    const res = await disconnect({ httpMethod: 'POST', headers: { authorization: 'Bearer tok-A' }, body: '{}' });
    expect(res.statusCode).toBe(200);
  });
});
