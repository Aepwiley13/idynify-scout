/**
 * validationInvoker — process exactly one explicitly named message, or refuse.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY A SEPARATE MECHANISM EXISTS AT ALL                                  ║
 * ║                                                                          ║
 * ║  gmail-sync-worker is cursor-driven. It processes whatever Gmail returns ║
 * ║  since lastHistoryId — which is the correct design for a mailbox and the ║
 * ║  wrong one for a first-use validation, where "exactly one message, that  ║
 * ║  one, and nothing else" is the entire requirement. There is no argument  ║
 * ║  you can pass the worker that means "only this message".                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── THE SHAPE OF THE SAFETY ────────────────────────────────────────────────
 *
 * Every guard here is a REFUSAL, not a filter. Nothing is inferred, defaulted,
 * or narrowed — a request that does not name precisely one message in precisely
 * one allowlisted tenant is rejected outright. There is deliberately no "most
 * recent", no "first unmatched", and no wildcard: those are the shapes that
 * turn a validation tool into an accidental bulk processor.
 *
 * Four independent gates, each of which alone is sufficient to refuse:
 *
 *   1. TOKEN     A shared secret that exists in no deploy context by default.
 *                Absent or mismatched → refuse. This is what stops the endpoint
 *                doing anything at all in production, where it will be unset.
 *   2. TENANT    An explicit allowlist. A tenant not named in
 *                VALIDATION_ALLOWED_TENANTS is refused even with a valid token,
 *                so a leaked token cannot reach a real customer's workspace.
 *   3. MESSAGE   Both idynifyUserId and gmailMessageId are required, must be
 *                strings, and must be non-empty. No defaults exist.
 *   4. MODE      Honours GMAIL_IDENTITY_MODE exactly as the worker does, so a
 *                dry_run environment stays dry even through this path.
 *
 * ─── WHAT IT DOES NOT CHANGE ────────────────────────────────────────────────
 *
 * After selection the message goes through processNormalizedMessage — the same
 * function the scheduled worker calls, in the same order, with the same writer
 * and the same identity engine. The point of the exercise is to observe the
 * production pipeline, so the pipeline is not reimplemented or stubbed here.
 * This module chooses the message; it does not process it.
 */

import { FieldValue } from 'firebase-admin/firestore';

export const INVOCATION_LOG_COLLECTION = 'validation_invocations';

export const REFUSAL = Object.freeze({
  DISABLED: 'invoker_disabled',
  BAD_TOKEN: 'invalid_token',
  TENANT_NOT_ALLOWED: 'tenant_not_allowlisted',
  MISSING_TENANT: 'missing_idynifyUserId',
  MISSING_MESSAGE: 'missing_gmailMessageId',
  BROAD_REQUEST: 'broad_processing_refused',
});

/**
 * Fields whose presence means the caller is asking for more than one message.
 *
 * Refusing on their presence rather than ignoring them is the point: a caller
 * who passes `limit: 50` believes they are getting fifty messages, and silently
 * giving them one is a different bug from refusing.
 */
const BROAD_REQUEST_FIELDS = [
  'all', 'limit', 'maxResults', 'since', 'historyId', 'cursor',
  'gmailMessageIds', 'contactIds', 'batch', 'tenants',
];

function parseAllowedTenants(env) {
  return String(env.VALIDATION_ALLOWED_TENANTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Decide whether a request may proceed. Pure — no I/O, so every refusal path
 * is testable without a database or a deploy.
 *
 * @returns {{ ok: true, userId: string, gmailMessageId: string }
 *          | { ok: false, reason: string, detail?: string }}
 */
export function authorizeValidationRequest(body = {}, env = process.env) {
  const expectedToken = env.VALIDATION_INVOKER_TOKEN;

  // Gate 1 — the endpoint does not exist unless a token has been provisioned.
  if (!expectedToken) return { ok: false, reason: REFUSAL.DISABLED };
  if (body.token !== expectedToken) return { ok: false, reason: REFUSAL.BAD_TOKEN };

  // Gate 3a — no broad request may be reinterpreted as a narrow one.
  const broad = BROAD_REQUEST_FIELDS.filter(f => body[f] !== undefined);
  if (broad.length > 0) {
    return { ok: false, reason: REFUSAL.BROAD_REQUEST, detail: broad.join(', ') };
  }

  // Gate 3b — both identifiers are mandatory and must be real strings.
  const userId = typeof body.idynifyUserId === 'string' ? body.idynifyUserId.trim() : '';
  const gmailMessageId = typeof body.gmailMessageId === 'string' ? body.gmailMessageId.trim() : '';
  if (!userId) return { ok: false, reason: REFUSAL.MISSING_TENANT };
  if (!gmailMessageId) return { ok: false, reason: REFUSAL.MISSING_MESSAGE };

  // Gate 2 — the allowlist. Checked last so its refusal is unambiguous in logs,
  // and enforced even for a caller holding a valid token.
  const allowed = parseAllowedTenants(env);
  if (allowed.length === 0 || !allowed.includes(userId)) {
    return { ok: false, reason: REFUSAL.TENANT_NOT_ALLOWED, detail: userId };
  }

  return { ok: true, userId, gmailMessageId };
}

/**
 * Append-only record of every invocation, refused ones included.
 *
 * The refusals are the interesting half. An endpoint that can process a real
 * message must leave evidence of every attempt to make it do so, including the
 * ones it turned down, or "it refused" is an assertion rather than a fact.
 */
export async function logInvocation(db, entry) {
  try {
    await db.collection(INVOCATION_LOG_COLLECTION).add({
      ...entry,
      at: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[validation-invoker] could not write invocation log:', err.message);
  }
}

export default { authorizeValidationRequest, logInvocation, REFUSAL };
