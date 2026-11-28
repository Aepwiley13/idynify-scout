/**
 * INBOX INGESTION IS OFF BY DEFAULT (production hotfix)
 *
 * Disabled means: no Firestore query, no OAuth, no Gmail call, no queue
 * processing, no ops alert. Only the exact string 'true' enables it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@netlify/functions', () => ({ schedule: (_cron, handler) => handler }));
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));
const getFirestore = vi.fn(() => ({}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: (...a) => getFirestore(...a), FieldValue: {} }));
const gmailFactory = vi.fn(() => ({}));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {} }, gmail: (...a) => gmailFactory(...a) } }));

const getOAuthClient = vi.fn(async () => null);
vi.mock('../../netlify/functions/utils/gmailMessageService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getOAuthClient: (...a) => getOAuthClient(...a) };
});
const alertOps = vi.fn(async () => {});
vi.mock('../../netlify/functions/utils/alertOps.js', () => ({ alertOps: (...a) => alertOps(...a) }));

const queueCollection = vi.fn();
vi.mock('../../netlify/functions/firebase-admin.js', () => ({ db: { collection: (...a) => queueCollection(...a) } }));

import { isInboxIngestionEnabled } from '../../netlify/functions/utils/inboxIngestionFlag.js';
import { runGmailSync, syncUserInbox, syncHandler, handler as syncScheduled }
  from '../../netlify/functions/gmail-sync-worker.js';
import { processInboxQueue, handler as queueScheduled }
  from '../../netlify/functions/process-barry-inbox-queue.js';

const throwingDb = () => ({
  collection: vi.fn(() => { throw new Error('Firestore must not be touched'); }),
  collectionGroup: vi.fn(() => { throw new Error('Firestore must not be touched'); }),
});
const makeUser = () => ({ userId: 'u1', docRef: { update: vi.fn(async () => {}) }, data: { email: 'a@b.com' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('flag parsing', () => {
  it('is off when unset', () => {
    vi.stubEnv('GMAIL_INBOX_INGESTION_ENABLED', undefined);
    delete process.env.GMAIL_INBOX_INGESTION_ENABLED;
    expect(isInboxIngestionEnabled()).toBe(false);
  });
  it.each(['', 'TRUE', 'True', '1', 'yes', 'on', 'false', ' true', 'true ', 'enabled'])(
    'is off for invalid value %j', (v) => {
      expect(isInboxIngestionEnabled({ GMAIL_INBOX_INGESTION_ENABLED: v })).toBe(false);
    });
  it('is on only for exactly "true"', () => {
    expect(isInboxIngestionEnabled({ GMAIL_INBOX_INGESTION_ENABLED: 'true' })).toBe(true);
  });
});

describe('disabled (default)', () => {
  beforeEach(() => { delete process.env.GMAIL_INBOX_INGESTION_ENABLED; });

  it('runGmailSync discovers no users and queries nothing', async () => {
    const db = throwingDb();
    const r = await runGmailSync(db);
    expect(r.disabled).toBe(true);
    expect(r.usersConsidered).toBe(0);
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.collectionGroup).not.toHaveBeenCalled();
  });

  it('syncUserInbox does no write, OAuth or Gmail call', async () => {
    const user = makeUser();
    const r = await syncUserInbox(throwingDb(), user);
    expect(r.disabled).toBe(true);
    expect(r.processed).toBe(0);
    expect(user.docRef.update).not.toHaveBeenCalled();
    expect(getOAuthClient).not.toHaveBeenCalled();
    expect(gmailFactory).not.toHaveBeenCalled();
  });

  it('syncHandler returns 200 disabled, touches no Firestore, does not alert ops', async () => {
    const res = await syncHandler();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ success: true, disabled: true });
    expect(getFirestore).not.toHaveBeenCalled();
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('the scheduled sync entry point is the guarded handler', async () => {
    const res = await syncScheduled();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).disabled).toBe(true);
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it.each([{}, { httpMethod: 'POST' }])('the queue processor runs no query for %j', async (event) => {
    const res = await processInboxQueue(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).disabled).toBe(true);
    expect(queueCollection).not.toHaveBeenCalled();
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('the scheduled queue entry point is the guarded handler', async () => {
    const res = await queueScheduled({});
    expect(JSON.parse(res.body).disabled).toBe(true);
    expect(queueCollection).not.toHaveBeenCalled();
  });

  it.each(['TRUE', '1', 'yes', ''])('stays disabled for invalid value %j', async (v) => {
    vi.stubEnv('GMAIL_INBOX_INGESTION_ENABLED', v);
    const db = throwingDb();
    expect((await runGmailSync(db)).disabled).toBe(true);
    expect(JSON.parse((await processInboxQueue({})).body).disabled).toBe(true);
    expect(db.collection).not.toHaveBeenCalled();
    expect(queueCollection).not.toHaveBeenCalled();
  });
});

describe('enabled', () => {
  beforeEach(() => { vi.stubEnv('GMAIL_INBOX_INGESTION_ENABLED', 'true'); });

  it('syncUserInbox proceeds to OAuth', async () => {
    const user = makeUser();
    const r = await syncUserInbox({}, user);
    expect(r.disabled).toBeUndefined();
    expect(getOAuthClient).toHaveBeenCalledTimes(1);
  });

  it('runGmailSync queries for connected users', async () => {
    const db = { collection: vi.fn(() => { throw new Error('queried'); }), collectionGroup: vi.fn(() => { throw new Error('queried'); }) };
    await runGmailSync(db).catch(() => {});
    expect(db.collection.mock.calls.length + db.collectionGroup.mock.calls.length).toBeGreaterThan(0);
  });

  it('the queue processor queries the queue', async () => {
    queueCollection.mockImplementation(() => { throw new Error('queried'); });
    await processInboxQueue({});
    expect(queueCollection).toHaveBeenCalledWith('barry_processing_queue');
  });
});

describe('entry points cannot bypass the flag', () => {
  const read = (f) => readFileSync(`netlify/functions/${f}`, 'utf8');
  it('both scheduled files import the switch and wrap the guarded handlers', () => {
    const w = read('gmail-sync-worker.js');
    const q = read('process-barry-inbox-queue.js');
    expect(w).toContain("from './utils/inboxIngestionFlag.js'");
    expect(q).toContain("from './utils/inboxIngestionFlag.js'");
    expect(w).toContain('schedule(SYNC_SCHEDULE, syncHandler)');
    expect(q).toContain('schedule(QUEUE_SCHEDULE, processInboxQueue)');
  });
  it('no other function calls the ingestion entry points', () => {
    const r = read('gmail-reply-sync-worker.js');
    expect(r).not.toMatch(/runGmailSync|syncUserInbox|processInboxQueue/);
  });
});
