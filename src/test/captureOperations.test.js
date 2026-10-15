/**
 * The capture operation record (architecture sections 12 and 23).
 *
 * Holds the state machine to the approved table, pins idempotent create and
 * commit, lazy 24-hour expiry, the 24 h / 90 day retention metadata, and the
 * values-free rule: nothing that was on the card can be written to the record.
 *
 * The database is an in-memory stand-in with Firestore's transaction shape:
 * writes are staged and applied only when the callback returns, and
 * tx.create fails on an existing document.
 */
import { describe, it, expect } from 'vitest';
import {
  STATES, TRANSITIONS, OPEN_TTL_MS, COMMITTED_TTL_MS, OPERATION_ID_PATTERN, ERRORS, FAILURE_CODES,
  OPERATIONS_COLLECTION, CaptureOperationError,
  canTransition, isStale, toMillis, validatePatch, operationRef, createOperation, transitionOperation,
} from '../../netlify/functions/utils/captureOperations.js';

// ─── In-memory Firestore with transactions ─────────────────────────────────

function memoryDb() {
  const docs = new Map();
  let writes = 0;
  const ref = path => ({ path, collection: name => coll(`${path}/${name}`) });
  const coll = path => ({ doc: id => ref(`${path}/${id}`) });
  return {
    docs,
    writes: () => writes,
    collection: name => coll(name),
    async runTransaction(fn) {
      const staged = [];
      const tx = {
        get: async r => ({ exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)) }),
        create: (r, data) => staged.push(() => {
          if (docs.has(r.path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
          docs.set(r.path, structuredClone(data));
        }),
        update: (r, data) => staged.push(() => {
          if (!docs.has(r.path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
          docs.set(r.path, { ...docs.get(r.path), ...structuredClone(data) });
        }),
      };
      const result = await fn(tx);
      for (const write of staged) { write(); writes += 1; }
      return result;
    },
  };
}

const UID = 'uid_7g5gbY';
const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const T0 = new Date('2026-10-15T12:00:00Z');
const at = ms => new Date(T0.getTime() + ms);
const pathOf = (uid = UID, op = OP) => `users/${uid}/${OPERATIONS_COLLECTION}/${op}`;
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const EVENT = `rev_${'abcdefghijklmnopqrst'}`;

const PATCHES = {
  [STATES.EXTRACTED]: {
    extraction: { status: 'ok', provider: 'claude_vision', model: 'claude-model-x', promptVersion: 'card-extraction/v1', ms: 1840, fieldCount: 7 },
  },
  [STATES.PREVIEWED]: { previewFingerprint: HASH_A, identityInputsHash: HASH_B },
  [STATES.FAILED]: { errorCode: 'no_text' },
  [STATES.COMMITTED]: { result: { contactId: 'k8Hq2LmN', companyId: null, relationshipEventIds: [EVENT] } },
  [STATES.EXPIRED]: {},
  [STATES.CREATED]: {},
};

/** Put a record directly into `state`, as if earlier transitions had happened. */
function seed(db, state, extra = {}) {
  db.docs.set(pathOf(), {
    operationId: OP, state, previewVersion: state === STATES.PREVIEWED ? 1 : 0,
    createdAt: T0, updatedAt: T0, lastActivityAt: T0, expiresAt: at(OPEN_TTL_MS), ...extra,
  });
}

async function expectCode(promise, code) {
  const error = await promise.then(() => null, e => e);
  expect(error, `expected ${code}`).toBeInstanceOf(CaptureOperationError);
  expect(error.code).toBe(code);
}

// ─── The table ──────────────────────────────────────────────────────────────

describe('the approved transition table', () => {
  it('is exactly section 23', () => {
    expect(TRANSITIONS).toEqual({
      created: ['extracted', 'previewed', 'failed', 'expired'],
      extracted: ['previewed', 'failed', 'expired'],
      previewed: ['previewed', 'committed', 'expired'],
      committed: [],
      failed: [],
      expired: [],
    });
  });

  const ALL = Object.values(STATES);
  const pairs = ALL.flatMap(from => ALL.map(to => [from, to]));

  it.each(pairs)('%s → %s', async (from, to) => {
    const db = memoryDb();
    seed(db, from);
    const before = db.writes();
    const attempt = transitionOperation(db, {
      uid: UID, operationId: OP, to, patch: PATCHES[to], expectedPreviewVersion: 1, now: at(60_000),
    });
    if (from === STATES.COMMITTED && to === STATES.COMMITTED) {
      const { replayed } = await attempt;
      expect(replayed).toBe(true);
      expect(db.writes()).toBe(before);
    } else if (canTransition(from, to)) {
      const { operation, replayed } = await attempt;
      expect(replayed).toBe(false);
      expect(operation.state).toBe(to);
      expect(db.docs.get(pathOf()).state).toBe(to);
    } else {
      await expectCode(attempt, ERRORS.INVALID_TRANSITION);
      expect(db.docs.get(pathOf()).state).toBe(from);
      expect(db.writes()).toBe(before);
    }
  });
});

// ─── Create ─────────────────────────────────────────────────────────────────

describe('createOperation', () => {
  it('creates the record in state created, with 24-hour expiry metadata', async () => {
    const db = memoryDb();
    const { operation, created } = await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    expect(created).toBe(true);
    expect(db.docs.get(pathOf())).toEqual({
      operationId: OP, state: 'created', previewVersion: 0,
      createdAt: T0, updatedAt: T0, lastActivityAt: T0, expiresAt: at(OPEN_TTL_MS),
    });
    expect(operation.state).toBe('created');
  });

  it('a second create with the same operationId returns the existing record and writes nothing', async () => {
    const db = memoryDb();
    await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'extracted', patch: PATCHES.extracted, now: at(1000) });
    const writes = db.writes();
    const { operation, created } = await createOperation(db, { uid: UID, operationId: OP, now: at(2000) });
    expect(created).toBe(false);
    expect(operation.state).toBe('extracted');
    expect(db.writes()).toBe(writes);
  });

  it('a create that finds a stale open record marks it expired', async () => {
    const db = memoryDb();
    seed(db, STATES.PREVIEWED);
    const { operation, created } = await createOperation(db, { uid: UID, operationId: OP, now: at(OPEN_TTL_MS) });
    expect(created).toBe(false);
    expect(operation.state).toBe('expired');
    expect(db.docs.get(pathOf()).state).toBe('expired');
  });

  it('keeps operations of different users apart', async () => {
    const db = memoryDb();
    await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    const { created } = await createOperation(db, { uid: 'uid_other', operationId: OP, now: T0 });
    expect(created).toBe(true);
    expect(operationRef(db, 'uid_other', OP).path).toBe(pathOf('uid_other'));
  });

  it.each([
    ['no prefix', '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'],
    ['upper case', 'cap_3F2A9C1E-5B7D-4E8A-9C21-7D4E5F6A8B90'],
    ['UUID v1', 'cap_3f2a9c1e-5b7d-1e8a-9c21-7d4e5f6a8b90'],
    ['trailing text', `${OP}x`],
    ['path segment', 'cap_../../users/other'],
    ['empty', ''],
  ])('refuses an operationId with %s', async (_, operationId) => {
    expect(OPERATION_ID_PATTERN.test(operationId)).toBe(false);
    await expectCode(createOperation(memoryDb(), { uid: UID, operationId }), ERRORS.INVALID_OPERATION_ID);
  });

  it.each([['empty', ''], ['slash', 'a/b'], ['not a string', 42]])('refuses a uid that is %s', async (_, uid) => {
    await expectCode(createOperation(memoryDb(), { uid, operationId: OP }), ERRORS.INVALID_USER);
  });
});

// ─── Preview, commit, replay ────────────────────────────────────────────────

describe('the scan lifecycle', () => {
  async function toPreviewed(db) {
    await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'extracted', patch: PATCHES.extracted, now: at(1000) });
    return transitionOperation(db, { uid: UID, operationId: OP, to: 'previewed', patch: PATCHES.previewed, now: at(2000) });
  }

  it('each preview increments previewVersion and pushes expiry out 24 hours', async () => {
    const db = memoryDb();
    const first = await toPreviewed(db);
    expect(first.operation.previewVersion).toBe(1);
    const second = await transitionOperation(db, {
      uid: UID, operationId: OP, to: 'previewed', patch: { previewFingerprint: HASH_B, identityInputsHash: HASH_A }, now: at(5000),
    });
    expect(second.operation.previewVersion).toBe(2);
    expect(db.docs.get(pathOf())).toMatchObject({ previewVersion: 2, lastActivityAt: at(5000), expiresAt: at(5000 + OPEN_TTL_MS) });
  });

  it('commit requires the matching previewVersion', async () => {
    const db = memoryDb();
    await toPreviewed(db);
    await expectCode(transitionOperation(db, { uid: UID, operationId: OP, to: 'committed', patch: PATCHES.committed, expectedPreviewVersion: 0, now: at(3000) }), ERRORS.STALE_PREVIEW);
    await expectCode(transitionOperation(db, { uid: UID, operationId: OP, to: 'committed', patch: PATCHES.committed, now: at(3000) }), ERRORS.STALE_PREVIEW);
    expect(db.docs.get(pathOf()).state).toBe('previewed');
  });

  it('commit stores the result IDs and 90-day expiry metadata', async () => {
    const db = memoryDb();
    await toPreviewed(db);
    const { operation, replayed } = await transitionOperation(db, {
      uid: UID, operationId: OP, to: 'committed', patch: PATCHES.committed, expectedPreviewVersion: 1, now: at(3000),
    });
    expect(replayed).toBe(false);
    expect(operation.result).toEqual(PATCHES.committed.result);
    expect(db.docs.get(pathOf())).toMatchObject({
      state: 'committed', committedAt: at(3000), expiresAt: at(3000 + COMMITTED_TTL_MS),
    });
  });

  it('a repeat commit writes nothing and replays the stored result', async () => {
    const db = memoryDb();
    await toPreviewed(db);
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'committed', patch: PATCHES.committed, expectedPreviewVersion: 1, now: at(3000) });
    const writes = db.writes();
    const stored = structuredClone(db.docs.get(pathOf()));
    const replay = await transitionOperation(db, {
      uid: UID, operationId: OP, to: 'committed', expectedPreviewVersion: 99, now: at(OPEN_TTL_MS * 5),
      patch: { result: { contactId: 'different', companyId: null, relationshipEventIds: [] } },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.operation.result).toEqual(PATCHES.committed.result);
    expect(db.writes()).toBe(writes);
    expect(db.docs.get(pathOf())).toEqual(stored);
  });

  it('a stored record has only the known fields', async () => {
    const db = memoryDb();
    await toPreviewed(db);
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'committed', patch: PATCHES.committed, expectedPreviewVersion: 1, now: at(3000) });
    expect(Object.keys(db.docs.get(pathOf())).sort()).toEqual([
      'committedAt', 'createdAt', 'expiresAt', 'extraction', 'identityInputsHash', 'lastActivityAt',
      'operationId', 'previewFingerprint', 'previewVersion', 'result', 'state', 'updatedAt',
    ]);
  });

  it('manual entry goes straight from created to previewed', async () => {
    const db = memoryDb();
    await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    const { operation } = await transitionOperation(db, {
      uid: UID, operationId: OP, to: 'previewed', patch: { ...PATCHES.previewed, extraction: { status: 'manual' } }, now: at(1000),
    });
    expect(operation).toMatchObject({ state: 'previewed', previewVersion: 1, extraction: { status: 'manual' } });
  });

  it('a non-retryable failure is terminal', async () => {
    const db = memoryDb();
    await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'failed', patch: { errorCode: 'image_rejected' }, now: at(1000) });
    expect(db.docs.get(pathOf())).toMatchObject({ state: 'failed', failedAt: at(1000), expiresAt: at(1000 + OPEN_TTL_MS) });
    await expectCode(transitionOperation(db, { uid: UID, operationId: OP, to: 'extracted', patch: PATCHES.extracted, now: at(2000) }), ERRORS.INVALID_TRANSITION);
  });

  it('only non-retryable codes may fail an operation', async () => {
    expect(FAILURE_CODES).toEqual(['image_rejected', 'no_text', 'config_error']);
    for (const errorCode of ['timeout', 'rate_limited', 'unavailable', 'invalid_output', 'network']) {
      const db = memoryDb();
      seed(db, STATES.CREATED);
      await expectCode(transitionOperation(db, { uid: UID, operationId: OP, to: 'failed', patch: { errorCode }, now: at(1000) }), ERRORS.INVALID_FIELD);
      expect(db.docs.get(pathOf()).state).toBe('created');
    }
  });

  it('a missing record is operation_not_found', async () => {
    await expectCode(transitionOperation(memoryDb(), { uid: UID, operationId: OP, to: 'extracted', patch: PATCHES.extracted }), ERRORS.NOT_FOUND);
  });
});

// ─── Expiry ─────────────────────────────────────────────────────────────────

describe('24-hour expiry of open records', () => {
  it.each([STATES.CREATED, STATES.EXTRACTED, STATES.PREVIEWED])('a %s record idle for 24 h is expired on the next touch', async (state) => {
    const db = memoryDb();
    seed(db, state);
    const to = state === STATES.CREATED ? 'extracted' : 'previewed';
    await expectCode(transitionOperation(db, {
      uid: UID, operationId: OP, to, patch: PATCHES[to], now: at(OPEN_TTL_MS),
    }), ERRORS.EXPIRED);
    expect(db.docs.get(pathOf())).toMatchObject({ state: 'expired', expiredAt: at(OPEN_TTL_MS) });
  });

  it('a record idle for just under 24 h is still open', async () => {
    const db = memoryDb();
    seed(db, STATES.PREVIEWED);
    const { operation } = await transitionOperation(db, {
      uid: UID, operationId: OP, to: 'previewed', patch: PATCHES.previewed, now: at(OPEN_TTL_MS - 1),
    });
    expect(operation.state).toBe('previewed');
  });

  it('a committed record never expires through this path', () => {
    expect(isStale({ state: 'committed', lastActivityAt: T0 }, at(COMMITTED_TTL_MS * 2))).toBe(false);
  });

  it('reads Firestore Timestamps, Dates and numbers', () => {
    expect(toMillis({ toMillis: () => 123 })).toBe(123);
    expect(toMillis(new Date(456))).toBe(456);
    expect(toMillis(789)).toBe(789);
    expect(toMillis(null)).toBe(null);
    expect(isStale({ state: 'created', lastActivityAt: { toMillis: () => T0.getTime() } }, at(OPEN_TTL_MS))).toBe(true);
  });
});

// ─── Values-free ────────────────────────────────────────────────────────────

describe('no card, contact or company values can be stored', () => {
  const CARD = {
    name: 'Jane Smith', email: 'jane.smith@acmerockets.com', phone: '+1 (415) 555-0142', title: 'VP of Sales',
    company: 'Acme Rockets Inc', website: 'https://acmerockets.com', address: '123 Market Street',
  };

  const attempts = [
    ['a name field', 'extracted', { ...PATCHES.extracted, name: CARD.name }, ERRORS.FIELD_NOT_ALLOWED],
    ['an email field', 'previewed', { ...PATCHES.previewed, email: CARD.email }, ERRORS.FIELD_NOT_ALLOWED],
    ['the whole extraction', 'extracted', { extraction: { ...PATCHES.extracted.extraction, fields: CARD } }, ERRORS.FIELD_NOT_ALLOWED],
    ['raw OCR text', 'extracted', { ...PATCHES.extracted, rawText: Object.values(CARD).join('\n') }, ERRORS.FIELD_NOT_ALLOWED],
    ['an image', 'extracted', { ...PATCHES.extracted, imageBase64: 'iVBORw0KGgo=' }, ERRORS.FIELD_NOT_ALLOWED],
    ['a name as the provider', 'extracted', { extraction: { ...PATCHES.extracted.extraction, provider: CARD.name } }, ERRORS.INVALID_FIELD],
    ['an email as the model', 'extracted', { extraction: { ...PATCHES.extracted.extraction, model: CARD.email } }, ERRORS.INVALID_FIELD],
    ['a company as the prompt version', 'extracted', { extraction: { ...PATCHES.extracted.extraction, promptVersion: CARD.company } }, ERRORS.INVALID_FIELD],
    ['a phone as the fingerprint', 'previewed', { ...PATCHES.previewed, previewFingerprint: CARD.phone }, ERRORS.INVALID_FIELD],
    ['a title as the identity hash', 'previewed', { ...PATCHES.previewed, identityInputsHash: CARD.title }, ERRORS.INVALID_FIELD],
    ['an email as the contact ID', 'committed', { result: { ...PATCHES.committed.result, contactId: CARD.email } }, ERRORS.INVALID_FIELD],
    ['a company name as the company ID', 'committed', { result: { ...PATCHES.committed.result, companyId: CARD.company } }, ERRORS.INVALID_FIELD],
    ['an address as an event ID', 'committed', { result: { ...PATCHES.committed.result, relationshipEventIds: [CARD.address] } }, ERRORS.INVALID_FIELD],
    ['a website in the result', 'committed', { result: { ...PATCHES.committed.result, website: CARD.website } }, ERRORS.FIELD_NOT_ALLOWED],
    ['a nested object for a count', 'extracted', { extraction: { ...PATCHES.extracted.extraction, fieldCount: { name: CARD.name } } }, ERRORS.INVALID_FIELD],
    ['an error message instead of a code', 'failed', { errorCode: `no text on ${CARD.name}'s card` }, ERRORS.INVALID_FIELD],
    ['a field on expire', 'expired', { note: CARD.name }, ERRORS.FIELD_NOT_ALLOWED],
  ];

  it.each(attempts)('refuses %s', async (_, to, patch, code) => {
    const db = memoryDb();
    const from = { extracted: 'created', previewed: 'extracted', committed: 'previewed', failed: 'created', expired: 'created' }[to];
    seed(db, from);
    await expectCode(transitionOperation(db, {
      uid: UID, operationId: OP, to, patch, expectedPreviewVersion: 1, now: at(1000),
    }), code);
    const stored = JSON.stringify([...db.docs.values()]).toLowerCase();
    for (const value of Object.values(CARD)) expect(stored).not.toContain(value.toLowerCase());
    expect(db.docs.get(pathOf()).state).toBe(from);
  });

  it('refuses the manual status on an extracted → previewed transition', () => {
    expect(() => validatePatch('previewed', { ...PATCHES.previewed, extraction: { status: 'manual' } }, 'extracted'))
      .toThrow(CaptureOperationError);
  });

  it('a full lifecycle stores none of the card values', async () => {
    const db = memoryDb();
    await createOperation(db, { uid: UID, operationId: OP, now: T0 });
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'extracted', patch: PATCHES.extracted, now: at(1) });
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'previewed', patch: PATCHES.previewed, now: at(2) });
    await transitionOperation(db, { uid: UID, operationId: OP, to: 'committed', patch: PATCHES.committed, expectedPreviewVersion: 1, now: at(3) });
    const stored = JSON.stringify([...db.docs.values()]).toLowerCase();
    for (const value of [...Object.values(CARD), 'jane', 'smith', 'acme', '555-0142', '@']) {
      expect(stored).not.toContain(value.toLowerCase());
    }
  });
});
