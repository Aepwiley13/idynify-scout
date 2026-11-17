/**
 * The Free plan — the on/off switch and where it applies.
 *
 * WHAT IT IS. An account the server has confirmed has no paid access (a new
 * signup with no card, or a customer who stopped paying) may use Contact Hub
 * and Settings. Everything else stays part of a paid Scout plan, and a free
 * account that opens it sees what the plan adds instead of being sent out of
 * the app. Nothing about a free account is stored: "free" is simply "verified,
 * and not paid" (utils/accountPlan.js). Stopping payment changes no data.
 *
 * THREE SETTINGS, from `VITE_FREE_PLAN` at build time, and only when Contact
 * Hub (constants/contactHub.js) and the shell (constants/shellMigration.js —
 * Contact Hub's routes exist only inside it) are both on:
 *
 *   on        Free signups, and free access for every free account.
 *   existing  THE ROLLBACK SETTING. No new Free signups (a signup with no tier
 *             is a Starter signup again, as before launch), but every account
 *             that is already free keeps Contact Hub and Settings: no one is
 *             locked out of their contacts or pushed to a purchase.
 *   (unset)   Exactly the behaviour before the Free plan existed. Safe only
 *             before any free account exists: afterwards it would send free
 *             accounts to checkout at sign-in. Their data stays intact either
 *             way, but use `existing` instead.
 *
 * NEVER FROM AN UNCERTAIN ACCOUNT. A failed, slow or cache-only account read is
 * not a free account. The gates still show the verification screen for it, on
 * free routes too (utils/accountVerification.js accessDecision).
 */
import { CONTACT_HUB, CONTACT_HUB_PATH, contactHubPersonPath } from './contactHub';
import { SHELL_MIGRATION } from './shellMigration';
import { planOf, PLAN } from '../utils/accountPlan';

export const FREE_PLAN_MODES = Object.freeze({ ON: 'on', EXISTING: 'existing', OFF: 'off' });

/** Pure: the setting a raw variable value names. Anything unrecognised is off. */
export function freePlanModeFrom(value) {
  if (value === 'on' || value === 'true' || value === '1') return FREE_PLAN_MODES.ON;
  if (value === 'existing') return FREE_PLAN_MODES.EXISTING;
  return FREE_PLAN_MODES.OFF;
}

/** Pure: is this raw variable value an explicit "on"? (Free signups and free access.) */
export function freePlanEnabledFrom(value) {
  return freePlanModeFrom(value) === FREE_PLAN_MODES.ON;
}

/** Pure: the switch, from the raw variable and the two switches it depends on. */
export function freePlanFrom(value, { contactHub = CONTACT_HUB.enabled, shell = SHELL_MIGRATION.enabled } = {}) {
  const mode = contactHub && shell ? freePlanModeFrom(value) : FREE_PLAN_MODES.OFF;
  return Object.freeze({
    mode,
    /** Free accounts may use the free routes. */
    enabled: mode !== FREE_PLAN_MODES.OFF,
    /** A signup with no tier creates a Free account. */
    signups: mode === FREE_PLAN_MODES.ON,
  });
}

export const FREE_PLAN = freePlanFrom(import.meta.env?.VITE_FREE_PLAN);

/** Where a free account starts. */
export const FREE_PLAN_HOME = CONTACT_HUB_PATH;

/** The routes a verified free account may use. Everything else is paid. */
export const FREE_PLAN_PATHS = Object.freeze([CONTACT_HUB_PATH, '/settings']);

/** Pure: is this pathname one of the free routes (or under one)? */
export function isFreePlanPath(pathname, { enabled = FREE_PLAN.enabled } = {}) {
  if (!enabled || typeof pathname !== 'string') return false;
  return FREE_PLAN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The account a signup creates. Pure.
 *   ?tier=starter|pro  → that paid tier, then checkout (unchanged)
 *   no tier            → 'free' when Free signups are on; 'starter' otherwise (unchanged)
 * Any other value is treated as no tier.
 */
export function signupPlanFor(tierParam, { enabled = FREE_PLAN.signups } = {}) {
  if (tierParam === 'pro' || tierParam === 'starter') return tierParam;
  return enabled ? 'free' : 'starter';
}

/** Where a signup goes once the account exists. Pure. */
export function signupLandingPath(plan) {
  return plan === 'free' ? FREE_PLAN_HOME : `/checkout?tier=${plan}`;
}

/**
 * The user document a Free signup creates: no billing fields at all, so the
 * browser never writes anything the server trusts. firestore.rules accepts a
 * signup without them (the signup billing fields are all-or-nothing).
 */
export function freeSignupDocument(email, now = new Date()) {
  return { email, createdAt: now };
}

/**
 * Paid pages a free account reaches from free places, and where they lead instead. Pure.
 *   /mission-control-v2   the logo and other "home" links → the Contact Hub
 *   /contact/:id,
 *   /scout/contact/:id    a contact from global search or a notification → that
 *                         person in Contact Hub, not the paid contact page
 * Anything else is a paid page, shown as UpgradeRequired. Only ever used for a
 * server-verified free account (the gate's "checkout" decision).
 */
export function freePlanRedirectFor(pathname) {
  if (typeof pathname !== 'string') return null;
  if (pathname === '/mission-control-v2' || pathname === '/mission-control-v2/') return FREE_PLAN_HOME;
  const contact = /^\/(?:scout\/)?contact\/([^/]+)\/?$/.exec(pathname);
  if (contact) return contactHubPersonPath(decodeURIComponent(contact[1]));
  return null;
}

/** SmartRedirect's destination for a server-verified free account; null otherwise. */
export function freePlanHomeFor(account, { enabled = FREE_PLAN.enabled } = {}) {
  return enabled && planOf(account) === PLAN.FREE ? FREE_PLAN_HOME : null;
}

/** Whether SmartRedirect must see paid access before it lets an account through. */
export const SMART_REDIRECT_REQUIRES_PAYMENT = !FREE_PLAN.enabled;
