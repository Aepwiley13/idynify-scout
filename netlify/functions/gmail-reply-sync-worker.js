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
 *
 * ROLLOUT CONTROL
 * ----------------
 * This worker is gated by GMAIL_REPLY_SYNC_ENABLED, which defaults OFF —
 * unset, or set to anything other than the literal string 'true' — in
 * every environment, production and Netlify deploy previews included.
 * While off, runReplySync returns immediately, BEFORE findConnectedGmailUsers
 * is called: no mailbox enumeration, no OAuth client, no Gmail API call.
 * This flag is independent of GMAIL_IDENTITY_MODE and does not touch it.
 *
 * The manual "Sync Replies" button (gmail-poll-replies.js) is a separate
 * HTTP function and is NOT gated by this flag — it keeps working exactly
 * as it does today regardless of this worker's rollout state.
 *
 * Rollout procedure — VERIFIED against Netlify's own documentation, not
 * assumed: changing an environment variable's value does NOT take effect
 * on its own. Netlify's docs state plainly that "environment variable
 * changes require a build and deploy to take effect" — this applies to
 * Functions reading a var at runtime just as much as to build-time usage,
 * and scheduled functions only run on a published deploy (a Deploy
 * Preview's build will never actually fire this cron), so the env var
 * that matters here is the one on the deploy that is actually live.
 *
 *   1. Set the variable: Project configuration > Environment variables >
 *      find the key > Options > Edit (or `netlify env:set KEY value`, or
 *      the Netlify API). Set GMAIL_REPLY_SYNC_ENABLED=true AND
 *      GMAIL_REPLY_SYNC_USER_ALLOWLIST=<comma-separated userIds> (e.g.
 *      just Aaron's own userId) for the internal-test phase. If this
 *      site uses scoped variables (Pro plan+), confirm the scope includes
 *      "Functions" and the context you intend (Production) — a value
 *      scoped only to Deploy Previews will never reach the scheduled run.
 *   2. Redeploy — REQUIRED, not optional, even though nothing about the
 *      code changed. From the Deploys page: "Trigger deploy" (production/
 *      primary branch only — this worker's actual schedule only ever
 *      fires there). There is no "apply env var without a new deploy"
 *      option; the new deploy simply rebuilds the same code with the new
 *      variable values baked in.
 *   3. Verify — watch the gmail.reply_sync.ok / gmail.reply_sync.partial_failure
 *      logs and alertOps output for the allowlisted users over a few
 *      10-minute runs. (The "Run now" button or `netlify functions:invoke`
 *      can trigger one run immediately rather than waiting for the cron
 *      tick, for faster iteration during this step.)
 *   4. Broaden — once satisfied, remove GMAIL_REPLY_SYNC_USER_ALLOWLIST
 *      (leave GMAIL_REPLY_SYNC_ENABLED=true), then repeat step 2 — this
 *      is itself a variable change and needs its own redeploy. With no
 *      allowlist set, every connected account is checked — the same
 *      accounts the manual button already reaches, just on a schedule.
 *   To pause entirely at any point, set GMAIL_REPLY_SYNC_ENABLED back to
 *   unset/false, THEN repeat step 2 — the redeploy is required to turn
 *   it off again too, same as turning it on.
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

/**
 * Master rollout switch — see this file's ROLLOUT CONTROL docstring above.
 * Defaults OFF: only the exact string 'true' turns the worker on, so an
 * unset var (every environment until explicitly configured, deploy
 * previews included) is off by construction, not by convention.
 */
export function isReplySyncEnabled(env = process.env) {
  return env.GMAIL_REPLY_SYNC_ENABLED === 'true';
}

/**
 * Optional internal-test allowlist. Returns null (no restriction — every
 * connected user is in scope) when unset or empty; otherwise a Set of
 * userIds, trimmed, for syncUserReplies to be limited to.
 */
export function getReplySyncAllowlist(env = process.env) {
  const raw = env.GMAIL_REPLY_SYNC_USER_ALLOWLIST;
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

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
  const summary = {
    userId, checkedCount: 0, transitionedCount: 0, needsReconnect: false, error: null,
    // Per-contact failures, distinct from `error` (a whole-user failure).
    // A contact-level checkpoint failure most often means its id does not
    // resolve to a real document — see replyPolling.js's candidate-
    // projection fix. Non-empty here with summary.error === null means
    // the user's run otherwise succeeded; this is visibility, not a
    // reason to report the run itself as failed.
    contactFailures: [], checkpointFailures: [],
  };

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

    const { transitioned, checkedCount, needsReconnect, failures, checkpointFailures } =
      await pollRepliesForUser(db, gmail, userId, myEmail);
    summary.checkedCount = checkedCount;
    summary.transitionedCount = transitioned.length;
    summary.needsReconnect = needsReconnect;
    summary.contactFailures = failures;
    summary.checkpointFailures = checkpointFailures;
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
 * Resolve the rollout allowlist directly against each userId's own
 * integration document — NEVER through findConnectedGmailUsers's capped,
 * sorted enumeration. An explicitly allowlisted internal-test user must be
 * evaluated because they are named, not because they happened to survive
 * a Firestore .limit() and a least-recently-synced sort that has nothing
 * to do with being on this list. (This was the bug: the old code ran the
 * capped enumeration FIRST and filtered to the allowlist AFTER, so a
 * listed user outside that run's top MAX_USERS_PER_RUN — or outside the
 * .limit(limit*4) pre-filter entirely, for a large account base — was
 * silently dropped despite being named explicitly.)
 *
 * Still enforces the same ownership/eligibility check findConnectedGmailUsers
 * uses — status === 'connected' on that user's own integration doc. The
 * allowlist grants visibility into which users get evaluated this run; it
 * is not an exemption from being a real, connected Gmail account. A listed
 * id that is misspelled, was never connected, or has since disconnected is
 * logged and excluded, never silently treated as eligible.
 *
 * Naturally bounded without a separate cap: this makes exactly one
 * Firestore read per listed id (an operator-curated, short internal-test
 * list — not the general account base), and the caller's own RUN_BUDGET_MS
 * check still applies to how many of the resolved, eligible users actually
 * get processed in one run.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {Set<string>} allowlist
 * @returns {Promise<Array<{ userId: string, docRef: object, data: object }>>}
 */
async function resolveAllowlistedUsers(db, allowlist) {
  const resolved = await Promise.all(
    [...allowlist].map(async (userId) => {
      try {
        const docRef = db.collection('users').doc(userId).collection('integrations').doc('gmail');
        const snap = await docRef.get();
        if (!snap.exists || snap.data()?.status !== 'connected') {
          warn(`Allowlisted user ${userId} is not an eligible connected Gmail account — excluding from this run`);
          return null;
        }
        return { userId, docRef, data: snap.data() || {} };
      } catch (err) {
        warn(`Could not resolve allowlisted user ${userId} (non-blocking): ${err.message}`);
        return null;
      }
    })
  );
  return resolved.filter(Boolean);
}

/**
 * Run one full reply-check pass across every connected Gmail account.
 *
 * Gated by GMAIL_REPLY_SYNC_ENABLED (see this file's ROLLOUT CONTROL
 * docstring). When disabled, this returns immediately — before any
 * account resolution, before any OAuth client, before any Gmail call.
 *
 * When a rollout allowlist is active, the user list comes ONLY from
 * resolveAllowlistedUsers (direct per-id lookups) — findConnectedGmailUsers
 * is not called at all, so its cap and rotation never apply during the
 * internal-test phase. With no allowlist, behavior is unchanged from
 * before the rollout flag existed: the normal capped, fairly-rotated
 * enumeration runs exactly as it always has.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ now?: number, budgetMs?: number, enabled?: boolean, allowlist?: Set<string>|null }} [options]
 *   `enabled`/`allowlist` default to reading GMAIL_REPLY_SYNC_ENABLED /
 *   GMAIL_REPLY_SYNC_USER_ALLOWLIST from the environment; tests override
 *   them directly rather than mutating process.env.
 */
export async function runReplySync(db, options = {}) {
  const startedAt = options.now ?? Date.now();
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const enabled = options.enabled ?? isReplySyncEnabled();

  if (!enabled) {
    log('disabled via GMAIL_REPLY_SYNC_ENABLED — skipping run (no account enumeration, no OAuth, no Gmail calls)');
    return {
      usersConsidered: 0, usersSynced: 0, usersDeferred: 0,
      totals: { checked: 0, transitioned: 0, failed: 0, contactFailures: 0, checkpointFailures: 0 },
      results: [], durationMs: Date.now() - startedAt, disabled: true,
    };
  }

  const allowlist = options.allowlist ?? getReplySyncAllowlist();

  let users;
  if (allowlist) {
    users = await resolveAllowlistedUsers(db, allowlist);
    log(`rollout allowlist active — resolved ${users.length} of ${allowlist.size} listed user(s) directly (general enumeration not consulted)`);
  } else {
    users = await findConnectedGmailUsers(db, undefined, REPLY_SYNC_ROTATION_FIELD);
  }
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
      // Contact-level failures, distinct from an account-level `error`
      // above. A run with zero account failures can still have contacts
      // whose thread check failed (contactFailures) or whose best-effort
      // checkpoint stamp failed (checkpointFailures, most often NOT_FOUND
      // — see replyPolling.js). Both used to be invisible outside a
      // console.warn; counted here so "0 failed" can no longer describe a
      // run that actually had either.
      contactFailures: acc.contactFailures + (r.contactFailures?.length || 0),
      checkpointFailures: acc.checkpointFailures + (r.checkpointFailures?.length || 0),
    }),
    { checked: 0, transitioned: 0, failed: 0, contactFailures: 0, checkpointFailures: 0 }
  );

  log(
    `run complete — ${results.length} account(s), ${totals.checked} thread(s) checked, ` +
    `${totals.transitioned} transitioned, ${totals.failed} account(s) failed, ` +
    `${totals.contactFailures} contact(s) failed, ${totals.checkpointFailures} checkpoint stamp(s) failed`
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

    // A run with zero account-level failures can still have contact-level
    // ones — see totals' own comment. Treating only account failures as
    // "not ok" is exactly how a run with real NOT_FOUND / checkpoint
    // failures got reported as fully successful; both now count.
    const allOk = summary.totals.failed === 0
      && summary.totals.contactFailures === 0
      && summary.totals.checkpointFailures === 0;
    console.log(allOk ? 'gmail.reply_sync.ok' : 'gmail.reply_sync.partial_failure', {
      usersConsidered: summary.usersConsidered,
      usersSynced: summary.usersSynced,
      usersDeferred: summary.usersDeferred,
      threadsChecked: summary.totals.checked,
      transitioned: summary.totals.transitioned,
      usersFailed: summary.totals.failed,
      contactFailures: summary.totals.contactFailures,
      checkpointFailures: summary.totals.checkpointFailures,
      durationMs: summary.durationMs,
    });

    if (!allOk) {
      await alertOps({
        db: safeFirestore(), job: 'gmail-reply-sync-worker', severity: 'partial_failure',
        summary: `${summary.totals.failed} account(s), ${summary.totals.contactFailures} contact(s), ` +
          `and ${summary.totals.checkpointFailures} checkpoint stamp(s) failed.`,
        detail: {
          usersConsidered: summary.usersConsidered, usersSynced: summary.usersSynced,
          threadsChecked: summary.totals.checked, failed: summary.totals.failed,
          contactFailures: summary.totals.contactFailures, checkpointFailures: summary.totals.checkpointFailures,
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
