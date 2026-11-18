/**
 * Where a customer goes back to after checkout: the contact or page the upgrade started from.
 *
 * The path travels as `returnTo` on /checkout, is checked here, and is kept for the tab in
 * sessionStorage while the customer is on Stripe's page (Stripe returns them to the same tab).
 * The success page sends them there once their account says paid; the cancel page offers it.
 *
 * Only an internal path of this app is ever accepted:
 *   - it starts with one "/" (never "//", which a browser reads as another site, or "/\")
 *   - it has no scheme, no backslash and no control characters, and resolves on this origin
 *   - it is at most 512 characters
 *   - it is not a page that makes no sense to return to (checkout, sign-in, sign-up, onboarding,
 *     or "/" itself, which only redirects)
 * Anything else is dropped, and the success page uses its usual destination.
 */

export const CHECKOUT_RETURN_KEY = 'idynify.checkoutReturnTo';
export const CHECKOUT_RETURN_FALLBACK = '/onboarding';

const MAX_LENGTH = 512;
const NOT_A_RETURN = ['/checkout', '/login', '/signup', '/logout', '/onboarding', '/forgot-password'];
const BASE = 'https://return-path.invalid';

/** The path if it is a safe place in this app to return to, otherwise null. Pure. */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let url;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const path = url.pathname;
  if (path === '/') return null;
  if (NOT_A_RETURN.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** /checkout for a plan, carrying a safe return path when there is one. Pure. */
export function checkoutPath(tier, returnTo) {
  const plan = tier === 'pro' ? 'pro' : 'starter';
  const safe = safeReturnPath(returnTo);
  return safe ? `/checkout?tier=${plan}&returnTo=${encodeURIComponent(safe)}` : `/checkout?tier=${plan}`;
}

function sessionStore() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Checkout's start: keep this checkout's plan and return path, or forget an older path, so a
 * later checkout started somewhere else never returns to an old place. Returns the kept path.
 */
export function rememberCheckoutReturn(returnTo, tier = 'starter', storage = sessionStore()) {
  const safe = safeReturnPath(returnTo);
  try {
    if (safe) storage?.setItem(CHECKOUT_RETURN_KEY, JSON.stringify({ returnTo: safe, tier: tier === 'pro' ? 'pro' : 'starter' }));
    else storage?.removeItem(CHECKOUT_RETURN_KEY);
  } catch {
    // Storage unavailable (private mode, quota): the usual destination is used.
  }
  return safe;
}

/** The kept checkout, its path checked again on the way out; null when there is none. */
export function peekCheckoutReturn(storage = sessionStore()) {
  try {
    const kept = JSON.parse(storage?.getItem(CHECKOUT_RETURN_KEY) ?? 'null');
    const returnTo = safeReturnPath(kept?.returnTo);
    return returnTo ? { returnTo, tier: kept.tier === 'pro' ? 'pro' : 'starter' } : null;
  } catch {
    return null;
  }
}

export function clearCheckoutReturn(storage = sessionStore()) {
  try {
    storage?.removeItem(CHECKOUT_RETURN_KEY);
  } catch {
    // Nothing to clear.
  }
}
