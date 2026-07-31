/**
 * Layer 1 — the wide sidebar, rendered for real.
 *
 * Asserts the final navigation brief: 220px, always visible, never collapses,
 * full text module names, active module as a filled violet pill, Barry as a
 * card at the bottom rather than a nav item, and the exact module order —
 * including Command Center, which was missing.
 *
 * The "what the sidebar does NOT have" list is tested as hard as the positive
 * spec, because every one of those items has been in this component at some
 * point during the navigation sprints.
 */

import { describe, it, expect, vi } from 'vitest';
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
    expect(within(card).getByText('AI SDR')).toBeInTheDocument();
    expect(within(card).getByText('Online')).toBeInTheDocument();
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

  it('has no collapse or expand control', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /expand sidebar/i })).toBeNull();
  });

  it('has no theme toggle — Settings owns Themes', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /theme/i })).toBeNull();
    expect(screen.queryByText(/appearance/i)).not.toBeInTheDocument();
  });
});
