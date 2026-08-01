/**
 * GMAIL SYNC WORKER — Sprint 1 Team A
 *
 * Drives the scheduled worker against a fake Firestore and a fake Gmail client.
 * The behaviours that matter here are the ones that lose or duplicate mail:
 *
 *   - the history cursor advances only after every message succeeded
 *   - a stale cursor falls back to a full poll instead of erroring
 *   - a failed token refresh marks needs_reconnect and skips the user
 *   - one user's failure never stops the loop for the others
 *   - Section 4 filtering keeps outbound and automated noise out of Team B
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@netlify/functions', () => ({ schedule: (_cron, handler) => handler }));
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => [{}],
  cert: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}), FieldValue: {} }));
vi.mock('googleapis', () => ({
  google: { auth: { OAuth2: class {} }, gmail: () => globalThis.__fakeGmail },
}));

const processNormalizedMessage = vi.fn(async () => ({ success: true, messageRecordId: 'rec_1' }));
vi.mock('../../netlify/functions/utils/messageProcessor.js', () => ({
  processNormalizedMessage: (...args) => processNormalizedMessage(...args),
}));

const getOAuthClient = vi.fn(async () => ({
  oauth2Client: {},
  gmailData: { email: 'aaron@idynify.com' },
  gmailDocRef: {},
}));
const isKnownContact = vi.fn(async () => true);
const isKnownIdynifyThread = vi.fn(async () => false);

vi.mock('../../netlify/functions/utils/gmailMessageService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getOAuthClient: (...args) => getOAuthClient(...args),
    isKnownContact: (...args) => isKnownContact(...args),
    isKnownIdynifyThread: (...args) => isKnownIdynifyThread(...args),
  };
});

import {
  runGmailSync,
  syncUserInbox,
  findConnectedGmailUsers,
  SYNC_SCHEDULE,
  SYNC_STATE_FIELDS,
  SYNC_STATUS,
} from '../../netlify/functions/gmail-sync-worker.js';
import indexConfig from '../../firestore.indexes.json';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64url');

function inboundMessage(id, overrides = {}) {
  return {
    id,
    threadId: overrides.threadId || `thr_${id}`,
    internalDate: '1767612840000',
    labelIds: overrides.labelIds || ['INBOX'],
    historyId: overrides.historyId,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: overrides.from || 'Jane Doe <jane@acme.com>' },
        { name: 'To', value: 'aaron@idynify.com' },
        { name: 'Subject', value: overrides.subject || 'Re: Intro call' },
        ...(overrides.extraHeaders || []),
      ],
      body: { data: b64(overrides.body || 'Yes, Thursday works.') },
    },
  };
}

/**
 * Fake Gmail client. `history` and `messages` describe what the API returns.
 */
function makeGmail({
  profileHistoryId = '5000',
  historyResponse = null,
  historyError = null,
  listIds = [],
  messagesById = {},
  threadSizes = {},
  profileError = null,
} = {}) {
  const calls = { historyList: 0, messagesList: 0, messagesGet: [], threadsGet: [] };

  return {
    calls,
    users: {
      getProfile: async () => {
        if (profileError) throw profileError;
        return { data: { emailAddress: 'aaron@idynify.com', historyId: profileHistoryId } };
      },
      history: {
        list: async () => {
          calls.historyList += 1;
          if (historyError) throw historyError;
          return { data: historyResponse || { historyId: profileHistoryId } };
        },
      },
      messages: {
        list: async () => {
          calls.messagesList += 1;
          return { data: { messages: listIds.map((id) => ({ id })) } };
        },
        get: async ({ id }) => {
          calls.messagesGet.push(id);
          if (!messagesById[id]) throw new Error(`no fixture for ${id}`);
          return { data: messagesById[id] };
        },
      },
      threads: {
        get: async ({ id }) => {
          calls.threadsGet.push(id);
          const size = threadSizes[id] ?? 1;
          return { data: { id, messages: Array.from({ length: size }, () => ({})) } };
        },
      },
    },
  };
}

/** Firestore doc stub that records every update() it receives. */
function makeUser(userId, data = {}) {
  const updates = [];
  return {
    userId,
    data: { status: 'connected', email: 'aaron@idynify.com', ...data },
    updates,
    docRef: {
      update: async (patch) => {
        updates.push(patch);
        return patch;
      },
    },
  };
}

/** The merged view of every update() call — i.e. the final document state. */
const finalState = (user) => Object.assign({}, ...user.updates);

beforeEach(() => {
  vi.clearAllMocks();
  processNormalizedMessage.mockImplementation(async () => ({ success: true, messageRecordId: 'r' }));
  getOAuthClient.mockImplementation(async () => ({
    oauth2Client: {},
    gmailData: { email: 'aaron@idynify.com' },
    gmailDocRef: {},
  }));
  isKnownContact.mockImplementation(async () => true);
  isKnownIdynifyThread.mockImplementation(async () => false);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('worker configuration', () => {
  it('is scheduled every 10 minutes', () => {
    expect(SYNC_SCHEDULE).toBe('*/10 * * * *');
  });

  it('declares exactly the five sync-state fields from the spec', () => {
    expect([...SYNC_STATE_FIELDS]).toEqual([
      'lastHistoryId',
      'lastSuccessfulSyncAt',
      'syncStatus',
      'lastSyncError',
      'nextSyncAt',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('findConnectedGmailUsers', () => {
  const makeSnap = (docs) => ({
    collectionGroup: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs }) }) }),
    }),
  });

  const doc = (id, userId, data) => ({
    id,
    ref: { parent: { parent: { id: userId } }, update: vi.fn() },
    data: () => data,
  });

  it('ignores non-gmail integration documents', async () => {
    const db = makeSnap([
      doc('gmail', 'u1', { status: 'connected' }),
      doc('calendar', 'u1', { status: 'connected' }),
    ]);
    const users = await findConnectedGmailUsers(db);
    expect(users.map((u) => u.userId)).toEqual(['u1']);
  });

  it('puts never-synced accounts first, then the least recently synced', async () => {
    const db = makeSnap([
      doc('gmail', 'recent', { status: 'connected', lastSuccessfulSyncAt: '2026-08-01T10:00:00Z' }),
      doc('gmail', 'never', { status: 'connected' }),
      doc('gmail', 'stale', { status: 'connected', lastSuccessfulSyncAt: '2026-07-01T10:00:00Z' }),
    ]);
    const users = await findConnectedGmailUsers(db);
    expect(users.map((u) => u.userId)).toEqual(['never', 'stale', 'recent']);
  });

  it('caps the batch at the requested limit', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => doc('gmail', `u${i}`, { status: 'connected' }));
    const users = await findConnectedGmailUsers(makeSnap(docs), 4);
    expect(users).toHaveLength(4);
  });

  it('explains how to fix a missing collection-group index', async () => {
    const db = {
      collectionGroup: () => ({
        where: () => ({
          limit: () => ({
            get: async () => {
              throw Object.assign(
                new Error('FAILED_PRECONDITION: The query requires an index.'),
                { code: 9 }
              );
            },
          }),
        }),
      }),
    };
    await expect(findConnectedGmailUsers(db)).rejects.toThrow(
      /firebase deploy --only firestore:indexes/
    );
  });

  it('rethrows unrelated Firestore errors untouched', async () => {
    const db = {
      collectionGroup: () => ({
        where: () => ({
          limit: () => ({ get: async () => { throw new Error('DEADLINE_EXCEEDED'); } }),
        }),
      }),
    };
    await expect(findConnectedGmailUsers(db)).rejects.toThrow('DEADLINE_EXCEEDED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('firestore.indexes.json', () => {
  it('declares the collection-group index the worker query depends on', () => {
    const override = (indexConfig.fieldOverrides || []).find(
      (f) => f.collectionGroup === 'integrations' && f.fieldPath === 'status'
    );
    expect(override, 'integrations.status fieldOverride is missing').toBeDefined();
    expect(override.indexes).toContainEqual({
      order: 'ASCENDING',
      queryScope: 'COLLECTION_GROUP',
    });
  });

  it('keeps the automatic COLLECTION-scope indexes the override would otherwise drop', () => {
    const override = indexConfig.fieldOverrides.find(
      (f) => f.collectionGroup === 'integrations' && f.fieldPath === 'status'
    );
    expect(override.indexes).toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION' });
    expect(override.indexes).toContainEqual({ order: 'DESCENDING', queryScope: 'COLLECTION' });
    expect(override.indexes).toContainEqual({
      arrayConfig: 'CONTAINS',
      queryScope: 'COLLECTION',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('syncUserInbox — bootstrap (no cursor)', () => {
  it('polls recent inbox, processes each message, and stores the cursor', async () => {
    globalThis.__fakeGmail = makeGmail({
      profileHistoryId: '9100',
      listIds: ['m1', 'm2'],
      messagesById: { m1: inboundMessage('m1'), m2: inboundMessage('m2') },
    });

    const user = makeUser('u1');
    const summary = await syncUserInbox({}, user);

    expect(summary.mode).toBe('bootstrap');
    expect(summary.processed).toBe(2);
    expect(processNormalizedMessage).toHaveBeenCalledTimes(2);

    const state = finalState(user);
    expect(state.lastHistoryId).toBe('9100');
    expect(state.syncStatus).toBe(SYNC_STATUS.IDLE);
    expect(state.lastSyncError).toBeNull();
    expect(state.lastSuccessfulSyncAt).toEqual(expect.any(String));
    expect(state.nextSyncAt).toEqual(expect.any(String));
  });

  it('hands Team B a NormalizedMessage with the message id, not the thread id', async () => {
    globalThis.__fakeGmail = makeGmail({
      listIds: ['m1'],
      messagesById: { m1: inboundMessage('m1', { threadId: 'thr_1' }) },
      threadSizes: { thr_1: 3 },
    });

    await syncUserInbox({}, makeUser('u1'));

    const [, message] = processNormalizedMessage.mock.calls[0];
    expect(message.gmailMessageId).toBe('m1');
    expect(message.gmailThreadId).toBe('thr_1');
    expect(message.threadMessageCount).toBe(3);
    expect(message.isFirstMessageInThread).toBe(false);
    expect(message.idynifyUserId).toBe('u1');
    expect(message.gmailAccountId).toBe('aaron@idynify.com');
    expect(message.ingestionVersion).toBe('1.0.0');
  });

  it('fetches each thread only once per run', async () => {
    const gmail = makeGmail({
      listIds: ['m1', 'm2'],
      messagesById: {
        m1: inboundMessage('m1', { threadId: 'thr_shared' }),
        m2: inboundMessage('m2', { threadId: 'thr_shared' }),
      },
      threadSizes: { thr_shared: 2 },
    });
    globalThis.__fakeGmail = gmail;

    await syncUserInbox({}, makeUser('u1'));
    expect(gmail.calls.threadsGet).toEqual(['thr_shared']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('syncUserInbox — incremental (history cursor)', () => {
  it('reads only messages added since the cursor and advances it', async () => {
    const gmail = makeGmail({
      historyResponse: {
        historyId: '9200',
        history: [
          { id: '9150', messagesAdded: [{ message: { id: 'm1' } }] },
          { id: '9180', messagesAdded: [{ message: { id: 'm2' } }] },
        ],
      },
      messagesById: { m1: inboundMessage('m1'), m2: inboundMessage('m2') },
    });
    globalThis.__fakeGmail = gmail;

    const user = makeUser('u1', { lastHistoryId: '9100' });
    const summary = await syncUserInbox({}, user);

    expect(summary.mode).toBe('history');
    expect(summary.processed).toBe(2);
    expect(gmail.calls.messagesList).toBe(0); // no full poll
    expect(finalState(user).lastHistoryId).toBe('9200');
  });

  it('de-duplicates a message that appears twice in one history batch', async () => {
    globalThis.__fakeGmail = makeGmail({
      historyResponse: {
        historyId: '9200',
        history: [
          { id: '9150', messagesAdded: [{ message: { id: 'm1' } }] },
          { id: '9160', messagesAdded: [{ message: { id: 'm1' } }] },
        ],
      },
      messagesById: { m1: inboundMessage('m1') },
    });

    const summary = await syncUserInbox({}, makeUser('u1', { lastHistoryId: '9100' }));
    expect(summary.processed).toBe(1);
    expect(processNormalizedMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full poll when the cursor has gone stale (404)', async () => {
    const staleError = Object.assign(new Error('Not Found'), { status: 404 });
    const gmail = makeGmail({
      profileHistoryId: '9999',
      historyError: staleError,
      listIds: ['m1'],
      messagesById: { m1: inboundMessage('m1') },
    });
    globalThis.__fakeGmail = gmail;

    const user = makeUser('u1', { lastHistoryId: '1' });
    const summary = await syncUserInbox({}, user);

    expect(summary.mode).toBe('stale_cursor_poll');
    expect(summary.processed).toBe(1);
    expect(gmail.calls.messagesList).toBe(1);
    expect(finalState(user).lastHistoryId).toBe('9999');
  });

  it('records an error and keeps the cursor when history.list fails for another reason', async () => {
    globalThis.__fakeGmail = makeGmail({
      historyError: Object.assign(new Error('backend error'), { status: 500 }),
    });

    const user = makeUser('u1', { lastHistoryId: '9100' });
    const summary = await syncUserInbox({}, user);

    expect(summary.status).toBe(SYNC_STATUS.ERROR);
    const state = finalState(user);
    expect(state.syncStatus).toBe(SYNC_STATUS.ERROR);
    expect(state.lastSyncError).toContain('backend error');
    expect(state.lastHistoryId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('syncUserInbox — cursor safety', () => {
  it('does not advance the cursor when a message fails to process', async () => {
    processNormalizedMessage.mockImplementation(async () => ({
      success: false,
      error: 'contact matcher exploded',
    }));

    globalThis.__fakeGmail = makeGmail({
      historyResponse: {
        historyId: '9200',
        history: [{ id: '9150', messagesAdded: [{ message: { id: 'm1' } }] }],
      },
      messagesById: { m1: inboundMessage('m1') },
    });

    const user = makeUser('u1', { lastHistoryId: '9100' });
    const summary = await syncUserInbox({}, user);

    expect(summary.failed).toBe(1);
    const state = finalState(user);
    expect(state.lastHistoryId).toBeUndefined();
    expect(state.lastSuccessfulSyncAt).toBeUndefined();
    expect(state.syncStatus).toBe(SYNC_STATUS.ERROR);
    expect(state.lastSyncError).toContain('contact matcher exploded');
  });

  it('stops at the first failure so later messages are not skipped by the cursor', async () => {
    processNormalizedMessage
      .mockImplementationOnce(async () => ({ success: true }))
      .mockImplementationOnce(async () => ({ success: false, error: 'boom' }));

    globalThis.__fakeGmail = makeGmail({
      historyResponse: {
        historyId: '9200',
        history: [
          { id: '9150', messagesAdded: [{ message: { id: 'm1' } }] },
          { id: '9160', messagesAdded: [{ message: { id: 'm2' } }] },
          { id: '9170', messagesAdded: [{ message: { id: 'm3' } }] },
        ],
      },
      messagesById: {
        m1: inboundMessage('m1'),
        m2: inboundMessage('m2'),
        m3: inboundMessage('m3'),
      },
    });

    const user = makeUser('u1', { lastHistoryId: '9100' });
    const summary = await syncUserInbox({}, user);

    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(processNormalizedMessage).toHaveBeenCalledTimes(2); // m3 never attempted
    expect(finalState(user).lastHistoryId).toBeUndefined();
  });

  it('keeps the cursor when fetching a message throws', async () => {
    globalThis.__fakeGmail = makeGmail({
      historyResponse: {
        historyId: '9200',
        history: [{ id: '9150', messagesAdded: [{ message: { id: 'missing' } }] }],
      },
      messagesById: {},
    });

    const user = makeUser('u1', { lastHistoryId: '9100' });
    const summary = await syncUserInbox({}, user);

    expect(summary.failed).toBe(1);
    expect(finalState(user).lastHistoryId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('syncUserInbox — OAuth and scope handling', () => {
  it('skips the user when getOAuthClient returns null', async () => {
    getOAuthClient.mockImplementation(async () => null);
    globalThis.__fakeGmail = makeGmail();

    const summary = await syncUserInbox({}, makeUser('u1'));

    expect(summary.status).toBe(SYNC_STATUS.NEEDS_RECONNECT);
    expect(processNormalizedMessage).not.toHaveBeenCalled();
  });

  it('marks needs_reconnect when the read scope is missing (403)', async () => {
    globalThis.__fakeGmail = makeGmail({
      profileError: Object.assign(new Error('Insufficient Permission'), { status: 403 }),
    });

    const user = makeUser('u1');
    const summary = await syncUserInbox({}, user);

    expect(summary.status).toBe(SYNC_STATUS.NEEDS_RECONNECT);
    const state = finalState(user);
    expect(state.syncStatus).toBe(SYNC_STATUS.NEEDS_RECONNECT);
    expect(state.lastSyncError).toContain('reconnect');
    expect(processNormalizedMessage).not.toHaveBeenCalled();
  });

  it('continues with the stored address when getProfile fails for a non-scope reason', async () => {
    globalThis.__fakeGmail = makeGmail({
      profileError: Object.assign(new Error('rate limited'), { status: 429 }),
      listIds: ['m1'],
      messagesById: { m1: inboundMessage('m1') },
    });

    const summary = await syncUserInbox({}, makeUser('u1'));
    expect(summary.processed).toBe(1);
    expect(processNormalizedMessage.mock.calls[0][1].gmailAccountId).toBe('aaron@idynify.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('syncUserInbox — Section 4 filtering', () => {
  const runWith = async (message, { knownThread = false } = {}) => {
    isKnownIdynifyThread.mockImplementation(async () => knownThread);
    globalThis.__fakeGmail = makeGmail({
      listIds: [message.id],
      messagesById: { [message.id]: message },
    });
    return syncUserInbox({}, makeUser('u1'));
  };

  it('skips outbound mail without touching Team B', async () => {
    const summary = await runWith(inboundMessage('m1', { from: 'aaron@idynify.com' }));
    expect(summary.skipped).toBe(1);
    expect(processNormalizedMessage).not.toHaveBeenCalled();
  });

  it('skips automated mail on an unknown thread', async () => {
    const summary = await runWith(
      inboundMessage('m1', {
        from: 'no-reply@newsletter.com',
        subject: 'Your weekly digest',
      })
    );
    expect(summary.skipped).toBe(1);
    expect(processNormalizedMessage).not.toHaveBeenCalled();
  });

  it('processes automated mail when the thread is already known to Idynify', async () => {
    const summary = await runWith(
      inboundMessage('m1', { from: 'no-reply@acme.com', subject: 'Out of Office' }),
      { knownThread: true }
    );
    expect(summary.processed).toBe(1);
    expect(processNormalizedMessage.mock.calls[0][1].category).toBe('automated');
  });

  it.each([['SPAM'], ['TRASH'], ['CATEGORY_PROMOTIONS']])(
    'skips messages labelled %s',
    async (label) => {
      const summary = await runWith(inboundMessage('m1', { labelIds: ['INBOX', label] }));
      expect(summary.skipped).toBe(1);
      expect(processNormalizedMessage).not.toHaveBeenCalled();
    }
  );

  it('still advances the cursor when every message was skipped', async () => {
    globalThis.__fakeGmail = makeGmail({
      profileHistoryId: '9300',
      listIds: ['m1'],
      messagesById: { m1: inboundMessage('m1', { from: 'aaron@idynify.com' }) },
    });

    const user = makeUser('u1');
    await syncUserInbox({}, user);
    expect(finalState(user).lastHistoryId).toBe('9300');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runGmailSync', () => {
  function dbWithUsers(userIds) {
    const refs = new Map();
    const docs = userIds.map((id) => {
      const ref = { update: vi.fn(async () => {}) };
      refs.set(id, ref);
      return { id: 'gmail', ref: { ...ref, parent: { parent: { id } } }, data: () => ({ status: 'connected', email: 'aaron@idynify.com' }) };
    });
    return {
      refs,
      db: {
        collectionGroup: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs }) }) }) }),
      },
    };
  }

  it('keeps going after one user fails', async () => {
    globalThis.__fakeGmail = makeGmail({
      listIds: ['m1'],
      messagesById: { m1: inboundMessage('m1') },
    });

    getOAuthClient.mockImplementation(async (userId) => {
      if (userId === 'broken') throw new Error('firestore unavailable');
      return { oauth2Client: {}, gmailData: { email: 'aaron@idynify.com' }, gmailDocRef: {} };
    });

    const { db } = dbWithUsers(['broken', 'healthy']);
    const result = await runGmailSync(db);

    expect(result.usersSynced).toBe(2);
    expect(result.totals.failed).toBe(1);
    expect(result.totals.processed).toBe(1);
    expect(result.results.find((r) => r.userId === 'healthy').status).toBe(SYNC_STATUS.IDLE);
    expect(result.results.find((r) => r.userId === 'broken').status).toBe(SYNC_STATUS.ERROR);
  });

  it('defers the remaining users once the time budget is spent', async () => {
    globalThis.__fakeGmail = makeGmail({
      listIds: ['m1'],
      messagesById: { m1: inboundMessage('m1') },
    });

    const { db } = dbWithUsers(['u1', 'u2', 'u3']);
    const result = await runGmailSync(db, { budgetMs: -1 });

    expect(result.usersSynced).toBe(0);
    expect(result.usersDeferred).toBe(3);
    expect(processNormalizedMessage).not.toHaveBeenCalled();
  });

  it('reports zero work when no account is connected', async () => {
    const { db } = dbWithUsers([]);
    const result = await runGmailSync(db);
    expect(result).toMatchObject({
      usersConsidered: 0,
      usersSynced: 0,
      totals: { processed: 0, skipped: 0, invalid: 0, failed: 0 },
    });
  });
});
