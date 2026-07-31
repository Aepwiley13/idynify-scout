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
import ModuleMoreSheet from '../components/layout/ModuleMoreSheet';
import { MODULE_COLORS } from '../constants/mobileNavigation';
import { SIDEBAR_ORDER, sidebarDestinations } from '../constants/navigationModel';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1' }, signOut: vi.fn().mockResolvedValue(undefined), onAuthStateChanged: () => () => {} },
  db: {},
}));

const AARON = { email: 'aaron@idynify.com', firstName: 'Aaron', lastName: 'Wiley' };

/**
 * jsdom has no matchMedia, and the sidebar now BUILDS one arrangement or the
 * other rather than hiding one with CSS — so a mobile test that does not say
 * it is mobile silently renders the desktop nav and asserts nothing it means to.
 */
function setViewport(mobile) {
  window.matchMedia = (q) => ({
    matches: mobile, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

function renderDrawer({ onClose = vi.fn(), onLogout = vi.fn() } = {}) {
  setViewport(true);
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
  it('lists every module, grouped by what the platform actually is', () => {
    // Desktop draws a flat list — the final nav brief calls the grouping an
    // architectural decision, not a visual one in that sidebar style. The
    // drawer is the ONLY place modules are listed on mobile, so it is where
    // the shape has to be legible.
    renderDrawer();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const labels = within(nav).getAllByRole('button').map(b => b.textContent);

    expect(labels).toEqual([
      'Mission Control',
      'Scout', 'Hunter', 'Sniper',
      'Basecamp', 'Reinforcements', 'Fallback',
      'Recon',
      'Command Center',
    ]);

    // Same destinations as desktop, different arrangement — nothing dropped.
    expect([...labels].sort()).toEqual(sidebarDestinations().map(d => d.label).sort());
    expect(labels).toHaveLength(SIDEBAR_ORDER.length);
  });

  it('labels the groups, and makes none of them tappable', () => {
    // A group describes the platform. It is not a destination, and a heading
    // that looks tappable but is not is worse than no heading.
    renderDrawer();
    const nav = screen.getByRole('navigation', { name: /global navigation/i });

    for (const group of ['PIPELINE', 'RELATIONSHIPS', 'INTELLIGENCE']) {
      const el = within(nav).getByText(group);
      expect(el.tagName).not.toBe('BUTTON');
      expect(el.closest('button')).toBeNull();
    }
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

describe('bottom bar — module sections, not modules', () => {
  function renderBar(at) {
    return render(
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>
          <BottomNav onOpenMore={vi.fn()} />
        </ThemeProvider>
      </MemoryRouter>
    );
  }

  const labels = () =>
    within(screen.getByRole('navigation')).getAllByRole('button').map(b => b.textContent);

  it('shows the current module\'s sections', () => {
    // The whole correction in one assertion. This bar used to read
    // Scout · Hunter · Sniper · Basecamp · More on every screen in the
    // product — the hamburger's job, done twice.
    renderBar('/hunter?tab=all');
    expect(labels()).toEqual(['Blitz', 'All People', 'Companies', 'Follow Up', 'More']);
  });

  it('changes with the module', () => {
    renderBar('/scout?tab=daily-leads');
    expect(labels()).toEqual(['Daily', 'Saved', 'People', 'Scout+', 'More']);
  });

  it('shows no More cell for a module whose sections all fit', () => {
    // Basecamp has exactly four. A More that opens an empty sheet is worse
    // than no More.
    renderBar('/basecamp?tab=people');
    expect(labels()).toEqual(['People', 'Companies', 'Engage', 'CSM']);
  });

  it('never lists another module', () => {
    renderBar('/sniper?tab=people');
    for (const other of ['Scout', 'Hunter', 'Basecamp', 'Recon', 'Fallback']) {
      expect(labels()).not.toContain(other);
    }
  });

  it('falls back to the module list where there are no sections to show', () => {
    // Mission Control is a single scrolling dashboard with nothing to switch
    // between — see the note in constants/mobileNavigation.
    renderBar('/mission-control-v2');
    expect(labels()).toEqual(['Scout', 'Hunter', 'Sniper', 'Basecamp', 'More']);
  });

  it('marks the section from the URL', () => {
    renderBar('/hunter?tab=companies');
    const current = within(screen.getByRole('navigation'))
      .getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Companies');
  });

  it('marks the default section on a bare module URL', () => {
    // /hunter with no ?tab= renders Hunter's default view. An unlit bar reads
    // as "you are nowhere".
    renderBar('/hunter');
    const current = within(screen.getByRole('navigation'))
      .getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('All People');
  });

  it('resolves path-based sections too, longest match winning', () => {
    // Recon navigates by real path. /recon/messaging must not also light
    // Overview, whose path is a prefix of every Recon route.
    renderBar('/recon/messaging');
    const current = within(screen.getByRole('navigation'))
      .getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Messaging');
  });

  it('tints the active section with the module colour', () => {
    renderBar('/hunter?tab=all');
    const active = within(screen.getByRole('navigation'))
      .getAllByRole('button').find(b => b.getAttribute('aria-current') === 'page');

    expect(active).toHaveStyle({ color: MODULE_COLORS.hunter });
  });

  it('names itself for the module, so the bar is not "Main navigation" everywhere', () => {
    renderBar('/sniper?tab=people');
    expect(screen.getByRole('navigation', { name: /sniper sections/i })).toBeInTheDocument();
  });
});

describe('the two More surfaces stay distinct', () => {
  function renderModuleMore(at) {
    return render(
      <MemoryRouter initialEntries={[at]}>
        <ThemeProvider>
          <ModuleMoreSheet isOpen onClose={vi.fn()} />
        </ThemeProvider>
      </MemoryRouter>
    );
  }

  it('shows only the current module\'s overflow sections', () => {
    renderModuleMore('/hunter?tab=all');
    const sheet = screen.getByRole('dialog');

    expect(within(sheet).getAllByRole('button').map(b => b.textContent))
      .toEqual(['', "Today's Actions", 'Replied', 'Active', 'New (Unengaged)']);
  });

  it('contains no module names at all', () => {
    // Acceptance criterion 7. If a module name appears here the user has two
    // ways to change workspace and no way to tell them apart.
    renderModuleMore('/scout?tab=daily-leads');
    const sheet = screen.getByRole('dialog');

    for (const module of ['Hunter', 'Sniper', 'Basecamp', 'Recon', 'Reinforcements',
                          'Fallback', 'Command Center', 'Mission Control']) {
      expect(within(sheet).queryByText(module)).toBeNull();
    }
  });

  it('is titled with the module, where the global sheet says "All Modules"', () => {
    renderModuleMore('/recon');
    expect(within(screen.getByRole('dialog')).getByText('Recon')).toBeInTheDocument();
  });

  it('does not open for a module with nothing to overflow', () => {
    const { container } = renderModuleMore('/basecamp?tab=people');
    expect(container).toBeEmptyDOMElement();
  });
});
