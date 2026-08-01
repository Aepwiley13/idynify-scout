/**
 * barry-approve-send — Sprint 3 Team Alpha
 *
 * The endpoint that actually puts an email in front of a prospect. Tests cover
 * the guarantees the sprint constraints put on it:
 *
 *   - thread continuity is required (missing gmailThreadId → 400, never 500)
 *   - the send is threaded, and reply headers use the RFC Message-ID
 *   - the contact document gains only conversationState/lastOutboundAt/updatedAt
 *   - a Firestore failure after a successful send is not reported as a failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn(async () => ({ data: { id: 'sent_1', threadId: 'thr_1' } }));
const messagesGetMock = vi.fn(async () => ({
  data: { payload: { headers: [{ name: 'Message-ID', value: '<orig@mail.acme.com>' }] } },
}));

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
          send: (...args) => sendMock(...args),
          get: (...args) => messagesGetMock(...args),
        },
      },
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

const verifyAuthToken = vi.fn(async () => ({ tokenUserId: 'user_1' }));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: (...args) => verifyAuthToken(...args),
}));
vi.mock('../../netlify/functions/utils/extractAuthToken.js', () => ({
  extractAuthToken: (event) => {
    const header = event.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    try { return JSON.parse(event.body).authToken || null; } catch { return null; }
  },
}));
vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignature: async () => null,
  appendSignature: (body) => body,
}));

// ── Fake Firestore ───────────────────────────────────────────────────────────
const state = {
  commRecord: {
    exists: true,
    data: {
      idynifyUserId: 'user_1',
      subject: 'Intro call',
      gmailMessageId: 'gmail_inbound_1',
      gmailThreadId: 'thr_1',
    },
  },
  gmailIntegration: {
    exists: true,
    data: { status: 'connected', accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000 },
  },
  contactUpdates: [],
  draftUpdates: [],
  timelineAdds: [],
  failWrites: false,
};

function makeContactRef() {
  return {
    update: async (patch) => {
      if (state.failWrites) throw new Error('firestore unavailable');
      state.contactUpdates.push(patch);
    },
    collection: (name) => {
      if (name === 'barry_drafts') {
        return {
          doc: () => ({
            update: async (patch) => {
              if (state.failWrites) throw new Error('firestore unavailable');
              state.draftUpdates.push(patch);
            },
          }),
        };
      }
      return {
        add: async (doc) => {
          if (state.failWrites) throw new Error('firestore unavailable');
          state.timelineAdds.push(doc);
        },
      };
    },
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: {
    collection: (name) => {
      if (name === 'communication_records') {
        return {
          doc: () => ({
            get: async () => ({
              exists: state.commRecord.exists,
              data: () => state.commRecord.data,
            }),
          }),
        };
      }
      // users/{id}...
      return {
        doc: () => ({
          collection: (sub) => {
            if (sub === 'integrations') {
              return {
                doc: () => ({
                  get: async () => ({
                    exists: state.gmailIntegration.exists,
                    data: () => state.gmailIntegration.data,
                    ref: { update: async () => {} },
                  }),
                }),
              };
            }
            return { doc: () => makeContactRef() };
          },
        }),
      };
    },
  },
  admin: {},
}));

import { handler, buildReplySubject, buildReplyMime } from '../../netlify/functions/barry-approve-send.js';

const validBody = {
  userId: 'user_1',
  authToken: 'token',
  contactId: 'contact_1',
  messageRecordId: 'rec_1',
  bodyText: 'Thursday works — sending an invite.',
  gmailThreadId: 'thr_1',
  recipientEmail: 'jane@acme.com',
};

const post = (body, headers = { authorization: 'Bearer token' }) =>
  handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) });

const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/callback';
  sendMock.mockResolvedValue({ data: { id: 'sent_1', threadId: 'thr_1' } });
  messagesGetMock.mockResolvedValue({
    data: { payload: { headers: [{ name: 'Message-ID', value: '<orig@mail.acme.com>' }] } },
  });
  verifyAuthToken.mockResolvedValue({ tokenUserId: 'user_1' });
  state.commRecord = {
    exists: true,
    data: {
      idynifyUserId: 'user_1',
      subject: 'Intro call',
      gmailMessageId: 'gmail_inbound_1',
      gmailThreadId: 'thr_1',
    },
  };
  state.gmailIntegration = {
    exists: true,
    data: { status: 'connected', accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000 },
  };
  state.contactUpdates = [];
  state.draftUpdates = [];
  state.timelineAdds = [];
  state.failWrites = false;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildReplySubject', () => {
  it('adds a Re: prefix', () => {
    expect(buildReplySubject('Intro call')).toBe('Re: Intro call');
  });

  it('does not double-prefix an existing reply subject', () => {
    expect(buildReplySubject('Re: Intro call')).toBe('Re: Intro call');
    expect(buildReplySubject('RE:  Intro call')).toBe('RE:  Intro call');
  });

  it('falls back when there is no subject', () => {
    expect(buildReplySubject('')).toBe('Re: (no subject)');
    expect(buildReplySubject(null)).toBe('Re: (no subject)');
  });

  it('strips newlines so a subject cannot inject headers', () => {
    expect(buildReplySubject('Hi\r\nBcc: evil@example.com')).toBe('Re: Hi Bcc: evil@example.com');
  });
});

describe('buildReplyMime', () => {
  it('includes both threading headers when a Message-ID is known', () => {
    const mime = buildReplyMime({
      toEmail: 'jane@acme.com',
      subject: 'Re: Intro call',
      bodyText: 'Hello',
      inReplyTo: '<orig@mail.acme.com>',
    });
    expect(mime).toContain('In-Reply-To: <orig@mail.acme.com>');
    expect(mime).toContain('References: <orig@mail.acme.com>');
    expect(mime).toContain('To: jane@acme.com');
  });

  it('omits the threading headers rather than faking them', () => {
    const mime = buildReplyMime({
      toEmail: 'jane@acme.com',
      subject: 'Re: Intro call',
      bodyText: 'Hello',
      inReplyTo: null,
    });
    expect(mime).not.toContain('In-Reply-To');
    expect(mime).not.toContain('References');
  });

  it('converts blank-line-separated text into paragraphs', () => {
    const mime = buildReplyMime({
      toEmail: 'a@b.com', subject: 's', bodyText: 'One\n\nTwo\nThree', inReplyTo: null,
    });
    expect(mime).toContain('<p>One</p><p>Two<br>Three</p>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('request validation', () => {
  it('rejects a missing gmailThreadId with 400, not 500', async () => {
    const res = await post({ ...validBody, gmailThreadId: undefined });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/thread/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects an empty body text', async () => {
    const res = await post({ ...validBody, bodyText: '   ' });
    expect(res.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each([['userId'], ['contactId'], ['messageRecordId'], ['recipientEmail']])(
    'rejects a missing %s',
    async (field) => {
      const res = await post({ ...validBody, [field]: undefined });
      expect(res.statusCode).toBe(400);
      expect(sendMock).not.toHaveBeenCalled();
    }
  );

  it('rejects a non-POST method', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, body: '{}' });
    expect(res.statusCode).toBe(405);
  });

  it('answers the CORS preflight', async () => {
    const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await post(
      { ...validBody, authToken: undefined },
      {}
    );
    expect(res.statusCode).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a token that does not match the user', async () => {
    verifyAuthToken.mockRejectedValue(new Error('Token does not match user ID'));
    const res = await post(validBody);
    expect(res.statusCode).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses to reply on another user\'s communication record', async () => {
    state.commRecord.data.idynifyUserId = 'someone_else';
    const res = await post(validBody);
    expect(res.statusCode).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('404s when the communication record is gone', async () => {
    state.commRecord.exists = false;
    const res = await post(validBody);
    expect(res.statusCode).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('reports a disconnected Gmail account without throwing', async () => {
    state.gmailIntegration.data.status = 'disconnected';
    const res = await post(validBody);
    expect(res.statusCode).toBe(400);
    expect(parse(res).code).toBe('GMAIL_NOT_CONNECTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sending', () => {
  it('sends into the original thread', async () => {
    const res = await post(validBody);
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({
      success: true,
      gmailMessageId: 'sent_1',
      gmailThreadId: 'thr_1',
    });
    expect(sendMock.mock.calls[0][0].requestBody.threadId).toBe('thr_1');
  });

  it('threads on the RFC Message-ID, not the Gmail API id', async () => {
    await post(validBody);
    const raw = sendMock.mock.calls[0][0].requestBody.raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(mime).toContain('In-Reply-To: <orig@mail.acme.com>');
    expect(mime).not.toContain('In-Reply-To: gmail_inbound_1');
  });

  it('still sends when the Message-ID header cannot be read', async () => {
    messagesGetMock.mockRejectedValue(new Error('404'));
    const res = await post(validBody);
    expect(res.statusCode).toBe(200);
    const mime = Buffer.from(sendMock.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf-8');
    expect(mime).not.toContain('In-Reply-To');
    expect(sendMock.mock.calls[0][0].requestBody.threadId).toBe('thr_1');
  });

  it('sends the body it was given, not the stored draft', async () => {
    await post({ ...validBody, bodyText: 'A user-edited reply.' });
    const mime = Buffer.from(sendMock.mock.calls[0][0].requestBody.raw, 'base64url').toString('utf-8');
    expect(mime).toContain('A user-edited reply.');
  });

  it('surfaces a Gmail rejection as 502 without writing anything', async () => {
    sendMock.mockRejectedValue(new Error('Invalid thread'));
    const res = await post(validBody);
    expect(res.statusCode).toBe(502);
    expect(state.contactUpdates).toHaveLength(0);
    expect(state.draftUpdates).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Firestore updates', () => {
  it('marks the draft sent', async () => {
    await post(validBody);
    expect(state.draftUpdates[0]).toMatchObject({
      approvalStatus: 'sent',
      draftStatus: 'sent',
      sentMessageId: 'sent_1',
    });
  });

  it('advances conversationState to waiting_on_contact', async () => {
    await post(validBody);
    expect(state.contactUpdates[0]).toMatchObject({
      conversationState: 'waiting_on_contact',
    });
  });

  it('writes only the three permitted contact fields', async () => {
    await post(validBody);
    expect(Object.keys(state.contactUpdates[0]).sort()).toEqual([
      'conversationState', 'lastOutboundAt', 'updatedAt',
    ]);
  });

  it('never touches stage, brigade, icpScore, name or company', async () => {
    await post(validBody);
    for (const patch of state.contactUpdates) {
      for (const forbidden of ['stage', 'brigade', 'icpScore', 'name', 'company_name']) {
        expect(patch).not.toHaveProperty(forbidden);
      }
    }
  });

  it('writes a reply_sent timeline event', async () => {
    await post({ ...validBody, bodyText: 'Short reply body.' });
    expect(state.timelineAdds[0]).toMatchObject({
      eventType: 'reply_sent',
      direction: 'outbound',
      source: 'barry_approved',
      subject: 'Re: Intro call',
      preview: 'Short reply body.',
      messageRecordId: 'rec_1',
    });
  });

  it('reports success with a warning when the email sent but Firestore failed', async () => {
    state.failWrites = true;
    const res = await post(validBody);
    // The mail is already gone — telling the user it failed makes them send twice.
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ success: true, gmailMessageId: 'sent_1' });
    expect(parse(res).warning).toMatch(/could not be updated/i);
  });
});
