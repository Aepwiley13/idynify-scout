/**
 * The cursor wedge, and the proof it is closed.
 *
 * The wedge was never subtle: any message that failed permanently held
 * `lastHistoryId`, so the next run replayed the same batch, hit the same
 * failure, and stopped again — leaving every later Gmail event unreachable,
 * indefinitely, with nothing surfaced to the user.
 *
 * What matters in these tests is the ORDER of the two guarantees. A transient
 * failure must still hold the cursor, because skipping real mail is the worse
 * bug. Only once the retry budget is spent may the pipeline move on. Both
 * halves are asserted, because a fix that only did the second one would have
 * traded a visible blockade for silent data loss.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordIngestFailure,
  clearIngestFailure,
  failureKey,
  MAX_ATTEMPTS,
  FAILURE_STATUS,
  QUARANTINE_COLLECTION,
} from '../../netlify/functions/utils/ingestQuarantine.js';
import { deriveSyncHealth, SYNC_HEALTH } from '../utils/gmailSyncHealth';

function createFakeDb({ failWrites = false } = {}) {
  const store = new Map();
  const doc = (path) => ({
    async get() { return { exists: store.has(path), data: () => store.get(path) }; },
    async set(data, opts) {
      if (failWrites) throw new Error('firestore unavailable');
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
    },
    async delete() { store.delete(path); },
  });
  return {
    store,
    collection: (name) => ({ doc: (id) => doc(`${name}/${id}`) }),
  };
}

const USER = 'user_fixture_0003';
const MSG = 'msg_fixture_wedged';
const key = `${USER}__${MSG}`;

function fail(db, reason = 'FAILED_PRECONDITION: index missing') {
  return recordIngestFailure(db, { userId: USER, gmailMessageId: MSG, reason });
}

describe('bounded retry — a transient failure still holds the cursor', () => {
  let db;
  beforeEach(() => { db = createFakeDb(); });

  it('holds the cursor on every attempt inside the budget', async () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await fail(db);
      expect(result.attempts).toBe(attempt);
      expect(result.quarantined).toBe(false);
      expect(result.holdCursor).toBe(true);
    }
  });

  it('keeps the message marked as retrying, not set aside', async () => {
    await fail(db);
    expect(db.store.get(`${QUARANTINE_COLLECTION}/${key}`).status)
      .toBe(FAILURE_STATUS.RETRYING);
  });

  it('forgets the failure once the message finally ingests', async () => {
    await fail(db);
    await fail(db);
    await clearIngestFailure(db, { userId: USER, gmailMessageId: MSG });
    expect(db.store.has(`${QUARANTINE_COLLECTION}/${key}`)).toBe(false);

    // …so an unrelated hiccup later starts from one again, not from three.
    const afterRecovery = await fail(db);
    expect(afterRecovery.attempts).toBe(1);
    expect(afterRecovery.holdCursor).toBe(true);
  });
});

describe('the wedge is closed — a permanent failure stops blocking', () => {
  let db;
  beforeEach(() => { db = createFakeDb(); });

  it('releases the cursor once the retry budget is spent', async () => {
    let result;
    for (let i = 0; i < MAX_ATTEMPTS; i++) result = await fail(db);

    expect(result.attempts).toBe(MAX_ATTEMPTS);
    expect(result.quarantined).toBe(true);
    expect(result.holdCursor).toBe(false);
  });

  it('stays released on every subsequent encounter', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await fail(db);
    const later = await fail(db);
    expect(later.holdCursor).toBe(false);
    expect(later.attempts).toBe(MAX_ATTEMPTS + 1);
  });

  it('preserves the message and its error rather than discarding either', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await fail(db);
    const record = db.store.get(`${QUARANTINE_COLLECTION}/${key}`);

    expect(record.status).toBe(FAILURE_STATUS.QUARANTINED);
    expect(record.gmailMessageId).toBe(MSG);
    expect(record.idynifyUserId).toBe(USER);
    expect(record.lastError).toContain('FAILED_PRECONDITION');
    expect(record.attempts).toBe(MAX_ATTEMPTS);
  });
});

describe('the escape hatch cannot itself lose mail', () => {
  it('holds the cursor when quarantine bookkeeping fails', async () => {
    // Fails OPEN on purpose: a bug in the escape hatch must not become a new
    // way to skip messages. Unwritable bookkeeping means we keep retrying.
    const db = createFakeDb({ failWrites: true });
    const result = await fail(db);
    expect(result.holdCursor).toBe(true);
    expect(result.quarantined).toBe(false);
  });

  it('holds the cursor for an unkeyable message', async () => {
    const db = createFakeDb();
    const result = await recordIngestFailure(db, {
      userId: USER, gmailMessageId: null, reason: 'no id',
    });
    expect(result.holdCursor).toBe(true);
    expect(failureKey(USER, null)).toBeNull();
  });
});

describe('sync health becomes observable', () => {
  const connected = { status: 'connected', syncStatus: 'idle' };
  const now = Date.parse('2020-05-01T12:00:00.000Z');
  const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();

  it('reports healthy for a mailbox read minutes ago', () => {
    const health = deriveSyncHealth(
      { ...connected, lastSuccessfulSyncAt: minutesAgo(3) }, now
    );
    expect(health.status).toBe(SYNC_HEALTH.HEALTHY);
    expect(health.actionable).toBe(false);
  });

  it('reports stale once sync falls well behind schedule', () => {
    const health = deriveSyncHealth(
      { ...connected, lastSuccessfulSyncAt: minutesAgo(90) }, now
    );
    expect(health.status).toBe(SYNC_HEALTH.STALE);
    expect(health.actionable).toBe(true);
    expect(health.message).toMatch(/replies may not be reflected/i);
  });

  it('reports needs_reconnect ahead of anything else', () => {
    const health = deriveSyncHealth(
      { ...connected, syncStatus: 'needs_reconnect', lastSuccessfulSyncAt: minutesAgo(2) }, now
    );
    expect(health.status).toBe(SYNC_HEALTH.NEEDS_RECONNECT);
    expect(health.actionable).toBe(true);
  });

  it('distinguishes a partial blockade from a stopped sync', () => {
    const health = deriveSyncHealth(
      { ...connected, lastSuccessfulSyncAt: minutesAgo(2), quarantinedCount: 4 }, now
    );
    expect(health.status).toBe(SYNC_HEALTH.DEGRADED);
    expect(health.quarantinedCount).toBe(4);
    expect(health.message).toMatch(/4 messages could not be processed/);
  });

  it('never reports healthy for a disconnected account', () => {
    expect(deriveSyncHealth({ status: 'revoked' }, now).status).toBe(SYNC_HEALTH.DISCONNECTED);
    expect(deriveSyncHealth(null, now).status).toBe(SYNC_HEALTH.DISCONNECTED);
  });

  it('describes the production state the audit found as unhealthy', () => {
    // Gate 2 sampled six accounts: connected, idle, synced ~3 minutes earlier,
    // no error — while 978 replies sat unprocessed. That reads healthy here,
    // and correctly so: sync WAS working. The failure was downstream, which is
    // why quarantinedCount is the signal that makes a blockade visible.
    const looksFine = deriveSyncHealth(
      { ...connected, lastSuccessfulSyncAt: minutesAgo(3) }, now
    );
    expect(looksFine.status).toBe(SYNC_HEALTH.HEALTHY);

    const withBlockade = deriveSyncHealth(
      { ...connected, lastSuccessfulSyncAt: minutesAgo(3), quarantinedCount: 978 }, now
    );
    expect(withBlockade.status).toBe(SYNC_HEALTH.DEGRADED);
    expect(withBlockade.actionable).toBe(true);
  });
});
