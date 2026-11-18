/**
 * Billing Phase 1d: the real shell, rendered for a Free and for a paid account. Barry's panel is
 * replaced by a probe that records whether it mounted (the real one requests an opening brief
 * from the server as soon as it mounts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';

const { mounts } = vi.hoisted(() => ({ mounts: { barry: 0 } }));

vi.mock('../components/dashboard/BarryChatPanel', () => ({
  default: function BarryPanelProbe() { mounts.barry += 1; return <div data-testid="barry-panel" />; },
}));
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u-1', email: 'someone@example.test', getIdToken: async () => 'tok' }, onAuthStateChanged: () => () => {}, signOut: async () => {} },
  db: {},
}));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  const empty = { exists: () => false, data: () => undefined, docs: [], empty: true, forEach() {} };
  return {
    ...actual,
    doc: () => ({}), collection: () => ({}), query: () => ({}), where: () => ({}), orderBy: () => ({}), limit: () => ({}),
    getDoc: async () => empty, getDocs: async () => empty, onSnapshot: () => () => {},
    setDoc: async () => {}, updateDoc: async () => {}, addDoc: async () => ({ id: 'x' }), serverTimestamp: () => null,
  };
});

import MainLayout from '../components/layout/MainLayout';

const renderShell = (userData) => render(
  <MemoryRouter initialEntries={['/contact-hub']}>
    <ThemeProvider>
      <MainLayout user={{ uid: 'u-1', email: 'someone@example.test' }} userData={userData}>
        <div data-testid="page">Contact Hub</div>
      </MainLayout>
    </ThemeProvider>
  </MemoryRouter>,
);

beforeEach(() => { mounts.barry = 0; vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))); });

describe('MainLayout and Barry', () => {
  it('a Free account: the page renders, with no Barry control and no Barry panel', () => {
    renderShell({ email: 'free@example.test', createdAt: 1 });
    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open barry/i })).toBeNull();
    expect(screen.queryByTestId('barry-panel')).toBeNull();
    expect(mounts.barry).toBe(0);
  });

  it('a paid account: Barry as before', () => {
    renderShell({ email: 'paid@example.test', hasCompletedPayment: true, subscriptionTier: 'starter' });
    expect(screen.getByRole('button', { name: /open barry/i })).toBeInTheDocument();
    expect(screen.getByTestId('barry-panel')).toBeInTheDocument();
  });

  it('an admin without a subscription: Barry as before', () => {
    renderShell({ email: 'admin@example.test', role: 'admin' });
    expect(screen.getByTestId('barry-panel')).toBeInTheDocument();
  });
});
