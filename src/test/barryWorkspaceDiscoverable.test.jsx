/**
 * #005.5 — the full Barry workspace (/barry) can be found from Barry's panel.
 *
 * Before, /barry was reachable only from first run or a typed URL. The panel now
 * has "Open the full Barry workspace". It lives inside the panel, which is only
 * mounted for accounts with Barry access, so access is unchanged: a Free account
 * gets neither the panel nor the control (and /barry keeps its own payment gate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';

vi.mock('../components/dashboard/BarryChatPanel', () => ({
  default: function BarryPanelProbe() { return <div data-testid="barry-panel" />; },
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

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
const renderShell = (userData) => render(
  <MemoryRouter initialEntries={['/hunter']}>
    <ThemeProvider>
      <MainLayout user={{ uid: 'u-1', email: 'someone@example.test' }} userData={userData}>
        <Where />
      </MainLayout>
    </ThemeProvider>
  </MemoryRouter>,
);

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))); });

describe('opening the full Barry workspace', () => {
  it('a paid account: open the panel, then "Open the full Barry workspace" goes to /barry and closes the panel', () => {
    renderShell({ email: 'paid@example.test', hasCompletedPayment: true, subscriptionTier: 'starter' });
    fireEvent.click(screen.getByRole('button', { name: /^open barry$/i }));
    const expand = screen.getByRole('button', { name: 'Open the full Barry workspace' });
    fireEvent.click(expand);
    expect(screen.getByTestId('where').textContent).toBe('/barry');
    expect(screen.queryByRole('button', { name: 'Open the full Barry workspace' })).toBeNull();
  });

  it('while the panel is closed, the control is hidden from assistive tech', () => {
    renderShell({ email: 'paid@example.test', hasCompletedPayment: true, subscriptionTier: 'starter' });
    expect(screen.queryByRole('button', { name: 'Open the full Barry workspace' })).toBeNull();
  });

  it('a Free account: no panel and no control, so access is unchanged', () => {
    renderShell({ email: 'free@example.test', createdAt: 1 });
    expect(screen.queryByTestId('barry-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the full Barry workspace', hidden: true })).toBeNull();
  });
});
