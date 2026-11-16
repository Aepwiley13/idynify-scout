/**
 * Account verification: what the app knows about the signed-in customer's
 * account, and what each gate may do with it.
 *
 * WHY THIS EXISTS. The access gates used to ask one question, "is there
 * account data marked paid?", and sent everyone else to /checkout. A read that
 * FAILED left no account data, so a paying customer whose read failed was
 * shown the purchase page. "Could not check" was being treated as "has not
 * paid".
 *
 * A read now ends in one of three ways:
 *
 *   VERIFIED    The server answered. The account is whatever it said,
 *               including "no document yet" (a brand-new signup).
 *   CACHED      The server could not be reached and the browser's saved copy
 *               says paid. This keeps the offline experience the app already
 *               had. It is NOT proof: it never authorises a purchase, and the
 *               app re-checks with the server when the connection returns.
 *   UNVERIFIED  The read failed, timed out, or only a saved copy exists that
 *               is unpaid or missing. Nothing is assumed either way.
 *
 * Credits, enrichment and plan changes are decided on the server from the
 * live account (Netlify functions and Firestore rules), so a saved copy in
 * the browser cannot authorise those whatever this module says.
 *
 * No Firebase import: the caller passes the sign-in listener and the read in,
 * so every path here can be tested without a database.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { hasActiveAccess } from './billingEntitlement';

export const ACCOUNT = Object.freeze({
  LOADING: 'loading',
  VERIFIED: 'verified',
  CACHED: 'cached',
  UNVERIFIED: 'unverified',
});

export const UNVERIFIED_REASON = Object.freeze({
  READ_FAILED: 'read-failed',
  TIMED_OUT: 'timed-out',
  CACHE_ONLY: 'cache-only',
});

/** How long the loading screen may last before the read counts as failed. */
export const ACCOUNT_READ_TIMEOUT_MS = 15000;

export const LOADING_ACCOUNT = Object.freeze({ status: ACCOUNT.LOADING, data: null });

/**
 * Turn one finished read into an account state.
 * @param snapshot a Firestore document snapshot (exists(), data(), metadata.fromCache)
 */
export function classifySnapshot(snapshot) {
  const exists = snapshot.exists();
  const data = exists ? snapshot.data() : null;

  // Only an explicit `false` counts as "the server answered". A snapshot with
  // no metadata cannot be shown to be authoritative.
  if (snapshot.metadata?.fromCache === false) {
    return { status: ACCOUNT.VERIFIED, data };
  }
  if (exists && hasActiveAccess(data)) {
    return { status: ACCOUNT.CACHED, data };
  }
  // A saved copy that is unpaid or absent proves nothing: the customer may
  // have paid since it was saved.
  return { status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.CACHE_ONLY };
}

/**
 * Read the account once. Never throws and never waits longer than the
 * timeout; a read that answers after the timeout is ignored.
 * @param read () => Promise<snapshot>. May also throw synchronously (a
 *   Firestore client that has failed internally does).
 */
export async function readAccount(read, { timeoutMs = ACCOUNT_READ_TIMEOUT_MS } = {}) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.TIMED_OUT }),
      timeoutMs,
    );
  });
  const attempt = (async () => {
    try {
      return classifySnapshot(await read());
    } catch (error) {
      return { status: ACCOUNT.UNVERIFIED, data: null, reason: UNVERIFIED_REASON.READ_FAILED, error };
    }
  })();
  try {
    return await Promise.race([attempt, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Should a refreshed result replace the current one?
 * A background re-check that fails must not take away access that a saved
 * copy (or an earlier server answer) already gave; any real answer replaces it.
 */
export function shouldApplyRefresh(current, next) {
  if (next.status !== ACCOUNT.UNVERIFIED) return true;
  return current.status !== ACCOUNT.CACHED && current.status !== ACCOUNT.VERIFIED;
}

export const DECISION = Object.freeze({
  LOADING: 'loading',
  LOGIN: 'login',
  UNVERIFIED: 'unverified',
  CHECKOUT: 'checkout',
  ALLOW: 'allow',
});

/**
 * The one decision every gate uses.
 * @param requirePayment the route needs a paid account
 * @param purchase the route starts or completes a purchase (the /checkout
 *   routes). These need the server's answer: a saved copy is not enough.
 */
export function accessDecision({ loading, user, account, requirePayment = true, purchase = false }) {
  if (loading) return DECISION.LOADING;
  if (!user) return DECISION.LOGIN;

  switch (account?.status) {
    case ACCOUNT.VERIFIED:
      return requirePayment && !hasActiveAccess(account.data) ? DECISION.CHECKOUT : DECISION.ALLOW;
    case ACCOUNT.CACHED:
      return purchase ? DECISION.UNVERIFIED : DECISION.ALLOW;
    default:
      // Unverified, or a state this function does not recognise: assume nothing.
      return DECISION.UNVERIFIED;
  }
}

const SIGNED_OUT = Object.freeze({ authLoading: false, authUser: null, account: LOADING_ACCOUNT, retrying: false });

/**
 * Follows the signed-in user and keeps their account state.
 *
 * - As before this change, the user is only exposed once their account read
 *   has finished (successfully or not). Until then `authLoading` stays true
 *   on first load, and a page such as Login stays in place after a sign-in.
 * - One read per sign-in. A manual `retry` reads again. While the account is
 *   not server-verified, the browser's "back online" event triggers one quiet
 *   re-check. Nothing here polls or retries on a timer.
 * - Every read is numbered. A read that finishes after a newer one started,
 *   or after a sign-out, is dropped.
 * - The user stays signed in whatever the read does.
 *
 * Both functions must keep the same identity between renders (define them
 * outside the component): a new one restarts the subscription.
 *
 * @param onAuthChange (callback) => unsubscribe. Called with the Firebase user or null.
 * @param readSnapshot (uid) => Promise<snapshot>
 */
export function useAccountVerification({ onAuthChange, readSnapshot, timeoutMs = ACCOUNT_READ_TIMEOUT_MS }) {
  const [state, setState] = useState({ authLoading: true, authUser: null, account: LOADING_ACCOUNT, retrying: false });
  const latest = useRef(0);

  // mode: 'sign-in' (first read for this user), 'retry' (the button), or
  // 'quiet' (connection came back; must not disturb what is on screen).
  const check = useCallback(async (authUser, mode) => {
    const mine = ++latest.current;
    if (mode === 'retry') setState((current) => ({ ...current, retrying: true }));

    const result = await readAccount(() => readSnapshot(authUser.uid), { timeoutMs });
    if (mine !== latest.current) return; // a newer read, or a sign-out, replaced this one

    if (result.status === ACCOUNT.UNVERIFIED) {
      // Logged, never shown. The screen says only that the check failed.
      console.error('[account] Could not verify the account:', result.reason, result.error ?? '');
    }
    setState((current) => {
      if (mode === 'quiet') {
        if (current.authUser?.uid !== authUser.uid || !shouldApplyRefresh(current.account, result)) return current;
        return { ...current, account: result };
      }
      return { authLoading: false, authUser, account: result, retrying: false };
    });
  }, [readSnapshot, timeoutMs]);

  useEffect(() => onAuthChange((authUser) => {
    if (authUser) {
      check(authUser, 'sign-in');
    } else {
      latest.current += 1; // drop any read still in flight
      setState(SIGNED_OUT);
    }
  }), [onAuthChange, check]);

  const { authUser, account } = state;
  const needsServer = Boolean(authUser) && (account.status === ACCOUNT.CACHED || account.status === ACCOUNT.UNVERIFIED);
  useEffect(() => {
    if (!needsServer) return undefined;
    const recheck = () => check(authUser, 'quiet');
    window.addEventListener('online', recheck);
    return () => window.removeEventListener('online', recheck);
  }, [needsServer, authUser, check]);

  const retry = useCallback(() => {
    if (authUser) check(authUser, 'retry');
  }, [authUser, check]);

  return { authLoading: state.authLoading, authUser, account, retry, retrying: state.retrying };
}
