/**
 * gmail-reply-sync-worker.js — the scheduled orchestration layer: account
 * enumeration (reused, not reimplemented), serial per-user processing, a
 * time budget, and failure reporting. pollRepliesForUser itself is mocked
 * here — its own behavior is covered in replyPolling.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));
// getFirestore() backs replySyncHandler's own internal call — makeFakeDb is a
// hoisted function declaration (defined further down this file), so it's
// already available by the time this factory actually runs.
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => makeFakeDb() }));
vi.mock('googleapis', () => ({ google: { gmail: () => ({ users: { getProfile: async () => ({ data: { emailAddress: 'u@x.com' } }) } }) } }));

const h = vi.hoisted(() => ({
  users: [],
  oauthByUser: {},
  pollResultByUser: {},
  alertCalls: [],
  docs: {},
  // Backs the allowlist's direct per-user integration lookup
  // (resolveAllowlistedUsers) — separate from `users`, which only backs
  // the mocked findConnectedGmailUsers (the general, capped enumeration).
  // Keyed by userId -> integration doc data, or absent entirely to model
  // a userId that was never connected (or is misspelled).
  integrationDocs: {},
  // userIds whose integration-doc .get() should throw, to model a
  // transient Firestore error resolving one specific allowlisted id.
  throwOnIntegrationGet: new Set(),
}));

vi.mock('../../netlify/functions/gmail-sync-worker.js', () => ({
  findConnectedGmailUsers: vi.fn(async () => h.users),
}));

vi.mock('../../netlify/functions/utils/gmailMessageService.js', () => ({
  getOAuthClient: vi.fn(async (userId) =>
    Object.prototype.hasOwnProperty.call(h.oauthByUser, userId)
      ? h.oauthByUser[userId]
      : { oauth2Client: {}, gmailData: { email: `${userId}@x.com` } }
  ),
}));

vi.mock('../../netlify/functions/utils/replyPolling.js', () => ({
  pollRepliesForUser: vi.fn(async (_db, _gmail, userId) => {
    const r = h.pollResultByUser[userId];
    if (r?.throw) throw new Error(r.throw);
    return r ?? { transitioned: [], checkedCount: 0, needsReconnect: false };
  }),
}));

vi.mock('../../netlify/functions/utils/alertOps.js', () => ({
  alertOps: vi.fn(async (args) => { h.alertCalls.push(args); }),
}));

const {
  runReplySync, syncUserReplies, replySyncHandler, isReplySyncEnabled, getReplySyncAllowlist,
} = await import('../../netlify/functions/gmail-reply-sync-worker.js');
const { findConnectedGmailUsers } = await import('../../netlify/functions/gmail-sync-worker.js');
const { getOAuthClient } = await import('../../netlify/functions/utils/gmailMessageService.js');
const { pollRepliesForUser } = await import('../../netlify/functions/utils/replyPolling.js');

/**
 * Minimal fake supporting (1) the lastReplySyncAt stamp syncUserReplies
 * writes in its finally block, and (2) resolveAllowlistedUsers's direct
 * per-user integration-doc .get() — backed by h.integrationDocs, keyed by
 * userId, deliberately separate from h.users (which only ever backs the
 * mocked findConnectedGmailUsers / general enumeration).
 */
function makeFakeDb() {
  function docRef(path) {
    return {
      get: async () => {
        const m = path.match(/^users\/([^/]+)\/integrations\/gmail$/);
        const userId = m ? m[1] : null;
        if (userId != null && h.throwOnIntegrationGet.has(userId)) {
          throw new Error('Firestore unavailable');
        }
        const exists = userId != null && Object.prototype.hasOwnProperty.call(h.integrationDocs, userId);
        return { exists, data: () => (exists ? h.integrationDocs[userId] : undefined) };
      },
      update: async (patch) => { h.docs[path] = { ...(h.docs[path] || {}), ...patch }; },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }
  function collRef(path) {
    return { doc: (id) => docRef(`${path}/${id}`) };
  }
  return { collection: (name) => collRef(name) };
}

beforeEach(() => {
  h.users = [];
  h.oauthByUser = {};
  h.pollResultByUser = {};
  h.alertCalls.length = 0;
  h.docs = {};
  h.integrationDocs = {};
  h.throwOnIntegrationGet = new Set();
  findConnectedGmailUsers.mockClear();
  getOAuthClient.mockClear();
  pollRepliesForUser.mockClear();
  // Rollout flag must default off regardless of what the host shell's env
  // happens to carry — every test that needs the worker actually running
  // opts in explicitly via { enabled: true } or by setting these itself.
  delete process.env.GMAIL_REPLY_SYNC_ENABLED;
  delete process.env.GMAIL_REPLY_SYNC_USER_ALLOWLIST;
});

describe('syncUserReplies', () => {
  it('reuses getOAuthClient and returns oauth_unavailable without throwing when it returns null', async () => {
    h.oauthByUser.u1 = null;
    const summary = await syncUserReplies(makeFakeDb(), { userId: 'u1' });
    expect(summary.error).toBe('oauth_unavailable');
  });

  it('aggregates checkedCount/transitionedCount from pollRepliesForUser', async () => {
    h.pollResultByUser.u1 = { transitioned: [{ contactId: 'c1' }], checkedCount: 5, needsReconnect: false };
    const summary = await syncUserReplies(makeFakeDb(), { userId: 'u1' });
    expect(summary.checkedCount).toBe(5);
    expect(summary.transitionedCount).toBe(1);
    expect(summary.error).toBeNull();
  });

  it('never throws — a crash inside pollRepliesForUser is captured as summary.error', async () => {
    h.pollResultByUser.u1 = { throw: 'boom' };
    const summary = await syncUserReplies(makeFakeDb(), { userId: 'u1' });
    expect(summary.error).toBe('boom');
  });

  it('stamps lastReplySyncAt on the integration doc regardless of outcome — its own fairness-rotation field, independent of the identity-sync worker\'s', async () => {
    h.pollResultByUser.u1 = { throw: 'boom' }; // even on failure
    const db = makeFakeDb();
    await syncUserReplies(db, { userId: 'u1' });
    expect(h.docs['users/u1/integrations/gmail'].lastReplySyncAt).toBeDefined();
  });
});

describe('runReplySync', () => {
  it('processes every connected user serially and totals the results', async () => {
    h.users = [{ userId: 'u1' }, { userId: 'u2' }];
    h.pollResultByUser.u1 = { transitioned: [{ contactId: 'c1' }], checkedCount: 2, needsReconnect: false };
    h.pollResultByUser.u2 = { transitioned: [], checkedCount: 3, needsReconnect: false };

    const summary = await runReplySync(makeFakeDb(), { enabled: true });

    expect(summary.usersConsidered).toBe(2);
    expect(summary.usersSynced).toBe(2);
    expect(summary.totals).toEqual({ checked: 5, transitioned: 1, failed: 0 });
  });

  it('one user failing does not stop the loop — the other user is still processed', async () => {
    h.users = [{ userId: 'u1' }, { userId: 'u2' }];
    h.pollResultByUser.u1 = { throw: 'u1 blew up' };
    h.pollResultByUser.u2 = { transitioned: [], checkedCount: 1, needsReconnect: false };

    const summary = await runReplySync(makeFakeDb(), { enabled: true });

    expect(summary.usersSynced).toBe(2);
    expect(summary.totals.failed).toBe(1);
    expect(summary.totals.checked).toBe(1); // only u2's
  });

  it('defers remaining users once the time budget is spent, least-recently-synced order preserved from findConnectedGmailUsers', async () => {
    h.users = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }];
    h.pollResultByUser.u1 = { transitioned: [], checkedCount: 1, needsReconnect: false };

    const summary = await runReplySync(makeFakeDb(), { enabled: true, now: Date.now() - 1_000_000, budgetMs: 0 });

    expect(summary.usersSynced).toBe(0);
    expect(summary.usersDeferred).toBe(3);
  });

  it('calls findConnectedGmailUsers with its own rotation field, not the default', async () => {
    h.users = [];
    await runReplySync(makeFakeDb(), { enabled: true });
    expect(findConnectedGmailUsers).toHaveBeenCalledWith(expect.anything(), undefined, 'lastReplySyncAt');
  });
});

describe('rollout gating (GMAIL_REPLY_SYNC_ENABLED / allowlist)', () => {
  it('isReplySyncEnabled is false for unset, empty, or any value other than the exact string "true"', () => {
    expect(isReplySyncEnabled({})).toBe(false);
    expect(isReplySyncEnabled({ GMAIL_REPLY_SYNC_ENABLED: '' })).toBe(false);
    expect(isReplySyncEnabled({ GMAIL_REPLY_SYNC_ENABLED: 'TRUE' })).toBe(false);
    expect(isReplySyncEnabled({ GMAIL_REPLY_SYNC_ENABLED: '1' })).toBe(false);
    expect(isReplySyncEnabled({ GMAIL_REPLY_SYNC_ENABLED: 'true' })).toBe(true);
  });

  it('getReplySyncAllowlist returns null when unset, a trimmed Set when populated', () => {
    expect(getReplySyncAllowlist({})).toBeNull();
    expect(getReplySyncAllowlist({ GMAIL_REPLY_SYNC_USER_ALLOWLIST: '' })).toBeNull();
    const allowlist = getReplySyncAllowlist({ GMAIL_REPLY_SYNC_USER_ALLOWLIST: ' u1, u2 ,u3' });
    expect(allowlist).toEqual(new Set(['u1', 'u2', 'u3']));
  });

  it('disabled by default: no account enumeration, no OAuth, no Gmail calls — the run is a true no-op', async () => {
    h.users = [{ userId: 'u1' }]; // would be processed if the gate were open
    h.pollResultByUser.u1 = { transitioned: [{ contactId: 'c1' }], checkedCount: 1, needsReconnect: false };

    const summary = await runReplySync(makeFakeDb()); // no options — reads env, which beforeEach cleared

    expect(summary.disabled).toBe(true);
    expect(summary.usersConsidered).toBe(0);
    expect(summary.usersSynced).toBe(0);
    expect(summary.totals).toEqual({ checked: 0, transitioned: 0, failed: 0 });
    // The actual guarantee Aaron asked for: these never even get called.
    expect(findConnectedGmailUsers).not.toHaveBeenCalled();
    expect(getOAuthClient).not.toHaveBeenCalled();
    expect(pollRepliesForUser).not.toHaveBeenCalled();
  });

  it('an allowlist restricts the run to only the listed userIds, resolved directly rather than through the general enumeration', async () => {
    h.integrationDocs.u2 = { status: 'connected' };
    h.pollResultByUser.u2 = { transitioned: [], checkedCount: 1, needsReconnect: false };
    // findConnectedGmailUsers is mocked to return nothing — proves u2 was
    // found via resolveAllowlistedUsers, not by filtering its result.
    h.users = [];

    const summary = await runReplySync(makeFakeDb(), { enabled: true, allowlist: new Set(['u2']) });

    expect(summary.usersConsidered).toBe(1);
    expect(summary.usersSynced).toBe(1);
    expect(summary.results[0].userId).toBe('u2');
    expect(findConnectedGmailUsers).not.toHaveBeenCalled();
    expect(getOAuthClient).toHaveBeenCalledTimes(1);
    expect(getOAuthClient).toHaveBeenCalledWith('u2', expect.anything());
  });

  it('an allowlisted account outside the normal first-50 selection is still evaluated — the bug this fixes', async () => {
    // Models exactly the reported defect: u-outside is eligible and
    // connected, but would never survive findConnectedGmailUsers's cap or
    // its least-recently-synced sort (it is not even IN that mocked
    // result here) — yet being named on the allowlist must still work.
    h.integrationDocs['u-outside'] = { status: 'connected', lastReplySyncAt: '2026-01-01T00:00:00.000Z' };
    h.pollResultByUser['u-outside'] = { transitioned: [], checkedCount: 2, needsReconnect: false };
    h.users = []; // the general enumeration "knows" nothing about this user

    const summary = await runReplySync(makeFakeDb(), { enabled: true, allowlist: new Set(['u-outside']) });

    expect(summary.usersConsidered).toBe(1);
    expect(summary.results[0].userId).toBe('u-outside');
    expect(summary.totals.checked).toBe(2);
  });

  it('an invalid (never connected) or disconnected allowlisted account is excluded, not silently treated as eligible', async () => {
    h.integrationDocs.good = { status: 'connected' };
    h.integrationDocs.disconnected = { status: 'disconnected' };
    // 'typo-d-id' has no integrationDocs entry at all — never connected / misspelled.
    h.pollResultByUser.good = { transitioned: [], checkedCount: 1, needsReconnect: false };

    const summary = await runReplySync(makeFakeDb(), {
      enabled: true, allowlist: new Set(['good', 'disconnected', 'typo-d-id']),
    });

    expect(summary.usersConsidered).toBe(1);
    expect(summary.results[0].userId).toBe('good');
    expect(getOAuthClient).toHaveBeenCalledTimes(1);
    expect(getOAuthClient).toHaveBeenCalledWith('good', expect.anything());
  });

  it('a Firestore error resolving one allowlisted id does not block the others', async () => {
    h.integrationDocs.good = { status: 'connected' };
    h.pollResultByUser.good = { transitioned: [], checkedCount: 1, needsReconnect: false };
    h.throwOnIntegrationGet.add('broken');

    const summary = await runReplySync(makeFakeDb(), { enabled: true, allowlist: new Set(['broken', 'good']) });

    expect(summary.usersConsidered).toBe(1);
    expect(summary.results[0].userId).toBe('good');
  });

  it('replySyncHandler itself stays off by default (the real entry point, not just the inner function)', async () => {
    h.users = [{ userId: 'u1' }];
    h.pollResultByUser.u1 = { transitioned: [{ contactId: 'c1' }], checkedCount: 1, needsReconnect: false };

    const res = await replySyncHandler(); // no env var set — beforeEach cleared it

    expect(res.statusCode).toBe(200); // disabled is a clean no-op, not a failure
    const body = JSON.parse(res.body);
    expect(body.usersConsidered).toBe(0);
    expect(findConnectedGmailUsers).not.toHaveBeenCalled();
    expect(h.alertCalls).toHaveLength(0); // a disabled run never alerts ops
  });

  it('replySyncHandler processes accounts once GMAIL_REPLY_SYNC_ENABLED=true is set in the environment', async () => {
    h.users = [{ userId: 'u1' }];
    h.pollResultByUser.u1 = { transitioned: [], checkedCount: 1, needsReconnect: false };
    process.env.GMAIL_REPLY_SYNC_ENABLED = 'true';

    const res = await replySyncHandler();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.usersConsidered).toBe(1);
    expect(findConnectedGmailUsers).toHaveBeenCalledTimes(1);
  });
});

describe('replySyncHandler (with the rollout flag enabled — processing behavior, not gating)', () => {
  beforeEach(() => {
    // These tests are about what happens once the worker IS running, same
    // as before the rollout flag existed — gating itself is covered above.
    process.env.GMAIL_REPLY_SYNC_ENABLED = 'true';
  });

  it('returns 200 when every account succeeds', async () => {
    h.users = [{ userId: 'u1' }];
    h.pollResultByUser.u1 = { transitioned: [], checkedCount: 0, needsReconnect: false };
    const res = await replySyncHandler();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  it('returns 207 and alerts ops on a partial failure', async () => {
    h.users = [{ userId: 'u1' }];
    h.pollResultByUser.u1 = { throw: 'boom' };
    const res = await replySyncHandler();
    expect(res.statusCode).toBe(207);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(h.alertCalls).toHaveLength(1);
    expect(h.alertCalls[0].severity).toBe('partial_failure');
  });

  it('returns 500 (not 200) and alerts ops when the whole run throws before finishing', async () => {
    findConnectedGmailUsers.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const res = await replySyncHandler();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(h.alertCalls).toHaveLength(1);
    expect(h.alertCalls[0].severity).toBe('failed');
  });
});
