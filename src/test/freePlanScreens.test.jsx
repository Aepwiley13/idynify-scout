/**
 * What a Free account sees: the in-app upgrade screen, and Settings → Billing.
 *
 * Settings → Billing must show Free only on the server's own answer, show "we couldn't confirm"
 * (and offer nothing to buy) when the plan can't be read, and never send a paying customer to a
 * second checkout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';

let nextSnapshot;
const getDocMock = vi.fn(async () => nextSnapshot());

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1', email: 'u1@example.test' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ path: args.slice(1).join('/') }),
  getDoc: (...args) => getDocMock(...args),
  getDocs: async () => ({ docs: [] }),
  collection: () => ({}),
  updateDoc: vi.fn(),
  writeBatch: () => ({ update: () => {}, commit: async () => {} }),
  serverTimestamp: () => null,
}));

vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../components/serviceProfiles/ServiceProfileSetup', () => ({ default: () => null }));
vi.mock('../utils/mfa', () => ({
  isMfaEnrolled: async () => false,
  getEnrolledFactors: async () => [],
  startTotpEnrollment: () => {}, completeTotpEnrollment: () => {}, unenrollFactor: () => {},
}));
vi.mock('../hooks/useUserPreference', () => ({
  useUserPreference: (_key, initial) => [initial, () => {}],
}));

const { default: UserSettings } = await import('../pages/UserSettings');
const { default: UpgradeRequired } = await import('../components/billing/UpgradeRequired');

const server = (data) => () => ({ exists: () => data !== null, data: () => data, metadata: { fromCache: false } });
const cacheOnly = (data) => () => ({ exists: () => data !== null, data: () => data, metadata: { fromCache: true } });

function renderBilling() {
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
  return render(
    <MemoryRouter initialEntries={['/settings?tab=billing']}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u1', uid: 'u1', email: 'u1@example.test' }} userData={{}}>
          <UserSettings />
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const checkoutLinks = () => screen.queryAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/checkout'));

beforeEach(() => {
  getDocMock.mockClear();
  localStorage.clear();
});

describe('Settings → Billing', () => {
  it('a Free account: Free, $0, both upgrades, no credit meter, no billing dates', async () => {
    nextSnapshot = server({ email: 'u1@example.test' });
    renderBilling();
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(checkoutLinks().map((a) => a.getAttribute('href'))).toEqual(['/checkout?tier=starter', '/checkout?tier=pro']);
    expect(screen.getByText('The Free plan has no enrichment credits')).toBeInTheDocument();
    expect(screen.queryByText('Billing dates')).not.toBeInTheDocument();
    expect(screen.queryByText('Credit usage')).not.toBeInTheDocument();
    expect(screen.getByText(/yours to keep on every plan/)).toBeInTheDocument();
  });

  it('a paying customer: their plan, and no link to a second checkout', async () => {
    nextSnapshot = server({ hasCompletedPayment: true, subscriptionTier: 'starter', credits: { total: 400, used: 10, remaining: 390, resetDate: null } });
    renderBilling();
    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Credit usage')).toBeInTheDocument();
    expect(checkoutLinks()).toEqual([]);
    // W3: the plan is changed on the existing subscription, and billing is managed in the
    // Customer Portal. Neither is a second checkout.
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });

  it('a Pro customer: Pro, and no link to a second checkout', async () => {
    nextSnapshot = server({ hasCompletedPayment: true, subscriptionTier: 'pro', credits: { total: 1250, used: 0, remaining: 1250, resetDate: null } });
    renderBilling();
    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(checkoutLinks()).toEqual([]);
  });

  it('a failed read: "couldn\'t confirm", no plan named, nothing to buy', async () => {
    nextSnapshot = () => { throw new Error('unavailable'); };
    renderBilling();
    expect(await screen.findByText('We couldn’t confirm your plan right now')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(screen.queryByText('Starter')).not.toBeInTheDocument();
    expect(checkoutLinks()).toEqual([]);
  });

  it('a cache-only unpaid copy is not Free either', async () => {
    nextSnapshot = cacheOnly({ hasCompletedPayment: false });
    renderBilling();
    expect(await screen.findByText('We couldn’t confirm your plan right now')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(checkoutLinks()).toEqual([]);
  });

  it('Try again reads again and shows the answer', async () => {
    nextSnapshot = () => { throw new Error('unavailable'); };
    renderBilling();
    const button = await screen.findByRole('button', { name: /try again/i });
    nextSnapshot = server({ email: 'u1@example.test' });
    await userEvent.setup().click(button);
    expect(await screen.findByText('Free')).toBeInTheDocument();
  });
});

describe('UpgradeRequired', () => {
  function renderUpgrade() {
    return render(
      <MemoryRouter>
        <ThemeProvider>
          <UpgradeRequired />
        </ThemeProvider>
      </MemoryRouter>,
    );
  }

  it('offers both paid plans through checkout, and a way back to Contact Hub', () => {
    renderUpgrade();
    expect(screen.getByRole('heading', { name: 'This is part of Scout' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose Scout Starter' }).getAttribute('href')).toBe('/checkout?tier=starter');
    expect(screen.getByRole('link', { name: 'Choose Scout Pro' }).getAttribute('href')).toBe('/checkout?tier=pro');
    expect(screen.getByRole('link', { name: /back to contact hub/i }).getAttribute('href')).toBe('/contact-hub');
  });

  it('tells a free customer their data stays free', () => {
    renderUpgrade();
    expect(screen.getByText(/Your contacts, stickers and notes stay free/)).toBeInTheDocument();
  });
});
