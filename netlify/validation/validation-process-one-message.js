/**
 * validation-process-one-message — process exactly one named Gmail message.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IS NOT IN netlify/functions/.                                 ║
 * ║                                                                          ║
 * ║  Netlify deploys the configured functions directory. This lives outside  ║
 * ║  it, so it CANNOT reach production's function list by default. The       ║
 * ║  validation site stages it in at build time; production's build does     ║
 * ║  not. See scripts/stageValidationFunction.mjs — the exclusion is         ║
 * ║  structural, not a matter of leaving a token unset.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * gmail-sync-worker is cursor-driven: it processes whatever Gmail returns since
 * lastHistoryId. That is right for a mailbox and useless for a first-use
 * validation, where naming one message and only that message is the whole
 * requirement. No argument to the worker means "only this one".
 *
 * ─── WHAT IT DELIBERATELY DOES NOT CONTAIN ──────────────────────────────────
 *
 * No loop. No cursor. No history call. No collection scan. No batch or range
 * parameter. No fallback selection. No alternate relationship-processing
 * implementation — after the message is fetched it goes straight into
 * processNormalizedMessage(), the same function the scheduled worker calls,
 * with the same writer, the same identity engine and the same ordering behind
 * it. This file chooses a message; it does not process one.
 *
 * The per-message path below is the worker's own, minus the loop: fetch by id,
 * normalize, filter, validate, hand over. Reusing those helpers rather than
 * reimplementing them is the point — a parallel implementation would prove
 * something about itself rather than about production.
 *
 * ─── SEND ───────────────────────────────────────────────────────────────────
 *
 * Nothing here imports a send path. gmail-send, gmail-send-quick,
 * gmail-send-wave and barry-approve-send are all absent from this module's
 * import graph, and a test asserts that. The validation mailbox's
 * gmail.readonly scope is the infrastructure backstop; this is the code-level
 * one.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';

import { validateNormalizedMessage } from '../../src/types/normalizedMessage.js';
import { processNormalizedMessage } from '../functions/utils/messageProcessor.js';
import {
  getOAuthClient,
  fetchMessage,
  fetchThread,
  normalizeMessage,
  shouldProcessMessage,
  isKnownContact,
} from '../functions/utils/gmailMessageService.js';
import {
  authorizeValidationRequest,
  logInvocation,
  REFUSAL,
} from '../functions/utils/validationInvoker.js';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const HEADERS = { 'Content-Type': 'application/json' };

const respond = (statusCode, payload) => ({
  statusCode, headers: HEADERS, body: JSON.stringify(payload),
});

/**
 * Parse a request body without ever throwing.
 *
 * A malformed body must produce a refusal and an audit record, not a 500 that
 * skips the log. Returns `undefined` on anything unparseable; the authorizer
 * then rejects it on shape.
 */
function parseBody(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return undefined; }
}

export const handler = async (event = {}) => {
  const db = getFirestore();
  const invocationId = randomUUID();

  if (event.httpMethod && event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const body = parseBody(event.body);
  const auth = authorizeValidationRequest(body, process.env);

  if (!auth.ok) {
    // Logged before returning. The refusals are the half that proves the gate
    // works, and the logger drops anything outside its own field allowlist —
    // the presented token is never written.
    await logInvocation(db, {
      invocationId,
      outcome: 'refused',
      reason: auth.reason,
      detail: auth.detail,
      mode: process.env.GMAIL_IDENTITY_MODE ?? '(unset)',
    });
    const status = auth.reason === REFUSAL.DISABLED ? 404 : 403;
    return respond(status, { error: auth.reason, invocationId });
  }

  const { userId, gmailMessageId } = auth;

  try {
    const oauth = await getOAuthClient(userId, db);
    if (!oauth) {
      await logInvocation(db, {
        invocationId, outcome: 'refused', reason: 'oauth_unavailable',
        idynifyUserId: userId, gmailMessageId,
      });
      return respond(409, { error: 'oauth_unavailable', invocationId });
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth.oauth2Client });

    // ── Exactly one message, fetched by the id the caller named ─────────────
    // messages.get, not messages.list. There is no query, no page token and no
    // result set to iterate: the id is the selection.
    const raw = await fetchMessage(gmail, gmailMessageId);
    if (!raw?.id) {
      await logInvocation(db, {
        invocationId, outcome: 'refused', reason: 'message_not_found',
        idynifyUserId: userId, gmailMessageId,
      });
      return respond(404, { error: 'message_not_found', invocationId });
    }

    const gmailAccountId = (oauth.gmailData.email || '').toLowerCase();

    let threadMessageCount = 1;
    if (raw.threadId) {
      const thread = await fetchThread(gmail, raw.threadId);
      threadMessageCount = Math.max(1, (thread?.messages || []).length);
    }

    const preview = normalizeMessage(raw, userId, gmailAccountId, { threadMessageCount });
    const knownContact = await isKnownContact(db, userId, preview.fromEmail);
    const normalized = normalizeMessage(raw, userId, gmailAccountId, {
      threadMessageCount, isKnownContact: knownContact,
    });

    const decision = shouldProcessMessage(normalized, { labelIds: raw.labelIds || [] });
    if (!decision.process) {
      await logInvocation(db, {
        invocationId, outcome: 'skipped', reason: decision.reason,
        idynifyUserId: userId, gmailMessageId,
      });
      return respond(200, { skipped: true, reason: decision.reason, invocationId });
    }

    const validation = validateNormalizedMessage(normalized);
    if (!validation.valid) {
      await logInvocation(db, {
        invocationId, outcome: 'refused', reason: 'invalid_normalized_message',
        idynifyUserId: userId, gmailMessageId,
      });
      return respond(422, { error: 'invalid_normalized_message', invocationId });
    }

    // ── The production path. Called ONCE, never in a loop ───────────────────
    const result = await processNormalizedMessage(db, normalized);

    await logInvocation(db, {
      invocationId,
      outcome: 'processed',
      idynifyUserId: userId,
      gmailMessageId,
      messageRecordId: result?.messageRecordId,
      processingStatus: result?.success ? 'success' : 'failed',
      mode: process.env.GMAIL_IDENTITY_MODE ?? '(unset)',
    });

    return respond(200, { invocationId, result });
  } catch (err) {
    console.error('[validation-invoker] processing failed:', err.message);
    await logInvocation(db, {
      invocationId, outcome: 'error', reason: 'processing_exception',
      idynifyUserId: userId, gmailMessageId,
    });
    return respond(500, { error: 'processing_exception', invocationId });
  }
};

export default handler;
