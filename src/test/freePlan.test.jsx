/**
 * The Free plan (constants/freePlan.js, utils/accountPlan.js).
 *
 * The rules under test:
 *   - a server-verified account with no paid access may use the free routes (Contact Hub,
 *     Settings), and sees an in-app upgrade screen on a paid route;
 *   - an account that could not be verified is NEVER treated as Free: a failed, slow or
 *     cache-only read shows the verification screen on free routes too;
 *   - with the switch off, every gate behaves exactly as before.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import { AccountGate } from '../components/AccountUnverified';
import { useAccountVerification, ACCOUNT, ACCOUNT_READ_TIMEOUT_MS } from '../utils/accountVerification';
import { planOf, PLAN, isPaidPlan } from '../utils/accountPlan';
import {
  FREE_PLAN, FREE_PLAN_HOME, freePlanEnabledFrom, isFreePlanPath, signupPlanFor, signupLandingPath,
} from '../constants/freePlan';
import { CONTACT_HUB_PATH } from '../constants/contactHub';

const PAID_STARTER = { hasCompletedPayment: true, subscriptionTier: 'starter' };
const PAID_PRO = { hasCompletedPayment: true, subscriptionTier: 'pro' };
const UNPAID = { hasCompletedPayment: false };
const FREE_SIGNUP = { email: 'new@example.test' };
const snapshot = (data, { fromCache = false } = {}) => ({ exists: () => data !== null, data: () => data, metadata: { fromCache } });
const UNVERIFIED = 'We couldn’t verify your account right now.';

describe('the switch', () => {
  it('is off in a build without VITE_FREE_PLAN', () => {
    expect(FREE_PLAN.enabled).toBe(false);
  });

  it.each([['on', true], ['true', true], ['1', true], ['off', false], ['', false], [undefined, false], ['yes', false]])(
    'VITE_FREE_PLAN=%s → %s', (value, on) => {
      expect(freePlanEnabledFrom(value)).toBe(on);
    },
  );
});

describe('isFreePlanPath', () => {
  const on = { enabled: true };
  it.each([
    [CONTACT_HUB_PATH, true], [`${CONTACT_HUB_PATH}/person/abc`, true], ['/settings', true],
    ['/scout', false], ['/hunter', false], ['/barry', false], ['/contact/abc', false],
    [`${CONTACT_HUB_PATH}-other`, false], ['/settingsx', false], ['/', false],
  ])('%s → %s', (path, free) => {
    expect(isFreePlanPath(path, on)).toBe(free);
  });

  it('no path is free while the switch is off', () => {
    expect(isFreePlanPath(CONTACT_HUB_PATH, { enabled: false })).toBe(false);
    expect(isFreePlanPath('/settings')).toBe(false); // the real switch, off in tests
  });
});

describe('signup', () => {
  it('switch off: no tier still means Starter, a tier is kept', () => {
    expect(signupPlanFor(null, { enabled: false })).toBe('starter');
    expect(signupPlanFor('pro', { enabled: false })).toBe('pro');
  });

  it('switch on: no tier means Free; a paid tier in the link is kept', () => {
    expect(signupPlanFor(null, { enabled: true })).toBe('free');
    expect(signupPlanFor('bogus', { enabled: true })).toBe('free');
    expect(signupPlanFor('starter', { enabled: true })).toBe('starter');
    expect(signupPlanFor('pro', { enabled: true })).toBe('pro');
  });

  it('Free lands in Contact Hub; a paid tier lands on its checkout', () => {
    expect(signupLandingPath('free')).toBe(FREE_PLAN_HOME);
    expect(signupLandingPath('pro')).toBe('/checkout?tier=pro');
    expect(signupLandingPath('starter')).toBe('/checkout?tier=starter');
  });
});

describe('planOf', () => {
  it.each([
    ['verified, paid Starter', { status: ACCOUNT.VERIFIED, data: PAID_STARTER }, PLAN.STARTER],
    ['verified, paid Pro', { status: ACCOUNT.VERIFIED, data: PAID_PRO }, PLAN.PRO],
    ['verified, paid with no tier recorded', { status: ACCOUNT.VERIFIED, data: { hasCompletedPayment: true } }, PLAN.STARTER],
    ['verified, unpaid', { status: ACCOUNT.VERIFIED, data: UNPAID }, PLAN.FREE],
    ['verified, a Free signup (no billing fields)', { status: ACCOUNT.VERIFIED, data: FREE_SIGNUP }, PLAN.FREE],
    ['verified, no document yet', { status: ACCOUNT.VERIFIED, data: null }, PLAN.FREE],
    ['saved copy, paid', { status: ACCOUNT.CACHED, data: PAID_PRO }, PLAN.PRO],
    ['saved copy, unpaid (never classified CACHED, checked anyway)', { status: ACCOUNT.CACHED, data: UNPAID }, PLAN.UNKNOWN],
    ['unverified (read failed)', { status: ACCOUNT.UNVERIFIED, data: null, reason: 'read-failed' }, PLAN.UNKNOWN],
    ['unverified (timed out)', { status: ACCOUNT.UNVERIFIED, data: null, reason: 'timed-out' }, PLAN.UNKNOWN],
    ['still loading', { status: ACCOUNT.LOADING, data: null }, PLAN.UNKNOWN],
    ['no account state', undefined, PLAN.UNKNOWN],
    ['an unrecognised state', { status: 'something-new', data: UNPAID }, PLAN.UNKNOWN],
  ])('%s → %s', (_label, account, plan) => {
    expect(planOf(account)).toBe(plan);
  });

  it('only Starter and Pro are paid', () => {
    expect([PLAN.FREE, PLAN.STARTER, PLAN.PRO, PLAN.UNKNOWN].filter(isPaidPlan)).toEqual([PLAN.STARTER, PLAN.PRO]);
  });
});

// ── The shell's decision, end to end with the real hook and gate ────────────────────────────
//
// The same shape as App.jsx's ShellRoute (accountGate.test.jsx pins App.jsx to these exact
// expressions): requirePayment is relaxed on a free route, and a verified unpaid account on a
// paid route gets the in-app upgrade screen.

let signIn;
let readSnapshot;
const onAuthChange = (callback) => { signIn = callback; return () => {}; };

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function Shell({ gate, freePlanOn }) {
  const { pathname } = useLocation();
  const freeRoute = isFreePlanPath(pathname, { enabled: freePlanOn });
  return (
    <AccountGate {...gate} requirePayment={!freeRoute} upgrade={freePlanOn ? <p>Upgrade screen</p> : null}>
      <Outlet />
    </AccountGate>
  );
}

function Harness({ freePlanOn }) {
  const { authLoading, authUser, account, retry, retrying } = useAccountVerification({ onAuthChange, readSnapshot });
  const gate = { loading: authLoading, user: authUser, account, recovery: { onRetry: retry, retrying, onSignOut: vi.fn(), onReload: vi.fn() }, loadingScreen: <p>Loading...</p> };
  return (
    <>
      <Where />
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/checkout" element={<p>Checkout page</p>} />
        <Route element={<Shell gate={gate} freePlanOn={freePlanOn} />}>
          <Route path={CONTACT_HUB_PATH} element={<p>My People</p>} />
          <Route path="/settings" element={<p>Settings</p>} />
          <Route path="/scout" element={<p>Scout</p>} />
        </Route>
      </Routes>
    </>
  );
}

async function start(path, read, { freePlanOn = true } = {}) {
  readSnapshot = vi.fn(read);
  render(<MemoryRouter initialEntries={[path]}><Harness freePlanOn={freePlanOn} /></MemoryRouter>);
  await act(async () => { signIn({ uid: 'u1', email: 'u1@example.test' }); });
}

afterEach(() => { vi.useRealTimers(); });

describe('Free plan on: a verified free account', () => {
  it('opens My People', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(FREE_SIGNUP));
    expect(screen.getByText('My People')).toBeInTheDocument();
  });

  it('opens Settings', async () => {
    await start('/settings', async () => snapshot(UNPAID));
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('a brand-new signup whose document is not written yet is Free too', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(null));
    expect(screen.getByText('My People')).toBeInTheDocument();
  });

  it('sees the upgrade screen on a paid page, in place, with no redirect to checkout', async () => {
    await start('/scout', async () => snapshot(UNPAID));
    expect(screen.getByText('Upgrade screen')).toBeInTheDocument();
    expect(screen.queryByText('Scout')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/scout');
  });
});

describe('Free plan on: a paid account is unchanged', () => {
  it('opens paid pages and free pages', async () => {
    await start('/scout', async () => snapshot(PAID_PRO));
    expect(screen.getByText('Scout')).toBeInTheDocument();
  });

  it('a saved paid copy still opens the app offline', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(PAID_STARTER, { fromCache: true }));
    expect(screen.getByText('My People')).toBeInTheDocument();
  });
});

describe('Free plan on: an account that cannot be verified is never Free', () => {
  it('a failed read shows the verification screen on My People', async () => {
    await start(CONTACT_HUB_PATH, async () => { throw new Error('unavailable'); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText('My People')).not.toBeInTheDocument();
  });

  it('a cache-only unpaid copy shows the verification screen, not Free', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(UNPAID, { fromCache: true }));
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
  });

  it('a failed read on a paid page shows the verification screen, not the upgrade screen', async () => {
    await start('/scout', async () => { throw new Error('unavailable'); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText('Upgrade screen')).not.toBeInTheDocument();
  });

  it('a read that never answers shows the verification screen after the timeout', async () => {
    vi.useFakeTimers();
    await start(CONTACT_HUB_PATH, () => new Promise(() => {}));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(ACCOUNT_READ_TIMEOUT_MS); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText('My People')).not.toBeInTheDocument();
  });
});

describe('Free plan off: exactly as before', () => {
  it('a verified unpaid account on My People is sent to checkout', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(UNPAID), { freePlanOn: false });
    expect(screen.getByText('Checkout page')).toBeInTheDocument();
  });

  it('a verified unpaid account on a paid page is sent to checkout', async () => {
    await start('/scout', async () => snapshot(UNPAID), { freePlanOn: false });
    expect(screen.getByText('Checkout page')).toBeInTheDocument();
  });
});
