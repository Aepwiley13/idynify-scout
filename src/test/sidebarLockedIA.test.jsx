/**
 * Sidebar — the global icon rail, rendered for real.
 *
 * Asserts the direction correction's Definition of Done: "the rail never
 * changes shape, width, or structure", the active module is always obvious,
 * and the locked information architecture survives the visual change.
 *
 * The grouping is now carried by dividers rather than text headers, so these
 * tests check DOM ORDER and accessible group names instead of visible
 * headings — the hierarchy has to hold even though the labels are gone.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';
import Sidebar from '../components/layout/Sidebar';
import { MODULES } from '../constants/navigationModel';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { email: 'aaron@idynify.com' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

function renderRail(path = '/mission-control-v2') {
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

describe('icon rail — locked hierarchy survives the visual change', () => {
  it('renders every destination in locked order', () => {
    renderRail();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const order = within(nav)
      .getAllByRole('button')
      .map(b => b.getAttribute('aria-label'));

    expect(order).toEqual([
      'Mission Control',
      'Scout', 'Hunter', 'Sniper',
      'Basecamp', 'Reinforcements', 'Fallback',
      'Recon',
    ]);
  });

  it('groups modules with accessible names, since the text headers are gone', () => {
    // Dividers communicate grouping visually. Screen readers get it from the
    // accessible name on each list — the non-visual equivalent of the header
    // that was removed, so the hierarchy is not purely decorative.
    renderRail();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    for (const group of ['pipeline', 'relationships', 'intelligence']) {
      expect(within(nav).getByRole('list', { name: group })).toBeInTheDocument();
    }
  });

  it('keeps Mission Control out of any group', () => {
    renderRail();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const pipeline = within(nav).getByRole('list', { name: 'pipeline' });
    const mc = within(nav).getByRole('button', { name: 'Mission Control' });

    expect(pipeline).not.toContainElement(mc);
  });

  it('uses the locked label as every item\'s accessible name', () => {
    renderRail();
    for (const mod of MODULES) {
      expect(screen.getByRole('button', { name: mod.label })).toBeInTheDocument();
    }
    expect(screen.queryByText(/homebase/i)).not.toBeInTheDocument();
  });
});

describe('icon rail — compact by construction', () => {
  it('shows no descriptive subtitles', () => {
    // The direction correction removes these explicitly. They were the main
    // reason the old sidebar needed 230px.
    renderRail('/scout');

    for (const text of [
      'Find and qualify prospects',
      'Engage and follow up',
      'Close deals',
      'Customer success and retention',
    ]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it('shows no permanent group headers', () => {
    renderRail();
    for (const header of ['PIPELINE', 'RELATIONSHIPS', 'INTELLIGENCE']) {
      expect(screen.queryByText(header)).not.toBeInTheDocument();
    }
  });

  it('labels the active item only', () => {
    renderRail('/scout');

    // Active item carries its short rail label...
    const scout = screen.getByRole('button', { name: 'Scout' });
    expect(within(scout).getByText('SCOUT')).toBeInTheDocument();

    // ...and inactive ones do not.
    const hunter = screen.getByRole('button', { name: 'Hunter' });
    expect(within(hunter).queryByText('HUNTER')).not.toBeInTheDocument();
  });

  it('gives every item a tooltip carrying the FULL locked label', () => {
    // "MC" is a display abbreviation for a 20px-wide slot, never an
    // alternative name — the tooltip must still say Mission Control.
    renderRail('/mission-control-v2');

    const mc = screen.getByRole('button', { name: 'Mission Control' });
    expect(within(mc).getByText('MC')).toBeInTheDocument();          // rail label
    expect(within(mc).getByText('Mission Control')).toBeInTheDocument(); // tooltip
  });

  it('has no collapse control — the rail cannot change width', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /expand sidebar/i })).toBeNull();
  });
});

describe('icon rail — active state', () => {
  it('marks the active module', () => {
    renderRail('/scout');
    expect(screen.getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the module active on a nested route', () => {
    renderRail('/scout/contact/abc123');

    expect(screen.getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Hunter' })).not.toHaveAttribute('aria-current');
  });

  it('marks exactly one item active at a time', () => {
    renderRail('/hunter');
    const current = screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('aria-label', 'Hunter');
  });
});

describe('icon rail — utility, Barry and account', () => {
  it('keeps Settings and Help reachable from every route', () => {
    renderRail('/scout');
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help / Support' })).toBeInTheDocument();
  });

  it('treats Barry as a control, not a destination', () => {
    renderRail('/scout');

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    expect(within(nav).queryByRole('button', { name: /barry/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Barry' })).toBeInTheDocument();
  });

  it('keeps theme switching available from the account menu', async () => {
    // Theme lived in the old text sidebar. The rail has no room for a theme
    // row, but the capability must not disappear with the redesign.
    const user = userEvent.setup();
    renderRail('/scout');

    expect(screen.queryByText(/appearance/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /account and appearance/i }));

    // Scoped to the menu: the email also appears in the account button's
    // tooltip, so an unscoped query legitimately matches twice.
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText(/appearance/i)).toBeInTheDocument();
    expect(within(menu).getByText('aaron@idynify.com')).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitemradio').length).toBeGreaterThan(0);
  });
});
