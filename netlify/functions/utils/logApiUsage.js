/**
 * Log API usage to Firestore for admin tracking and cost measurement.
 *
 * P0B — defects A2, A3, A11
 * ─────────────────────────
 * This util previously recorded EVERY call, whatever it was, as
 * `APOLLO_<OPERATION>` with `creditsUsed: 1`. Anthropic spend was being booked
 * as Apollo credits, so the one question the logs exist to answer — what did
 * Claude cost yesterday — could not be asked. Three further problems compounded
 * it:
 *
 *   A2  provider was implicit and always wrong for AI calls; model was absent;
 *       token counts, where captured at all, were buried inside a
 *       JSON-stringified `metadata` blob that Firestore cannot aggregate.
 *   A3  writes went to the Firestore REST API with no Authorization header,
 *       relying on the `apiLogs` rule `allow write: if request.auth != null`.
 *       The fetch carried no token, so these writes were either failing
 *       silently or the rule was not being enforced on that path. Either way
 *       the numbers could not be trusted.
 *   A11 the per-user summary was a read-then-write, so concurrent calls lost
 *       counts.
 *
 * All four are fixed here. Writes now go through the Admin SDK (authenticated
 * by service account), provider/model/tokens are first-class queryable fields,
 * and summary counters use FieldValue.increment().
 *
 * BACKWARD COMPATIBILITY
 * ──────────────────────
 * `adminGetApiLogs.js` reads userId, endpoint, creditsUsed, timestamp, status,
 * responseTime, environment, errorCode and metadata. Every one of those is
 * still written, with the same meaning. `endpoint` keeps its
 * `<PROVIDER>_<OPERATION>` shape, so Apollo rows are byte-identical to before
 * (`APOLLO_SEARCHPEOPLE`) and AI rows are finally honest
 * (`ANTHROPIC_BARRYMISSIONCHAT`). Historical rows need no migration.
 *
 * `creditsUsed` now means what it says: Apollo credits. AI calls record 0 and
 * report tokens instead, so Claude stops inflating the Apollo credit counter.
 *
 * @param {string} userId   Firebase user UID
 * @param {string} operation Operation name, e.g. 'searchPeople', 'barryMissionChat'
 * @param {string} status   'success' | 'error'
 * @param {object} [options]
 * @param {number} [options.responseTime]  Milliseconds
 * @param {string} [options.errorCode]
 * @param {object} [options.metadata]      Free-form; never put numbers here that
 *                                         you intend to aggregate — give them a field
 * @param {'apollo'|'anthropic'|'google'} [options.provider='apollo']
 *        Defaults to apollo so the 14 non-AI call sites keep their exact
 *        previous semantics without being touched.
 * @param {string} [options.model]         Model identifier, for AI providers
 * @param {object} [options.usage]         Raw Anthropic `response.usage`
 *                                         ({ input_tokens, output_tokens })
 * @param {number} [options.inputTokens]   Alternative to `usage`
 * @param {number} [options.outputTokens]  Alternative to `usage`
 * @param {string} [options.traceId]       Links the calls of one user intent
 */

import { db } from '../firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

/** Providers whose calls are billed in Apollo credits. */
const CREDIT_BEARING_PROVIDERS = new Set(['apollo']);

/** Coerce to a non-negative integer, or null when there is nothing usable. */
function toCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

/**
 * Pull token counts from either the raw Anthropic usage object or explicit
 * options. Returns nulls rather than zeros when unknown — zero is a
 * measurement, "we did not capture it" is not, and conflating them is how the
 * previous version produced numbers that looked real.
 */
function resolveTokens(options) {
  const usage = options.usage || null;
  return {
    inputTokens: toCount(options.inputTokens ?? usage?.input_tokens),
    outputTokens: toCount(options.outputTokens ?? usage?.output_tokens),
  };
}

export async function logApiUsage(userId, operation, status, options = {}) {
  try {
    if (!userId) return;

    // The logical application environment, and nothing else. It is NOT derived
    // from the Firebase project: FIREBASE_PROJECT_ID selects the physical
    // database, BARRY_ENV names the environment, and neither may be inferred
    // from the other (BO-011).
    //
    // The previous implementation tested the project ID for the substring
    // "dev". The one project serving production is named `idynify-scout-dev`,
    // so that test returned 'dev' for every row ever written and the field
    // distinguished nothing.
    //
    // No fallback by design. An absent variable records 'unknown' rather than a
    // guess — a wrong label is worse than an admittedly missing one, because it
    // reads as measurement.
    const environment = process.env.BARRY_ENV || 'unknown';

    const provider = options.provider || 'apollo';
    const endpoint = `${provider.toUpperCase()}_${operation.toUpperCase()}`;
    const creditsUsed = CREDIT_BEARING_PROVIDERS.has(provider) ? 1 : 0;

    const { inputTokens, outputTokens } = resolveTokens(options);
    const responseTime = Math.round(Number(options.responseTime) || 0);
    const metadata = options.metadata || {};

    const logEntry = {
      userId,
      operation,
      provider,
      endpoint,
      creditsUsed,
      status,
      responseTime,
      environment,
      timestamp: FieldValue.serverTimestamp(),
    };

    if (options.model) logEntry.model = options.model;
    if (inputTokens !== null) logEntry.inputTokens = inputTokens;
    if (outputTokens !== null) logEntry.outputTokens = outputTokens;
    if (inputTokens !== null && outputTokens !== null) {
      logEntry.totalTokens = inputTokens + outputTokens;
    }
    if (options.traceId) logEntry.traceId = options.traceId;
    if (options.errorCode) logEntry.errorCode = String(options.errorCode);

    // Still a JSON string: adminGetApiLogs JSON.parses this field, and changing
    // its type would break every historical row it reads alongside the new ones.
    if (Object.keys(metadata).length > 0) {
      logEntry.metadata = JSON.stringify(metadata);
    }

    await db.collection('apiLogs').add(logEntry);

    // ── Per-user rolling summary ──────────────────────────────────────────
    // Every counter is an increment, so concurrent calls add up instead of
    // overwriting each other (A11).
    const summaryUpdate = {
      lastUpdated: FieldValue.serverTimestamp(),
      [`calls_${provider}`]: FieldValue.increment(1),
      [operation]: FieldValue.increment(1),
    };

    if (creditsUsed > 0) {
      summaryUpdate.totalCredits = FieldValue.increment(creditsUsed);
    }
    if (inputTokens !== null) {
      summaryUpdate.totalInputTokens = FieldValue.increment(inputTokens);
    }
    if (outputTokens !== null) {
      summaryUpdate.totalOutputTokens = FieldValue.increment(outputTokens);
    }

    await db
      .collection('users').doc(userId)
      .collection('apiUsage').doc('summary')
      .set(summaryUpdate, { merge: true });

    console.log(
      `✅ API log: ${endpoint} (${status}) ${environment} user=${userId} ${responseTime}ms` +
      (logEntry.totalTokens ? ` tokens=${logEntry.totalTokens}` : '')
    );
  } catch (error) {
    // Telemetry must never break the operation it is measuring.
    console.error('❌ Failed to log API usage:', error);
  }
}
