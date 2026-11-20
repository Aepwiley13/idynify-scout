/**
 * Billing Phase 1d: should the shell offer Barry to this account?
 *
 * The server is the gate: every Claude-powered function refuses accounts without paid access
 * (netlify/functions/utils/paidAiAccess.js). This only keeps a Free account from opening a Barry
 * the server would refuse, and from the background requests Barry's panel makes when it mounts.
 *
 * Barry is hidden only when the account's own data says it has no paid access and is not an
 * admin. Without account data (still loading, or a screen rendered outside the account flow)
 * nothing changes. Offering Barry to Free accounts later, for example as a guided onboarding
 * assistant, starts on the server with a free allowance; this then follows it.
 */
import { hasActiveAccess } from './billingEntitlement.js';

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

export function barryAvailableFor(userData) {
  if (userData === null || userData === undefined) return true;
  return hasActiveAccess(userData) || ADMIN_ROLES.has(userData.role);
}
