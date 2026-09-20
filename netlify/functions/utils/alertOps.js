/**
 * alertOps — make a failed scheduled run reach a human.
 *
 * WHY THIS EXISTS
 * ───────────────
 * daily-leads-refresh was designed to be noticed. It returns 207 on partial
 * failure, logs `discovery.scheduled.partial_failure`, and names every user
 * that failed. All of that worked. Nothing consumed any of it, so a refactor
 * that left `projectId` undefined failed for every user, on every weekday run,
 * for 17 runs, while the logs faithfully recorded it to nobody.
 *
 * The gap was never instrumentation. It was that no signal left the process.
 *
 * WHY EMAIL, AND WHY NO SDK
 * ─────────────────────────
 * Resend is already in production here — send-welcome-email and
 * daily-leads-refresh both post to it with plain `fetch` and no client
 * library. Reusing it costs nothing and adds no dependency, which is the same
 * call src/services/analytics.js made when it chose Firestore over an
 * analytics SDK. A monitoring vendor would add a bill, a dependency in every
 * function, and — because these failures are CAUGHT and counted, not thrown —
 * would still need an explicit call at exactly this line to see them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ────────────────────────────────
 * It cannot detect a run that never happened. If a deploy breaks the schedule
 * or DISCOVERY_CRON_ENABLED turns a job off, no code runs and no alert sends —
 * silence still reads as health. Closing that needs a heartbeat written on
 * success and something outside these functions reading it, which is a
 * separate piece of work.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Same verified sender the other Resend calls in this codebase use. */
const FROM = 'Idynify Alerts <aaron@idynify.com>';

/**
 * How long to stay quiet after alerting about the same job.
 *
 * process-barry-inbox-queue runs every 5 minutes. Without this, one broken
 * deploy is 288 identical emails a day, which is indistinguishable from spam
 * and gets the alert address filtered — the exact failure this module exists
 * to prevent, arrived at from the other direction.
 */
const COOLDOWN_MS = 60 * 60 * 1000;

/**
 * How long to wait for Resend before giving up on the alert.
 *
 * Every call site awaits this function, so an unbounded fetch is the one way
 * this module can still break its caller: gmail-sync-worker and
 * process-barry-inbox-queue are capped at 300s (netlify.toml), and a hung
 * connection held past that turns a run that was reporting a PARTIAL failure
 * into a total timeout — the alert taking down the job it was reporting on.
 * Ten seconds is far beyond a healthy Resend POST and far inside every
 * function's budget.
 */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Report a failed or partially-failed scheduled run.
 *
 * NEVER THROWS. An alerting failure must not turn a partial failure into a
 * total one — the caller has already done its work by the time this runs.
 *
 * @param {object}  args
 * @param {string}  args.job      Function name, e.g. 'daily-leads-refresh'.
 * @param {'partial_failure'|'failed'} args.severity
 * @param {string}  args.summary  One line a human can act on.
 * @param {object} [args.detail]  Counters or an error message, rendered as-is.
 * @param {object} [args.db]      Firestore handle. Omitted, the cooldown is
 *                                skipped and the alert always sends.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function alertOps({ job, severity, summary, detail = {}, db = null }) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.OPS_ALERT_EMAIL;

    // Unset is a valid configuration, not an error: environments that have not
    // opted in stay silent rather than crashing the job that called us.
    if (!apiKey) return { sent: false, reason: 'no_resend_key' };
    if (!to) return { sent: false, reason: 'no_ops_alert_email' };

    if (db && await isInCooldown(db, job)) {
      return { sent: false, reason: 'cooldown' };
    }

    const label = severity === 'failed' ? 'FAILED' : 'PARTIAL';

    // Scannable on a lock screen, where roughly the first 35 characters
    // survive. Severity first so the eye lands on it, then the job name, then
    // the count if there is one — "[FAILED] gmail-sync-worker" tells you what
    // to do before the preview text has loaded.
    const count = detail.failed ?? detail.usersFailed ?? detail.entriesFailed ?? null;
    const subject = count === null
      ? `[${label}] ${job}`
      : `[${label}] ${job} — ${count} failed`;
    const rows = Object.entries(detail)
      .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td>` +
                       `<td style="font-family:monospace">${escapeHtml(String(v))}</td></tr>`)
      .join('');

    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
            <h2 style="margin:0 0 4px">${escapeHtml(job)} — ${label}</h2>
            <p style="margin:0 0 16px;color:#444">${escapeHtml(summary)}</p>
            <table style="font-size:13px;border-collapse:collapse">${rows}</table>
            <p style="margin-top:20px;font-size:12px;color:#888">
              Sent once per hour per job at most. Check the Netlify function log
              for <code>${escapeHtml(job)}</code> for the full run.
            </p>
          </div>`,
      }),
    });

    if (!response.ok) {
      console.error('alertOps.send_failed', { job, status: response.status });
      return { sent: false, reason: `resend_${response.status}` };
    }

    if (db) await recordAlert(db, job);
    return { sent: true };
  } catch (err) {
    // Swallowed on purpose, and logged. The caller is already reporting a
    // failure; it must not also fail because the alert could not be sent.
    //
    // A timed-out send is named rather than folded into `threw`: "the alert
    // could not be delivered in 10s" and "alertOps has a bug" are different
    // problems, and the whole point of this module is that a failure says
    // which one it is.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      console.error('alertOps.timed_out', { job, timeoutMs: SEND_TIMEOUT_MS });
      return { sent: false, reason: 'timeout' };
    }
    console.error('alertOps.threw', { job, error: err?.message });
    return { sent: false, reason: 'threw' };
  }
}

/**
 * Fails OPEN. If the cooldown cannot be read, send the alert: a duplicate
 * email is a nuisance, a suppressed one is the bug this module is fixing.
 */
async function isInCooldown(db, job) {
  try {
    const snap = await db.collection('ops_alerts').doc(job).get();
    if (!snap.exists) return false;
    const lastMs = snap.data()?.lastAlertAtMs;
    if (typeof lastMs !== 'number') return false;
    return Date.now() - lastMs < COOLDOWN_MS;
  } catch (err) {
    console.error('alertOps.cooldown_read_failed', { job, error: err?.message });
    return false;
  }
}

async function recordAlert(db, job) {
  try {
    await db.collection('ops_alerts').doc(job).set({
      lastAlertAtMs: Date.now(),
      lastAlertAt: new Date().toISOString(),
      job,
    }, { merge: true });
  } catch (err) {
    console.error('alertOps.cooldown_write_failed', { job, error: err?.message });
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const __testing = { COOLDOWN_MS, SEND_TIMEOUT_MS, FROM, RESEND_ENDPOINT };
