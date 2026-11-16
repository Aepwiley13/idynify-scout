/**
 * AccountUnverified: shown when the signed-in customer's account could not
 * be checked with the server.
 *
 * It replaces a redirect to /checkout. "We could not check" is not "you have
 * not paid", so this screen assumes neither: it gives no access and offers no
 * purchase. The customer stays signed in unless they choose Sign out.
 *
 * Nothing here retries or reloads on its own. Retry reads the account again
 * in place; Reload page is the way out when the page itself is stuck and an
 * in-place retry cannot succeed.
 *
 * No error text is shown. The caller logs the cause.
 *
 * Styling is self-contained (the shell is not mounted in this state). Colours
 * come from the theme variables when set, with light and dark fallbacks.
 */

import { Navigate } from 'react-router-dom';
import { accessDecision, DECISION } from '../utils/accountVerification';

const CSS = `
.acct-unverified {
  --au-bg: var(--bg-primary, #f8f7fc);
  --au-card: var(--bg-card, #ffffff);
  --au-border: var(--border, #e0d8f0);
  --au-text: var(--text-primary, #12082a);
  --au-muted: var(--text-secondary, #5a4880);
  min-height: 100vh; min-height: 100dvh;
  display: flex; align-items: center; justify-content: center;
  padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: var(--au-bg); color: var(--au-text);
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme]) .acct-unverified {
    --au-bg: #06040f; --au-card: #110e1e; --au-border: #2a2440;
    --au-text: #f4f1fb; --au-muted: #b9aed6;
  }
}
.acct-unverified-card {
  width: 100%; max-width: 440px; box-sizing: border-box; padding: 28px 24px;
  background: var(--au-card); border: 1px solid var(--au-border);
  border-radius: 18px; text-align: center;
}
.acct-unverified-title { margin: 0 0 10px; font-size: 22px; font-weight: 800; line-height: 1.25; }
.acct-unverified-body { margin: 0 0 22px; font-size: 16px; line-height: 1.5; color: var(--au-muted); }
.acct-unverified-actions { display: flex; flex-direction: column; gap: 10px; }
.acct-unverified-btn {
  min-height: 48px; width: 100%; padding: 0 22px; border-radius: 12px; cursor: pointer;
  font: inherit; font-size: 17px; font-weight: 700;
}
.acct-unverified-btn:disabled { opacity: 0.6; cursor: default; }
.acct-unverified-btn--primary { border: none; background: var(--au-text); color: var(--au-card); }
.acct-unverified-btn--secondary { border: 1.5px solid var(--au-border); background: transparent; color: var(--au-text); }
.acct-unverified-link {
  min-height: 44px; margin-top: 6px; padding: 0 12px; border: none; background: transparent; cursor: pointer;
  font: inherit; font-size: 15px; font-weight: 600; color: var(--au-text); text-decoration: underline;
}
.acct-unverified-btn:focus-visible, .acct-unverified-link:focus-visible { outline: 3px solid var(--au-muted); outline-offset: 3px; }
`;

export default function AccountUnverified({ onRetry, onReload, onSignOut, retrying = false }) {
  const reload = onReload ?? (() => window.location.reload());

  return (
    <div className="acct-unverified" role="alert">
      <style>{CSS}</style>
      <div className="acct-unverified-card">
        <h1 className="acct-unverified-title">We couldn&rsquo;t verify your account right now.</h1>
        <p className="acct-unverified-body">
          This is usually a connection problem. Your account and your data are
          not affected, and you have not been charged.
        </p>
        <div className="acct-unverified-actions">
          <button
            type="button"
            className="acct-unverified-btn acct-unverified-btn--primary"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? 'Checking…' : 'Retry'}
          </button>
          <button
            type="button"
            className="acct-unverified-btn acct-unverified-btn--secondary"
            onClick={reload}
          >
            Reload page
          </button>
        </div>
        <button type="button" className="acct-unverified-link" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * The gate every protected route goes through. One component, so the three
 * places that used to repeat this check cannot drift apart again.
 *
 *   loading     the caller's loading screen
 *   login       not signed in
 *   unverified  the screen above: no access, no purchase, no redirect
 *   checkout    the server confirmed the account is unpaid
 *   allow       the children
 *
 * @param recovery { onRetry, onSignOut, retrying?, onReload? } for the unverified screen
 */
export function AccountGate({ loading, user, account, requirePayment = true, purchase = false, recovery, loadingScreen = null, children }) {
  switch (accessDecision({ loading, user, account, requirePayment, purchase })) {
    case DECISION.LOADING: return loadingScreen;
    case DECISION.LOGIN: return <Navigate to="/login" />;
    case DECISION.CHECKOUT: return <Navigate to="/checkout" />;
    case DECISION.ALLOW: return children;
    default: return <AccountUnverified {...recovery} />;
  }
}
