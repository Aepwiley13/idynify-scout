/**
 * gmail-send-quick.js — the forward-only relationship-state guard on a
 * confirmed send. Not a re-test of MIME construction (gmailSendQuick.test.js
 * covers that) — this exercises the handler end to end, with a fake
 * Firestore and Gmail client, to confirm hunter_status is included in the
 * contact update only when sendShouldMarkAwaitingReply allows it.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ docs: {}, sendResult: { data: { id: 'msg1', threadId: 'thread1' } } }));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));

vi.mock('firebase-admin/firestore', () => {
  function docRef(path) {
    return {
      get: async () => ({ exists: h.docs[path] !== undefined, data: () => h.docs[path] }),
      update: async (patch) => { h.docs[path] = { ...(h.docs[path] || {}), ...patch }; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }
  function collRef(path) {
    return { doc: (id) => docRef(`${path}/${id}`), add: async () => ({ id: 'log1' }) };
  }
  return { getFirestore: () => ({ collection: (name) => collRef(name) }), FieldValue: { increment: (n) => ({ __increment: n }) } };
});

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => ({ users: { messages: { send: async () => h.sendResult } } }),
  },
}));

vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignatureHtml: () => null,
  appendSignatureHtml: (body) => body,
  resolveFallbackSignOff: (bodyText) => ({ bodyText, signatureHtml: '' }),
}));

const originalFetch = global.fetch;
const { handler } = await import('../../netlify/functions/gmail-send-quick.js');

const USER_ID = 'u1';
const CONTACT_ID = 'c1';
const integPath = () => `users/${USER_ID}/integrations/gmail`;
const docPath = () => `users/${USER_ID}/contacts/${CONTACT_ID}`;

function makeEvent(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body) };
}

beforeEach(() => {
  h.docs = {};
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

function send(contactId, existingThreadId) {
  return handler(makeEvent({
    userId: USER_ID, authToken: 'tok', toEmail: 'jane@acme.com', toName: 'Jane',
    subject: 'Checking in', body: 'Hello', contactId, existingThreadId,
  }));
}

describe('gmail-send-quick.js: a confirmed send never regresses an established relationship', () => {
  it('a fresh (New) contact IS marked awaiting_reply by a send', async () => {
    h.docs[docPath()] = { contact_status: 'New' };
    const res = await send(CONTACT_ID);
    expect(res.statusCode).toBe(200);
    expect(h.docs[docPath()].hunter_status).toBe('awaiting_reply');
  });

  it('a contact already In Conversation is NOT regressed by a follow-up send within the same thread', async () => {
    h.docs[docPath()] = { contact_status: 'In Conversation', hunter_status: 'in_conversation', gmail_thread_id: 'thread1' };
    const res = await send(CONTACT_ID, 'thread1');
    expect(res.statusCode).toBe(200);
    expect(h.docs[docPath()].hunter_status).toBe('in_conversation');
    expect(h.docs[docPath()].contact_status).toBe('In Conversation');
  });

  it.each(['Active Customer', 'Past Customer', 'Partner', 'Network', 'Mission Complete'])(
    'a contact holding the advanced relationship status %s is NOT regressed by a send',
    async (status) => {
      h.docs[docPath()] = { contact_status: status, hunter_status: 'awaiting_reply' };
      const res = await send(CONTACT_ID);
      expect(res.statusCode).toBe(200);
      expect(h.docs[docPath()].contact_status).toBe(status);
      // hunter_status is left exactly as it was — the guard omits the key
      // entirely rather than writing a value that could disagree with it.
      expect(h.docs[docPath()].hunter_status).toBe('awaiting_reply');
    }
  );

  it('other send-time fields (gmail_last_message_id, last_sent_at, gmail_thread_id) are still updated even when hunter_status is withheld', async () => {
    h.docs[docPath()] = { contact_status: 'In Conversation', hunter_status: 'in_conversation' };
    await send(CONTACT_ID); // no existingThreadId — a fresh thread
    const doc = h.docs[docPath()];
    expect(doc.gmail_last_message_id).toBe('msg1');
    expect(doc.gmail_thread_id).toBe('thread1');
    expect(doc.last_sent_at).toBeTruthy();
    expect(doc.hunter_status).toBe('in_conversation'); // still preserved
  });
});
