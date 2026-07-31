/**
 * Scout's module sub-nav panel.
 *
 * Scout briefly used a horizontal tab bar across the top of its content area.
 * The direction correction replaced it with the expandable left panel that
 * Hunter, Sniper, Basecamp, Reinforcements, Recon and Fallback already ship.
 * These tests pin the panel down so the tab bar cannot come back by accident.
 *
 * Scout's view components are mocked: this is a test of the navigation layer,
 * and the real ones each open Firestore connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'u1', email: 'aaron@idynify.com' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

vi.mock('../pages/Scout/DailyLeads', () => ({ default: () => <div data-testid="view">daily</div> }));
vi.mock('../pages/Scout/SavedCompanies', () => ({ default: () => <div data-testid="view">saved</div> }));
vi.mock('../pages/Scout/AllLeads', () => ({ default: () => <div data-testid="view">people</div> }));
vi.mock('../pages/Scout/CompanyProfileView', () => ({ default: () => <div data-testid="view">company</div> }));
vi.mock('../pages/Scout/ScoutPlus', () => ({ default: () => <div data-testid="view">scoutplus</div> }));
vi.mock('../pages/Scout/ICPSettings', () => ({ default: () => <div data-testid="view">icp</div> }));
vi.mock('../pages/Scout/CadencesList', () => ({ default: () => <div data-testid="view">cadences</div> }));

const { default: ScoutMain } = await import('../pages/Scout/ScoutMain');

function renderScout(path = '/scout') {
  // The panel is desktop-only; the mobile branch keeps its own layout.
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u1' }} userData={{}}>
          <Routes>
            <Route path="/scout" element={<ScoutMain />} />
          </Routes>
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('Scout sub-nav panel', () => {
  it('renders an expandable left panel, not a horizontal tab bar', () => {
    const { container } = renderScout();

    expect(screen.getByRole('complementary', { name: /scout sections/i })).toBeInTheDocument();
    // The tab strip this replaced.
    expect(container.querySelector('.scout-views')).toBeNull();
    expect(container.querySelector('.scout-view-tab')).toBeNull();
  });

  it('names the module and its purpose in the panel header', () => {
    renderScout();
    const panel = screen.getByRole('complementary', { name: /scout sections/i });

    expect(within(panel).getByText('SCOUT')).toBeInTheDocument();
    expect(within(panel).getByText('Find and qualify prospects')).toBeInTheDocument();
  });

  it('lists every Scout section in order', () => {
    renderScout();
    const panel = screen.getByRole('complementary', { name: /scout sections/i });

    const labels = within(panel)
      .getAllByRole('button')
      .map(b => b.textContent)
      .filter(t => t && !/^$/.test(t));

    // Header collapse control is a button too — drop it by matching on the
    // section labels themselves.
    for (const section of [
      'Daily Discoveries', 'People', 'Saved Companies', 'Scout+',
      'Cadences', 'Total Market', 'ICP Settings', 'Game Mode',
    ]) {
      expect(labels.some(l => l.startsWith(section))).toBe(true);
    }
  });

  it('shows a short description under each section, as the other modules do', () => {
    renderScout();
    const panel = screen.getByRole('complementary', { name: /scout sections/i });

    expect(within(panel).getByText('Review queue')).toBeInTheDocument();
    expect(within(panel).getByText('My leads')).toBeInTheDocument();
    expect(within(panel).getByText('Targeting criteria')).toBeInTheDocument();
  });

  it('marks the active section', () => {
    renderScout('/scout?tab=all-leads');
    const panel = screen.getByRole('complementary', { name: /scout sections/i });

    const active = within(panel).getAllByRole('button')
      .filter(b => b.getAttribute('aria-current') === 'true');

    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('People');
  });

  it('collapses and expands, and remembers the choice', async () => {
    const user = userEvent.setup();
    const { container, unmount } = renderScout();

    expect(container.querySelector('.module-subnav.collapsed')).toBeNull();

    await user.click(screen.getByRole('button', { name: /collapse scout sections/i }));
    expect(container.querySelector('.module-subnav.collapsed')).not.toBeNull();
    expect(localStorage.getItem('scout_subnav_collapsed')).toBe('true');

    await user.click(screen.getByRole('button', { name: /expand scout sections/i }));
    expect(container.querySelector('.module-subnav.collapsed')).toBeNull();

    // Survives a remount — the panel state belongs to the user, not the route.
    await user.click(screen.getByRole('button', { name: /collapse scout sections/i }));
    unmount();

    const second = renderScout();
    expect(second.container.querySelector('.module-subnav.collapsed')).not.toBeNull();
  });

  it('leaves identity to the shell rail — no duplicate user footer', () => {
    // The other modules put an email in their panel footer because they are
    // self-contained shells. Scout is not: the rail owns the account, and
    // repeating it here would be the duplication the shell work removed.
    renderScout();
    const panel = screen.getByRole('complementary', { name: /scout sections/i });
    expect(within(panel).queryByText('aaron@idynify.com')).toBeNull();
  });
});
