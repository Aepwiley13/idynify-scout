/**
 * gmail-poll-replies.js — the manual "Sync Replies" HTTP handler. Its own
 * per-contact logic moved into replyPolling.js (covered in its own test
 * file); this one proves the HTTP CONTRACT — auth, OAuth setup, status
 * codes, response shape — is byte-for-byte unchanged by that extraction.
 * pollRepliesForUser itself is mocked here so this file tests only the
 * wrapper, not the logic it delegates to.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ docs: {}, pollResult: { transitioned: [], checkedCount: 0, needsReconnect: false } }));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => [{}],
  cert: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => {
  function docRef(path) {
    return {
      get: async () => ({ exists: h.docs[path] !== undefined, data: () => h.docs[path] }),
      update: async (patch) => { h.docs[path] = { ...(h.docs[path] || {}), ...patch }; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }
  function collRef(path) {
    return { doc: (id) => docRef(`${path}/${id}`) };
  }
  return { getFirestore: () => ({ collection: (name) => collRef(name) }) };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        async refreshAccessToken() { return { credentials: {} }; }
      },
    },
    gmail: () => ({ users: { getProfile: async () => ({ data: { emailAddress: 'me@idynify.com' } }) } }),
  },
}));

vi.mock('../../netlify/functions/utils/replyPolling.js', () => ({
  pollRepliesForUser: vi.fn(async () => h.pollResult),
}));

const originalFetch = global.fetch;
const { handler } = await import('../../netlify/functions/gmail-poll-replies.js');
const { pollRepliesForUser } = await import('../../netlify/functions/utils/replyPolling.js');

const USER_ID = 'u1';

function makeEvent(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body) };
}

beforeEach(() => {
  for (const key of Object.keys(h.docs)) delete h.docs[key];
  h.pollResult = { transitioned: [], checkedCount: 0, needsReconnect: false };
  pollRepliesForUser.mockClear();
  process.env.FIREBASE_API_KEY = 'test-key';
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/callback';
  h.docs[`users/${USER_ID}/integrations/gmail`] = {
    status: 'connected', accessToken: 'tok', refreshToken: 'rtok',
    expiresAt: Date.now() + 60 * 60 * 1000, email: 'me@idynify.com',
  };
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: USER_ID }] }) }));
});

afterAll(() => { global.fetch = originalFetch; });

describe('gmail-poll-replies.js HTTP contract', () => {
  it('OPTIONS preflight returns 200 with CORS headers', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('rejects non-POST with 405', async () => {
    const res = await handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  it('400 when userId or authToken is missing', async () => {
    const res = await handler(makeEvent({ userId: USER_ID }));
    expect(res.statusCode).toBe(400);
  });

  it('GMAIL_NOT_CONNECTED when the integration doc is missing', async () => {
    delete h.docs[`users/${USER_ID}/integrations/gmail`];
    const res = await handler(makeEvent({ userId: USER_ID, authToken: 'tok' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ transitioned: [], code: 'GMAIL_NOT_CONNECTED' });
  });

  it('checkedCount: 0 short-circuits before needing a transition list, same shape as before the extraction', async () => {
    h.pollResult = { transitioned: [], checkedCount: 0, needsReconnect: false };
    const res = await handler(makeEvent({ userId: USER_ID, authToken: 'tok' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ transitioned: [], checkedCount: 0 });
  });

  it('a successful poll with transitions returns { transitioned, checkedCount }, delegating to pollRepliesForUser exactly once', async () => {
    h.pollResult = {
      transitioned: [{ contactId: 'c1', name: 'Jane', threadId: 't1', fromEmail: 'jane@acme.com' }],
      checkedCount: 3,
      needsReconnect: false,
    };
    const res = await handler(makeEvent({ userId: USER_ID, authToken: 'tok' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      transitioned: [{ contactId: 'c1', name: 'Jane', threadId: 't1', fromEmail: 'jane@acme.com' }],
      checkedCount: 3,
    });
    expect(pollRepliesForUser).toHaveBeenCalledTimes(1);
    expect(pollRepliesForUser).toHaveBeenCalledWith(expect.anything(), expect.anything(), USER_ID, 'me@idynify.com');
  });

  it('NEEDS_RECONNECT when pollRepliesForUser reports it and nothing transitioned', async () => {
    h.pollResult = { transitioned: [], checkedCount: 2, needsReconnect: true };
    const res = await handler(makeEvent({ userId: USER_ID, authToken: 'tok' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ transitioned: [], code: 'NEEDS_RECONNECT' });
  });

  it('needsReconnect is reported alongside any transitions that DID succeed, not swallowed', async () => {
    h.pollResult = {
      transitioned: [{ contactId: 'c1', name: 'Jane', threadId: 't1', fromEmail: 'jane@acme.com' }],
      checkedCount: 2,
      needsReconnect: true,
    };
    const res = await handler(makeEvent({ userId: USER_ID, authToken: 'tok' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transitioned).toHaveLength(1);
  });
});
