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
 * OFF BY DEFAULT. On only in a build made with `VITE_FREE_PLAN=on` (also
 * `true`, `1`) AND with Contact Hub on (constants/contactHub.js) AND the shell
 * in use (constants/shellMigration.js — Contact Hub's routes exist only inside
 * it): without Contact Hub there is nothing free to offer, so the switch stays
 * off whatever the variable says. Off, every gate behaves exactly as before.
 *
 * NEVER FROM AN UNCERTAIN ACCOUNT. A failed, slow or cache-only account read is
 * not a free account. The gates still show the verification screen for it, on
 * free routes too (utils/accountVerification.js accessDecision).
 */
import { CONTACT_HUB, CONTACT_HUB_PATH } from './contactHub';
import { SHELL_MIGRATION } from './shellMigration';

/** Pure: is this raw variable value an explicit "on"? Anything else is off. */
export function freePlanEnabledFrom(value) {
  return value === 'on' || value === 'true' || value === '1';
}

export const FREE_PLAN = Object.freeze({
  enabled: CONTACT_HUB.enabled && SHELL_MIGRATION.enabled && freePlanEnabledFrom(import.meta.env?.VITE_FREE_PLAN),
});

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
 *   no tier            → 'free' when the Free plan is on; 'starter' when it is off (unchanged)
 * Any other value is treated as no tier.
 */
export function signupPlanFor(tierParam, { enabled = FREE_PLAN.enabled } = {}) {
  if (tierParam === 'pro' || tierParam === 'starter') return tierParam;
  return enabled ? 'free' : 'starter';
}

/** Where a signup goes once the account exists. Pure. */
export function signupLandingPath(plan) {
  return plan === 'free' ? FREE_PLAN_HOME : `/checkout?tier=${plan}`;
}
