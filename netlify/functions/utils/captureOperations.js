/**
 * The capture operation record (architecture sections 12 and 23).
 *
 * One server-only document per scan, users/{uid}/capture_operations/{operationId},
 * moving through six states. Retries and replays are decided by reading this
 * one document. Firestore rules deny every client read and write.
 *
 *   created ─► extracted ─► previewed ─► committed
 *      │  └──────────────────►  ▲  │          │
 *      │                        └──┘          └─ repeat commit: replayed, no write
 *      └─► failed (also from extracted)
 *   any open state ─► expired, 24 h after its last activity
 *
 * VALUES-FREE. The record holds state, versions, hashes, timings, counts,
 * error codes and result IDs, never what was on the card: no name, email,
 * phone, title, company, website, address or image. That is enforced, not
 * hoped for. Each transition accepts only its own fields, and every string is
 * held to a code-like format (a lower-case token, a sha256 hash, an ID), so
 * free text such as "Jane Smith" or "jane@acme.com" cannot be written.
 *
 * Retention metadata: an open record expires 24 h after its last activity, a
 * committed one after 90 days (expiresAt, for a Firestore TTL policy or a
 * cleanup job; neither is configured here).
 *
 * `db` is an Admin SDK Firestore instance, passed in by the caller.
 */

export const OPERATIONS_COLLECTION = 'capture_operations';

export const STATES = Object.freeze({
  CREATED: 'created',
  EXTRACTED: 'extracted',
  PREVIEWED: 'previewed',
  COMMITTED: 'committed',
  FAILED: 'failed',
  EXPIRED: 'expired',
});

const OPEN_STATES = new Set([STATES.CREATED, STATES.EXTRACTED, STATES.PREVIEWED]);

/** Allowed transitions, from section 23. committed → committed is a replay, handled separately. */
export const TRANSITIONS = Object.freeze({
  [STATES.CREATED]: Object.freeze([STATES.EXTRACTED, STATES.PREVIEWED, STATES.FAILED, STATES.EXPIRED]),
  [STATES.EXTRACTED]: Object.freeze([STATES.PREVIEWED, STATES.FAILED, STATES.EXPIRED]),
  [STATES.PREVIEWED]: Object.freeze([STATES.PREVIEWED, STATES.COMMITTED, STATES.EXPIRED]),
  [STATES.COMMITTED]: Object.freeze([]),
  [STATES.FAILED]: Object.freeze([]),
  [STATES.EXPIRED]: Object.freeze([]),
});

export const OPEN_TTL_MS = 24 * 60 * 60 * 1000;
export const COMMITTED_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** cap_ + a lower-case UUIDv4, minted by the client when capture starts (section 12). */
export const OPERATION_ID_PATTERN = /^cap_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const ERRORS = Object.freeze({
  INVALID_OPERATION_ID: 'invalid_operation_id',
  INVALID_USER: 'invalid_user',
  NOT_FOUND: 'operation_not_found',
  EXPIRED: 'operation_expired',
  INVALID_TRANSITION: 'invalid_transition',
  STALE_PREVIEW: 'stale_preview',
  FIELD_NOT_ALLOWED: 'field_not_allowed',
  INVALID_FIELD: 'invalid_field',
});

export class CaptureOperationError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CaptureOperationError';
    this.code = code;
  }
}

// ─── The values-free field schema ───────────────────────────────────────────

const TOKEN = /^[a-z0-9][a-z0-9._:/-]{0,63}$/;          // provider, model, prompt version
const HASH = /^sha256:[0-9a-f]{64}$/;                    // previewFingerprint, identityInputsHash
const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;                 // contact and company IDs
const EVENT_ID = /^rev_[a-z2-7]{20}$/;                   // relationshipEventId (section 12)
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

const isToken = v => typeof v === 'string' && TOKEN.test(v);
const isHash = v => typeof v === 'string' && HASH.test(v);
const isDocId = v => typeof v === 'string' && DOC_ID.test(v);
const isCount = v => Number.isInteger(v) && v >= 0 && v <= 1000;
const isMs = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 600000;
const oneOf = values => v => values.includes(v);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

/** An object whose keys are all known and whose values each pass their check. */
function shape(checks, required = []) {
  return (value, path) => {
    if (!isPlainObject(value)) throw new CaptureOperationError(ERRORS.INVALID_FIELD, path);
    for (const key of Object.keys(value)) {
      if (!checks[key]) throw new CaptureOperationError(ERRORS.FIELD_NOT_ALLOWED, `${path}.${key}`);
      checks[key](value[key], `${path}.${key}`);
    }
    for (const key of required) {
      if (!(key in value)) throw new CaptureOperationError(ERRORS.INVALID_FIELD, `${path}.${key} is required`);
    }
  };
}

function scalar(test) {
  return (value, path) => {
    if (!test(value)) throw new CaptureOperationError(ERRORS.INVALID_FIELD, path);
  };
}

/** Non-retryable failures (section 23). Retryable ones leave the state unchanged. */
export const FAILURE_CODES = Object.freeze(['image_rejected', 'no_text', 'config_error']);

/** The fields each transition may write, and nothing else. */
const PATCH_SCHEMA = Object.freeze({
  [STATES.EXTRACTED]: shape({
    extraction: shape({
      status: scalar(oneOf(['ok', 'partial'])),
      provider: scalar(isToken),
      model: scalar(isToken),
      promptVersion: scalar(isToken),
      ms: scalar(isMs),
      fieldCount: scalar(isCount),
    }, ['status', 'provider', 'model', 'promptVersion']),
  }, ['extraction']),
  [STATES.PREVIEWED]: shape({
    previewFingerprint: scalar(isHash),
    identityInputsHash: scalar(isHash),
    // Only on created → previewed: manual entry, or a resumed expired scan.
    extraction: shape({ status: scalar(oneOf(['manual', 'resumed'])) }, ['status']),
  }, ['previewFingerprint', 'identityInputsHash']),
  [STATES.FAILED]: shape({ errorCode: scalar(oneOf(FAILURE_CODES)) }, ['errorCode']),
  [STATES.COMMITTED]: shape({
    result: shape({
      contactId: scalar(isDocId),
      companyId: scalar(v => v === null || isDocId(v)),
      relationshipEventIds: scalar(v => Array.isArray(v) && v.length <= 5
        && v.every(id => typeof id === 'string' && EVENT_ID.test(id))),
    }, ['contactId', 'relationshipEventIds']),
  }, ['result']),
  [STATES.EXPIRED]: shape({}),
});

/** Throws unless `patch` is exactly what a transition to `to` may store. */
export function validatePatch(to, patch, from = null) {
  const check = PATCH_SCHEMA[to];
  if (!check) throw new CaptureOperationError(ERRORS.INVALID_TRANSITION, `no patch for ${to}`);
  check(patch ?? {}, 'patch');
  if (to === STATES.PREVIEWED && patch?.extraction && from !== STATES.CREATED) {
    throw new CaptureOperationError(ERRORS.FIELD_NOT_ALLOWED, 'patch.extraction is set only on created → previewed');
  }
}

// ─── Pure rules ─────────────────────────────────────────────────────────────

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function isOpen(state) {
  return OPEN_STATES.has(state);
}

/** Milliseconds from a Firestore Timestamp, a Date or a number. */
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

/** An open record whose last activity was 24 h or more before `now`. */
export function isStale(operation, now) {
  if (!isOpen(operation?.state)) return false;
  const last = toMillis(operation.lastActivityAt);
  return last == null || now.getTime() - last >= OPEN_TTL_MS;
}

function assertIds(uid, operationId) {
  if (typeof uid !== 'string' || !USER_ID.test(uid)) throw new CaptureOperationError(ERRORS.INVALID_USER);
  if (typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) {
    throw new CaptureOperationError(ERRORS.INVALID_OPERATION_ID);
  }
}

export function operationRef(db, uid, operationId) {
  return db.collection('users').doc(uid).collection(OPERATIONS_COLLECTION).doc(operationId);
}

function expiredFields(now) {
  return { state: STATES.EXPIRED, expiredAt: now, updatedAt: now };
}

// ─── Store ──────────────────────────────────────────────────────────────────

/**
 * Create the record in state `created`. A second create with the same
 * operationId returns the existing record unchanged (created: false), except
 * that a stale open record is marked expired on this touch.
 *
 * Returns { operation, created }.
 */
export async function createOperation(db, { uid, operationId, now = new Date() }) {
  assertIds(uid, operationId);
  const ref = operationRef(db, uid, operationId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data();
      if (isStale(existing, now)) {
        const update = expiredFields(now);
        tx.update(ref, update);
        return { operation: { ...existing, ...update }, created: false };
      }
      return { operation: existing, created: false };
    }
    const operation = {
      operationId,
      state: STATES.CREATED,
      previewVersion: 0,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + OPEN_TTL_MS),
    };
    tx.create(ref, operation);
    return { operation, created: true };
  });
}

/**
 * Move the record to `to`, writing only the fields that transition allows.
 *
 *   - A stale open record is marked expired and operation_expired is thrown.
 *   - committed → committed writes nothing and returns { replayed: true }.
 *   - previewed → committed requires expectedPreviewVersion to equal the
 *     record's previewVersion (stale_preview otherwise).
 *   - Each preview increments previewVersion.
 *
 * Returns { operation, replayed }.
 */
export async function transitionOperation(db, {
  uid, operationId, to, patch = {}, expectedPreviewVersion, now = new Date(),
}) {
  assertIds(uid, operationId);
  const ref = operationRef(db, uid, operationId);
  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { error: ERRORS.NOT_FOUND };
    const current = snapshot.data();

    if (current.state === STATES.COMMITTED && to === STATES.COMMITTED) {
      return { operation: current, replayed: true };
    }
    if (isStale(current, now)) {
      // Written, then reported: a transaction that throws would discard this write.
      tx.update(ref, expiredFields(now));
      return { error: ERRORS.EXPIRED };
    }
    if (!canTransition(current.state, to)) {
      return { error: ERRORS.INVALID_TRANSITION, detail: `${current.state} → ${to}` };
    }
    validatePatch(to, patch, current.state);
    if (to === STATES.COMMITTED && expectedPreviewVersion !== current.previewVersion) {
      return { error: ERRORS.STALE_PREVIEW };
    }

    const update = { ...patch, state: to, updatedAt: now };
    if (to === STATES.EXPIRED) {
      update.expiredAt = now;
    } else {
      update.lastActivityAt = now;
      update.expiresAt = new Date(now.getTime() + (to === STATES.COMMITTED ? COMMITTED_TTL_MS : OPEN_TTL_MS));
    }
    if (to === STATES.PREVIEWED) update.previewVersion = (current.previewVersion ?? 0) + 1;
    if (to === STATES.COMMITTED) update.committedAt = now;
    if (to === STATES.FAILED) update.failedAt = now;

    tx.update(ref, update);
    return { operation: { ...current, ...update }, replayed: false };
  });

  if (outcome.error) throw new CaptureOperationError(outcome.error, outcome.detail);
  return outcome;
}
