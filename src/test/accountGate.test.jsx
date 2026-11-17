/* global process */
/**
 * The account gates, end to end: the real hook and the real gate component,
 * with the sign-in listener and the account read supplied by the test.
 *
 * The rule under test: a failed, slow or cache-only account read is never
 * "unpaid". It does not redirect to checkout, does not open the app, and does
 * not let a purchase start.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountGate } from '../components/AccountUnverified';
import { useAccountVerification, ACCOUNT_READ_TIMEOUT_MS } from '../utils/accountVerification';

const PAID = { hasCompletedPayment: true };
const UNPAID = { hasCompletedPayment: false };
const snapshot = (data, { fromCache = false } = {}) => ({ exists: () => data !== null, data: () => data, metadata: { fromCache } });
const UNVERIFIED = 'We couldn’t verify your account right now.';

/** A read the test settles by hand. */
function deferred() {
  let resolve; let reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

let signIn;        // (firebaseUser | null) => void
let readSnapshot;  // vi.fn((uid) => Promise<snapshot>)
let buy;           // the purchase action on the test's checkout page
const signOut = vi.fn();
const onAuthChange = (callback) => { signIn = callback; return () => {}; };

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** The same shape as App.jsx: a protected app route, the checkout route, login. */
function Harness() {
  const { authLoading, authUser, account, retry, retrying } = useAccountVerification({ onAuthChange, readSnapshot });
  const gate = { loading: authLoading, user: authUser, account, recovery: { onRetry: retry, retrying, onSignOut: signOut, onReload: vi.fn() }, loadingScreen: <p>Loading...</p> };
  return (
    <>
      <Where />
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/app" element={<AccountGate {...gate}><p>The app</p></AccountGate>} />
        <Route
          path="/checkout"
          element={(
            <AccountGate {...gate} requirePayment={false} purchase>
              <button type="button" onClick={buy}>Buy Scout Starter</button>
            </AccountGate>
          )}
        />
      </Routes>
    </>
  );
}
const open = (path = '/app') => render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>);
const where = () => screen.getByTestId('where').textContent;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const signInAs = (uid) => act(async () => { signIn({ uid, email: `${uid}@example.test` }); await Promise.resolve(); });

let errors;
beforeEach(() => {
  readSnapshot = vi.fn();
  buy = vi.fn();
  signOut.mockReset();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errors.mockRestore(); vi.useRealTimers(); });

describe('verified accounts keep today\'s behaviour', () => {
  it('paid: the app opens', async () => {
    readSnapshot.mockResolvedValue(snapshot(PAID));
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByText('The app')).toBeInTheDocument();
    expect(where()).toBe('/app');
  });

  it('unpaid: redirected to checkout, where the purchase is offered', async () => {
    readSnapshot.mockResolvedValue(snapshot(UNPAID));
    open();
    await signInAs('u1');
    await settle();
    expect(where()).toBe('/checkout');
    expect(screen.getByRole('button', { name: 'Buy Scout Starter' })).toBeInTheDocument();
  });

  it('no account document, confirmed by the server (a new signup): checkout', async () => {
    readSnapshot.mockResolvedValue(snapshot(null));
    open();
    await signInAs('u1');
    await settle();
    expect(where()).toBe('/checkout');
    expect(screen.getByRole('button', { name: 'Buy Scout Starter' })).toBeInTheDocument();
  });

  it('paid may still open checkout (upgrades)', async () => {
    readSnapshot.mockResolvedValue(snapshot(PAID));
    open('/checkout');
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('button', { name: 'Buy Scout Starter' })).toBeInTheDocument();
  });

  it('signed out: login', async () => {
    open();
    await act(async () => signIn(null));
    expect(where()).toBe('/login');
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});

describe('a failed account read', () => {
  // Braces matter: a function returned from beforeEach is run as a teardown.
  beforeEach(() => { readSnapshot.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'unavailable' })); });

  it('shows the verification screen: no checkout redirect, no app', async () => {
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    expect(where()).toBe('/app');
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
  });

  it('blocks the checkout page too, so no purchase can start', async () => {
    open('/checkout');
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    expect(screen.queryByRole('button', { name: /buy/i })).not.toBeInTheDocument();
    expect(buy).not.toHaveBeenCalled();
  });

  it('keeps the customer signed in, and makes exactly one read', async () => {
    open();
    await signInAs('u1');
    await settle();
    expect(signOut).not.toHaveBeenCalled();
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('logs the cause and keeps it off the screen', async () => {
    open();
    await signInAs('u1');
    await settle();
    expect(errors.mock.calls.some((call) => String(call[0]).includes('[account] Could not verify'))).toBe(true);
    expect(screen.getByRole('alert').textContent).not.toMatch(/unavailable/);
  });

  it('a throw as the read starts (a failed Firestore client) is handled the same way', async () => {
    readSnapshot.mockImplementation(() => { throw new Error('INTERNAL ASSERTION FAILED (ID: b815)'); });
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
  });

  it('Sign out is the customer\'s choice', async () => {
    open();
    await signInAs('u1');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('an expired session leaves the screen for login', async () => {
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    await act(async () => signIn(null));
    expect(where()).toBe('/login');
  });
});

describe('Retry', () => {
  it('reads again only when pressed, and recovers to the app', async () => {
    vi.useFakeTimers();
    readSnapshot.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(snapshot(PAID));
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);

    // No automatic retry, however long the screen is left open.
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
    expect(readSnapshot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('a retry that finds the account unpaid goes to checkout, as a first read would', async () => {
    readSnapshot.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(snapshot(UNPAID));
    open();
    await signInAs('u1');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(where()).toBe('/checkout');
  });

  it('a retry that fails again shows the screen again, with one more read and no loop', async () => {
    readSnapshot.mockRejectedValue(new Error('unavailable'));
    open();
    await signInAs('u1');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('slow reads and late answers', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('shows loading, then the verification screen at 15 seconds', async () => {
    readSnapshot.mockReturnValue(new Promise(() => {}));
    open();
    await signInAs('u1');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(ACCOUNT_READ_TIMEOUT_MS - 1); });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
  });

  it('a first read that answers "unpaid" after a retry has succeeded changes nothing', async () => {
    const first = deferred();
    const second = deferred();
    readSnapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    open();
    await signInAs('u1');
    await act(async () => { await vi.advanceTimersByTimeAsync(ACCOUNT_READ_TIMEOUT_MS); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // While the retry is in flight the screen stays, with the button busy.
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await act(async () => { second.resolve(snapshot(PAID)); await Promise.resolve(); });
    await settle();
    expect(screen.getByText('The app')).toBeInTheDocument();

    await act(async () => { first.resolve(snapshot(UNPAID)); await Promise.resolve(); });
    await settle();
    expect(screen.getByText('The app')).toBeInTheDocument();
    expect(where()).toBe('/app');
  });

  it('after a sign-in, the page in place stays until the account read finishes', async () => {
    // As before this change: Login is not swapped for a loading screen, and
    // the user is not exposed to the routes, until the read settles.
    const pending = deferred();
    readSnapshot.mockReturnValue(pending.promise);
    open('/login');
    await act(async () => signIn(null));
    await signInAs('u1');
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('an answer for a previous user is dropped when someone else has signed in', async () => {
    const forFirst = deferred();
    readSnapshot.mockReturnValueOnce(forFirst.promise).mockResolvedValue(snapshot(UNPAID));
    open();
    await signInAs('first');
    await signInAs('second');
    await settle();
    expect(where()).toBe('/checkout');

    await act(async () => { forFirst.resolve(snapshot(PAID)); await Promise.resolve(); });
    await settle();
    expect(where()).toBe('/checkout');
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
  });

  it('an answer that arrives after sign-out is dropped', async () => {
    const pending = deferred();
    readSnapshot.mockReturnValue(pending.promise);
    open();
    await signInAs('u1');
    await act(async () => signIn(null));
    await act(async () => { pending.resolve(snapshot(PAID)); await Promise.resolve(); });
    await settle();
    expect(where()).toBe('/login');
  });
});

describe('only the browser\'s saved copy is available', () => {
  it('saved copy says paid: the app opens, as it did offline before', async () => {
    readSnapshot.mockResolvedValue(snapshot(PAID, { fromCache: true }));
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('but the saved copy cannot start a purchase', async () => {
    readSnapshot.mockResolvedValue(snapshot(PAID, { fromCache: true }));
    open('/checkout');
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    expect(screen.queryByRole('button', { name: /buy/i })).not.toBeInTheDocument();
  });

  it.each([['unpaid', UNPAID], ['missing', null]])('saved copy %s: the verification screen, not checkout', async (_label, data) => {
    readSnapshot.mockResolvedValue(snapshot(data, { fromCache: true }));
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    expect(where()).toBe('/app');
  });

  it('when the connection returns, the server\'s answer is applied', async () => {
    readSnapshot.mockResolvedValueOnce(snapshot(PAID, { fromCache: true })).mockResolvedValue(snapshot(UNPAID));
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByText('The app')).toBeInTheDocument();

    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve(); });
    await settle();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(where()).toBe('/checkout');
  });

  it('a re-check that fails leaves the open app alone, without a loading flash', async () => {
    readSnapshot.mockResolvedValueOnce(snapshot(PAID, { fromCache: true })).mockRejectedValue(new Error('unavailable'));
    open();
    await signInAs('u1');
    await settle();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByText('The app')).toBeInTheDocument();
    await settle();
    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('once the server has answered, coming back online reads nothing more', async () => {
    readSnapshot.mockResolvedValue(snapshot(PAID));
    open();
    await signInAs('u1');
    await settle();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('coming back online while on the verification screen re-checks once and recovers', async () => {
    readSnapshot.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(snapshot(PAID));
    open();
    await signInAs('u1');
    await settle();
    expect(screen.getByRole('heading')).toHaveTextContent(UNVERIFIED);
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve(); });
    await settle();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByText('The app')).toBeInTheDocument();
  });
});

describe('nothing is changed while unverified', () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const source = (path) => strip(readFileSync(resolve(process.cwd(), path), 'utf8'));

  it('the verification code cannot write, pay or navigate away: it has no means to', () => {
    for (const path of ['src/utils/accountVerification.js', 'src/components/AccountUnverified.jsx']) {
      const code = source(path);
      expect(code).not.toMatch(/firebase|updateDoc|setDoc|addDoc|deleteDoc|writeBatch|fetch\(|stripe|location\.href|localStorage/i);
    }
  });

  it('the only data call made in the unverified state is the account read itself', async () => {
    readSnapshot.mockRejectedValue(new Error('unavailable'));
    open('/checkout');
    await signInAs('u1');
    await settle();
    expect(readSnapshot.mock.calls).toEqual([['u1']]);
    expect(buy).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('App.jsx uses this gate everywhere', () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = strip(readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8'));

  it('no gate decides from the paid flag directly any more', () => {
    expect(app).not.toMatch(/hasActiveAccess|hasCompletedPayment/);
  });

  it('ShellRoute, ProtectedRoute and SmartRedirect all render AccountGate', () => {
    expect(app.match(/<AccountGate\b/g)).toHaveLength(3);
  });

  it('the only bare redirect to checkout left is the signed-in /signup route, which lands on a guarded route', () => {
    const redirects = app.match(/<Navigate to="\/checkout" \/>/g) ?? [];
    expect(redirects).toHaveLength(1);
    // The Free plan moved it into SignedInSignupRedirect: /checkout when the Free plan is off,
    // exactly as before; otherwise checkout for a paid tier or the Contact Hub. All guarded.
    expect(app).toMatch(/path="\/signup" element=\{!user \? <Signup \/> : <SignedInSignupRedirect \/>\}/);
    expect(app).toMatch(/if \(!FREE_PLAN\.enabled\) return <Navigate to="\/checkout" \/>;/);
  });

  it('the shell lets a free route skip the paid check, and never skips the verification check', () => {
    // requirePayment may be relaxed for a free route; nothing else about the decision changes, so
    // a failed or cache-only read still reaches the verification screen (accessDecision).
    expect(app).toMatch(/requirePayment=\{requirePayment && !freeRoute\}/);
    expect(app).toMatch(/upgrade=\{FREE_PLAN\.enabled \? \(/);
  });

  it('all three checkout routes need the server\'s answer', () => {
    for (const path of ['/checkout', '/checkout/success', '/checkout/cancel']) {
      expect(app).toContain(`<Route path="${path}" element={<ProtectedRoute requirePayment={false} purchase>`);
    }
  });

  it('the account is read once per sign-in through the verification hook, and nowhere else', () => {
    expect(app.match(/useAccountVerification\(/g)).toHaveLength(1);
    expect(app.match(/getDoc\(/g)).toHaveLength(1);
    expect(app).not.toMatch(/setInterval\([^)]*retry/);
  });
});
