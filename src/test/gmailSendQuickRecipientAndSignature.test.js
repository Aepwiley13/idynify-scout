/**
 * PR 1 (Email Reliability & Sender Identity): two independent fixes in
 * gmail-send-quick.js, covered end-to-end through the exported `handler`.
 *
 *  - toEmail format validation: the primary recipient used to be checked for
 *    presence only. The incident this exists for was a malformed/nonexistent
 *    domain (DNS NXDOMAIN) that sailed through that check and only surfaced
 *    as a bounce minutes later, with the UI still showing Sent.
 *  - Sender-name fallback: nothing in the app prompts a user to configure a
 *    Gmail signature, so the common case sends end in "Best," with no name.
 *    buildFallbackSignatureHtml only fires when the real Gmail signature is
 *    empty, and must never produce two signatures in the same email.
 *
 * The module's Google/Firebase dependencies are faked at the boundary; only
 * this handler's own logic is under test.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const h = vi.hoisted(() => {
  const docs = {};
  const sent = { raw: null };
  return { docs, sent };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => [{}], // non-empty: skips the requireProjectId()-gated init block entirely
  cert: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => {
  function docRef(path) {
    return {
      get: async () => {
        const data = h.docs[path];
        return { exists: data !== undefined, data: () => data };
      },
      update: async (patch) => { h.docs[path] = { ...(h.docs[path] || {}), ...patch }; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }
  function collRef(path) {
    return {
      doc: (id) => docRef(`${path}/${id}`),
      add: async (data) => { h.docs[`${path}/auto_${Object.keys(h.docs).length}`] = data; return { id: 'auto' }; },
    };
  }
  return {
    getFirestore: () => ({ collection: (name) => collRef(name) }),
    FieldValue: {},
  };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        async refreshAccessToken() { return { credentials: {} }; }
      },
    },
    gmail: () => ({
      users: {
        messages: {
          send: vi.fn(async ({ requestBody }) => {
            h.sent.raw = requestBody.raw;
            return { data: { id: 'gmail-msg-1', threadId: 'gmail-thread-1' } };
          }),
        },
      },
    }),
  },
}));

// Real getGmailSignatureHtml is network-bound (sendAs.list); each test controls
// what it returns. appendSignatureHtml and buildFallbackSignatureHtml are the
// REAL implementations — this is the integration point under test.
const gmailSigMock = vi.hoisted(() => ({ signature: '' }));
vi.mock('../../netlify/functions/utils/gmailSignature.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getGmailSignatureHtml: async () => gmailSigMock.signature };
});

const originalFetch = global.fetch;

function decodeRaw() {
  const b64 = h.sent.raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

const { handler } = await import('../../netlify/functions/gmail-send-quick.js');

const USER_ID = 'u1';

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    body: JSON.stringify({
      userId: USER_ID,
      authToken: 'tok',
      toEmail: 'jane@acme.com',
      subject: 'Hi',
      body: 'Hello there.',
      ...overrides,
    }),
  };
}

beforeEach(() => {
  for (const key of Object.keys(h.docs)) delete h.docs[key];
  h.sent.raw = null;
  gmailSigMock.signature = '';
  process.env.FIREBASE_API_KEY = 'test-api-key';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/callback';
  h.docs[`users/${USER_ID}/integrations/gmail`] = {
    status: 'connected',
    accessToken: 'access-tok',
    refreshToken: 'refresh-tok',
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  h.docs[`users/${USER_ID}`] = { displayName: 'Aaron Wiley' };
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ users: [{ localId: USER_ID }] }),
  }));
});

// vi auto-restores mocks between files, but fetch is a global we set
// ourselves — restore it explicitly so later test files aren't affected.
afterAll(() => { global.fetch = originalFetch; });

describe('toEmail format validation', () => {
  it('rejects a malformed recipient address with 400, same error shape as the existing cc check', async () => {
    const res = await handler(makeEvent({ toEmail: 'not-an-email' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'toEmail must be a valid email address' });
    expect(h.sent.raw).toBeNull(); // never reached the send
  });

  it('accepts a valid recipient and sends', async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(h.sent.raw).not.toBeNull();
  });

  it('still validates cc with the same rule (pre-existing behavior, unaffected)', async () => {
    const res = await handler(makeEvent({ cc: 'not-valid' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'cc must be a valid email address' });
  });
});

describe('sender-name fallback signature', () => {
  it('signs with the fallback name when the Gmail account has no signature configured', async () => {
    gmailSigMock.signature = '';
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const raw = decodeRaw();
    expect(raw).toContain('Best,<br>Aaron Wiley');
  });

  it('never applies the fallback when a real Gmail signature exists — no double signature', async () => {
    gmailSigMock.signature = '<div>Aaron W. — Acme Inc.</div>';
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const raw = decodeRaw();
    expect(raw).toContain('Acme Inc.');
    expect(raw).not.toContain('Best,<br>Aaron Wiley');
    // Exactly one signature container, never two
    expect(raw.split('gmail_signature_container').length - 1).toBe(1);
  });

  it('produces no signature block at all when there is neither a Gmail signature nor a resolvable display name', async () => {
    gmailSigMock.signature = '';
    h.docs[`users/${USER_ID}`] = {}; // no displayName, no firstName/lastName/name, no email to derive from
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const raw = decodeRaw();
    expect(raw).not.toContain('gmail_signature_container');
  });
});
