/**
 * GMAIL REPLY SYNC WORKER
 *
 * Scheduled Netlify function. Every 10 minutes it walks every user with a
 * connected Gmail account and checks their tracked Hunter threads
 * (gmail-poll-replies.js's own logic, shared via utils/replyPolling.js) for
 * a genuine reply — the same thing the "Sync Replies" button does on
 * demand, now running on its own.
 *
 * Deliberately a SEPARATE scheduled function from gmail-sync-worker.js, not
 * folded into it: that worker's write path is gated behind
 * GMAIL_IDENTITY_MODE (the pre-live identity-resolution cutover, currently
 * and deliberately disabled — see ADR-006's cursor-wedge blocker). This
 * worker imports nothing from that gated path — not messageProcessor.js,
 * not relationshipEventWriter.js, not identityResolution.js — and never
 * will; see replySyncWorkerBoundary.test.js, which asserts this by reading
 * the source.
 *
 * Account enumeration is reused from gmail-sync-worker.js
 * (findConnectedGmailUsers) and OAuth handling from gmailMessageService.js
 * (getOAuthClient) — this file adds no new credential handling or
 * account-discovery logic. findConnectedGmailUsers is called with its own
 * independent sortField ('lastReplySyncAt', stamped by this worker after
 * every user it checks) rather than the default 'lastSuccessfulSyncAt' —
 * sharing that field would make this worker's own fairness rotation an
 * accident of how often the UNRELATED identity-sync worker happens to run,
 * rather than a property of this worker's own progress.
 *
 * Users are processed serially, same reasoning as gmail-sync-worker.js:
 * one slow or failing mailbox must not exhaust the run's time budget or
 * block any other user's threads from being checked.
 */

import { schedule } from '@netlify/functions';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';

import { findConnectedGmailUsers } from './gmail-sync-worker.js';
import { getOAuthClient } from './utils/gmailMessageService.js';
import { pollRepliesForUser } from './utils/replyPolling.js';
import { alertOps } from './utils/alertOps.js';
import { requireProjectId } from './utils/firebaseEnv.js';

/** This worker's own fairness-rotation field — see findConnectedGmailUsers's docstring. */
const REPLY_SYNC_ROTATION_FIELD = 'lastReplySyncAt';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  initializeApp({
    credential: cert({
      projectId: requireProjectId(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

/** Cron expression — matches gmail-sync-worker.js's existing cadence. Independently tunable. */
export const REPLY_SYNC_SCHEDULE = '*/10 * * * *';

/** Stop picking up new users once this much of the run has elapsed. */
const RUN_BUDGET_MS = 240_000;

const log = (...args) => console.log('[gmail-reply-sync]', ...args);
const warn = (...args) => console.warn('[gmail-reply-sync]', ...args);

/**
 * Check one user's tracked threads for replies. Never throws — every
 * failure mode is captured in the returned summary.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ userId: string }} user
 */
export async function syncUserReplies(db, user) {
  const { userId } = user;
  const summary = { userId, checkedCount: 0, transitionedCount: 0, needsReconnect: false, error: null };

  try {
    const auth = await getOAuthClient(userId, db);
    if (!auth) {
      summary.error = 'oauth_unavailable';
      return summary;
    }

    const gmail = google.gmail({ version: 'v1', auth: auth.oauth2Client });

    // Scope check — accounts connected before the reply-polling scope
    // existed return 403 here and must reconnect, same as the manual
    // handler. getOAuthClient's own refresh does not call getProfile, so
    // this is the one piece of OAuth handling this file adds itself.
    let myEmail = auth.gmailData.email?.toLowerCase() || '';
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      myEmail = profile.data.emailAddress?.toLowerCase() || myEmail;
    } catch (scopeErr) {
      if (scopeErr.status === 403 || scopeErr.code === 403) {
        summary.needsReconnect = true;
        summary.error = 'missing_scope';
        return summary;
      }
      warn(`getProfile failed for ${userId} (non-blocking): ${scopeErr.message}`);
    }

    const { transitioned, checkedCount, needsReconnect } = await pollRepliesForUser(db, gmail, userId, myEmail);
    summary.checkedCount = checkedCount;
    summary.transitionedCount = transitioned.length;
    summary.needsReconnect = needsReconnect;
    return summary;
  } catch (err) {
    warn(`Sync failed for ${userId}:`, err.message);
    summary.error = err.message;
    return summary;
  } finally {
    // Stamps this worker's OWN fairness-rotation field, regardless of
    // outcome — a user who errored or had nothing new was still examined,
    // and must not be checked again before everyone else gets a turn.
    await db.collection('users').doc(userId).collection('integrations').doc('gmail')
      .update({ [REPLY_SYNC_ROTATION_FIELD]: new Date().toISOString() })
      .catch((err) => warn(`Could not stamp ${REPLY_SYNC_ROTATION_FIELD} for ${userId} (non-blocking):`, err.message));
  }
}

/**
 * Run one full reply-check pass across every connected Gmail account.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ now?: number, budgetMs?: number }} [options]
 */
export async function runReplySync(db, options = {}) {
  const startedAt = options.now ?? Date.now();
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;

  const users = await findConnectedGmailUsers(db, undefined, REPLY_SYNC_ROTATION_FIELD);
  log(`starting run — ${users.length} connected account(s)`);

  const results = [];
  let deferred = 0;

  for (const user of users) {
    if (Date.now() - startedAt > budgetMs) {
      deferred = users.length - results.length;
      warn(`time budget spent — deferring ${deferred} account(s) to the next run`);
      break;
    }
    results.push(await syncUserReplies(db, user));
  }

  const totals = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.checkedCount,
      transitioned: acc.transitioned + r.transitionedCount,
      failed: acc.failed + (r.error ? 1 : 0),
    }),
    { checked: 0, transitioned: 0, failed: 0 }
  );

  log(
    `run complete — ${results.length} account(s), ${totals.checked} thread(s) checked, ` +
    `${totals.transitioned} transitioned, ${totals.failed} failed`
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

function safeFirestore() {
  try {
    return getFirestore();
  } catch {
    return null;
  }
}

export const replySyncHandler = async () => {
  try {
    const summary = await runReplySync(getFirestore());

    const allOk = summary.totals.failed === 0;
    console.log(allOk ? 'gmail.reply_sync.ok' : 'gmail.reply_sync.partial_failure', {
      usersConsidered: summary.usersConsidered,
      usersSynced: summary.usersSynced,
      usersDeferred: summary.usersDeferred,
      threadsChecked: summary.totals.checked,
      transitioned: summary.totals.transitioned,
      usersFailed: summary.totals.failed,
      durationMs: summary.durationMs,
    });

    if (!allOk) {
      await alertOps({
        db: safeFirestore(), job: 'gmail-reply-sync-worker', severity: 'partial_failure',
        summary: `${summary.totals.failed} Gmail account(s) failed to check for replies.`,
        detail: {
          usersConsidered: summary.usersConsidered, usersSynced: summary.usersSynced,
          threadsChecked: summary.totals.checked, failed: summary.totals.failed,
          firstError: summary.results.find((r) => r.error)?.error || 'n/a',
        },
      });
    }

    return {
      statusCode: allOk ? 200 : 207,
      body: JSON.stringify({ success: allOk, ...summary }),
    };
  } catch (err) {
    console.error('[gmail-reply-sync] Run failed:', err);
    console.error('gmail.reply_sync.failed', { error: err.message });
    await alertOps({
      db: safeFirestore(), job: 'gmail-reply-sync-worker', severity: 'failed',
      summary: 'The Gmail reply-sync worker crashed before finishing. No account was checked.',
      detail: { error: err.message },
    });

    // Scheduled functions are not retried by Netlify on a non-2xx — a
    // failed run is simply skipped until the next cron tick. Returning 500
    // here (rather than swallowing it as 200) is what makes that visible
    // outside the logs, matching gmail-sync-worker.js's own fix for this.
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};

export const handler = schedule(REPLY_SYNC_SCHEDULE, replySyncHandler);
