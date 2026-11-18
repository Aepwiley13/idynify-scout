/**
 * Billing Phase 1d: Claude-powered features (Barry, generated messages, RECON reports, website
 * analysis, capture extraction) are for paid accounts.
 *
 * Every function that sends a request to Claude exports its handler through withPaidAiAccess.
 * Before the function's own code runs, the wrapper:
 *
 *   1. finds every Firebase ID token the request carries (Authorization: Bearer, and the body's
 *      authToken or idToken, the fields these functions read) and verifies each one;
 *   2. asks Phase 1c's checkPaidApiAccess about each token holder: paid access
 *      (hasCompletedPayment, which only the Stripe webhook and manual recovery write) or an
 *      admin, from the server's own lists or server-written role.
 *
 *   401  no token, or a token that does not verify. Nothing else runs
 *   402  the token holder has no paid access: a Free account, a lapsed customer
 *   503  the account could not be read. Nothing is assumed and Claude is not called
 *
 * The token holder is what is checked, so admin impersonation (an admin's token acting for a
 * user) keeps working, and a Free account cannot borrow a paid account's id in the body: the
 * function's own check still ties the body's userId to the token.
 *
 * Free Contact Hub needs none of these functions (no Contact Hub or Settings screen calls one),
 * so Free use is unaffected. CORS preflight (OPTIONS) goes straight to the function.
 *
 * Introducing Barry later for Free accounts (a guided onboarding assistant, say) is one decision
 * here: give that feature a server-enforced allowance (a counter the Admin SDK increments in a
 * transaction, which clients cannot write) and allow a Free token holder while it lasts. Until
 * such an allowance exists, no feature has one, and the screens hide Barry from Free accounts
 * (src/utils/barryAccess.js) so they never meet these refusals.
 *
 * This is an access check, not usage metering: a paid account is not charged here.
 */
import { Buffer } from 'node:buffer';

/** The same codes as Phase 1c's PAID_API_DENIAL (asserted by src/test/paidAiAccess.test.js). */
export const PAID_AI_DENIAL = Object.freeze({
  UNAUTHENTICATED: 'unauthorized',
  NOT_PAID: 'paid_plan_required',
  UNVERIFIED: 'entitlement_unavailable',
});

// The Admin SDK is loaded on the first guarded request, not when the function module loads:
// several of these functions never used it before, and a start-up failure here must become a
// 503 refusal, not a function that no longer loads.
const verifyWithAdmin = async (token) => (await import('../firebase-admin.js')).admin.auth().verifyIdToken(token);
const checkWithFirestore = async (args) => (await import('./paidApiAccess.js')).checkPaidApiAccess(args);

const BODY_TOKEN_FIELDS = ['authToken', 'idToken'];

function parseBody(event) {
  try {
    const raw = event?.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event?.body;
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : null;
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/** Every distinct ID token the request carries, wherever these functions read one. Pure. */
export function requestTokens(event) {
  const tokens = [];
  const header = event?.headers?.authorization ?? event?.headers?.Authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ') && header.length > 7) tokens.push(header.slice(7));
  const body = parseBody(event);
  for (const field of BODY_TOKEN_FIELDS) {
    if (typeof body?.[field] === 'string' && body[field]) tokens.push(body[field]);
  }
  return [...new Set(tokens)];
}

const UNAUTHENTICATED = Object.freeze({ allowed: false, statusCode: 401, error: PAID_AI_DENIAL.UNAUTHENTICATED });

/**
 * May this request reach Claude? Every token it carries must verify and belong to a paid
 * account or an admin.
 *
 * @returns {Promise<{ allowed: true, basis: 'paid'|'admin', uids: string[] } | { allowed: false, statusCode: 401|402|503, error: string }>}
 */
export async function checkPaidAiAccess(event, {
  verifyIdToken = verifyWithAdmin,
  checkAccount = checkWithFirestore,
} = {}) {
  const tokens = requestTokens(event);
  if (tokens.length === 0) return UNAUTHENTICATED;

  const uids = [];
  for (const token of tokens) {
    let uid = null;
    try {
      uid = (await verifyIdToken(token))?.uid ?? null;
    } catch {
      uid = null;
    }
    if (typeof uid !== 'string' || !uid) return UNAUTHENTICATED;
    if (!uids.includes(uid)) uids.push(uid);
  }

  let basis = 'paid';
  for (const uid of uids) {
    const access = await checkAccount({ userId: uid });
    if (!access?.allowed) {
      return access?.statusCode === 402
        ? { allowed: false, statusCode: 402, error: PAID_AI_DENIAL.NOT_PAID }
        : { allowed: false, statusCode: 503, error: PAID_AI_DENIAL.UNVERIFIED };
    }
    if (access.basis === 'admin') basis = 'admin';
  }
  return { allowed: true, basis, uids };
}

const MESSAGES = {
  [PAID_AI_DENIAL.UNAUTHENTICATED]: 'Please sign in again.',
  [PAID_AI_DENIAL.NOT_PAID]: 'Barry and AI writing are part of a paid Scout plan.',
  [PAID_AI_DENIAL.UNVERIFIED]: 'Your plan could not be confirmed right now. Nothing was sent to Barry. Please try again shortly.',
};

const DENIAL_HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

/** The HTTP answer for a refusal. It carries no account data. */
export function paidAiDeniedResponse(access, feature) {
  return {
    statusCode: access.statusCode,
    headers: { ...DENIAL_HEADERS },
    body: JSON.stringify({ success: false, error: access.error, message: MESSAGES[access.error], feature }),
  };
}

/**
 * Wrap a Claude-powered function's handler. `feature` names it in logs and refusals; it is
 * also what a future free allowance would be keyed on.
 */
export function withPaidAiAccess(handler, { feature, check = checkPaidAiAccess } = {}) {
  if (typeof handler !== 'function') throw new TypeError('withPaidAiAccess needs the handler function');
  if (typeof feature !== 'string' || !feature) throw new TypeError('withPaidAiAccess needs a feature name');

  const guarded = async (event, context) => {
    if (event?.httpMethod === 'OPTIONS') return handler(event, context);
    let access = null;
    try {
      access = await check(event);
    } catch (err) {
      console.error('paid_ai_access.unverified', { feature, message: err?.message });
    }
    if (!access?.allowed) {
      const refusal = access?.statusCode ? access : { statusCode: 503, error: PAID_AI_DENIAL.UNVERIFIED };
      console.warn('paid_ai_access.denied', { feature, error: refusal.error });
      return paidAiDeniedResponse(refusal, feature);
    }
    return handler(event, context);
  };
  Object.defineProperty(guarded, 'paidAiFeature', { value: feature });
  return guarded;
}
