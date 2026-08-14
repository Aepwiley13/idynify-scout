/**
 * signupAnalytics — funnel events for a page where nobody is signed in yet.
 *
 * THE PROBLEM
 * ───────────
 * `services/analytics.js` writes to `users/{uid}/analytics_events` and returns
 * early when there is no signed-in user (analytics.js:122-124), which
 * firestore.rules enforces at the database. Every signup event except the last
 * one happens BEFORE that uid exists, so routing them straight through
 * `logEvent` would drop them silently — while still printing to the console in
 * dev, so the instrumentation would look present and record nothing.
 *
 * THE DECISION (D5, option B)
 * ───────────────────────────
 * Buffer in memory, flush through the existing authenticated path once the
 * account exists. No new collection, no rules change, no new SDK.
 *
 * KNOWN LIMITATION — documented because it was accepted, not overlooked:
 *
 *   Abandoned signups are not captured. A visitor who lands on the page and
 *   leaves without creating an account produces no record, because there is
 *   never a uid to write under. That means this instrumentation can answer
 *   "what did people who succeeded do on the way" but NOT "how many people
 *   dropped, and where" — which is the actual conversion question.
 *
 *   Answering that needs an anonymous write path and a security review
 *   (D5 option C), scoped as a separate initiative. Until then, treat any
 *   funnel built on these events as conditioned on success.
 *
 * Ordering and relative timing are preserved: each event carries `at_ms`, the
 * offset in milliseconds from page load, so the flushed batch still describes
 * a sequence rather than an unordered pile of writes.
 */

import { logEvent } from './analytics';

export const SIGNUP_EVENTS = Object.freeze({
  VIEWED:          'signup_page_viewed',
  EMAIL_STARTED:   'signup_email_started',
  PASSWORD_STARTED:'signup_password_started',
  SUBMITTED:       'signup_submitted',
  SUCCEEDED:       'signup_succeeded',
  FAILED:          'signup_failed',
  SIGNIN_CLICKED:  'signup_signin_clicked',
  METHOD_SELECTED: 'signup_method_selected',
});

/** Bounded so a page left open overnight cannot grow without limit. */
const LIMIT = 60;

let buffer = [];
let t0 = Date.now();

/** Reset the buffer and the clock. Called on mount. */
export function beginSignupSession() {
  buffer = [];
  t0 = Date.now();
}

/**
 * Record a pre-auth event. Never throws, never awaits, never writes.
 *
 * Params must describe BEHAVIOUR, not content: an error code is fine, an email
 * address or password is not. Nothing here should ever carry either.
 */
export function bufferSignupEvent(name, params = {}) {
  if (!name) return;
  if (buffer.length >= LIMIT) return;
  buffer.push({ name, params, at_ms: Date.now() - t0 });
}

/**
 * Record an event once per session — for "first keystroke in the email field"
 * and friends, where every subsequent keystroke would otherwise be an event.
 */
export function bufferSignupEventOnce(name, params = {}) {
  if (buffer.some(e => e.name === name)) return;
  bufferSignupEvent(name, params);
}

/**
 * Flush everything buffered, plus the terminal event, now that a uid exists.
 *
 * Fire-and-forget by construction: `logEvent` returns void and swallows its
 * own failures, so this can never delay or break the redirect that follows it.
 */
export function flushSignupEvents(finalName, finalParams = {}) {
  const batch = buffer;
  buffer = [];

  for (const e of batch) {
    logEvent(e.name, { ...e.params, at_ms: e.at_ms, buffered: true });
  }
  if (finalName) {
    logEvent(finalName, { ...finalParams, at_ms: Date.now() - t0 });
  }
}

/** @internal — tests only. */
export function _peekBuffer() {
  return buffer.slice();
}
