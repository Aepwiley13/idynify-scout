/**
 * The Free plan's routing (components/billing/freePlanRouting.jsx) with the switch ON, using the
 * real components and the real account hook. The rule that matters most: an account that could
 * not be verified is never treated as Free, on any route.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import { useAccountVerification, ACCOUNT, ACCOUNT_READ_TIMEOUT_MS } from '../utils/accountVerification';
import { CONTACT_HUB_PATH } from '../constants/contactHub';

vi.mock('../constants/freePlan', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    FREE_PLAN: Object.freeze({ mode: 'on', enabled: true, signups: true }),
    isFreePlanPath: (pathname) => real.isFreePlanPath(pathname, { enabled: true }),
    signupPlanFor: (tier) => real.signupPlanFor(tier, { enabled: true }),
    freePlanHomeFor: (account) => real.freePlanHomeFor(account, { enabled: true }),
    SMART_REDIRECT_REQUIRES_PAYMENT: false,
  };
});
vi.mock('../components/billing/UpgradeRequired', () => ({ default: () => <p>Upgrade screen</p> }));

const { ShellAccountGate, SignedInSignupRedirect } = await import('../components/billing/freePlanRouting');
const { freePlanHomeFor, SMART_REDIRECT_REQUIRES_PAYMENT } = await import('../constants/freePlan');

const PAID = { hasCompletedPayment: true, subscriptionTier: 'pro' };
const UNPAID = { hasCompletedPayment: false };
const FREE_SIGNUP = { email: 'new@example.test' };
const snapshot = (data, { fromCache = false } = {}) => ({ exists: () => data !== null, data: () => data, metadata: { fromCache } });
const UNVERIFIED = 'We couldn’t verify your account right now.';

let signIn;
let readSnapshot;
const onAuthChange = (callback) => { signIn = callback; return () => {}; };

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function Harness() {
  const { authLoading, authUser, account, retry, retrying } = useAccountVerification({ onAuthChange, readSnapshot });
  const gate = { loading: authLoading, user: authUser, account, recovery: { onRetry: retry, retrying, onSignOut: vi.fn(), onReload: vi.fn() }, loadingScreen: <p>Loading...</p> };
  return (
    <>
      <Where />
      <Routes>
        <Route path="/checkout" element={<p>Checkout page</p>} />
        <Route element={<ShellAccountGate {...gate} layout={(content) => <div data-testid="shell">{content}</div>}><div data-testid="shell"><Outlet /></div></ShellAccountGate>}>
          <Route path={CONTACT_HUB_PATH} element={<p>My People</p>} />
          <Route path={`${CONTACT_HUB_PATH}/person/:id`} element={<p>A person</p>} />
          <Route path="/settings" element={<p>Settings</p>} />
          <Route path="/scout" element={<p>Scout</p>} />
          <Route path="/mission-control-v2" element={<p>Mission Control</p>} />
          <Route path="/contact/:id" element={<p>Paid contact page</p>} />
        </Route>
      </Routes>
    </>
  );
}

async function start(path, read) {
  readSnapshot = vi.fn(read);
  render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>);
  await act(async () => { signIn({ uid: 'u1', email: 'u1@example.test' }); });
}

afterEach(() => { vi.useRealTimers(); });

describe('a verified Free account', () => {
  it.each([[CONTACT_HUB_PATH, 'My People'], [`${CONTACT_HUB_PATH}/person/p1`, 'A person'], ['/settings', 'Settings']])(
    'opens %s', async (path, text) => {
      await start(path, async () => snapshot(FREE_SIGNUP));
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it('a new signup whose document is not written yet is Free too', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(null));
    expect(screen.getByText('My People')).toBeInTheDocument();
  });

  it('sees the upgrade screen inside the shell on a paid page, with no redirect', async () => {
    await start('/scout', async () => snapshot(UNPAID));
    expect(screen.getByText('Upgrade screen')).toBeInTheDocument();
    expect(screen.getByTestId('shell')).toContainElement(screen.getByText('Upgrade screen'));
    expect(screen.queryByText('Scout')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/scout');
  });
});

describe('a free account following a link from a free place', () => {
  it('the logo (Mission Control) leads to My People, not the upgrade screen', async () => {
    await start('/mission-control-v2', async () => snapshot(FREE_SIGNUP));
    expect(screen.getByTestId('where')).toHaveTextContent(CONTACT_HUB_PATH);
    expect(screen.getByText('My People')).toBeInTheDocument();
    expect(screen.queryByText('Upgrade screen')).not.toBeInTheDocument();
  });

  it('a contact from global search opens that person in Contact Hub', async () => {
    await start('/contact/p1', async () => snapshot(FREE_SIGNUP));
    expect(screen.getByTestId('where')).toHaveTextContent(`${CONTACT_HUB_PATH}/person/p1`);
    expect(screen.getByText('A person')).toBeInTheDocument();
  });

  it('a paid account still gets the real pages', async () => {
    await start('/contact/p1', async () => snapshot(PAID));
    expect(screen.getByText('Paid contact page')).toBeInTheDocument();
  });

  it('an unverified account is not redirected anywhere: the verification screen', async () => {
    await start('/mission-control-v2', async () => { throw new Error('unavailable'); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/mission-control-v2');
  });
});

describe('a paid account is unchanged', () => {
  it('opens a paid page', async () => {
    await start('/scout', async () => snapshot(PAID));
    expect(screen.getByText('Scout')).toBeInTheDocument();
  });

  it('a saved paid copy still opens the app offline', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(PAID, { fromCache: true }));
    expect(screen.getByText('My People')).toBeInTheDocument();
  });
});

describe('an account that cannot be verified is never Free', () => {
  it('a failed read: the verification screen on My People', async () => {
    await start(CONTACT_HUB_PATH, async () => { throw new Error('unavailable'); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText('My People')).not.toBeInTheDocument();
  });

  it('a cache-only unpaid copy: the verification screen, not Free', async () => {
    await start(CONTACT_HUB_PATH, async () => snapshot(UNPAID, { fromCache: true }));
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
  });

  it('a failed read on a paid page: the verification screen, not the upgrade screen', async () => {
    await start('/scout', async () => { throw new Error('unavailable'); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText('Upgrade screen')).not.toBeInTheDocument();
  });

  it('a read that never answers: the verification screen after the timeout', async () => {
    vi.useFakeTimers();
    await start(CONTACT_HUB_PATH, () => new Promise(() => {}));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(ACCOUNT_READ_TIMEOUT_MS); });
    expect(screen.getByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText('My People')).not.toBeInTheDocument();
  });
});

describe('SmartRedirect and signed-in /signup', () => {
  it('SmartRedirect sends only a server-verified free account to Contact Hub', () => {
    expect(SMART_REDIRECT_REQUIRES_PAYMENT).toBe(false);
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: FREE_SIGNUP })).toBe(CONTACT_HUB_PATH);
    expect(freePlanHomeFor({ status: ACCOUNT.VERIFIED, data: PAID })).toBeNull();
    expect(freePlanHomeFor({ status: ACCOUNT.UNVERIFIED, data: null })).toBeNull();
    expect(freePlanHomeFor({ status: ACCOUNT.CACHED, data: PAID })).toBeNull();
  });

  it.each([['', CONTACT_HUB_PATH], ['?tier=pro', '/checkout'], ['?tier=starter', '/checkout']])(
    'signed in at /signup%s → %s', (search, destination) => {
      render(
        <MemoryRouter initialEntries={[`/signup${search}`]}>
          <Where />
          <Routes>
            <Route path="/signup" element={<SignedInSignupRedirect />} />
            <Route path="/checkout" element={<p>Checkout</p>} />
            <Route path={CONTACT_HUB_PATH} element={<p>My People</p>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByTestId('where')).toHaveTextContent(destination);
    },
  );
});
