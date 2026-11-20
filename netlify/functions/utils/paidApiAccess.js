/**
 * Billing Phase 1c: paid Apollo services are for paid accounts.
 *
 * Every function that calls Apollo (enrichment, people and company search, and the weekday lead
 * refresh through search-companies) asks this module, on the server, after it has verified who
 * the caller is and BEFORE any Apollo request:
 *
 *   allowed   the account has paid access (hasCompletedPayment, the field only the Stripe
 *             webhook and manual recovery write), or the caller is an admin (an admin working on
 *             their own account, or acting for a user through impersonation, which
 *             verifyAuthToken already restricts to admins)
 *   402       the account has no paid access: a Free account, a lapsed customer, a signup that
 *             never paid. Contact Hub needs none of these functions, so Free use is unaffected
 *   503       the account could not be read. Nothing is assumed: no Apollo call is made
 *
 * The decision uses only server-controlled data: the account document read through the Admin SDK
 * (firestore.rules forbid clients from writing hasCompletedPayment or role) and the server's own
 * admin lists. Nothing from the request body is trusted for it.
 *
 * This is an access check, not credit metering (Phase 3): a paid account is not charged here.
 */
import process from 'node:process';
import { db } from '../firebase-admin.js';
import { hasActiveAccess } from '../../../src/utils/billingEntitlement.js';

export const PAID_API_DENIAL = Object.freeze({
  NOT_PAID: 'paid_plan_required',
  UNVERIFIED: 'entitlement_unavailable',
});

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

const envList = (name, env) => (env[name] || '').split(',').map((id) => id.trim()).filter(Boolean);

/** Is this account an admin, from the server's own lists or its server-written role? Pure. */
export function isAdminAccount(uid, data, env = process.env) {
  if (!uid) return false;
  if (envList('ADMIN_USER_IDS', env).includes(uid) || envList('SUPER_ADMIN_USER_IDS', env).includes(uid)) return true;
  return ADMIN_ROLES.has(data?.role);
}

/** May this account use paid Apollo services? Pure: the scheduled refresh uses it on documents it has read. */
export function isPaidApiEligible(uid, data, env = process.env) {
  return hasActiveAccess(data) || isAdminAccount(uid, data, env);
}

async function readAccount(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * @param {object} args
 * @param {string} args.userId       the account the work is for (already verified against the token)
 * @param {string} [args.actorUserId] the token holder, when it may differ (admin impersonation)
 * @returns {Promise<{ allowed: true, basis: 'paid'|'admin' } | { allowed: false, statusCode: 402|503, error: string }>}
 */
export async function checkPaidApiAccess({ userId, actorUserId = userId, env = process.env }) {
  if (!userId) return { allowed: false, statusCode: 503, error: PAID_API_DENIAL.UNVERIFIED };
  try {
    const account = await readAccount(userId);
    if (hasActiveAccess(account)) return { allowed: true, basis: 'paid' };
    if (actorUserId === userId) {
      if (isAdminAccount(userId, account, env)) return { allowed: true, basis: 'admin' };
    } else {
      const actor = await readAccount(actorUserId);
      if (isAdminAccount(actorUserId, actor, env)) return { allowed: true, basis: 'admin' };
    }
    return { allowed: false, statusCode: 402, error: PAID_API_DENIAL.NOT_PAID };
  } catch (err) {
    console.error('paid_api_access.unverified', { message: err?.message });
    return { allowed: false, statusCode: 503, error: PAID_API_DENIAL.UNVERIFIED };
  }
}

const MESSAGES = {
  [PAID_API_DENIAL.NOT_PAID]: 'Enrichment and search are part of a paid Scout plan.',
  [PAID_API_DENIAL.UNVERIFIED]: 'Your plan could not be confirmed right now. Nothing was looked up. Please try again shortly.',
};

/** The HTTP answer for a refusal. `headers` lets each function keep its own CORS headers. */
export function paidApiDeniedResponse(access, headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }) {
  return {
    statusCode: access.statusCode,
    headers,
    body: JSON.stringify({ success: false, error: access.error, message: MESSAGES[access.error] }),
  };
}
