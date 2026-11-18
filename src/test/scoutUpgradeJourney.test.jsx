/**
 * W1: a Free customer sees what Scout could do for a contact, upgrades, and comes back to that
 * contact after payment confirmation.
 *
 *   - the preview is built from the contact record only, and makes no request at all;
 *   - Upgrade to Scout offers a choice of plan, each going to the authenticated checkout with
 *     the contact as the place to return to;
 *   - the return path is checked: only an internal path of this app is ever followed;
 *   - checkout keeps it for the tab while the customer is on Stripe; the success page goes there
 *     only once the account says paid, and otherwise to its usual destination;
 *   - a paid account gets "Open in Scout"; an account whose plan is unknown is offered nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ACCOUNT } from '../utils/accountVerification';

const getDocFromServerMock = vi.fn();

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1', email: 'u1@example.test', getIdToken: async () => 'id-token-1' }, onAuthStateChanged: () => () => {} },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: vi.fn(),
  getDocFromServer: (...a) => getDocFromServerMock(...a),
  getDoc: async () => ({ exists: () => false, data: () => undefined }),
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));
// The Free plan on, as at launch: checkout's Back link leads back instead of signing out.
vi.mock('../constants/freePlan', async (importOriginal) => ({
  ...(await importOriginal()),
  FREE_PLAN: Object.freeze({ mode: 'on', enabled: true, signups: true }),
}));

const {
  safeReturnPath, checkoutPath, rememberCheckoutReturn, peekCheckoutReturn, clearCheckoutReturn,
  CHECKOUT_RETURN_KEY, CHECKOUT_RETURN_FALLBACK,
} = await import('../utils/checkoutReturn');
const { scoutOpportunityFor, listInWords, scoutContactPath } = await import('../utils/scoutOpportunity');
const { default: ScoutOpportunity } = await import('../components/billing/ScoutOpportunity');
const { AccountPlanContext } = await import('../components/billing/accountPlanContext');
const { default: CheckoutPage } = await import('../pages/CheckoutPage');
const { default: CheckoutSuccessPage } = await import('../pages/CheckoutSuccessPage');
const { default: CheckoutCancelPage } = await import('../pages/CheckoutCancelPage');
const { default: UpgradeRequired } = await import('../components/billing/UpgradeRequired');
const { ThemeProvider } = await import('../theme/ThemeContext');

const verified = (data) => ({ status: ACCOUNT.VERIFIED, data });
const FREE = verified({ email: 'u1@example.test' });
const PAID = verified({ hasCompletedPayment: true, subscriptionTier: 'starter', subscriptionStatus: 'active' });

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname}{search}</p>;
}

let fetchMock;
beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv('VITE_STRIPE_ENABLED', 'true');
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
  getDocFromServerMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ── The return path ─────────────────────────────────────────────────────────────────────────────

describe('safeReturnPath: only an internal path of this app', () => {
  it.each([
    ['/contact/c1', '/contact/c1'],
    ['/contact-hub/person/c%201', '/contact-hub/person/c%201'],
    ['/scout?tab=leads#top', '/scout?tab=leads#top'],
    ['/settings?tab=billing', '/settings?tab=billing'],
  ])('accepts %s', (input, output) => {
    expect(safeReturnPath(input)).toBe(output);
  });

  it.each([
    'https://evil.example/contact/c1', '//evil.example/x', '/\\evil.example', '\\\\evil', 'javascript:alert(1)',
    'contact/c1', '', ' /contact/c1', '/contact/c1\n', '/con\u0000tact', `/${'a'.repeat(600)}`,
    '/', '/checkout?tier=pro', '/checkout/success', '/login', '/signup?tier=pro', '/onboarding', null, undefined, 42,
  ])('refuses %j', (input) => {
    expect(safeReturnPath(input)).toBeNull();
  });

  it('checkoutPath carries a safe path, encoded, and drops an unsafe one', () => {
    expect(checkoutPath('pro', '/contact/c1')).toBe('/checkout?tier=pro&returnTo=%2Fcontact%2Fc1');
    expect(checkoutPath('starter', '//evil.example')).toBe('/checkout?tier=starter');
    expect(checkoutPath('gold', null)).toBe('/checkout?tier=starter');
  });

  it('remember / peek / clear, and a later checkout without a path forgets the old one', () => {
    rememberCheckoutReturn('/contact/c1', 'pro');
    expect(peekCheckoutReturn()).toEqual({ returnTo: '/contact/c1', tier: 'pro' });
    rememberCheckoutReturn(null);
    expect(peekCheckoutReturn()).toBeNull();
    rememberCheckoutReturn('/contact/c2');
    clearCheckoutReturn();
    expect(sessionStorage.getItem(CHECKOUT_RETURN_KEY)).toBeNull();
  });

  it('a tampered stored value is checked again on the way out', () => {
    sessionStorage.setItem(CHECKOUT_RETURN_KEY, JSON.stringify({ returnTo: '//evil.example', tier: 'pro' }));
    expect(peekCheckoutReturn()).toBeNull();
    sessionStorage.setItem(CHECKOUT_RETURN_KEY, 'not json');
    expect(peekCheckoutReturn()).toBeNull();
  });

  it('storage that throws never breaks checkout', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(rememberCheckoutReturn('/contact/c1', 'pro', broken)).toBe('/contact/c1');
    expect(peekCheckoutReturn(broken)).toBeNull();
    expect(() => clearCheckoutReturn(broken)).not.toThrow();
  });
});

// ── Through checkout and back ───────────────────────────────────────────────────────────────────

describe('/checkout keeps where the upgrade started', () => {
  const renderCheckout = (path) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/checkout" element={<CheckoutPage account={FREE} />} /></Routes>
    </MemoryRouter>,
  );

  it('a safe returnTo is kept with the plan, and Back goes there', () => {
    renderCheckout('/checkout?tier=pro&returnTo=%2Fcontact%2Fc1');
    expect(peekCheckoutReturn()).toEqual({ returnTo: '/contact/c1', tier: 'pro' });
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/contact/c1');
  });

  it('an unsafe returnTo is ignored and an older one forgotten', () => {
    rememberCheckoutReturn('/contact/old', 'starter');
    renderCheckout('/checkout?tier=pro&returnTo=https%3A%2F%2Fevil.example');
    expect(peekCheckoutReturn()).toBeNull();
  });
});

describe('/checkout/success returns the customer once the account says paid', () => {
  const renderSuccess = (account) => render(
    <MemoryRouter initialEntries={['/checkout/success']}>
      <Where />
      <Routes>
        <Route path="/checkout/success" element={<CheckoutSuccessPage account={account} onRecheckAccount={vi.fn()} />} />
        <Route path="/contact/:contactId" element={<p>Scout contact page</p>} />
        <Route path="/onboarding" element={<p>Onboarding</p>} />
        <Route path="/contact-hub" element={<p>Contact Hub</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it('paid, with a kept contact: back to that contact in Scout, and the kept path is cleared', async () => {
    vi.useFakeTimers();
    rememberCheckoutReturn('/contact/c1', 'starter');
    renderSuccess(PAID);
    expect(screen.getByText('Taking you back to where you were…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByTestId('where')).toHaveTextContent('/contact/c1');
    expect(peekCheckoutReturn()).toBeNull();
  });

  it('a paid signup, nothing kept: onboarding as before', async () => {
    vi.useFakeTimers();
    renderSuccess(verified({ ...PAID.data, selectedTier: 'starter' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByTestId('where')).toHaveTextContent(CHECKOUT_RETURN_FALLBACK);
  });

  it('started Free, nothing kept (upgraded from Settings): back to Contact Hub, no second onboarding', async () => {
    vi.useFakeTimers();
    renderSuccess(PAID);
    expect(screen.getByText('Taking you back to where you were…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByTestId('where')).toHaveTextContent('/contact-hub');
  });

  it('not paid yet: it goes nowhere, whatever was kept', async () => {
    vi.useFakeTimers();
    getDocFromServerMock.mockResolvedValue({ exists: () => true, data: () => ({ hasCompletedPayment: false }) });
    rememberCheckoutReturn('/contact/c1', 'starter');
    renderSuccess(FREE);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByTestId('where')).toHaveTextContent('/checkout/success');
    expect(peekCheckoutReturn()).toEqual({ returnTo: '/contact/c1', tier: 'starter' });
  });
});

describe('/checkout/cancel', () => {
  const renderCancel = () => render(
    <MemoryRouter initialEntries={['/checkout/cancel']}>
      <Where />
      <Routes>
        <Route path="/checkout/cancel" element={<CheckoutCancelPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it('offers the way back, and Try Again keeps the plan and the place', () => {
    rememberCheckoutReturn('/contact/c1', 'pro');
    renderCancel();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByTestId('where')).toHaveTextContent('/checkout?tier=pro&returnTo=%2Fcontact%2Fc1');
  });

  it('Back to where you were goes there and forgets it', () => {
    rememberCheckoutReturn('/contact/c1', 'pro');
    renderCancel();
    fireEvent.click(screen.getByRole('button', { name: /back to where you were/i }));
    expect(screen.getByTestId('where')).toHaveTextContent('/contact/c1');
    expect(peekCheckoutReturn()).toBeNull();
  });

  it('nothing kept: as before', () => {
    renderCancel();
    expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
  });
});

// ── The preview on the person page ──────────────────────────────────────────────────────────────

const PERSON = { id: 'c1', name: 'Ana Lopez', company_name: 'Acme', title: 'CEO' };
const COMPLETE = { ...PERSON, email: 'ana@acme.test', phone: '801-555-0101', linkedin_url: 'https://linkedin.com/in/ana' };

const renderPreview = (plan, contact = PERSON) => render(
  <MemoryRouter>
    <ThemeProvider>
      <AccountPlanContext.Provider value={plan}>
        <ScoutOpportunity contact={contact} />
      </AccountPlanContext.Provider>
    </ThemeProvider>
  </MemoryRouter>,
);

describe('scoutOpportunityFor: from the record only', () => {
  it('names what is missing, in order', () => {
    expect(scoutOpportunityFor(PERSON).missing.map((m) => m.id)).toEqual(['email', 'phone', 'linkedin']);
    expect(scoutOpportunityFor(COMPLETE).missing).toEqual([]);
    expect(scoutOpportunityFor(null)).toBeNull();
    expect(listInWords(['email', 'phone number', 'LinkedIn profile'])).toBe('email, phone number and LinkedIn profile');
    expect(scoutContactPath('a b')).toBe('/contact/a%20b');
  });
});

describe('ScoutOpportunity', () => {
  it('Free: what Scout would look up, and Upgrade to Scout with a choice of plan returning to this contact', () => {
    renderPreview('free');
    expect(screen.getByRole('heading', { name: 'Scout can fill in the rest' })).toBeInTheDocument();
    expect(screen.getByText(/Ana Lopez has no email, phone number and LinkedIn profile on file/)).toBeInTheDocument();
    expect(screen.getByText(/find more people at Acme/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Choose a plan' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Scout' }));
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/checkout?tier=starter&returnTo=%2Fcontact%2Fc1', '/checkout?tier=pro&returnTo=%2Fcontact%2Fc1']);
    expect(screen.getByText(/stickers and notes stay exactly as they are/)).toBeInTheDocument();
  });

  it('Free: showing it makes no request of any kind', () => {
    renderPreview('free');
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Scout' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDocFromServerMock).not.toHaveBeenCalled();
  });

  it('a complete record: Scout can still find more people', () => {
    renderPreview('free', COMPLETE);
    expect(screen.getByRole('heading', { name: 'Find more people with Scout' })).toBeInTheDocument();
  });

  it('paid: Open in Scout, the same contact, and no purchase', () => {
    renderPreview('starter');
    expect(screen.getByRole('link', { name: 'Open in Scout' })).toHaveAttribute('href', '/contact/c1');
    expect(screen.queryByRole('button', { name: 'Upgrade to Scout' })).toBeNull();
  });

  it('plan unknown: nothing is offered', () => {
    const { container } = renderPreview('unknown');
    expect(container.textContent).toBe('');
  });
});

describe("Scout's upgrade screen returns to the page that was opened", () => {
  it('each plan carries the Scout page as the place to return to', () => {
    render(
      <MemoryRouter initialEntries={['/scout?tab=leads']}>
        <ThemeProvider><UpgradeRequired /></ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Choose Scout Starter' })).toHaveAttribute('href', '/checkout?tier=starter&returnTo=%2Fscout%3Ftab%3Dleads');
  });
});

describe('the shell provides the plan', () => {
  it("ShellAccountGate hands its verified account's plan to the screens inside it", async () => {
    const { ShellAccountGate } = await import('../components/billing/freePlanRouting');
    const { useAccountPlan } = await import('../components/billing/accountPlanContext');
    function Probe() { return <p data-testid="plan">{useAccountPlan()}</p>; }
    const renderAt = (account) => render(
      <MemoryRouter initialEntries={['/contact-hub/person/c1']}>
        <ShellAccountGate loading={false} user={{ uid: 'u1' }} account={account} requirePayment={false} layout={(c) => c} loadingScreen={<p>loading</p>}>
          <Probe />
        </ShellAccountGate>
      </MemoryRouter>,
    );
    const { unmount } = renderAt(FREE);
    expect(screen.getByTestId('plan')).toHaveTextContent('free');
    unmount();
    renderAt(PAID);
    expect(screen.getByTestId('plan')).toHaveTextContent('starter');
  });
});
