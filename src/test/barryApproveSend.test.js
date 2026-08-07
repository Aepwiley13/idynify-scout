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
 *   - the same reply is never sent twice (P0A / defect A1)
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
  FieldValue: { serverTimestamp: () => '__ts__', delete: () => '__delete__' },
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
  // The draft the send claims before touching Gmail. `approvalStatus` is what
  // makes a second click a no-op instead of a second email.
  draft: {
    exists: true,
    data: { approvalStatus: 'awaiting_user' },
  },
  contactUpdates: [],
  draftUpdates: [],
  timelineAdds: [],
  failWrites: false,
  // Fails only the contact/timeline writes, leaving draft writes working —
  // the partial outage that would otherwise strand a claim.
  failContactWrites: false,
};

function makeDraftRef() {
  return {
    get: async () => ({
      exists: state.draft.exists,
      // A copy, like a real snapshot. Handing back the live object would let a
      // write inside a transaction retroactively change what the read saw.
      data: () => ({ ...state.draft.data }),
    }),
    update: async (patch) => {
      if (state.failWrites) throw new Error('firestore unavailable');
      state.draftUpdates.push(patch);
      // Mirror the write back so a follow-up claim sees the new status, the
      // way a real Firestore would.
      Object.assign(state.draft.data, patch);
    },
  };
}

function makeContactRef() {
  return {
    update: async (patch) => {
      if (state.failWrites || state.failContactWrites) throw new Error('firestore unavailable');
      state.contactUpdates.push(patch);
    },
    collection: (name) => {
      if (name === 'barry_drafts') {
        return { doc: () => makeDraftRef() };
      }
      return {
        add: async (doc) => {
          if (state.failWrites || state.failContactWrites) throw new Error('firestore unavailable');
          state.timelineAdds.push(doc);
        },
      };
    },
  };
}

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: {
    // Writes buffer and apply at commit, like a real transaction — so a write
    // that fails throws out of runTransaction rather than vanishing into an
    // unhandled rejection. Contention itself is covered by driving
    // `state.draft` to the contended status directly.
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: (ref) => ref.get(),
        update: (ref, patch) => { writes.push([ref, patch]); },
      });
      for (const [ref, patch] of writes) await ref.update(patch);
      return result;
    },
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
  state.draft = { exists: true, data: { approvalStatus: 'awaiting_user' } };
  state.failContactWrites = false;
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

  it('surfaces a Gmail rejection as 502 without recording an outcome', async () => {
    sendMock.mockRejectedValue(new Error('Invalid thread'));
    const res = await post(validBody);
    expect(res.statusCode).toBe(502);
    expect(state.contactUpdates).toHaveLength(0);
    expect(state.timelineAdds).toHaveLength(0);
    // The draft is written twice — claimed, then handed back — but never
    // recorded as sent. Claim bookkeeping is not an outcome.
    expect(state.draft.data.approvalStatus).toBe('awaiting_user');
    expect(state.draftUpdates.some((p) => p.approvalStatus === 'sent')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Firestore updates', () => {
  it('marks the draft sent', async () => {
    await post(validBody);
    // draftUpdates[0] is the pre-send claim; the outcome is the last write.
    expect(state.draftUpdates.at(-1)).toMatchObject({
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
    state.failContactWrites = true;
    const res = await post(validBody);
    // The mail is already gone — telling the user it failed makes them send twice.
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ success: true, gmailMessageId: 'sent_1' });
    expect(parse(res).warning).toMatch(/could not be updated/i);
  });

  it('refuses to send at all when the claim cannot be written', async () => {
    // If Firestore is unavailable the send cannot be made idempotent, and an
    // un-guarded send is exactly the defect this endpoint had. Refuse instead.
    state.failWrites = true;
    const res = await post(validBody);

    expect(sendMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(parse(res).error).toMatch(/lock the draft/i);
  });
});

// ── Send-once guarantee (P0A / defect A1) ────────────────────────────────────
//
// Sending is irreversible, so the draft is claimed in a transaction before
// Gmail is called. These tests are the reason that claim exists: without it,
// two clicks put two emails in front of the same prospect.

describe('send-once guarantee', () => {
  it('claims the draft before calling Gmail', async () => {
    await post(validBody);
    // The claim must be the FIRST write, and it must land before the send.
    expect(state.draftUpdates[0]).toMatchObject({ approvalStatus: 'sending' });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a second time when the draft is already sent', async () => {
    state.draft.data = { approvalStatus: 'sent', sentMessageId: 'sent_1', sentThreadId: 'thr_1' };
    const res = await post(validBody);

    expect(sendMock).not.toHaveBeenCalled();
    // A duplicate click is not a user error — report the original send so the
    // UI settles instead of showing a failure and inviting another attempt.
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({
      success: true,
      alreadySent: true,
      gmailMessageId: 'sent_1',
    });
  });

  it('refuses a send that is already in flight', async () => {
    state.draft.data = { approvalStatus: 'sending', sendingStartedAt: Date.now() };
    const res = await post(validBody);

    expect(sendMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(parse(res).code).toBe('SEND_IN_PROGRESS');
  });

  it('reclaims a stale in-flight claim so a crash cannot strand the draft', async () => {
    // Older than STALE_CLAIM_MS — the invocation that claimed it never finished.
    state.draft.data = {
      approvalStatus: 'sending',
      sendingStartedAt: Date.now() - 10 * 60 * 1000,
    };
    const res = await post(validBody);

    expect(res.statusCode).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('hands the claim back when Gmail rejects the send', async () => {
    sendMock.mockRejectedValueOnce(new Error('rate limited'));
    const res = await post(validBody);

    expect(res.statusCode).toBe(502);
    // Nothing left the building, so the user must be able to try again.
    expect(state.draft.data.approvalStatus).toBe('awaiting_user');
  });

  it('hands the claim back when Gmail is not connected', async () => {
    state.gmailIntegration = { exists: true, data: { status: 'disconnected' } };
    const res = await post(validBody);

    expect(res.statusCode).toBe(400);
    expect(state.draft.data.approvalStatus).toBe('awaiting_user');
  });

  it('still marks the draft sent when the contact write fails after sending', async () => {
    // A partial outage: the mail is gone and the contact update fails. If the
    // draft were left at "sending", the stale-claim window would eventually let
    // a retry send the very same reply a second time.
    state.failContactWrites = true;
    const res = await post(validBody);

    expect(res.statusCode).toBe(200);
    expect(parse(res).warning).toMatch(/could not be updated/i);
    expect(state.draft.data.approvalStatus).toBe('sent');
  });

  it('still sends when no stored draft exists', async () => {
    // Not every reply has a draft document behind it. Nothing to claim, and
    // nothing that could be double-sent from it.
    state.draft = { exists: false, data: {} };
    const res = await post(validBody);

    expect(res.statusCode).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
