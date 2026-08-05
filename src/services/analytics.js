/**
 * analytics — product events, written where they can be counted.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The canonical routes made every module reach contacts and companies the same
 * way. That answered "can they get there". It did not answer "do they", and
 * that is the question the next four sprints need: which modules actually
 * drive contact engagement — Mission Control, Scout, Hunter, or the Command
 * Bar? Before this, a contact open from Mission Control and one from Scout
 * were the same `navigate()` call and left no trace that distinguished them.
 *
 * Every event flows through `openContact()` / `openCompany()`, which is only
 * possible because those helpers are now the single way to open a record. The
 * navigation contract and the analytics are the same change.
 *
 * WHERE EVENTS GO
 * ───────────────
 * `users/{uid}/analytics_events`. Not Firebase Analytics — this codebase does
 * not initialise it, and adding an SDK to ship six event types would be a new
 * external dependency the sprint explicitly forbids. Not the contact document
 * either: an event is a fact about a SESSION, and decision 7 is that the
 * reason a screen opened is never written to the record.
 *
 * THREE RULES, ALL OF THEM LOAD-BEARING
 * ─────────────────────────────────────
 * 1. It never blocks. Fire-and-forget; the navigation has already happened by
 *    the time the write is issued.
 * 2. It never throws. A rejected analytics write must not turn a working
 *    contact page into an error boundary. Failures are logged and swallowed —
 *    the ONE place in this sprint where swallowing is correct, because there
 *    is no user-visible outcome to get wrong.
 * 3. It never writes while impersonating. An admin looking at a customer's
 *    workspace would otherwise write their own clicks into that customer's
 *    analytics, and every conclusion drawn from the data would be wrong in a
 *    way nobody could see.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth } from '../firebase/config';
import { db } from '../firebase/config';
import { getActiveUserId } from '../context/ImpersonationContext';

/** Product event names. One place, so a typo is a missing import, not a lost event. */
export const EVENTS = Object.freeze({
  OPEN_CONTACT: 'open_contact',
  OPEN_COMPANY: 'open_company',
});

/**
 * Turned off in tests. A test that renders a navigation should not attempt a
 * Firestore write, and a mocked Firestore should not have to know this module
 * exists.
 */
let enabled = true;

/** @internal — used by tests and by the console, not by product code. */
export function setAnalyticsEnabled(value) {
  enabled = Boolean(value);
}

/** Recent events, for debugging and for assertions. Capped. */
const RECENT = [];
const RECENT_LIMIT = 50;

export function getRecentEvents() {
  return RECENT.slice();
}

export function clearRecentEvents() {
  RECENT.length = 0;
}

/** Drop undefined/null so an event document has only the fields it knows. */
function compact(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Record a product event.
 *
 * @param {string} name    From EVENTS. A free string is accepted but will not
 *                          be findable by anyone who does not already know it.
 * @param {object} params  Event-specific fields.
 * @returns {void}          Deliberately not a Promise — nothing should await this.
 */
export function logEvent(name, params = {}) {
  if (!name) return;

  const payload = compact(params);

  RECENT.push({ name, params: payload, at: new Date().toISOString() });
  if (RECENT.length > RECENT_LIMIT) RECENT.shift();

  console.info(`[analytics] ${name}`, payload);

  if (!enabled) return;

  // An admin impersonating a customer is READ-ONLY (IMPERSONATION_MODE), and
  // that has to include analytics. Their clicks are not the customer's
  // behaviour, and a workspace whose event log is half admin traffic answers
  // "which module drives engagement" with a number nobody can trust.
  const realUid = auth.currentUser?.uid ?? null;
  const activeUid = getActiveUserId();
  if (!realUid || !activeUid) return;
  if (realUid !== activeUid) {
    console.info('[analytics] suppressed — impersonating', { name });
    return;
  }

  // Fire and forget. The navigation already happened; this is bookkeeping.
  addDoc(collection(db, 'users', realUid, 'analytics_events'), {
    ...payload,
    event: name,
    at: serverTimestamp(),
  }).catch((err) => {
    // Swallowed on purpose — see rule 2 in the header. Logged with the
    // Firestore code so a systemic failure (a rules change, a quota) is
    // diagnosable rather than merely absent.
    console.warn('[analytics] event not recorded', {
      event: name, code: err?.code, message: err?.message,
    });
  });
}

export default { logEvent, EVENTS, setAnalyticsEnabled, getRecentEvents, clearRecentEvents };
