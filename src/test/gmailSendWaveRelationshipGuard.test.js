/**
 * gmail-send-wave.js — the forward-only relationship-state guard on a
 * confirmed send, same shape as gmailSendQuickRelationshipGuard.test.js.
 * Exercises the handler end to end with a fake Firestore and Gmail client.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ docs: {}, sendResults: [] }));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));

vi.mock('firebase-admin/firestore', () => {
  function docRef(path) {
    const ref = {
      path,
      get: async () => ({ exists: h.docs[path] !== undefined, data: () => h.docs[path] }),
      update: async (patch) => { h.docs[path] = { ...(h.docs[path] || {}), ...patch }; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
    ref.firestore = db; // applySendContactUpdate runs its transaction via contactRef.firestore
    return ref;
  }
  function collRef(path) {
    return { doc: (id) => docRef(`${path}/${id}`), add: async () => ({ id: 'log1' }) };
  }
  // No concurrency to simulate in these handler-level tests (that's
  // applySendContactUpdateConcurrency.test.js's job) — a single pass
  // through tx.get/tx.update against the same shared store is enough.
  // tx.update DOES still enforce real Firestore's "fails if the document
  // doesn't exist" — needed for the deleted-recipient test below to be
  // meaningful rather than silently no-op-succeeding.
  const db = {
    collection: (name) => collRef(name),
    runTransaction: async (fn) => fn({
      get: async (ref) => ref.get(),
      update: (ref, patch) => {
        if (h.docs[ref.path] === undefined) {
          const err = new Error(`NOT_FOUND: No document to update: ${ref.path}`);
          err.code = 5;
          throw err;
        }
        h.docs[ref.path] = { ...(h.docs[ref.path] || {}), ...patch };
      },
    }),
  };
  return { getFirestore: () => db, FieldValue: { increment: (n) => ({ __increment: n }) } };
});

let callIdx = 0;
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => ({ users: { messages: { send: async () => h.sendResults[callIdx++] } } }),
  },
}));

vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignature: async () => '',
  appendSignature: (body) => body,
}));

const originalFetch = global.fetch;
const { handler } = await import('../../netlify/functions/gmail-send-wave.js');

const USER_ID = 'u1';
const integPath = () => `users/${USER_ID}/integrations/gmail`;
const docPath = (id) => `users/${USER_ID}/contacts/${id}`;

function makeEvent(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body) };
}

beforeEach(() => {
  h.docs = {};
  h.sendResults = [];
  callIdx = 0;
  h.docs[integPath()] = {
    status: 'connected',
    accessToken: 'tok', refreshToken: 'rtok', expiresAt: Date.now() + 60 * 60 * 1000, email: 'me@idynify.com',
  };
  process.env.FIREBASE_API_KEY = 'test-key';
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/callback';
  global.fetch = vi.fn(async (url) => {
    if (typeof url === 'string' && url.includes('identitytoolkit')) {
      return { ok: true, json: async () => ({ users: [{ localId: USER_ID }] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

afterAll(() => { global.fetch = originalFetch; });

function sendWave(recipients) {
  return handler(makeEvent({
    userId: USER_ID, authToken: 'tok', waveId: 'w1', subject: 'Checking in',
    messageTemplate: 'Hi {{first_name}}', recipients,
  }));
}

describe('gmail-send-wave.js: a confirmed wave send never regresses an established relationship', () => {
  it('a fresh (New) recipient IS marked awaiting_reply', async () => {
    h.docs[docPath('c1')] = { contact_status: 'New', email: 'jane@acme.com' };
    h.sendResults = [{ data: { id: 'msg1', threadId: 'thread1' } }];
    const res = await sendWave([{ contactId: 'c1', email: 'jane@acme.com', firstName: 'Jane' }]);
    expect(res.statusCode).toBe(200);
    expect(h.docs[docPath('c1')].hunter_status).toBe('awaiting_reply');
  });

  it('a recipient already In Conversation is NOT regressed by a wave follow-up in the same thread', async () => {
    h.docs[docPath('c1')] = {
      contact_status: 'In Conversation', hunter_status: 'in_conversation',
      email: 'jane@acme.com', gmail_thread_id: 'thread1',
    };
    h.sendResults = [{ data: { id: 'msg1', threadId: 'thread1' } }];
    const res = await sendWave([{ contactId: 'c1', email: 'jane@acme.com', firstName: 'Jane', existingThreadId: 'thread1' }]);
    expect(res.statusCode).toBe(200);
    expect(h.docs[docPath('c1')].hunter_status).toBe('in_conversation');
    expect(h.docs[docPath('c1')].contact_status).toBe('In Conversation');
  });

  it.each(['Active Customer', 'Past Customer', 'Partner', 'Network', 'Mission Complete'])(
    'a recipient holding the advanced relationship status %s is NOT regressed by a wave send',
    async (status) => {
      h.docs[docPath('c1')] = { contact_status: status, hunter_status: 'awaiting_reply', email: 'jane@acme.com' };
      h.sendResults = [{ data: { id: 'msg1', threadId: 'thread1' } }];
      const res = await sendWave([{ contactId: 'c1', email: 'jane@acme.com', firstName: 'Jane' }]);
      expect(res.statusCode).toBe(200);
      expect(h.docs[docPath('c1')].contact_status).toBe(status);
      expect(h.docs[docPath('c1')].hunter_status).toBe('awaiting_reply');
    }
  );

  it('a mixed wave applies the guard independently per recipient', async () => {
    h.docs[docPath('fresh')] = { contact_status: 'New', email: 'new@acme.com' };
    h.docs[docPath('active')] = { contact_status: 'In Conversation', hunter_status: 'in_conversation', email: 'active@acme.com' };
    h.sendResults = [
      { data: { id: 'm1', threadId: 't1' } },
      { data: { id: 'm2', threadId: 't2' } },
    ];
    const res = await sendWave([
      { contactId: 'fresh', email: 'new@acme.com', firstName: 'New' },
      { contactId: 'active', email: 'active@acme.com', firstName: 'Active' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(h.docs[docPath('fresh')].hunter_status).toBe('awaiting_reply');
    expect(h.docs[docPath('active')].hunter_status).toBe('in_conversation');
  });

  it('a recipient deleted before this handler runs does not fail the overall wave or block other recipients\' updates — Gmail already accepted both messages', async () => {
    // No seed for docPath('gone') — simulates it being deleted between
    // the wave being queued and this recipient's turn in the loop.
    h.docs[docPath('fresh')] = { contact_status: 'New', email: 'new@acme.com' };
    h.sendResults = [
      { data: { id: 'm1', threadId: 't1' } }, // for 'gone'
      { data: { id: 'm2', threadId: 't2' } }, // for 'fresh'
    ];
    const res = await sendWave([
      { contactId: 'gone', email: 'gone@acme.com', firstName: 'Gone' },
      { contactId: 'fresh', email: 'new@acme.com', firstName: 'New' },
    ]);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.sent).toBe(2); // the contact-update failure never touches sentCount — Gmail accepted both
    // The other recipient's update is unaffected by the first one's failure.
    expect(h.docs[docPath('fresh')].hunter_status).toBe('awaiting_reply');
    expect(h.docs[docPath('gone')]).toBeUndefined();
  });
});
