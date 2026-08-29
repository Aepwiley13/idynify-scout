/**
 * gmailSyncHealth — turn the integration document into an answer to "is Barry
 * still reading my email?"
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The sync worker has always written `syncStatus`, `lastSyncError` and
 * `lastSuccessfulSyncAt`. The Gate 2 audit found that no code anywhere read any
 * of them: production had 978 unprocessed replies and every surface reported
 * healthy. The only `syncStatus` in the UI was local React state belonging to a
 * button, which is not the same thing and never was.
 *
 * A failure nobody can see is worse than a failure, because the product keeps
 * recommending outreach with confidence it has not earned. This module is the
 * missing reader.
 *
 * Pure: a document in, a verdict out. No Firestore, no React, so the rule is
 * testable and both runtimes share one answer.
 */

/**
 * How far behind the ten-minute schedule a sync may fall before it is stale.
 *
 * Three missed runs. Tight enough that a wedged mailbox surfaces within the
 * hour, loose enough that one slow run, a deploy, or a cold start does not cry
 * wolf at someone who is fine.
 */
export const STALE_AFTER_MINUTES = 30;

export const SYNC_HEALTH = Object.freeze({
  HEALTHY: 'healthy',
  NEVER_SYNCED: 'never_synced',
  STALE: 'stale',
  DEGRADED: 'degraded',
  ERROR: 'error',
  NEEDS_RECONNECT: 'needs_reconnect',
  DISCONNECTED: 'disconnected',
});

/**
 * Classify one Gmail integration document.
 *
 * Ordered most-actionable first: a reconnect is something only the user can do,
 * so it outranks staleness, which outranks a partial blockade. `degraded` is
 * deliberately distinct from `error` — quarantined mail means sync IS running
 * and some messages are being set aside, which is a different sentence to the
 * user than "sync has stopped".
 *
 * @returns {{ status: string, minutesSinceSync: number|null,
 *             quarantinedCount: number, message: string, actionable: boolean }}
 */
export function deriveSyncHealth(integration, now = Date.now()) {
  const quarantinedCount = integration?.quarantinedCount || 0;

  const base = { minutesSinceSync: null, quarantinedCount, actionable: false };

  if (!integration || integration.status !== 'connected') {
    return {
      ...base,
      status: SYNC_HEALTH.DISCONNECTED,
      message: 'Gmail is not connected, so Barry cannot see replies.',
      actionable: true,
    };
  }

  if (integration.syncStatus === 'needs_reconnect') {
    return {
      ...base,
      status: SYNC_HEALTH.NEEDS_RECONNECT,
      message:
        'Gmail needs reconnecting. Barry has stopped reading new mail, and ' +
        'follow-up suggestions may not account for recent replies.',
      actionable: true,
    };
  }

  const lastAt = integration.lastSuccessfulSyncAt
    ? Date.parse(integration.lastSuccessfulSyncAt)
    : null;
  const minutesSinceSync = lastAt && !Number.isNaN(lastAt)
    ? (now - lastAt) / 60_000
    : null;

  if (minutesSinceSync === null) {
    return {
      ...base,
      status: SYNC_HEALTH.NEVER_SYNCED,
      message: 'Gmail is connected but has not completed a first sync yet.',
    };
  }

  if (minutesSinceSync > STALE_AFTER_MINUTES) {
    return {
      ...base,
      minutesSinceSync,
      status: SYNC_HEALTH.STALE,
      message:
        `Barry last read your inbox ${formatAge(minutesSinceSync)} ago. ` +
        'Recent replies may not be reflected yet.',
      actionable: true,
    };
  }

  // Sync is current. An error recorded on a run that nonetheless completed is
  // reported, but not as loudly as a stalled mailbox.
  if (integration.syncStatus === 'error' || integration.lastSyncError) {
    return {
      ...base,
      minutesSinceSync,
      status: SYNC_HEALTH.ERROR,
      message: 'The last Gmail sync reported an error. Some replies may be missing.',
      actionable: true,
    };
  }

  if (quarantinedCount > 0) {
    return {
      ...base,
      minutesSinceSync,
      status: SYNC_HEALTH.DEGRADED,
      message:
        `Barry is reading your inbox, but ${quarantinedCount} ` +
        `${quarantinedCount === 1 ? 'message' : 'messages'} could not be processed ` +
        'and had to be set aside.',
      actionable: true,
    };
  }

  return {
    ...base,
    minutesSinceSync,
    status: SYNC_HEALTH.HEALTHY,
    message: `Barry read your inbox ${formatAge(minutesSinceSync)} ago.`,
  };
}

function formatAge(minutes) {
  if (minutes < 1) return 'moments';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} hr`;
  return `${Math.round(hours / 24)} d`;
}

export default { deriveSyncHealth, SYNC_HEALTH, STALE_AFTER_MINUTES };
