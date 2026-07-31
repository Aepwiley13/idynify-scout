/**
 * Layer 1 — the sidebar, rendered for real.
 *
 * Wide by default: 220px, full text module names, active module as a filled
 * violet pill, Barry as a card at the bottom, and the exact module order
 * including Command Center. Compact mode is 64px with icon + short label.
 *
 * The "what the sidebar does NOT have" list is tested as hard as the positive
 * spec, because every one of those items has been in this component at some
 * point across these navigation sprints — group headers, subtitles and the
 * theme toggle each shipped once and were each removed by a later brief.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import { ShellProvider } from '../context/ShellContext';
import Sidebar from '../components/layout/Sidebar';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { email: 'aaron@idynify.com' }, onAuthStateChanged: () => () => {} },
  db: {},
}));

beforeEach(() => { localStorage.clear(); });

function renderSidebar(path = '/mission-control-v2', props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u-1' }} userData={{}}>
          <Sidebar {...props} />
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('wide sidebar — module list', () => {
  it('renders every destination in the exact locked order', () => {
    renderSidebar();

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const order = within(nav).getAllByRole('button').map(b => b.textContent);

    expect(order).toEqual([
      'Mission Control',
      'Scout',
      'Hunter',
      'Sniper',
      'Basecamp',
      'Recon',
      'Reinforcements',
      'Fallback',
      'Command Center',
    ]);
  });

  it('includes Command Center, which the rail was missing', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Command Center' })).toBeInTheDocument();
  });

  it('shows full text names, not icon-only', () => {
    renderSidebar();
    for (const label of ['Mission Control', 'Scout', 'Hunter', 'Sniper', 'Basecamp',
                         'Recon', 'Reinforcements', 'Fallback', 'Command Center']) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });
});

describe('wide sidebar — active state', () => {
  it('marks the active module', () => {
    renderSidebar('/scout');
    const scout = screen.getByRole('button', { name: 'Scout' });
    expect(scout).toHaveAttribute('aria-current', 'page');
    expect(scout).toHaveClass('active');
  });

  it('keeps the module active on a nested route', () => {
    renderSidebar('/scout/contact/abc123');
    expect(screen.getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Hunter' })).not.toHaveAttribute('aria-current');
  });

  it('marks exactly one module at a time', () => {
    renderSidebar('/command-center');
    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    const current = within(nav).getAllByRole('button')
      .filter(b => b.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Command Center');
  });
});

describe('wide sidebar — wordmark', () => {
  it('sits at the top and returns to Mission Control', async () => {
    const user = userEvent.setup();
    renderSidebar('/scout');

    const wordmark = screen.getByRole('button', { name: /idynify/i });
    expect(wordmark).toBeInTheDocument();

    await user.click(wordmark);
    expect(screen.getByRole('button', { name: 'Mission Control' })).toHaveAttribute('aria-current', 'page');
  });

  it('falls back to a text wordmark when the asset does not load', () => {
    // /assets/Idynify_logo1.png is not in this repository. Without a fallback
    // the top of the sidebar is simply blank wherever the asset is not
    // deployed — which is every environment this has run in so far.
    //
    // The error is fired explicitly: jsdom never loads images, so onError
    // does not fire on its own and the fallback would otherwise go untested.
    renderSidebar();

    const img = document.querySelector('.sidebar-wordmark-img');
    expect(img).not.toBeNull();

    fireEvent.error(img);

    expect(document.querySelector('.sidebar-wordmark-img')).toBeNull();
    expect(screen.getByRole('button', { name: /idynify/i })).toHaveTextContent(/idynify/i);
  });
});

describe('wide sidebar — Barry card', () => {
  it('renders Barry as a card, not a nav item', () => {
    renderSidebar('/scout');

    const nav = screen.getByRole('navigation', { name: /global navigation/i });
    expect(within(nav).queryByText(/barry/i)).toBeNull();

    const card = screen.getByRole('button', { name: /open barry/i });
    expect(within(card).getByText('Barry')).toBeInTheDocument();
  });

  it('shows only the name and the chevron — no role label, no status', () => {
    renderSidebar('/scout');
    const card = screen.getByRole('button', { name: /open barry/i });

    expect(within(card).queryByText('AI SDR')).toBeNull();
    expect(within(card).queryByText('Online')).toBeNull();
  });

  it('opens the Barry overlay rather than navigating', async () => {
    const user = userEvent.setup();
    const onToggleBarry = vi.fn();
    renderSidebar('/scout', { onToggleBarry });

    await user.click(screen.getByRole('button', { name: /open barry/i }));

    expect(onToggleBarry).toHaveBeenCalledTimes(1);
    // Barry is a persistent overlay, never a destination — the active module
    // must be untouched by opening him.
    expect(screen.getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('wide sidebar — what it must NOT have', () => {
  it('has no group headers', () => {
    renderSidebar();
    for (const header of ['PIPELINE', 'RELATIONSHIPS', 'INTELLIGENCE']) {
      expect(screen.queryByText(header)).not.toBeInTheDocument();
    }
  });

  it('has no descriptive subtitles under module names', () => {
    renderSidebar('/scout');
    for (const text of [
      'Find and qualify prospects',
      'Engage and follow up',
      'Close deals',
      'Customer success and retention',
    ]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it('has no theme toggle — Settings owns Themes', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /theme/i })).toBeNull();
    expect(screen.queryByText(/appearance/i)).not.toBeInTheDocument();
  });
});

describe('sidebar toggle — wide ↔ compact', () => {
  it('defaults to wide', () => {
    const { container } = renderSidebar();
    expect(container.querySelector('.sidebar.wide')).not.toBeNull();
    expect(container.querySelector('.sidebar.compact')).toBeNull();
  });

  it('collapses to compact and expands back', async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar();

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    expect(container.querySelector('.sidebar.compact')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /expand sidebar/i }));
    expect(container.querySelector('.sidebar.wide')).not.toBeNull();
  });

  it('shows short labels in compact but keeps the full accessible name', async () => {
    const user = userEvent.setup();
    renderSidebar('/scout');

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }));

    // Visible label shortens...
    expect(screen.getByText('MC')).toBeInTheDocument();
    // ...while the name screen readers and tests use does not, so "MC" is
    // never the only name on offer.
    expect(screen.getByRole('button', { name: 'Mission Control' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Command Center' })).toBeInTheDocument();
  });

  it('keeps the active module marked in compact', async () => {
    const user = userEvent.setup();
    renderSidebar('/scout');

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    expect(screen.getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-current', 'page');
  });

  it('drops Barry to an icon in compact', async () => {
    const user = userEvent.setup();
    renderSidebar('/scout');

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }));

    const card = screen.getByRole('button', { name: /open barry/i });
    expect(card).toBeInTheDocument();
    expect(within(card).queryByText('Barry')).toBeNull();
  });

  it('remembers the mode across a remount', async () => {
    const user = userEvent.setup();
    const first = renderSidebar();

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    first.unmount();

    const second = renderSidebar();
    expect(second.container.querySelector('.sidebar.compact')).not.toBeNull();
  });
});
