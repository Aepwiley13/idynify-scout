/**
 * GMAIL SYNC WORKER — Barry Inbox Intelligence, Sprint 1 (Team A)
 *
 * Scheduled Netlify function. Every 10 minutes it walks every user with a
 * connected Gmail account, pulls the messages that arrived since the last run,
 * normalizes them, and hands each one to Team B's processNormalizedMessage().
 *
 * Design rules:
 *   - Incremental by default. The Gmail history cursor (lastHistoryId) means we
 *     never re-scan the whole inbox; a full poll only happens on first sync or
 *     when the cursor has gone stale.
 *   - The cursor advances ONLY after every message in the batch has been
 *     processed successfully. Losing the cursor costs a duplicate call (which
 *     Team B's idempotency absorbs); advancing it too early loses a message
 *     forever.
 *   - One user's failure never stops the loop. Every per-user error is recorded
 *     on that user's integration document and the worker moves on.
 *
 * Sync state lives on users/{userId}/integrations/gmail — see SYNC_STATE_FIELDS.
 */

import { schedule } from '@netlify/functions';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';

import { validateNormalizedMessage } from '../../src/types/normalizedMessage.js';
import { processNormalizedMessage } from './utils/messageProcessor.js';
import {
  getOAuthClient,
  fetchMessage,
  fetchThread,
  fetchHistorySince,
  fetchRecentInbox,
  normalizeMessage,
  shouldProcessMessage,
  isKnownContact,
  isKnownIdynifyThread,
} from './utils/gmailMessageService.js';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

/** Cron expression for the scheduled function. */
export const SYNC_SCHEDULE = '*/10 * * * *';

/** How often the worker is expected to run, in minutes — drives nextSyncAt. */
const SYNC_INTERVAL_MINUTES = 10;

/** Max users touched per invocation, to stay inside the function timeout. */
const MAX_USERS_PER_RUN = 50;

/** Max messages ingested per user per invocation. */
const MAX_MESSAGES_PER_USER = 50;

/** Messages fetched on the very first sync for an account. */
const BOOTSTRAP_MESSAGE_COUNT = 20;

/** Stop picking up new users once the run has been going this long. */
const RUN_BUDGET_MS = 240_000;

/**
 * The sync-state fields Team A adds to users/{userId}/integrations/gmail.
 * Existing fields (accessToken, refreshToken, expiresAt, status, email) are
 * never touched.
 */
export const SYNC_STATE_FIELDS = Object.freeze([
  'lastHistoryId',
  'lastSuccessfulSyncAt',
  'syncStatus',
  'lastSyncError',
  'nextSyncAt',
]);

export const SYNC_STATUS = Object.freeze({
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
  NEEDS_RECONNECT: 'needs_reconnect',
});

const log = (...args) => console.log('[gmail-sync]', ...args);
const warn = (...args) => console.warn('[gmail-sync]', ...args);

/**
 * True when Gmail says the message no longer exists.
 *
 * A history record is a record of what *happened*, not of what still exists —
 * a message added and then deleted (or moved out of the mailbox) stays in the
 * history feed while messages.get returns 404 "Requested entity was not found".
 * That is an ordinary Gmail state, not a processing failure, and it must never
 * hold the cursor: treating it as an error wedges the account, because the next
 * run replays the same batch, hits the same missing message, and stops again —
 * so nothing behind it is ever ingested.
 *
 * @param {Error & { code?: number|string, status?: number, response?: object }} err
 */
export function isMessageGoneError(err) {
  if (!err) return false;

  // googleapis surfaces the HTTP status on any of these, depending on version
  // and whether the failure came from the transport or the API layer.
  if (err.status === 404 || err.code === 404 || err.response?.status === 404) return true;

  if (Array.isArray(err.errors) && err.errors.some((e) => e?.reason === 'notFound')) return true;

  return /requested entity was not found/i.test(String(err.message || ''));
}

function nextSyncAtIso() {
  return new Date(Date.now() + SYNC_INTERVAL_MINUTES * 60_000).toISOString();
}

/**
 * Find every user with a connected Gmail integration.
 *
 * Uses a collection-group query over `integrations` and filters to the `gmail`
 * document in JS. Firestore's automatic single-field indexing only covers
 * COLLECTION scope, so the COLLECTION_GROUP index for `integrations.status` is
 * declared explicitly in firestore.indexes.json — without it this query fails
 * with FAILED_PRECONDITION on the first run.
 *
 * Least-recently-synced accounts go first so a large tenant list still gets
 * fair coverage across runs. Accounts that have never synced sort first.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {number} [limit]
 * @returns {Promise<Array<{ userId: string, docRef: object, data: object }>>}
 */
export async function findConnectedGmailUsers(db, limit = MAX_USERS_PER_RUN) {
  let snap;
  try {
    snap = await db
      .collectionGroup('integrations')
      .where('status', '==', 'connected')
      .limit(limit * 4)
      .get();
  } catch (err) {
    if (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(err.message || '')) {
      throw new Error(
        'The collection-group index for integrations.status is missing. Deploy it with ' +
        '`firebase deploy --only firestore:indexes` — see the fieldOverrides entry in ' +
        `firestore.indexes.json. Original error: ${err.message}`
      );
    }
    throw err;
  }

  const users = [];
  for (const doc of snap.docs) {
    if (doc.id !== 'gmail') continue;
    const userId = doc.ref.parent?.parent?.id;
    if (!userId) continue;
    users.push({ userId, docRef: doc.ref, data: doc.data() || {} });
  }

  users.sort((a, b) => {
    const aAt = a.data.lastSuccessfulSyncAt || '';
    const bAt = b.data.lastSuccessfulSyncAt || '';
    return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
  });

  return users.slice(0, limit);
}

/**
 * Ingest one message: fetch, normalize, filter, validate, hand to Team B.
 *
 * @returns {Promise<{ status: 'processed'|'skipped'|'deleted'|'invalid'|'failed', reason?: string }>}
 */
async function ingestMessage(db, gmail, messageId, userId, gmailAccountId, threadCountCache) {
  let raw;
  try {
    raw = await fetchMessage(gmail, messageId);
  } catch (err) {
    // Deleted between landing in the history feed and this fetch — expected,
    // and the cursor must still move past it.
    if (isMessageGoneError(err)) return { status: 'deleted', reason: 'message_no_longer_exists' };
    throw err;
  }
  if (!raw?.id) return { status: 'skipped', reason: 'empty_message' };

  const labelIds = raw.labelIds || [];

  // Resolve the thread size once per thread per run — it drives both
  // isFirstMessageInThread and the References-based reply rule.
  let threadMessageCount = 1;
  if (raw.threadId) {
    if (threadCountCache.has(raw.threadId)) {
      threadMessageCount = threadCountCache.get(raw.threadId);
    } else {
      try {
        const thread = await fetchThread(gmail, raw.threadId);
        threadMessageCount = Math.max(1, (thread?.messages || []).length);
      } catch (err) {
        warn(`thread fetch failed for ${raw.threadId}: ${err.message}`);
      }
      threadCountCache.set(raw.threadId, threadMessageCount);
    }
  }

  // Cheap pre-check so we do not run contact lookups for mail we will drop.
  const preview = normalizeMessage(raw, userId, gmailAccountId, { threadMessageCount });
  if (preview.direction === 'outbound') {
    return { status: 'skipped', reason: 'outbound' };
  }

  const knownContact = await isKnownContact(db, userId, preview.fromEmail);
  const normalized = normalizeMessage(raw, userId, gmailAccountId, {
    threadMessageCount,
    isKnownContact: knownContact,
  });

  const knownThread =
    normalized.category === 'automated'
      ? await isKnownIdynifyThread(db, userId, normalized.gmailThreadId)
      : false;

  const decision = shouldProcessMessage(normalized, { labelIds, isKnownThread: knownThread });
  if (!decision.process) {
    return { status: 'skipped', reason: decision.reason };
  }

  const validation = validateNormalizedMessage(normalized);
  if (!validation.valid) {
    console.error(`[gmail-sync] Invalid message ${messageId}:`, validation.errors);
    return { status: 'invalid', reason: validation.errors.join('; ') };
  }

  const result = await processNormalizedMessage(db, normalized);
  if (result && result.success === false) {
    return { status: 'failed', reason: result.error || 'processNormalizedMessage returned failure' };
  }

  return { status: 'processed' };
}

/**
 * Sync a single user's inbox. Never throws — every failure mode is reported
 * through the returned summary and written to the user's integration document.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ userId: string, docRef: object, data: object }} user
 * @returns {Promise<object>} summary for this user
 */
export async function syncUserInbox(db, user) {
  const { userId, docRef, data } = user;
  const summary = {
    userId,
    processed: 0,
    skipped: 0,
    deleted: 0,   // subset of `skipped` — messages Gmail no longer has
    invalid: 0,
    failed: 0,
    mode: null,
    status: SYNC_STATUS.IDLE,
    error: null,
  };

  try {
    await docRef.update({ syncStatus: SYNC_STATUS.SYNCING });

    const auth = await getOAuthClient(userId, db);
    if (!auth) {
      // Either no longer connected or the refresh failed — getOAuthClient has
      // already flagged needs_reconnect in the latter case.
      summary.status = SYNC_STATUS.NEEDS_RECONNECT;
      summary.error = 'oauth_unavailable';
      return summary;
    }

    const gmail = google.gmail({ version: 'v1', auth: auth.oauth2Client });

    // Scope check — accounts connected before the inbox read scope existed
    // return 403 here and must reconnect rather than error out every run.
    let gmailAccountId = (data.email || auth.gmailData.email || '').toLowerCase();
    let mailboxHistoryId = null;
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      gmailAccountId = (profile.data.emailAddress || gmailAccountId).toLowerCase();
      mailboxHistoryId = profile.data.historyId ? String(profile.data.historyId) : null;
    } catch (err) {
      if (err.status === 403 || err.code === 403) {
        await docRef.update({
          syncStatus: SYNC_STATUS.NEEDS_RECONNECT,
          lastSyncError: 'Gmail read scope missing — reconnect required',
          nextSyncAt: nextSyncAtIso(),
        });
        summary.status = SYNC_STATUS.NEEDS_RECONNECT;
        summary.error = 'missing_scope';
        return summary;
      }
      warn(`getProfile failed for ${userId} (non-blocking): ${err.message}`);
    }

    if (!gmailAccountId) {
      throw new Error('Could not determine the connected Gmail address');
    }

    // ── Decide which messages to look at ────────────────────────────────────
    let entries = [];
    let latestHistoryId = null;
    let truncated = false;

    if (data.lastHistoryId) {
      try {
        const history = await fetchHistorySince(gmail, String(data.lastHistoryId));
        entries = history.messages;
        latestHistoryId = history.latestHistoryId;
        truncated = history.truncated;
        summary.mode = 'history';
      } catch (err) {
        if (err.status === 404 || err.code === 404) {
          // Cursor aged out of Gmail's history window — fall back to a poll.
          warn(`history cursor stale for ${userId}, falling back to inbox poll`);
          const ids = await fetchRecentInbox(gmail, BOOTSTRAP_MESSAGE_COUNT);
          entries = ids.map((id) => ({ id, historyId: null }));
          latestHistoryId = mailboxHistoryId;
          summary.mode = 'stale_cursor_poll';
        } else {
          throw err;
        }
      }
    } else {
      const ids = await fetchRecentInbox(gmail, BOOTSTRAP_MESSAGE_COUNT);
      entries = ids.map((id) => ({ id, historyId: null }));
      // Snapshot taken before the bootstrap batch — anything that lands during
      // this run is replayed next time rather than skipped.
      latestHistoryId = mailboxHistoryId;
      summary.mode = 'bootstrap';
    }

    if (entries.length > MAX_MESSAGES_PER_USER) {
      entries = entries.slice(0, MAX_MESSAGES_PER_USER);
      truncated = true;
    }

    // ── Process ─────────────────────────────────────────────────────────────
    const processedInThisRun = new Set();
    const threadCountCache = new Map();
    let lastGoodHistoryId = null;

    for (const entry of entries) {
      if (processedInThisRun.has(entry.id)) continue;
      processedInThisRun.add(entry.id);

      try {
        const outcome = await ingestMessage(
          db, gmail, entry.id, userId, gmailAccountId, threadCountCache
        );

        if (outcome.status === 'processed') summary.processed += 1;
        else if (outcome.status === 'skipped') summary.skipped += 1;
        else if (outcome.status === 'deleted') {
          // Counted as skipped for the run tally, tracked separately so the
          // logs distinguish "gone from Gmail" from "filtered by our rules".
          summary.skipped += 1;
          summary.deleted += 1;
          log(`message ${entry.id} no longer exists — skipping`);
        }
        else if (outcome.status === 'invalid') summary.invalid += 1;
        else if (outcome.status === 'failed') {
          summary.failed += 1;
          summary.error = outcome.reason;
          console.error(`[gmail-sync] Processing failed for ${entry.id}: ${outcome.reason}`);
          break; // Stop here so the cursor cannot skip past this message.
        }

        if (entry.historyId) lastGoodHistoryId = entry.historyId;
      } catch (err) {
        // Safety net: a 404 raised anywhere else in the ingest path is still a
        // vanished message, and must not wedge the cursor.
        if (isMessageGoneError(err)) {
          summary.skipped += 1;
          summary.deleted += 1;
          log(`message ${entry.id} no longer exists — skipping`);
          if (entry.historyId) lastGoodHistoryId = entry.historyId;
          continue;
        }
        summary.failed += 1;
        summary.error = err.message;
        console.error(`[gmail-sync] Message ${entry.id} threw:`, err.message);
        break;
      }
    }

    // ── Advance the cursor only when the whole batch succeeded ──────────────
    const allSucceeded = summary.failed === 0;
    const update = { nextSyncAt: nextSyncAtIso() };

    if (allSucceeded) {
      // With a truncated batch the mailbox-wide historyId is ahead of what we
      // actually consumed, so step to the last record we handled instead.
      const cursor = truncated ? lastGoodHistoryId || latestHistoryId : latestHistoryId;
      if (cursor) update.lastHistoryId = String(cursor);
      update.lastSuccessfulSyncAt = new Date().toISOString();
      update.syncStatus = SYNC_STATUS.IDLE;
      update.lastSyncError = null;
      summary.status = SYNC_STATUS.IDLE;
    } else {
      update.syncStatus = SYNC_STATUS.ERROR;
      update.lastSyncError = summary.error || 'Unknown ingestion failure';
      summary.status = SYNC_STATUS.ERROR;
    }

    await docRef.update(update);

    log(
      `${userId} (${summary.mode}) — processed ${summary.processed}, skipped ${summary.skipped}` +
      `${summary.deleted > 0 ? ` (${summary.deleted} deleted in Gmail)` : ''}, ` +
      `invalid ${summary.invalid}, failed ${summary.failed}`
    );
    return summary;

  } catch (err) {
    summary.failed += 1;
    summary.status = SYNC_STATUS.ERROR;
    summary.error = err.message;
    console.error(`[gmail-sync] User ${userId} failed:`, err.message);
    try {
      await docRef.update({
        syncStatus: SYNC_STATUS.ERROR,
        lastSyncError: err.message,
        nextSyncAt: nextSyncAtIso(),
      });
    } catch (writeErr) {
      warn(`could not record sync error for ${userId}: ${writeErr.message}`);
    }
    return summary;
  }
}

/**
 * Run one full sync pass across every connected Gmail account.
 *
 * Users are processed serially so a slow mailbox cannot exhaust Gmail's
 * per-project rate budget, and so one user's failure is isolated by
 * construction. The run stops picking up new users once the time budget is
 * spent — the remainder are least-recently-synced and go first next run.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ now?: number, budgetMs?: number }} [options]
 */
export async function runGmailSync(db, options = {}) {
  const startedAt = options.now ?? Date.now();
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;

  const users = await findConnectedGmailUsers(db);
  log(`starting run — ${users.length} connected account(s)`);

  const results = [];
  let deferred = 0;

  for (const user of users) {
    if (Date.now() - startedAt > budgetMs) {
      deferred = users.length - results.length;
      warn(`time budget spent — deferring ${deferred} account(s) to the next run`);
      break;
    }
    results.push(await syncUserInbox(db, user));
  }

  const totals = results.reduce(
    (acc, r) => ({
      processed: acc.processed + r.processed,
      skipped: acc.skipped + r.skipped,
      deleted: acc.deleted + (r.deleted || 0),
      invalid: acc.invalid + r.invalid,
      failed: acc.failed + r.failed,
    }),
    { processed: 0, skipped: 0, deleted: 0, invalid: 0, failed: 0 }
  );

  log(
    `run complete — ${results.length} account(s), ${totals.processed} processed, ` +
    `${totals.skipped} skipped${totals.deleted > 0 ? ` (${totals.deleted} deleted in Gmail)` : ''}, ` +
    `${totals.invalid} invalid, ${totals.failed} failed`
  );

  return {
    usersConsidered: users.length,
    usersSynced: results.length,
    usersDeferred: deferred,
    totals,
    results,
    durationMs: Date.now() - startedAt,
  };
}

export const syncHandler = async () => {
  try {
    const summary = await runGmailSync(getFirestore());
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('[gmail-sync] Run failed:', err);
    // A 200 keeps Netlify from retry-storming a systemic failure; the error is
    // in the logs and every per-user failure is already recorded in Firestore.
    return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = schedule(SYNC_SCHEDULE, syncHandler);
