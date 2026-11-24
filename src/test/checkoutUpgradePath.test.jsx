/**
 * Billing Phase 1b: the upgrade path.
 *
 *   - every purchase goes through the authenticated Checkout Session; the Stripe Payment Links
 *     (which could not reuse an existing Stripe customer, so an existing subscriber who used one
 *     was charged for a second subscription) are gone;
 *   - an existing subscriber never sees a purchase on /checkout;
 *   - a refused checkout says why on the page, and that nothing was charged;
 *   - after paying, the customer is only taken into the product once the server has confirmed
 *     the payment, so they are never bounced back to checkout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { ACCOUNT } from '../utils/accountVerification';

const getDocFromServerMock = vi.fn();

vi.mock('../firebase/config', () => ({
  appCheck: null,
  auth: { currentUser: { uid: 'u1', email: 'u1@example.test', getIdToken: async () => 'id-token-1' } },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: vi.fn(),
  getDocFromServer: (...a) => getDocFromServerMock(...a),
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));

const { default: CheckoutPage, checkoutErrorMessage } = await import('../pages/CheckoutPage');
const { default: CheckoutSuccessPage, CONFIRM_POLL_MS, CONFIRM_TIMEOUT_MS } = await import('../pages/CheckoutSuccessPage');

const verified = (data) => ({ status: ACCOUNT.VERIFIED, data });
const FREE = verified({ email: 'u1@example.test' });
const PAID = verified({ hasCompletedPayment: true, subscriptionTier: 'starter', subscriptionStatus: 'active' });
const snapshot = (data) => ({ exists: () => data !== null, data: () => data });

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname}{search}</p>;
}

function renderCheckout(account, path = '/checkout?tier=pro') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/checkout" element={<CheckoutPage account={account} />} />
        <Route path="/settings" element={<p>Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

let fetchMock;
let hrefSet;
beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_ENABLED', 'true');
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
  hrefSet = vi.fn();
  // Leaving for Stripe is observed, not performed.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, set href(v) { hrefSet(v); }, get href() { return 'http://localhost/checkout'; } },
  });
  getDocFromServerMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('/checkout', () => {
  it('no Payment Link is left anywhere in the page', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/CheckoutPage.jsx'), 'utf8');
    expect(src).not.toMatch(/buy\.stripe\.com/);
    expect(src).not.toMatch(/client_reference_id/);
    expect(src).not.toMatch(/VITE_STRIPE_CHECKOUT_MODE/);
  });

  it('an existing subscriber is sent to Settings → Billing and offered nothing', () => {
    renderCheckout(PAID);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=billing');
    expect(screen.queryByRole('button', { name: /complete purchase/i })).not.toBeInTheDocument();
  });

  it('a free account starts the authenticated checkout for the tier in the link, and goes to Stripe', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/abc' }) });
    renderCheckout(FREE, '/checkout?tier=pro');
    await userEvent.setup().click(screen.getByRole('button', { name: /complete purchase/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/.netlify/functions/create-checkout-session');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-1');
    expect(JSON.parse(init.body)).toEqual({ tier: 'pro' });
    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith('https://checkout.stripe.com/c/abc'));
  });

  it('an unknown tier in the link is Starter', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/s' }) });
    renderCheckout(FREE, '/checkout?tier=enterprise');
    await userEvent.setup().click(screen.getByRole('button', { name: /complete purchase/i }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tier: 'starter' });
  });

  it('a refusal is explained on the page, says nothing was charged, and goes nowhere', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'already_subscribed' }) });
    renderCheckout(FREE);
    await userEvent.setup().click(screen.getByRole('button', { name: /complete purchase/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a subscription');
    expect(hrefSet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /complete purchase/i })).not.toBeDisabled();
  });

  it('a network failure is explained the same way', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    renderCheckout(FREE);
    await userEvent.setup().click(screen.getByRole('button', { name: /complete purchase/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have not been charged');
  });

  it('a double click starts one checkout', async () => {
    let resolveFetch;
    fetchMock.mockImplementation(() => new Promise((r) => { resolveFetch = r; }));
    renderCheckout(FREE);
    const button = screen.getByRole('button', { name: /complete purchase/i });
    await userEvent.setup().dblClick(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFetch({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/x' }) }); });
  });

  it('a subscription on file without paid access: explained up front, and the purchase is off', async () => {
    renderCheckout(verified({ hasCompletedPayment: false, subscriptionStatus: 'past_due' }));
    expect(screen.getByText('You already have a subscription on file')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /complete purchase/i });
    expect(button).toBeDisabled();
    await userEvent.setup().click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a canceled subscription does not block buying again', () => {
    renderCheckout(verified({ hasCompletedPayment: false, subscriptionStatus: 'canceled' }));
    expect(screen.queryByText('You already have a subscription on file')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete purchase/i })).not.toBeDisabled();
  });
});

describe('checkoutErrorMessage', () => {
  it.each([
    [409, 'subscription_needs_recovery'], [409, 'checkout_needs_manual_reconciliation'], [409, 'checkout_operation_superseded'],
    [409, 'customer_binding_conflict'], [409, 'contact_support'], [500, 'session_creation_failed'], [500, undefined],
  ])('%s %s says nothing was charged', (status, code) => {
    expect(checkoutErrorMessage(status, code)).toMatch(/not been charged/);
  });

  it('an expired session asks the customer to sign in again', () => {
    expect(checkoutErrorMessage(401, 'Invalid authentication token')).toMatch(/Sign in again/);
  });

  it('a checkout already being prepared asks the customer to wait', () => {
    expect(checkoutErrorMessage(425, 'checkout_in_progress')).toMatch(/Wait a moment/);
  });
});

describe('/checkout/success', () => {
  function renderSuccess(account, onRecheckAccount = vi.fn()) {
    const utils = render(
      <MemoryRouter initialEntries={['/checkout/success']}>
        <Where />
        <Routes>
          <Route path="/checkout/success" element={<CheckoutSuccessPage account={account} onRecheckAccount={onRecheckAccount} />} />
          <Route path="/onboarding" element={<p>Onboarding</p>} />
        </Routes>
      </MemoryRouter>,
    );
    return { ...utils, onRecheckAccount };
  }

  it('waits for the server: while the account is unpaid it does not go into the product', async () => {
    vi.useFakeTimers();
    getDocFromServerMock.mockResolvedValue(snapshot({ hasCompletedPayment: false }));
    renderSuccess(FREE);
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_POLL_MS * 3); });
    expect(screen.getByTestId('where')).toHaveTextContent('/checkout/success');
    expect(screen.getByText('Confirming your payment…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /meet barry/i })).not.toBeInTheDocument();
    expect(getDocFromServerMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('once the server shows paid access, it asks the app to re-check the account', async () => {
    vi.useFakeTimers();
    getDocFromServerMock
      .mockResolvedValueOnce(snapshot({ hasCompletedPayment: false }))
      .mockResolvedValue(snapshot({ hasCompletedPayment: true, subscriptionTier: 'pro' }));
    const { onRecheckAccount } = renderSuccess(FREE);
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_POLL_MS * 2); });
    expect(onRecheckAccount).toHaveBeenCalledTimes(1);
  });

  it('when the app\'s account says paid, it goes on to onboarding', async () => {
    vi.useFakeTimers();
    renderSuccess(PAID);
    expect(screen.getByText(/Your account is now activated/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByTestId('where')).toHaveTextContent('/onboarding');
    expect(getDocFromServerMock).not.toHaveBeenCalled();
  });

  it('after a minute without confirmation it says so, promises no second charge, and can check again', async () => {
    vi.useFakeTimers();
    getDocFromServerMock.mockResolvedValue(snapshot({ hasCompletedPayment: false }));
    renderSuccess(FREE);
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + CONFIRM_POLL_MS); });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('taking longer than usual');
    expect(alert).toHaveTextContent('You will not be charged again');
    const callsBefore = getDocFromServerMock.mock.calls.length;
    await act(async () => { screen.getByRole('button', { name: /check again/i }).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_POLL_MS); });
    expect(getDocFromServerMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('a failed server read is just "not yet"', async () => {
    vi.useFakeTimers();
    getDocFromServerMock.mockRejectedValue(new Error('unavailable'));
    renderSuccess(FREE);
    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIRM_POLL_MS * 2); });
    expect(screen.getByText('Confirming your payment…')).toBeInTheDocument();
  });
});
