/**
 * PR B — Scheduled follow-up protection.
 *
 * process-scheduled-engagements.js used to send a queued follow-up
 * unconditionally, using only the contact snapshot captured when the
 * engagement was queued — with no re-check of whether the contact had
 * since replied. isSendSuppressed/checkSendSuppressed close that race by
 * re-reading the contact's CURRENT state immediately before the Gmail
 * send. Covers both send sites in this file: the single scheduled
 * engagement, and the per-recipient loop inside a scheduled wave.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));

const h = vi.hoisted(() => ({ docs: {}, sentRaws: [], throwOnGet: new Set() }));

vi.mock('firebase-admin/firestore', () => {
  function docRef(path) {
    const self = {
      id: path.split('/').pop(),
      path,
      get: async () => {
        if (h.throwOnGet.has(path)) throw new Error('simulated transient Firestore error');
        return { exists: h.docs[path] !== undefined, data: () => h.docs[path], ref: self };
      },
      update: async (patch) => { h.docs[path] = { ...(h.docs[path] || {}), ...flatten(patch) }; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
    return self;
  }
  // Firestore dot-path updates ('stats.sent') merge into a nested field —
  // flatten them the same way so assertions can read contact.stats.sent.
  function flatten(patch) {
    const out = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key.includes('.')) {
        const [outer, inner] = key.split('.');
        out[outer] = { ...(out[outer] || {}), [inner]: value };
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  function collRef(path, filters = []) {
    const listChildren = () => {
      const prefix = `${path}/`;
      return Object.keys(h.docs)
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .filter((k) => {
          const d = h.docs[k] || {};
          return filters.every(([field, op, value]) => {
            if (op === '==') return d[field] === value;
            if (op === '<=') return d[field] <= value;
            return true;
          });
        });
    };
    return {
      doc: (id) => docRef(`${path}/${id}`),
      // Chainable: where(...).where(...).get() — matches real Firestore's query builder.
      where: (field, op, value) => collRef(path, [...filters, [field, op, value]]),
      get: async () => ({ docs: listChildren().map((k) => ({ id: k.slice(path.length + 1), ref: docRef(k), data: () => ({ ...h.docs[k] }) })) }),
      add: async (data) => { const ref = docRef(`${path}/auto_${Object.keys(h.docs).length}`); h.docs[ref.path] = data; return ref; },
    };
  }
  return {
    getFirestore: () => ({ collection: (name) => collRef(name) }),
    FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
  };
});

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} async refreshAccessToken() { return { credentials: {} }; } } },
    gmail: () => ({
      users: {
        messages: {
          send: vi.fn(async ({ requestBody }) => {
            h.sentRaws.push(requestBody.raw);
            return { data: { id: `msg_${h.sentRaws.length}`, threadId: `thread_${h.sentRaws.length}` } };
          }),
        },
      },
    }),
  },
}));

vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignature: async () => '',
  appendSignature: (body) => body,
}));
vi.mock('../../netlify/functions/utils/timelineWrite.js', () => ({
  writeTimelineEvent: vi.fn(async () => ({ ok: true })),
  ACTORS: { USER: 'user', CONTACT: 'contact' },
}));
vi.mock('../../netlify/functions/utils/alertOps.js', () => ({ alertOps: vi.fn(async () => {}) }));
vi.mock('../../netlify/functions/utils/engagementPromotion.js', () => ({
  engagementPromotionPatch: async () => ({}),
}));

const USER_ID = 'u1';
const {
  processScheduledEngagements, isSendSuppressed,
} = await import('../../netlify/functions/process-scheduled-engagements.js');

function contactPath(id) { return `users/${USER_ID}/contacts/${id}`; }
function engagementPath(id) { return `users/${USER_ID}/scheduledEngagements/${id}`; }
function wavePath(id) { return `users/${USER_ID}/waves/${id}`; }

beforeEach(() => {
  for (const key of Object.keys(h.docs)) delete h.docs[key];
  h.sentRaws.length = 0;
  h.throwOnGet.clear();
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/callback';
  h.docs[`users/${USER_ID}`] = {};
  h.docs[`users/${USER_ID}/integrations/gmail`] = {
    status: 'connected', accessToken: 'tok', refreshToken: 'rtok', expiresAt: Date.now() + 60 * 60 * 1000,
  };
});

afterAll(() => { delete process.env.FIREBASE_PROJECT_ID; });

describe('isSendSuppressed', () => {
  it('returns null for an ordinary eligible contact', () => {
    expect(isSendSuppressed({ hunter_status: 'awaiting_reply' })).toBeNull();
  });

  it('returns contact_deleted for a missing contact', () => {
    expect(isSendSuppressed(null)).toEqual({ reason: 'contact_deleted' });
    expect(isSendSuppressed(undefined)).toEqual({ reason: 'contact_deleted' });
  });

  it('returns contact_replied once hunter_status is in_conversation', () => {
    expect(isSendSuppressed({ hunter_status: 'in_conversation' })).toEqual({ reason: 'contact_replied' });
  });

  it('returns contact_bounced when email_delivery_status.state is bounced (forward-compatible with PR 2, field does not exist yet in production)', () => {
    expect(isSendSuppressed({ hunter_status: 'awaiting_reply', email_delivery_status: { state: 'bounced' } })).toEqual({ reason: 'contact_bounced' });
  });

  it('does not suppress on an unrelated email_delivery_status value', () => {
    expect(isSendSuppressed({ hunter_status: 'awaiting_reply', email_delivery_status: { state: 'delivered' } })).toBeNull();
  });
});

describe('sendScheduledEmail: fresh suppression check before the Gmail send', () => {
  const setupPending = (contactOverrides = {}) => {
    h.docs[contactPath('c1')] = { hunter_status: 'awaiting_reply', email: 'jane@acme.com', ...contactOverrides };
    h.docs[engagementPath('e1')] = {
      status: 'pending', scheduledFor: new Date(Date.now() - 1000).toISOString(),
      channel: 'email', contactId: 'c1', contact: { email: 'jane@acme.com', firstName: 'Jane' },
      subject: 'Following up', body: 'Just checking in.',
    };
  };

  it('sends normally when the contact is still eligible', async () => {
    setupPending();
    await processScheduledEngagements();
    expect(h.sentRaws).toHaveLength(1);
    expect(h.docs[engagementPath('e1')].status).toBe('sent');
  });

  it('skips and marks the engagement skipped (contact_replied) when the contact already replied since queuing', async () => {
    setupPending({ hunter_status: 'in_conversation' }); // the race: replied AFTER this was queued
    await processScheduledEngagements();
    expect(h.sentRaws).toHaveLength(0); // never reached the Gmail API
    const eng = h.docs[engagementPath('e1')];
    expect(eng.status).toBe('skipped');
    expect(eng.skippedReason).toBe('contact_replied');
  });

  it('skips (contact_bounced) once PR 2-style delivery state is present — forward compatibility, no second change needed here', async () => {
    setupPending({ email_delivery_status: { state: 'bounced' } });
    await processScheduledEngagements();
    expect(h.sentRaws).toHaveLength(0);
    expect(h.docs[engagementPath('e1')].skippedReason).toBe('contact_bounced');
  });

  it('a skipped engagement is never deleted or stripped of its original fields — history is preserved', async () => {
    setupPending({ hunter_status: 'in_conversation' });
    await processScheduledEngagements();
    const eng = h.docs[engagementPath('e1')];
    expect(eng.subject).toBe('Following up'); // original fields intact
    expect(eng.contactId).toBe('c1');
  });

  it('a transient failure reading the contact for the suppression check leaves the engagement pending for retry, rather than sending or skipping', async () => {
    setupPending();
    h.throwOnGet.add(contactPath('c1')); // the fresh read inside checkSendSuppressed will throw

    await processScheduledEngagements();

    expect(h.sentRaws).toHaveLength(0); // never sent
    const eng = h.docs[engagementPath('e1')];
    expect(eng.status).toBe('pending'); // not 'skipped', not 'failed' — a later run retries it
  });

  it('isSendSuppressed itself never throws for an unusual contact shape', () => {
    expect(() => isSendSuppressed({})).not.toThrow();
    expect(() => isSendSuppressed({ email_delivery_status: null })).not.toThrow();
  });
});

describe('sendScheduledWave: same suppression check in the per-recipient loop', () => {
  it('skips a recipient who already replied, sends to the others, and records stats.skipped on the wave doc', async () => {
    h.docs[contactPath('replied')] = { hunter_status: 'in_conversation', email: 'replied@acme.com' };
    h.docs[contactPath('eligible')] = { hunter_status: 'awaiting_reply', email: 'eligible@acme.com' };
    h.docs[wavePath('w1')] = {
      status: 'scheduled', scheduledFor: new Date(Date.now() - 1000).toISOString(),
      channel: 'via Email', message: 'Hi {{first_name}}, checking in.',
      recipientIds: ['replied', 'eligible'],
    };

    await processScheduledEngagements();

    expect(h.sentRaws).toHaveLength(1); // only the eligible one
    const wave = h.docs[wavePath('w1')];
    expect(wave.stats.sent).toBe(1);
    expect(wave.stats.skipped).toBe(1);
    expect(wave.status).toBe('processed');
  });
});
