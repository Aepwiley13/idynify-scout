/**
 * gmail-reply-sync-worker.js — the scheduled orchestration layer: account
 * enumeration (reused, not reimplemented), serial per-user processing, a
 * time budget, and failure reporting. pollRepliesForUser itself is mocked
 * here — its own behavior is covered in replyPolling.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('googleapis', () => ({ google: { gmail: () => ({ users: { getProfile: async () => ({ data: { emailAddress: 'u@x.com' } }) } }) } }));

const h = vi.hoisted(() => ({
  users: [],
  oauthByUser: {},
  pollResultByUser: {},
  alertCalls: [],
}));

vi.mock('../../netlify/functions/utils/gmailMessageService.js', () => ({
  findConnectedGmailUsers: vi.fn(async () => h.users),
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

const { runReplySync, syncUserReplies, replySyncHandler } = await import('../../netlify/functions/gmail-reply-sync-worker.js');
const { findConnectedGmailUsers, getOAuthClient } = await import('../../netlify/functions/utils/gmailMessageService.js');
const { pollRepliesForUser } = await import('../../netlify/functions/utils/replyPolling.js');

beforeEach(() => {
  h.users = [];
  h.oauthByUser = {};
  h.pollResultByUser = {};
  h.alertCalls.length = 0;
  findConnectedGmailUsers.mockClear();
  getOAuthClient.mockClear();
  pollRepliesForUser.mockClear();
});

describe('syncUserReplies', () => {
  it('reuses getOAuthClient and returns oauth_unavailable without throwing when it returns null', async () => {
    h.oauthByUser.u1 = null;
    const summary = await syncUserReplies({}, { userId: 'u1' });
    expect(summary.error).toBe('oauth_unavailable');
  });

  it('aggregates checkedCount/transitionedCount from pollRepliesForUser', async () => {
    h.pollResultByUser.u1 = { transitioned: [{ contactId: 'c1' }], checkedCount: 5, needsReconnect: false };
    const summary = await syncUserReplies({}, { userId: 'u1' });
    expect(summary.checkedCount).toBe(5);
    expect(summary.transitionedCount).toBe(1);
    expect(summary.error).toBeNull();
  });

  it('never throws — a crash inside pollRepliesForUser is captured as summary.error', async () => {
    h.pollResultByUser.u1 = { throw: 'boom' };
    const summary = await syncUserReplies({}, { userId: 'u1' });
    expect(summary.error).toBe('boom');
  });
});

describe('runReplySync', () => {
  it('processes every connected user serially and totals the results', async () => {
    h.users = [{ userId: 'u1' }, { userId: 'u2' }];
    h.pollResultByUser.u1 = { transitioned: [{ contactId: 'c1' }], checkedCount: 2, needsReconnect: false };
    h.pollResultByUser.u2 = { transitioned: [], checkedCount: 3, needsReconnect: false };

    const summary = await runReplySync({});

    expect(summary.usersConsidered).toBe(2);
    expect(summary.usersSynced).toBe(2);
    expect(summary.totals).toEqual({ checked: 5, transitioned: 1, failed: 0 });
  });

  it('one user failing does not stop the loop — the other user is still processed', async () => {
    h.users = [{ userId: 'u1' }, { userId: 'u2' }];
    h.pollResultByUser.u1 = { throw: 'u1 blew up' };
    h.pollResultByUser.u2 = { transitioned: [], checkedCount: 1, needsReconnect: false };

    const summary = await runReplySync({});

    expect(summary.usersSynced).toBe(2);
    expect(summary.totals.failed).toBe(1);
    expect(summary.totals.checked).toBe(1); // only u2's
  });

  it('defers remaining users once the time budget is spent, least-recently-synced order preserved from findConnectedGmailUsers', async () => {
    h.users = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }];
    h.pollResultByUser.u1 = { transitioned: [], checkedCount: 1, needsReconnect: false };

    const summary = await runReplySync({}, { now: Date.now() - 1_000_000, budgetMs: 0 });

    expect(summary.usersSynced).toBe(0);
    expect(summary.usersDeferred).toBe(3);
  });
});

describe('replySyncHandler', () => {
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
