/**
 * Mobile navigation: the hamburger drawer and the More sheet.
 *
 * The bottom nav is deliberately not touched here — Scout · Hunter · Sniper ·
 * Basecamp · More is approved and unchanged, and a test asserting it stays
 * that way is below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';
import Sidebar from '../components/layout/Sidebar';
import MoreSheet from '../components/layout/MoreSheet';
import BottomNav from '../components/layout/BottomNav';
import { SIDEBAR_ORDER, sidebarDestinations } from '../constants/navigationModel';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1' }, signOut: vi.fn().mockResolvedValue(undefined), onAuthStateChanged: () => () => {} },
  db: {},
}));

const AARON = { email: 'aaron@idynify.com', firstName: 'Aaron', lastName: 'Wiley' };

function renderDrawer({ onClose = vi.fn(), onLogout = vi.fn() } = {}) {
  const utils = render(
    <MemoryRouter initialEntries={['/hunter']}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u1' }} userData={{}}>
          <Sidebar mobileMenuOpen onCloseMobileMenu={onClose} user={AARON} onLogout={onLogout} />
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return { ...utils, onClose, onLogout };
}

function renderMoreSheet(onClose = vi.fn()) {
  const utils = render(
    <MemoryRouter initialEntries={['/scout']}>
      <ThemeProvider>
        <MoreSheet isOpen onClose={onClose} />
      </ThemeProvider>
    </MemoryRouter>
  );
  return { ...utils, onClose };
}

beforeEach(() => { localStorage.clear(); });

describe('hamburger drawer', () => {
  it('lists every module, in the desktop sidebar order', () => {
    // Same component as the desktop sidebar, so the order cannot drift: this
    // asserts that is still true rather than re-listing the modules.
    renderDrawer();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const labels = within(nav).getAllByRole('button').map(b => b.textContent);

    expect(labels).toEqual(sidebarDestinations().map(d => d.label));
    expect(labels).toHaveLength(SIDEBAR_ORDER.length);
  });

  it('marks the module the user is actually in', () => {
    renderDrawer();
    const current = screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Hunter');
  });

  it('reaches Settings, Help and Log out — which the drawer is the only mobile route to', () => {
    // On desktop these are in the top bar's user menu. The drawer has no top
    // bar, so without them mobile has no route to any of the three.
    renderDrawer();

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('sends Help to the support address', () => {
    renderDrawer();
    expect(screen.getByRole('link', { name: 'Help' }))
      .toHaveAttribute('href', 'mailto:aaron@idynify.com?subject=Idynify%20Support%20Request');
  });

  it('shows who is signed in, by name', () => {
    renderDrawer();

    expect(screen.getByText('Aaron Wiley')).toBeInTheDocument();
    expect(screen.getByText('aaron@idynify.com')).toBeInTheDocument();
    expect(screen.getByText('AW')).toBeInTheDocument();
  });

  it('has a close control of its own', async () => {
    // A drawer whose only exit is the sliver of page still visible beside it
    // is a drawer people get stuck in.
    const user = userEvent.setup();
    const { onClose } = renderDrawer();

    await user.click(screen.getByRole('button', { name: /close navigation menu/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when a module is tapped', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();

    await user.click(screen.getByRole('button', { name: 'Sniper' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes before logging out', async () => {
    const user = userEvent.setup();
    const { onClose, onLogout } = renderDrawer();

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(onClose).toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('More sheet', () => {
  it('lists modules only — no sub-sections of other modules', async () => {
    // It used to also list Game (a Scout section) and Missions, Campaigns and
    // Cadences (Command Center sections). A sheet titled "All Modules" that
    // mixes modules with four arbitrary sub-sections of two of them teaches
    // the wrong shape of the product.
    renderMoreSheet();

    for (const gone of ['Game', 'Missions', 'Campaigns', 'Cadences']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('still reaches every module not in the bottom nav', () => {
    renderMoreSheet();

    for (const label of ['Recon', 'Reinforcements', 'Fallback', 'Command Center', 'Mission Control']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Barry')).toBeInTheDocument();
  });

  it('offers the theme as a toggle labelled with what it does', async () => {
    const user = userEvent.setup();
    renderMoreSheet();

    // Was "Light Mode" while in light mode — the current state, not the action.
    expect(screen.queryByText('Light Mode')).toBeNull();
    expect(screen.getByText('Dark mode')).toBeInTheDocument();

    await user.click(screen.getByText('Dark mode'));
    expect(localStorage.getItem('idynify_theme')).toBe('mission');
  });

  it('keeps Log out last and on its own', () => {
    renderMoreSheet();
    const logout = screen.getByRole('button', { name: /log out/i });

    expect(logout).toHaveClass('more-sheet-logout');
    // Outside the tile grids: it is not one more thing to navigate to.
    expect(logout.closest('.more-sheet-grid')).toBeNull();
  });
});

describe('bottom nav — unchanged', () => {
  it('is still Scout · Hunter · Sniper · Basecamp · More', () => {
    render(
      <MemoryRouter initialEntries={['/scout']}>
        <BottomNav onOpenMore={vi.fn()} />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(nav).getAllByRole('button').map(b => b.textContent))
      .toEqual(['Scout', 'Hunter', 'Sniper', 'Basecamp', 'More']);
  });
});
