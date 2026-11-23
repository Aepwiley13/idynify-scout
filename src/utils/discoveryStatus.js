/**
 * Discovery status — one honest answer to "what is Barry doing with my search?" (#006.1)
 *
 * Built only from information that already exists:
 *   barryState          users/{uid}.barryState. The client sets 'SEARCHING' when it
 *                       starts a search; search-companies sets 'READY' when it
 *                       finishes and 'ERROR' when it throws.
 *   companiesFoundCount users/{uid}.companiesFoundCount, written with 'READY'
 *                       (companies added by that run, or the pending count when the
 *                       queue was already full).
 *   queueLength         companies waiting in Daily Discoveries right now.
 *   lastRun             what THIS page saw from its own search request, if any.
 *
 * There is no timestamp on barryState, so a status is never declared "stale" by
 * a clock. When this page's own request ends without a result it can trust
 * (timeout), the answer is "still working — check again", not "failed".
 *
 * Precedence: a search this page is running > the outcome this page just saw >
 * the stored barryState. The page's own outcome is the newest thing it knows.
 */

/** Outcome kinds of a search this page ran (handleManualRefresh). */
export const RUN = Object.freeze({
  RUNNING: 'running',
  ADDED: 'added',        // succeeded, added > 0
  NONE: 'none',          // succeeded, nothing new and queue empty
  FULL: 'full',          // succeeded, queue already has companies
  FAILED: 'failed',      // server said it failed, or the request errored
  TIMEOUT: 'timeout',    // request aborted at 25s; the server may still finish
});

/** What the user should be told, and which existing action fits. */
export const STATUS = Object.freeze({
  SEARCHING: 'searching',
  HAS_COMPANIES: 'has_companies',
  FOUND: 'found',                 // a search just added companies; queue is loading them
  NO_NEW_MATCHES: 'no_new_matches',
  ALL_REVIEWED: 'all_reviewed',
  FAILED: 'failed',
  STILL_WORKING: 'still_working', // our request timed out; result not known yet
  UNKNOWN: 'unknown',
});

const COPY = {
  [STATUS.SEARCHING]: {
    title: 'Barry is searching',
    body: 'Barry is finding companies that match your targeting.',
    action: 'check', actionLabel: 'Check for results',
  },
  [STATUS.FOUND]: {
    title: 'Barry found new companies',
    body: 'Loading them into your queue.',
    action: null,
  },
  [STATUS.NO_NEW_MATCHES]: {
    title: 'No new matches this time',
    body: 'Barry searched your current targeting and found no new companies. You can search again later, or broaden your targeting.',
    action: 'retry', actionLabel: 'Search again', secondary: 'icp',
  },
  [STATUS.ALL_REVIEWED]: {
    title: "You're all caught up",
    body: "You've reviewed every company from Barry's last search.",
    action: 'retry', actionLabel: 'Find more companies',
  },
  [STATUS.FAILED]: {
    title: "This search didn't finish",
    body: "Barry couldn't complete the last search. Your targeting is saved, so you can try again.",
    action: 'retry', actionLabel: 'Try again',
  },
  [STATUS.STILL_WORKING]: {
    title: 'Still working on it',
    body: 'This search is taking longer than usual. Barry may still be finishing it.',
    action: 'check', actionLabel: 'Check for results',
  },
  [STATUS.UNKNOWN]: {
    title: 'No companies in your queue',
    body: 'Ask Barry to search for companies that match your targeting.',
    action: 'retry', actionLabel: 'Find companies',
  },
  [STATUS.HAS_COMPANIES]: { title: '', body: '', action: null },
};

/**
 * @param {{ barryState?: string|null, companiesFoundCount?: number|null,
 *           queueLength: number, lastRun?: { kind: string }|null }} input
 * @returns {{ kind: string, title: string, body: string, action: 'retry'|'check'|null,
 *             actionLabel?: string, secondary?: 'icp' }}
 */
export function describeDiscovery({ barryState = null, companiesFoundCount = null, queueLength = 0, lastRun = null }) {
  const pick = (kind) => ({ kind, ...COPY[kind] });

  if (lastRun?.kind === RUN.RUNNING) return pick(STATUS.SEARCHING);

  if (lastRun) {
    if (lastRun.kind === RUN.FAILED) return pick(STATUS.FAILED);
    if (lastRun.kind === RUN.TIMEOUT) return pick(STATUS.STILL_WORKING);
    if (queueLength > 0) return pick(STATUS.HAS_COMPANIES);
    if (lastRun.kind === RUN.ADDED) return pick(STATUS.FOUND);
    if (lastRun.kind === RUN.NONE) return pick(STATUS.NO_NEW_MATCHES);
    // FULL with an empty queue: the server has companies this view hasn't loaded.
    if (lastRun.kind === RUN.FULL) return pick(STATUS.FOUND);
  }

  if (barryState === 'SEARCHING') return pick(STATUS.SEARCHING);
  if (barryState === 'ERROR') return pick(STATUS.FAILED);
  if (queueLength > 0) return pick(STATUS.HAS_COMPANIES);
  if (barryState === 'READY' && Number.isFinite(companiesFoundCount)) {
    return pick(companiesFoundCount > 0 ? STATUS.ALL_REVIEWED : STATUS.NO_NEW_MATCHES);
  }
  return pick(STATUS.UNKNOWN);
}

/**
 * The last search, as one persistent line (#006.3). It stays until the next
 * search instead of vanishing after a few seconds.
 *
 * Only facts the page actually has are shown: this page's own result (with the
 * time it finished), or — after a reload — the stored status and count. The
 * stored status has no timestamp, so no time is shown for it.
 *
 * @returns {{ tone: 'info'|'success'|'error', text: string, action: 'retry'|'check'|null } | null}
 */
export function describeLastSearch({ lastRun = null, barryState = null, companiesFoundCount = null, formatTime = defaultTime }) {
  const at = lastRun?.at ? ` · ${formatTime(lastRun.at)}` : '';
  if (lastRun) {
    switch (lastRun.kind) {
      case RUN.RUNNING: return null; // the running message is shown by the page itself
      case RUN.ADDED: return { tone: 'success', action: null, text: `Last search: Barry added ${lastRun.added} new ${lastRun.added === 1 ? 'company' : 'companies'}${at}` };
      case RUN.NONE: return { tone: 'info', action: 'retry', text: `Last search found no new companies${at}` };
      case RUN.FULL: return { tone: 'info', action: null, text: `Last search: your queue already has companies waiting${at}` };
      case RUN.FAILED: return { tone: 'error', action: 'retry', text: `Last search didn't finish${at}` };
      case RUN.TIMEOUT: return { tone: 'info', action: 'check', text: `Last search is taking longer than usual${at}` };
      default: return null;
    }
  }
  if (barryState === 'ERROR') return { tone: 'error', action: 'retry', text: "Barry's last search didn't finish" };
  if (barryState === 'READY' && Number.isFinite(companiesFoundCount) && companiesFoundCount > 0) {
    return { tone: 'info', action: null, text: `Barry's last search found ${companiesFoundCount} ${companiesFoundCount === 1 ? 'company' : 'companies'}` };
  }
  return null;
}

function defaultTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
