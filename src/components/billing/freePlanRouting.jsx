/**
 * The Free plan's part of routing, kept out of App.jsx so the shared router
 * carries only a few one-line hooks into it (constants/freePlan.js).
 *
 *   ShellAccountGate        the shell's account gate: on a free route a
 *                           server-verified free account is let in; on a paid
 *                           route it sees UpgradeRequired inside the shell.
 *   SignedInSignupRedirect  where a signed-in visitor to /signup goes.
 *   CheckoutHold            the launch fallback while upgrades are on hold
 *                           (constants/upgradeHold.js): /checkout serves only
 *                           today's live signup flow.
 *   (freePlanHomeFor, for SmartRedirect, is in constants/freePlan.js.)
 *
 * With the switch off every one of these behaves exactly as App.jsx did
 * before. With it on, an account that could not be verified still gets the
 * verification screen everywhere: only the paid check is relaxed, never the
 * verification check (utils/accountVerification.js accessDecision).
 */
import { Navigate, useLocation } from 'react-router-dom';
import { AccountGate } from '../AccountUnverified';
import UpgradeRequired from './UpgradeRequired';
import { FREE_PLAN, isFreePlanPath, signupPlanFor, signupLandingPath, freePlanRedirectFor } from '../../constants/freePlan';
import { checkoutHoldRedirect } from '../../constants/upgradeHold';

/**
 * AccountGate for the shell. `layout(content)` wraps content in the shell
 * (MainLayout), so the upgrade screen and the page sit in the same layout at
 * the same position and the shell stays mounted between them. A paid page a
 * free account reaches from a free place (the logo, a contact from global
 * search) leads to its Contact Hub equivalent instead (freePlanRedirectFor).
 */
export function ShellAccountGate({ requirePayment = true, layout, children, ...gate }) {
  const { pathname } = useLocation();
  const freeRoute = isFreePlanPath(pathname);
  const redirect = FREE_PLAN.enabled ? freePlanRedirectFor(pathname) : null;
  return (
    <AccountGate
      {...gate}
      requirePayment={requirePayment && !freeRoute}
      upgrade={FREE_PLAN.enabled ? (redirect ? <Navigate to={redirect} replace /> : layout(<UpgradeRequired />)) : null}
    >
      {children}
    </AccountGate>
  );
}

/**
 * The signed-in visitor to /signup. Free plan off: /checkout, as before. On: a
 * paid tier in the link still goes to that tier's checkout; otherwise the
 * Contact Hub. Either way the destination is a guarded route.
 */
export function SignedInSignupRedirect() {
  const { search } = useLocation();
  if (!FREE_PLAN.enabled) return <Navigate to="/checkout" />;
  // Already signed in: a paid tier in the link goes to its checkout; otherwise the
  // Contact Hub, whether or not new Free signups are open (`existing`).
  return <Navigate to={signupLandingPath(signupPlanFor(new URLSearchParams(search).get('tier'), { enabled: true }))} />;
}

/**
 * Around /checkout, inside its purchase gate (so the account is the server's answer). While
 * upgrades are on hold, an existing account is sent to Settings → Billing instead of being
 * offered a Payment Link; a new paid signup that has not paid yet checks out as today.
 */
export function CheckoutHold({ account, children }) {
  const destination = checkoutHoldRedirect(account);
  return destination ? <Navigate to={destination} replace /> : children;
}
