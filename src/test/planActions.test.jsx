/**
 * W3: Settings → Billing for a paying customer.
 *
 *   - Starter: Upgrade to Pro shows Stripe's preview of what is due today, then Confirm. After
 *     the server reports the change, the page waits for the account to show Pro (the webhook
 *     sets it) before saying so. A bank confirmation goes to Stripe's invoice page.
 *   - Manage billing opens the Customer Portal.
 *   - Pro: no upgrade; a plan set to end: no upgrade until it is kept.
 *   - A Scout "Upgrade to Pro" link for a Starter customer lands here with the preview open,
 *     never on a second checkout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ACCOUNT } from '../utils/accountVerification';

const getDocFromServerMock = vi.fn();
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1', getIdToken: async () => 'tok-u1' } },
  db: {},
  appCheck: null,
}));
vi.mock('../services/billingSecurity', () => ({
  billingRequestHeaders: vi.fn(async () => ({ Authorization: 'Bearer tok-u1', 'Content-Type': 'application/json' })),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: vi.fn(),
  getDocFromServer: (...a) => getDocFromServerMock(...a),
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));

const { default: PlanActions, UPGRADE_POLL_MS, UPGRADE_TIMEOUT_MS } = await import('../components/billing/PlanActions');
const { default: CheckoutPage } = await import('../pages/CheckoutPage');

let fetchMock;
let hrefSet;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const calls = (fn) => fetchMock.mock.calls.filter(([url]) => url.endsWith(`/${fn}`)).map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
  hrefSet = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, set href(v) { hrefSet(v); }, get href() { return 'http://localhost/settings'; } },
  });
  getDocFromServerMock.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

const PREVIEW = { amountDue: 2000, currency: 'usd', prorationDate: 1800000000, currentPeriodEnd: 1801728000 };

function routeFetch(handlers) {
  fetchMock.mockImplementation(async (url, init) => {
    const fn = url.split('/').pop();
    const body = JSON.parse(init.body);
    return handlers[fn](body);
  });
}

describe('Starter → Pro', () => {
  it('preview, confirm with the preview date, then wait for the account to show Pro', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routeFetch({
      'change-plan': (b) => (b.action === 'preview' ? reply(200, PREVIEW) : reply(200, { status: 'upgraded' })),
    });
    const onChanged = vi.fn();
    render(<PlanActions plan="starter" onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(await screen.findByText(/You pay/)).toHaveTextContent('$20.00');
    expect(screen.getByRole('group', { name: 'Upgrade to Pro' })).toHaveTextContent('850 more enrichment credits');

    getDocFromServerMock
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ subscriptionTier: 'starter' }) })
      .mockResolvedValue({ exists: () => true, data: () => ({ subscriptionTier: 'pro' }) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm upgrade' })); });
    expect(calls('change-plan')).toEqual([{ action: 'preview' }, { action: 'upgrade', prorationDate: 1800000000 }]);
    expect(screen.getByText(/Upgrading to Pro/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS * 2); });
    expect(screen.getByText(/You are on Scout Pro/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("the bank wants confirmation: Stripe's invoice page, and the page keeps waiting", async () => {
    routeFetch({
      'change-plan': (b) => (b.action === 'preview' ? reply(200, PREVIEW) : reply(200, { status: 'payment_required', invoiceUrl: 'https://invoice.stripe.test/i_1' })),
    });
    render(<PlanActions plan="starter" />);
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm upgrade' }));
    const link = await screen.findByRole('link', { name: 'Confirm the payment' });
    expect(link).toHaveAttribute('href', 'https://invoice.stripe.test/i_1');
    expect(screen.getByRole('alert')).toHaveTextContent('You are still on Starter');
  });

  it('a refusal is explained and says nothing changed', async () => {
    routeFetch({ 'change-plan': () => reply(409, { error: 'subscription_canceling' }) });
    render(<PlanActions plan="starter" />);
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your plan is set to end');
  });

  it('confirmation slower than a minute says the payment went through and nothing will be charged again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routeFetch({ 'change-plan': (b) => (b.action === 'preview' ? reply(200, PREVIEW) : reply(200, { status: 'upgraded' })) });
    getDocFromServerMock.mockResolvedValue({ exists: () => true, data: () => ({ subscriptionTier: 'starter' }) });
    render(<PlanActions plan="starter" />);
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm upgrade' });
    await act(async () => { fireEvent.click(confirm); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UPGRADE_TIMEOUT_MS + UPGRADE_POLL_MS * 2); });
    expect(screen.getByRole('alert')).toHaveTextContent('you will not be charged again');
  });

  it('arriving with ?upgrade=pro opens the preview straight away', async () => {
    routeFetch({ 'change-plan': () => reply(200, PREVIEW) });
    render(<PlanActions plan="starter" autoOpenUpgrade />);
    expect(await screen.findByRole('button', { name: 'Confirm upgrade' })).toBeInTheDocument();
  });
});

describe('what each plan is offered', () => {
  it('Pro: Manage billing, no upgrade, and a way to ask for Starter', () => {
    render(<PlanActions plan="pro" />);
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.getByText(/Moving to Starter/)).toBeInTheDocument();
  });

  it('a Starter plan set to end: no upgrade until it is kept', () => {
    render(<PlanActions plan="starter" cancelAtPeriodEnd currentPeriodEnd="2026-12-01T00:00:00Z" />);
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
    expect(screen.getByText(/set to end/)).toBeInTheDocument();
  });

  it('Manage billing opens the Customer Portal', async () => {
    routeFetch({ 'create-portal-session': () => reply(200, { url: 'https://billing.stripe.test/p_1' }) });
    render(<PlanActions plan="starter" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Manage billing' })); });
    expect(hrefSet).toHaveBeenCalledWith('https://billing.stripe.test/p_1');
  });

  it('a portal that is not set up yet is explained', async () => {
    routeFetch({ 'create-portal-session': () => reply(503, { error: 'portal_not_configured' }) });
    render(<PlanActions plan="pro" />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not available yet');
  });
});

describe('Scout upgrade links never reach a second checkout', () => {
  function Where() {
    const { pathname, search } = useLocation();
    return <p data-testid="where">{pathname}{search}</p>;
  }
  const renderCheckout = (data, path) => render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/checkout" element={<CheckoutPage account={{ status: ACCOUNT.VERIFIED, data }} />} />
        <Route path="/settings" element={<p>Settings</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it('a Starter customer choosing Pro goes to the in-app upgrade', () => {
    renderCheckout({ hasCompletedPayment: true, subscriptionTier: 'starter' }, '/checkout?tier=pro');
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=billing&upgrade=pro');
  });

  it('any other paying customer goes to Billing', () => {
    renderCheckout({ hasCompletedPayment: true, subscriptionTier: 'pro' }, '/checkout?tier=pro');
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=billing');
    expect(screen.getByTestId('where')).not.toHaveTextContent('upgrade=pro');
  });
});
