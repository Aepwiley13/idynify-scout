/**
 * validationInvoker — authorization and audit for the one-message validation
 * entrypoint. Decides whether a request may proceed; never processes anything.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY CHECK IS A REFUSAL, NOT A FILTER.                                 ║
 * ║                                                                          ║
 * ║  Nothing is inferred, defaulted, trimmed into existence, or narrowed. A  ║
 * ║  request that does not name precisely one message in precisely one       ║
 * ║  allowlisted tenant is rejected outright. There is no "most recent", no  ║
 * ║  "first unmatched", no wildcard — those are the shapes that turn a       ║
 * ║  validation tool into an accidental bulk processor.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── WHAT THE FIRST VERSION GOT WRONG ───────────────────────────────────────
 *
 * An audit of the previous draft found four things worth naming, because each
 * is a class of mistake rather than a typo:
 *
 *   The header claimed a MODE gate that the code never implemented. The string
 *   GMAIL_IDENTITY_MODE appeared once, in a comment. Documentation asserting a
 *   guarantee it does not enforce is worse than silence, because it is what a
 *   reviewer reads instead of the code.
 *
 *   Broad requests were refused by DENYLIST — ten known bulk field names. A
 *   field nobody thought of, like `range`, sailed through. The set of ways to
 *   ask for too much is open-ended; the set of fields this endpoint needs is
 *   three. Enumerate the small one.
 *
 *   The token was compared with `!==`, which leaks timing on the one secret
 *   standing between a request and a real message-processing path.
 *
 *   The audit log spread a caller-supplied object straight into Firestore, so
 *   a caller passing the raw request body would have persisted the token in
 *   plaintext — into the collection that exists to be the audit record.
 *
 * All four are corrected below. The mode gate is now enforced HERE as well as
 * in the writer: defence in depth, because these are different failure modes —
 * the writer protects relationship truth, this protects the whole pipeline
 * including timeline, queue and AI spend.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { timingSafeEqual, createHash } from 'node:crypto';

export const INVOCATION_LOG_COLLECTION = 'validation_invocations';

/** The ONLY keys a request may carry. Anything else is a refusal. */
export const ALLOWED_REQUEST_KEYS = Object.freeze(['token', 'idynifyUserId', 'gmailMessageId']);

export const REFUSAL = Object.freeze({
  DISABLED: 'invoker_disabled',
  BAD_BODY: 'malformed_request_body',
  UNEXPECTED_KEY: 'unexpected_request_key',
  BAD_TOKEN: 'invalid_token',
  MODE_NOT_LIVE: 'mode_not_live',
  MISSING_TENANT: 'missing_idynifyUserId',
  MISSING_MESSAGE: 'missing_gmailMessageId',
  TENANT_NOT_ALLOWED: 'tenant_not_allowlisted',
});

/**
 * Constant-time secret comparison.
 *
 * ─── WHY HASH FIRST ─────────────────────────────────────────────────────────
 *
 * `timingSafeEqual` throws when its two buffers differ in length, so comparing
 * raw token bytes forces a length branch — and that branch is itself a signal:
 * an attacker learns the secret's length by watching which path runs, which is
 * exactly what the function is supposed to conceal.
 *
 * Hashing both sides to a SHA-256 digest makes every comparison 32 bytes
 * against 32 bytes, so there is no length branch left to observe. Length,
 * content and encoding all collapse into a fixed-width value before anything is
 * compared.
 *
 * An earlier version documented this and did not do it — it compared raw
 * buffers with a length shortcut. That is the same defect class as the mode
 * gate that was described but never implemented, so the guarantee is now the
 * code rather than the comment.
 *
 * Total: any non-string, empty, or malformed input returns false rather than
 * throwing. A malformed token is a refusal, never an exception.
 */
function secretsMatch(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;

  // A secret that is only whitespace is not a secret. The previous guard
  // rejected the empty string but let `" "`, `"\n"` and `"\t"` through, and
  // since each hashes to itself, a whitespace-only configured token would
  // authorize a whitespace-only presented one. That defeats the intent of the
  // disabled-token gate: an operator who "cleared" the variable by leaving a
  // space would have a live endpoint with a one-character secret.
  //
  // Trimming is applied to each value INDEPENDENTLY, as a validity check. It is
  // not a comparison between the two lengths, so it reintroduces no length
  // signal — and it happens before hashing, so the comparison itself remains
  // fixed-width and constant-time.
  if (presented.trim().length === 0 || expected.trim().length === 0) return false;

  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();

  // Both digests are always 32 bytes, so this cannot throw and cannot branch.
  return timingSafeEqual(a, b);
}

function parseAllowedTenants(env) {
  return String(env.VALIDATION_ALLOWED_TENANTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** A plain object — not null, not an array, not a primitive. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decide whether a request may proceed. Pure — no I/O, so every refusal path is
 * testable without a database or a deploy, and TOTAL — every input shape
 * returns a verdict rather than throwing.
 *
 * @returns {{ ok: true, userId: string, gmailMessageId: string }
 *          | { ok: false, reason: string, detail?: string }}
 */
export function authorizeValidationRequest(body, env = process.env) {
  const expectedToken = env.VALIDATION_INVOKER_TOKEN;

  // Gate 1 — the endpoint does not exist unless a token has been provisioned.
  // Production never sets one, so every request there is refused, including a
  // perfectly formed one.
  if (!expectedToken) return { ok: false, reason: REFUSAL.DISABLED };

  // Gate 0 — shape. `null`, arrays, strings and numbers all refuse cleanly
  // instead of throwing on property access; JSON.parse('null') is a real
  // request body, and an uncaught TypeError would skip the audit record.
  if (!isPlainObject(body)) return { ok: false, reason: REFUSAL.BAD_BODY };

  // Gate 2 — strict allowlist. Not a denylist: the ways to ask for too much are
  // open-ended, the fields this endpoint needs are three.
  const unexpected = Object.keys(body).filter(k => !ALLOWED_REQUEST_KEYS.includes(k));
  if (unexpected.length > 0) {
    return { ok: false, reason: REFUSAL.UNEXPECTED_KEY, detail: unexpected.join(', ') };
  }

  // Gate 3 — the secret, in constant time.
  if (!secretsMatch(body.token, expectedToken)) {
    return { ok: false, reason: REFUSAL.BAD_TOKEN };
  }

  // Gate 4 — the mode, enforced here as well as in the writer. Only the exact
  // string 'live' proceeds; unset, empty, 'LIVE', 'liv' and anything else all
  // refuse.
  if (env.GMAIL_IDENTITY_MODE !== 'live') {
    return { ok: false, reason: REFUSAL.MODE_NOT_LIVE };
  }

  // Gate 5 — both identifiers, required, typed, non-empty. No defaults exist.
  const userId = typeof body.idynifyUserId === 'string' ? body.idynifyUserId.trim() : '';
  const gmailMessageId = typeof body.gmailMessageId === 'string' ? body.gmailMessageId.trim() : '';
  if (!userId) return { ok: false, reason: REFUSAL.MISSING_TENANT };
  if (!gmailMessageId) return { ok: false, reason: REFUSAL.MISSING_MESSAGE };

  // Gate 6 — the tenant allowlist, enforced even for a valid token, so a leaked
  // token still cannot reach a real customer workspace.
  const allowed = parseAllowedTenants(env);
  if (allowed.length === 0 || !allowed.includes(userId)) {
    return { ok: false, reason: REFUSAL.TENANT_NOT_ALLOWED };
  }

  return { ok: true, userId, gmailMessageId };
}

/**
 * The only fields an audit record may carry.
 *
 * An allowlist rather than a redaction pass, for the same reason as the request
 * contract: enumerating what is permitted is finite and reviewable, while
 * enumerating what is secret is a guessing game that loses once.
 */
export const LOGGABLE_FIELDS = Object.freeze([
  'invocationId', 'outcome', 'reason', 'detail',
  'idynifyUserId', 'gmailMessageId',
  'processingStatus', 'messageRecordId', 'eventCreated', 'mode',
]);

/**
 * Append-only audit record. THE LOGGER OWNS REDACTION.
 *
 * Callers cannot widen what is written: anything outside LOGGABLE_FIELDS is
 * dropped here, so passing the raw request body persists the tenant and message
 * id and silently discards the token. `detail` is truncated because it echoes
 * caller-supplied key names.
 *
 * Refusals are logged as well as acceptances. An endpoint that can reach a real
 * message must leave evidence of every attempt to make it do so, including the
 * ones it turned down — otherwise "it refused" is an assertion, not a fact.
 */
export async function logInvocation(db, entry = {}) {
  const safe = {};
  for (const key of LOGGABLE_FIELDS) {
    if (entry[key] === undefined) continue;
    safe[key] = key === 'detail' ? String(entry[key]).slice(0, 200) : entry[key];
  }

  try {
    await db.collection(INVOCATION_LOG_COLLECTION).add({ ...safe, at: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error('[validation-invoker] could not write invocation log:', err.message);
  }
  return safe;
}

export default { authorizeValidationRequest, logInvocation, REFUSAL, LOGGABLE_FIELDS };
