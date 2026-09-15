/**
 * The dry-run write boundary.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  OUTSIDE `live`, THIS PIPELINE WRITES EXACTLY ONE COLLECTION:            ║
 * ║      identity_resolution_probe                                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY THIS TEST EXISTS
 * ────────────────────
 * The writer's mode gate sits at Step 5, but four write paths run before it —
 * the communication record, the contact timeline, the relationship context and
 * the unmatched-message row. `dry_run` was therefore "relationship-truth safe"
 * while still leaving user-visible timeline entries on real contacts, which is
 * the opposite of what everyone reads the words "dry run" to mean.
 *
 * Asserting this by reading the source would prove only that the code looks
 * right. These tests drive the real `processNormalizedMessage` against a
 * recording Firestore stub and assert on the writes that actually happen.
 *
 * THE LOAD-BEARING CASE IS `does not consume the backlog`
 * ──────────────────────────────────────────────────────
 * Step 1 de-duplicates on `communication_records`. A dry run that persisted
 * those records would make the eventual switch to `live` skip every message it
 * had already observed. Observing must not consume what it observes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processNormalizedMessage } from '../../netlify/functions/utils/messageProcessor.js';

const UID = 'validation-user';
const CONTACT_ID = 'contact-1';
const SENDER = 'reply@example.com';

/** A recording Firestore stub. Every mutation lands in `writes` with its path. */
function makeDb({ contactExists = true, existingComm = false } = {}) {
  const writes = [];

  const contactDoc = {
    id: CONTACT_ID,
    email: SENDER,
    email_normalized: SENDER,
    conversationState: 'awaiting_response',
    relationship: {},
  };

  const snapOf = (docs) => ({
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map((d) => ({ id: d.id, data: () => d, ref: docRef(`x/${d.id}`) })),
  });

  function resolveQuery(path, clauses) {
    if (path === 'communication_records') {
      return snapOf(existingComm ? [{ id: 'existing', conversationState: null }] : []);
    }
    if (path.endsWith('/contacts')) {
      if (!contactExists) return snapOf([]);
      const eq = clauses.find((c) => c[0] === 'email' || c[0] === 'email_normalized');
      // Exact-identifier lookup, or the bounded fallback scan (no clauses).
      if (!eq) return snapOf([contactDoc]);
      return snapOf(eq[2] === SENDER ? [contactDoc] : []);
    }
    return snapOf([]);
  }

  function query(path, clauses) {
    return {
      where: (f, op, v) => query(path, [...clauses, [f, op, v]]),
      limit: () => query(path, clauses),
      orderBy: () => query(path, clauses),
      get: async () => resolveQuery(path, clauses),
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    };
  }

  function docRef(path) {
    return {
      _path: path,
      id: path.split('/').pop(),
      collection: (sub) => coll(`${path}/${sub}`),
      get: async () => {
        if (path.endsWith(`contacts/${CONTACT_ID}`)) {
          return { exists: contactExists, data: () => contactDoc };
        }
        return { exists: false, data: () => undefined };
      },
      set: async (data) => { writes.push({ op: 'set', path, data }); },
      update: async (data) => { writes.push({ op: 'update', path, data }); },
    };
  }

  function coll(path) {
    return {
      ...query(path, []),
      doc: (id) => docRef(`${path}/${id ?? 'auto'}`),
      add: async (data) => {
        writes.push({ op: 'add', path, data });
        return docRef(`${path}/generated`);
      },
    };
  }

  return {
    writes,
    collection: (name) => coll(name),
    runTransaction: async (fn) => fn({
      get: async (ref) => ref.get(),
      create: (ref, data) => { writes.push({ op: 'create', path: ref._path, data }); },
      update: (ref, data) => { writes.push({ op: 'update', path: ref._path, data }); },
    }),
  };
}

const message = (over = {}) => ({
  idynifyUserId: UID,
  gmailAccountId: 'me@example.com',
  gmailMessageId: 'msg-abc',
  gmailThreadId: 'thread-1',
  direction: 'inbound',
  category: 'reply',
  fromEmail: SENDER,
  fromName: 'A Sender',
  toEmails: ['me@example.com'],
  ccEmails: [],
  subject: 'Re: hello',
  receivedAt: '2026-09-15T10:00:00.000Z',
  bodyText: 'thanks, sounds good',
  bodyHtml: null,
  quotedReplyText: null,
  signature: null,
  attachments: [],
  threadMessageCount: 2,
  isFirstMessageInThread: false,
  ingestedAt: '2026-09-15T10:00:01.000Z',
  ingestionVersion: 'test',
  ...over,
});

/** Distinct top-level collections touched, so a path under users/ still reads clearly. */
const touched = (writes) => [...new Set(writes.map((w) => w.path.split('/')[0]))].sort();

let saved;
beforeEach(() => { saved = process.env.GMAIL_IDENTITY_MODE; });
afterEach(() => {
  if (saved === undefined) delete process.env.GMAIL_IDENTITY_MODE;
  else process.env.GMAIL_IDENTITY_MODE = saved;
});

describe('dry_run writes only the probe', () => {
  it('writes nothing but identity_resolution_probe on a matched message', async () => {
    delete process.env.GMAIL_IDENTITY_MODE;
    const db = makeDb();

    const result = await processNormalizedMessage(db, message());

    expect(result.success).toBe(true);
    expect(result.observedOnly).toBe(true);
    expect(touched(db.writes)).toEqual(['identity_resolution_probe']);
  });

  it('writes no communication record, timeline entry, context or queue entry', async () => {
    delete process.env.GMAIL_IDENTITY_MODE;
    const db = makeDb();

    await processNormalizedMessage(db, message());

    const paths = db.writes.map((w) => w.path).join(' ');
    for (const forbidden of ['communication_records', 'timeline', 'relationship_context',
                             'barry_processing_queue', 'unmatched_messages',
                             'relationship_events']) {
      expect(paths).not.toContain(forbidden);
    }
  });

  it('records a MISS in the probe too, so the signal is a rate and not a count', async () => {
    delete process.env.GMAIL_IDENTITY_MODE;
    const db = makeDb({ contactExists: false });

    await processNormalizedMessage(db, message());

    expect(touched(db.writes)).toEqual(['identity_resolution_probe']);
    const probe = db.writes.find((w) => w.path.startsWith('identity_resolution_probe'));
    expect(probe.data.contactId).toBeNull();
    // An unresolved sender must NOT land in unmatched_messages during a dry run.
    expect(db.writes.some((w) => w.path.includes('unmatched_messages'))).toBe(false);
  });

  it('probes nothing for automated mail, matching the live path', async () => {
    delete process.env.GMAIL_IDENTITY_MODE;
    const db = makeDb();

    await processNormalizedMessage(db, message({ category: 'automated' }));

    expect(db.writes).toEqual([]);
  });

  it.each([['dry_run'], ['LIVE'], ['Live'], [' live'], ['live '], ['true'], ['']])(
    'treats %s as not-live and still writes only the probe',
    async (mode) => {
      process.env.GMAIL_IDENTITY_MODE = mode;
      const db = makeDb();

      await processNormalizedMessage(db, message());

      expect(touched(db.writes)).toEqual(['identity_resolution_probe']);
    }
  );
});

describe('a dry run does not consume the backlog', () => {
  it('leaves no communication record, so live can still process the message', async () => {
    delete process.env.GMAIL_IDENTITY_MODE;
    const dry = makeDb();
    await processNormalizedMessage(dry, message());

    // Nothing was persisted to the collection Step 1 de-duplicates on...
    expect(dry.writes.some((w) => w.path === 'communication_records')).toBe(false);

    // ...so the same message, processed later in live, is NOT treated as seen.
    process.env.GMAIL_IDENTITY_MODE = 'live';
    const live = makeDb({ existingComm: false });
    const result = await processNormalizedMessage(live, message());

    expect(live.writes.some((w) => w.path === 'communication_records')).toBe(true);
    expect(result.messageRecordId).not.toBeNull();
  });
});

describe('live behaviour is unchanged', () => {
  it('still writes the record, the timeline entry and the canonical event', async () => {
    process.env.GMAIL_IDENTITY_MODE = 'live';
    const db = makeDb();

    const result = await processNormalizedMessage(db, message());

    expect(result.success).toBe(true);
    expect(result.observedOnly).toBeUndefined();

    const paths = db.writes.map((w) => w.path);
    expect(paths).toContain('communication_records');
    expect(paths.some((p) => p.includes('/timeline'))).toBe(true);
    expect(paths.some((p) => p.startsWith('relationship_events'))).toBe(true);
    // And the probe is a dry-run diagnostic only — live must not write it.
    expect(paths.some((p) => p.startsWith('identity_resolution_probe'))).toBe(false);
  });

  it('still routes an unresolved sender to unmatched_messages', async () => {
    process.env.GMAIL_IDENTITY_MODE = 'live';
    const db = makeDb({ contactExists: false });

    await processNormalizedMessage(db, message());

    expect(db.writes.some((w) => w.path === 'unmatched_messages')).toBe(true);
  });
});
