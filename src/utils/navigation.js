/**
 * navigation.js — the canonical navigation contract for Contact and Company.
 *
 * THE PROBLEM THIS SOLVES
 * ──────────────────────
 * Before this module, every surface that could open a contact called
 * `navigate('/scout/contact/' + id)` by hand. Three consequences followed from
 * that one line being written twenty times:
 *
 *   1. The URL said Scout, so the shell said Scout. A user who clicked a
 *      priority in Mission Control landed on a page whose breadcrumb claimed
 *      they were somewhere they had never been.
 *   2. There was nowhere to put the reason. The screen knew WHICH contact to
 *      open and nothing about WHY, so the arrival was silent — the user had to
 *      remember what they had clicked.
 *   3. Nothing was reviewable. A module that navigated wrongly looked exactly
 *      like a module that navigated correctly, because both were a string.
 *
 * So: two destinations, two helpers, one shape. `/contact/:contactId` and
 * `/company/:companyId` are module-agnostic — they do not live under Scout and
 * do not mount Scout's shell. Every module goes through openContact() and
 * openCompany(), which means a future sprint that bypasses them is a diff that
 * reintroduces a raw path, and that is visible in review.
 *
 * NAVIGATION INTENT IS EPHEMERAL
 * ──────────────────────────────
 * The reason a screen was opened travels in router state and dies there. It is
 * never written to the contact record. What gets persisted is the ACTION and
 * its OUTCOME, after the user takes it — a contact document that remembers
 * "someone once opened me because a follow-up was overdue" is a contact
 * document accumulating other people's context forever.
 *
 * Router state survives Back and forward within the session and is dropped on
 * refresh. That is the correct lifetime: on refresh the user is arriving cold,
 * with no reason to be told why a screen they are already looking at opened.
 */

import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logEvent, EVENTS } from '../services/analytics';

/** The key navigation intent travels under inside router state. */
export const NAVIGATION_INTENT_KEY = 'navigationIntent';

/** Two display modes, one implementation. See openContact(). */
export const DISPLAY_MODES = Object.freeze({ PAGE: 'page', PANEL: 'panel' });

/**
 * Where a navigation came from. Free-form strings are accepted — this is the
 * vocabulary the shell knows how to turn into a breadcrumb, not a whitelist.
 */
export const ENTRY_POINTS = Object.freeze({
  MISSION_CONTROL: 'mission_control',
  COMMAND_BAR: 'command_bar',
  SCOUT: 'scout',
  // Scout+ is the add/import flow, not the Scout list. Distinct from SCOUT
  // because a contact saved through a form has no list behind it to preserve —
  // see the SCOUT_PLUS entry in ENTRY_POINT_MODULE and ADR-001.
  SCOUT_PLUS: 'scout_plus',
  HUNTER: 'hunter',
  SNIPER: 'sniper',
  BASECAMP: 'basecamp',
  REINFORCEMENTS: 'reinforcements',
  FALLBACK: 'fallback',
  RECON: 'recon',
  COMMAND_CENTER: 'command_center',
  NOTIFICATIONS: 'notifications',
  BARRY: 'barry',
  COMPANY: 'company',
  DIRECT: 'direct',
});

/**
 * entryPoint → the module whose name the breadcrumb should show.
 *
 * Only entry points that correspond to a real navigable module appear here.
 * Command Bar is deliberately absent: search is not a place, so a contact
 * opened from ⌘K takes its breadcrumb from `returnTo` instead — the screen the
 * user was actually on when they searched.
 */
export const ENTRY_POINT_MODULE = Object.freeze({
  [ENTRY_POINTS.MISSION_CONTROL]: 'mission-control',
  [ENTRY_POINTS.SCOUT]: 'scout',
  // Scout+ lives inside Scout, so the breadcrumb says Scout. Only the display
  // mode differs, and that is decided at the call site, not here.
  [ENTRY_POINTS.SCOUT_PLUS]: 'scout',
  [ENTRY_POINTS.HUNTER]: 'hunter',
  [ENTRY_POINTS.SNIPER]: 'sniper',
  [ENTRY_POINTS.BASECAMP]: 'basecamp',
  [ENTRY_POINTS.REINFORCEMENTS]: 'reinforcements',
  [ENTRY_POINTS.FALLBACK]: 'fallback',
  [ENTRY_POINTS.RECON]: 'recon',
  [ENTRY_POINTS.COMMAND_CENTER]: 'command-center',
});

// ── Canonical paths ─────────────────────────────────────────────────────────

/** The canonical full-page route for a contact. Module-agnostic. */
export function contactPath(contactId) {
  return `/contact/${contactId}`;
}

/** The canonical full-page route for a company. Module-agnostic. */
export function companyPath(companyId) {
  return `/company/${companyId}`;
}

/**
 * Scout's panel-over-list route. Same canonical foundation, different display
 * mode: /scout/contact/:id is a CHILD of /scout, which is what keeps the list,
 * its filters and its scroll position alive behind the panel.
 */
export function contactPanelPath(contactId) {
  return `/scout/contact/${contactId}`;
}

// ── Intent construction ─────────────────────────────────────────────────────

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Build the router-state payload for a contact navigation.
 *
 * Exported separately from the navigating helpers so it can be asserted on
 * directly in tests without a router, and so a caller that already owns a
 * navigate() (a saga, a keyboard handler) can compose rather than re-derive.
 *
 * @returns {{ to: string, options: { state: object, replace?: boolean } }}
 */
export function buildContactNavigation({
  contactId,
  entryPoint = ENTRY_POINTS.DIRECT,
  reason = null,
  recommendedAction = null,
  priorityId = null,
  taskId = null,
  returnTo = null,
  displayMode = DISPLAY_MODES.PAGE,
  replace = false,
} = {}) {
  if (!contactId) {
    throw new Error('openContact: contactId is required.');
  }

  const intent = omitEmpty({
    entityType: 'contact',
    entityId: contactId,
    entryPoint,
    reason,
    recommendedAction,
    priorityId,
    taskId,
    returnTo,
    displayMode,
  });

  return {
    to: displayMode === DISPLAY_MODES.PANEL ? contactPanelPath(contactId) : contactPath(contactId),
    options: { state: { [NAVIGATION_INTENT_KEY]: intent }, replace },
  };
}

/** As buildContactNavigation, for companies. */
export function buildCompanyNavigation({
  companyId,
  entryPoint = ENTRY_POINTS.DIRECT,
  reason = null,
  returnTo = null,
  displayMode = DISPLAY_MODES.PAGE,
  replace = false,
} = {}) {
  if (!companyId) {
    throw new Error('openCompany: companyId is required.');
  }

  const intent = omitEmpty({
    entityType: 'company',
    entityId: companyId,
    entryPoint,
    reason,
    returnTo,
    displayMode,
  });

  return {
    to: companyPath(companyId),
    options: { state: { [NAVIGATION_INTENT_KEY]: intent }, replace },
  };
}

// ── The helpers every module calls ──────────────────────────────────────────

/**
 * Open a contact.
 *
 *   openContact({
 *     navigate,                       // react-router's navigate
 *     contactId,
 *     entryPoint: 'mission_control',
 *     reason: 'overdue_next_step',
 *     recommendedAction: priority.recommendedAction,
 *     priorityId, taskId,
 *     returnTo: '/mission-control-v2',
 *     displayMode: 'page',
 *   });
 *
 * `navigate` is part of the payload rather than a positional argument so that
 * call sites read exactly like the sprint brief's shape. Components that are
 * inside a Router should prefer useCanonicalNavigation(), which binds it.
 */
export function openContact({ navigate, ...params }) {
  if (typeof navigate !== 'function') {
    throw new Error('openContact: a navigate function is required — use useCanonicalNavigation() inside components.');
  }
  const { to, options } = buildContactNavigation(params);
  navigate(to, options);
  emitOpenEvent(EVENTS.OPEN_CONTACT, options.state[NAVIGATION_INTENT_KEY], 'contactId');
  return to;
}

/** Open a company. See openContact(). */
export function openCompany({ navigate, ...params }) {
  if (typeof navigate !== 'function') {
    throw new Error('openCompany: a navigate function is required — use useCanonicalNavigation() inside components.');
  }
  const { to, options } = buildCompanyNavigation(params);
  navigate(to, options);
  emitOpenEvent(EVENTS.OPEN_COMPANY, options.state[NAVIGATION_INTENT_KEY], 'companyId');
  return to;
}

/**
 * Emit the product event for an open, from the intent that was just built.
 *
 * Read off the INTENT rather than the caller's arguments, so the event and the
 * navigation can never disagree — including about defaults the builder filled
 * in (`displayMode`, `entryPoint`) that the caller never passed.
 *
 * Fired AFTER navigate() on purpose. Analytics must never sit between a click
 * and the screen it opens, and logEvent is fire-and-forget precisely so this
 * ordering costs nothing.
 */
function emitOpenEvent(event, intent, idField) {
  if (!intent) return;
  logEvent(event, {
    [idField]: intent.entityId,
    entryPoint: intent.entryPoint,
    displayMode: intent.displayMode,
    reason: intent.reason,
    returnTo: intent.returnTo,
  });
}

/**
 * openContact / openCompany, bound to the router and defaulting `returnTo` to
 * wherever the user currently is.
 *
 * The default matters more than it looks: a helper whose returnTo is optional
 * and unset produces a Back button with nothing to go back to, which is the
 * exact failure the canonical routes exist to remove. Callers that want a
 * different destination (Mission Control pinning Back to its own dashboard
 * rather than to a transient sub-view) pass returnTo explicitly.
 */
export function useCanonicalNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const here = location.pathname + (location.search || '');

  // Delegates to the standalone helpers rather than re-implementing them, so
  // the hook and the direct call cannot drift — most importantly, so both emit
  // the same analytics event. The hook's only addition is the `returnTo`
  // default.
  return useMemo(() => ({
    openContact: (params) => openContact({ navigate, returnTo: here, ...omitUndefined(params) }),
    openCompany: (params) => openCompany({ navigate, returnTo: here, ...omitUndefined(params) }),
  }), [navigate, here]);
}

/** Drop undefined keys so they cannot clobber a default via spread. */
function omitUndefined(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ── Intent consumption ──────────────────────────────────────────────────────

/**
 * Read the navigation intent for the entity currently on screen.
 *
 * Returns null unless the intent in router state is FOR THIS ENTITY. Without
 * that check an intent would outlive its navigation: React Router preserves
 * location.state across a same-route param change, so opening contact A from a
 * Mission Control priority and then clicking through to contact B would show B
 * an arrival banner explaining A's overdue follow-up.
 *
 * @param {object} location   react-router location
 * @param {object} expect     { entityType, entityId }
 */
export function readNavigationIntent(location, { entityType, entityId } = {}) {
  const intent = location?.state?.[NAVIGATION_INTENT_KEY];
  if (!intent) return null;
  if (entityType && intent.entityType !== entityType) return null;
  if (entityId && intent.entityId !== entityId) return null;
  return intent;
}

/**
 * The module whose name belongs in the breadcrumb for an arrival.
 *
 * entryPoint first — it is what the user clicked. Command Bar has no module of
 * its own, so it falls through to whatever screen `returnTo` names. Null means
 * "nothing better than the route itself", and the shell falls back to its
 * normal path-based resolution.
 */
/**
 * entryPoint → Barry session type.
 *
 * Decision 6 of the sprint brief: Barry's memory is CONTACT-scoped, and
 * sessions live beneath it. A follow-up prompted by Mission Control and an
 * outreach draft started in Hunter are two conversations about one person —
 * they must not share a thread, and neither may start from nothing.
 */
export const SESSION_TYPE_BY_ENTRY = Object.freeze({
  [ENTRY_POINTS.MISSION_CONTROL]: 'follow_up',
  [ENTRY_POINTS.HUNTER]: 'outreach',
  [ENTRY_POINTS.SNIPER]: 'post_meeting',
  [ENTRY_POINTS.BASECAMP]: 'account_review',
  [ENTRY_POINTS.REINFORCEMENTS]: 'referral',
  [ENTRY_POINTS.FALLBACK]: 're_engagement',
  [ENTRY_POINTS.COMMAND_BAR]: 'lookup',
});

/**
 * The Barry session key for an entity screen.
 *
 *   { entityType: 'contact', entityId, sessionType, sourceModule }
 *
 * Persistent relationship intelligence hangs off entityId; the session hangs
 * off the pair. This is the key shape the brief locks, built in one place so
 * the contact page, the Scout panel and the company page cannot drift.
 */
export function barrySessionKey(intent, entityId, entityType = 'contact') {
  if (!entityId) return null;
  const sourceModule = intent?.entryPoint ?? ENTRY_POINTS.DIRECT;
  return {
    entityType,
    entityId,
    sessionType: entityType === 'company'
      ? 'company_review'
      : (SESSION_TYPE_BY_ENTRY[sourceModule] ?? 'general'),
    sourceModule,
  };
}

export function originModuleId(intent, resolveModuleForPath) {
  if (!intent) return null;

  const fromEntry = ENTRY_POINT_MODULE[intent.entryPoint];
  if (fromEntry) return fromEntry;

  if (intent.returnTo && typeof resolveModuleForPath === 'function') {
    const mod = resolveModuleForPath(intent.returnTo.split('?')[0]);
    return mod?.id ?? null;
  }

  return null;
}

export default {
  openContact,
  openCompany,
  useCanonicalNavigation,
  contactPath,
  companyPath,
  contactPanelPath,
  readNavigationIntent,
  NAVIGATION_INTENT_KEY,
  DISPLAY_MODES,
  ENTRY_POINTS,
};
