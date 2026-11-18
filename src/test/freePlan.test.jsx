/**
 * The Free plan (constants/freePlan.js, utils/accountPlan.js).
 *
 * The rules under test:
 *   - a server-verified account with no paid access may use the free routes (Contact Hub,
 *     Settings), and sees an in-app upgrade screen on a paid route;
 *   - an account that could not be verified is NEVER treated as Free: a failed, slow or
 *     cache-only read shows the verification screen on free routes too;
 *   - with the switch off, every gate behaves exactly as before.
 * The switch-on gate behaviour is in freePlanShellGate.test.jsx (it mocks the switch on).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ShellAccountGate } from '../components/billing/freePlanRouting';
import { useAccountVerification, ACCOUNT } from '../utils/accountVerification';
import { planOf, PLAN, isPaidPlan } from '../utils/accountPlan';
import {
  FREE_PLAN, FREE_PLAN_HOME, freePlanEnabledFrom, isFreePlanPath, signupPlanFor, signupLandingPath, freeSignupDocument,
  freePlanHomeFor, SMART_REDIRECT_REQUIRES_PAYMENT, freePlanFrom, freePlanRedirectFor,
} from '../constants/freePlan';
import { CONTACT_HUB_PATH } from '../constants/contactHub';

const PAID_STARTER = { hasCompletedPayment: true, subscriptionTier: 'starter' };
const PAID_PRO = { hasCompletedPayment: true, subscriptionTier: 'pro' };
const UNPAID = { hasCompletedPayment: false };
const FREE_SIGNUP = { email: 'new@example.test' };
const snapshot = (data, { fromCache = false } = {}) => ({ exists: () => data !== null, data: () => data, metadata: { fromCache } });

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

describe('the three settings, and the rollback', () => {
  it.each([
    ['on', 'on', true, true], ['true', 'on', true, true], ['1', 'on', true, true],
    ['existing', 'existing', true, false],
    [undefined, 'off', false, false], ['', 'off', false, false], ['off', 'off', false, false], ['yes', 'off', false, false],
  ])('VITE_FREE_PLAN=%s → %s (free access %s, new Free signups %s)', (value, mode, enabled, signups) => {
    expect(freePlanFrom(value, { contactHub: true, shell: true })).toEqual({ mode, enabled, signups });
  });

  it('never on without Contact Hub or the shell, whatever the variable says', () => {
    expect(freePlanFrom('on', { contactHub: false, shell: true }).enabled).toBe(false);
    expect(freePlanFrom('existing', { contactHub: true, shell: false }).enabled).toBe(false);
  });

  it('`existing` keeps every free account in, and stops new Free signups', () => {
    const existing = freePlanFrom('existing', { contactHub: true, shell: true });
    expect(isFreePlanPath(CONTACT_HUB_PATH, { enabled: existing.enabled })).toBe(true);
    expect(signupPlanFor(null, { enabled: existing.signups })).toBe('starter'); // a no-tier signup pays again, as before launch
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: FREE_SIGNUP }, { enabled: existing.enabled })).toBe(FREE_PLAN_HOME);
  });
});

describe('free places that link to paid pages lead to Contact Hub instead', () => {
  it.each([
    ['/mission-control-v2', FREE_PLAN_HOME],
    ['/contact/abc123', `${CONTACT_HUB_PATH}/person/abc123`],
    ['/scout/contact/abc123', `${CONTACT_HUB_PATH}/person/abc123`],
    ['/contact/a%20b', `${CONTACT_HUB_PATH}/person/a%20b`],
  ])('%s → %s', (path, to) => {
    expect(freePlanRedirectFor(path)).toBe(to);
  });

  it.each(['/scout', '/hunter', '/company/c1', '/contact/abc/edit', '/barry', '/recon'])('%s stays a paid page', (path) => {
    expect(freePlanRedirectFor(path)).toBeNull();
  });
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

  it('a Free signup writes only email and createdAt: no billing field at all', () => {
    const now = new Date(0);
    expect(freeSignupDocument('a@example.test', now)).toEqual({ email: 'a@example.test', createdAt: now });
  });

  it('SmartRedirect: only a server-verified free account goes to Contact Hub, and only with the switch on', () => {
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: FREE_SIGNUP })).toBeNull(); // switch off in tests
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: FREE_SIGNUP }, { enabled: true })).toBe(FREE_PLAN_HOME);
    expect(freePlanHomeFor({ status: ACCOUNT.UNVERIFIED, data: null }, { enabled: true })).toBeNull();
    // A paid signup (it chose its tier) keeps its usual home and onboarding.
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: { ...PAID_PRO, selectedTier: 'pro' } }, { enabled: true })).toBeNull();
    // Started Free, then upgraded: Contact Hub, not onboarding.
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: { ...FREE_SIGNUP, ...PAID_PRO } }, { enabled: true })).toBe(FREE_PLAN_HOME);
    expect(SMART_REDIRECT_REQUIRES_PAYMENT).toBe(true); // switch off: unchanged
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

// ── The shell's gate with the switch off (the real component; the switch is off in tests) ────

let signIn;
let readSnapshot;
const onAuthChange = (callback) => { signIn = callback; return () => {}; };

function Harness() {
  const { authLoading, authUser, account, retry, retrying } = useAccountVerification({ onAuthChange, readSnapshot });
  const gate = { loading: authLoading, user: authUser, account, recovery: { onRetry: retry, retrying, onSignOut: vi.fn(), onReload: vi.fn() }, loadingScreen: <p>Loading...</p> };
  return (
    <Routes>
      <Route path="/checkout" element={<p>Checkout page</p>} />
      <Route element={<ShellAccountGate {...gate} layout={(content) => <div>{content}</div>}><Outlet /></ShellAccountGate>}>
        <Route path={CONTACT_HUB_PATH} element={<p>My People</p>} />
        <Route path="/scout" element={<p>Scout</p>} />
      </Route>
    </Routes>
  );
}

async function start(path, read) {
  readSnapshot = vi.fn(read);
  render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>);
  await act(async () => { signIn({ uid: 'u1', email: 'u1@example.test' }); });
}

describe('Free plan off: the shell gate is exactly as before', () => {
  it('a verified unpaid account on My People is sent to checkout', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(UNPAID));
    expect(screen.getByText('Checkout page')).toBeInTheDocument();
  });

  it('a verified unpaid account on a paid page is sent to checkout', async () => {
    await start('/scout', async () => snapshot(UNPAID));
    expect(screen.getByText('Checkout page')).toBeInTheDocument();
  });

  it('a paid account opens both', async () => {
    await start('/scout', async () => snapshot(PAID_PRO));
    expect(screen.getByText('Scout')).toBeInTheDocument();
  });

  it('a failed read shows the verification screen', async () => {
    await start(CONTACT_HUB_PATH, async () => { throw new Error('unavailable'); });
    expect(screen.getByText('We couldn’t verify your account right now.')).toBeInTheDocument();
  });
});
