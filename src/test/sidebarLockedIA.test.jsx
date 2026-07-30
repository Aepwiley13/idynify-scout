/**
 * Sidebar — locked information architecture, rendered for real.
 *
 * Phase 2 acceptance criteria from the Sprint 1 brief, asserted against the
 * actual component rather than the model behind it:
 *
 *   - Mission Control stands alone at the top
 *   - Pipeline, Relationships and Intelligence are distinguishable groups
 *   - The active module is always clearly indicated
 *   - Current location remains clear on nested routes
 *   - Groups do not add interaction to hide a small number of items
 *   - Labels use locked vocabulary only
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';
import Sidebar from '../components/layout/Sidebar';

// The theme provider reads a stored preference through Firestore; the sidebar
// under test does not care which theme wins, so the read is stubbed out.
vi.mock('../firebase/config', () => ({
  auth: { currentUser: null, onAuthStateChanged: () => () => {} },
  db: {},
}));

function renderSidebar(path = '/mission-control-v2') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u-1' }} userData={{}}>
          <Sidebar />
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Sidebar — locked hierarchy', () => {
  it('renders the groups in the locked order', () => {
    renderSidebar();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const groupLabels = within(nav)
      .getAllByText(/^(PIPELINE|RELATIONSHIPS|INTELLIGENCE)$/)
      .map(el => el.textContent);

    expect(groupLabels).toEqual(['PIPELINE', 'RELATIONSHIPS', 'INTELLIGENCE']);
  });

  it('puts Mission Control above the groups, not inside one', () => {
    renderSidebar();

    const missionControl = screen.getByRole('button', { name: /^Mission Control$/ });
    expect(missionControl).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    expect(nav).not.toContainElement(missionControl);
  });

  it('shows every module with its locked label', () => {
    renderSidebar();

    for (const label of [
      'Scout', 'Hunter', 'Sniper',
      'Basecamp', 'Reinforcements', 'Fallback',
      'Recon',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }

    // The name this module must never be called again.
    expect(screen.queryByText(/homebase/i)).not.toBeInTheDocument();
  });

  it('does not hide group contents behind a disclosure control', () => {
    // "Groups do not add unnecessary interaction to hide a small number of
    // items." The previous sidebar had eight independently collapsible
    // pillars; all module links must be reachable without any interaction.
    renderSidebar();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const groupHeaders = within(nav).queryAllByRole('button', {
      name: /^(PIPELINE|RELATIONSHIPS|INTELLIGENCE)$/,
    });
    expect(groupHeaders).toHaveLength(0);
  });

  it('marks the active module', () => {
    renderSidebar('/scout');
    const scout = screen.getByRole('button', { name: /Scout/ });
    expect(scout).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the module marked active on a nested route', () => {
    // Pre-migration the sidebar was not rendered at all on module hubs, and
    // lost its highlight on detail pages — so "where am I" had no answer.
    renderSidebar('/scout/contact/abc123');

    const scout = screen.getByRole('button', { name: /Scout/ });
    expect(scout).toHaveAttribute('aria-current', 'page');

    const hunter = screen.getByRole('button', { name: /Hunter/ });
    expect(hunter).not.toHaveAttribute('aria-current');
  });

  it('offers Settings, Help / Support and Barry — and never logs the user out of reach', () => {
    renderSidebar('/scout');

    expect(screen.getByRole('button', { name: /^Settings$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /help and support/i })).toBeInTheDocument();

    // Barry is a control, not a destination: he must not appear as a module.
    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    expect(within(nav).queryByRole('button', { name: /barry/i })).toBeNull();
    expect(screen.getByRole('button', { name: /open barry/i })).toBeInTheDocument();
  });
});
