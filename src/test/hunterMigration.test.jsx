/**
 * Hunter, migrated into the global shell.
 *
 * Hunter used to be a self-contained application shell: its own 60px icon rail
 * listing every module, its own theme picker, settings button, "back to
 * Mission Control" button, user footer and Barry instance. Entering Hunter
 * replaced the whole application chrome and leaving it replaced it again.
 *
 * These tests pin down that none of it comes back, and that Hunter's sections
 * survived the move intact — the brief is explicit that the sections do not
 * change, only where the chrome comes from.
 *
 * Hunter's views are mocked: this is a test of the navigation layer, and the
 * real ones open Firestore connections.
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

vi.mock('../pages/Scout/AllLeads', () => ({ default: () => <div data-testid="view">leads</div> }));
vi.mock('../components/shared/SharedCompaniesView', () => ({ default: () => <div data-testid="view">companies</div> }));

const { default: HunterMain } = await import('../pages/Hunter/HunterMain');

function renderHunter(path = '/hunter') {
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
            <Route path="/hunter" element={<HunterMain />} />
          </Routes>
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => { localStorage.clear(); });

describe('Hunter — chrome surrendered to the shell', () => {
  it('renders no module rail of its own', () => {
    const { container } = renderHunter();

    // The rail listed every module; the sidebar owns that now.
    for (const label of ['SCOUT', 'SNIPER', 'BASECAMP', 'REINFORCEMENTS', 'FALLBACK']) {
      expect(within(container).queryByText(label)).toBeNull();
    }
  });

  it('mounts no Barry of its own', () => {
    // Hunter used to mount BarryChat with its own conversation thread, keyed
    // drawer_hunter. Barry is the shell's now: one instance, one thread.
    const { container } = renderHunter();
    expect(within(container).queryByText(/barry/i)).toBeNull();
  });

  it('renders no settings, home or user-footer controls', () => {
    const { container } = renderHunter();
    expect(within(container).queryByText('aaron@idynify.com')).toBeNull();
    expect(within(container).queryByTitle('Mission Control')).toBeNull();
  });
});

describe('Hunter — sub-nav', () => {
  it('uses the shared panel, not a local copy', () => {
    const { container } = renderHunter();

    expect(screen.getByRole('complementary', { name: /hunter sections/i })).toBeInTheDocument();
    // Same class contract as Scout's, because it is literally the same
    // component — this is what stops the two drifting apart.
    expect(container.querySelector('.module-subnav')).not.toBeNull();
    expect(container.querySelector('.module-shell')).not.toBeNull();
  });

  it('keeps every existing section and description', () => {
    renderHunter();
    const panel = screen.getByRole('complementary', { name: /hunter sections/i });

    for (const section of [
      'Blitz Mode', 'All People', 'Companies', 'Follow Up Now',
      "Today's Actions", 'Replied', 'Active', 'New (Unengaged)',
    ]) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }

    expect(within(panel).getByText('Overdue engagement queue')).toBeInTheDocument();
    expect(within(panel).getByText('Contacts who have responded')).toBeInTheDocument();
  });

  it('names the module and its purpose in the header', () => {
    renderHunter();
    const panel = screen.getByRole('complementary', { name: /hunter sections/i });

    expect(within(panel).getByText('HUNTER')).toBeInTheDocument();
    expect(within(panel).getByText('Engage and follow up')).toBeInTheDocument();
  });

  it('marks the active section from the URL', () => {
    renderHunter('/hunter?tab=replied');
    const panel = screen.getByRole('complementary', { name: /hunter sections/i });

    const active = within(panel).getAllByRole('button')
      .filter(b => b.getAttribute('aria-current') === 'true');

    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Replied');
  });

  it('collapses independently of Scout, under its own key', async () => {
    const user = userEvent.setup();
    const { container } = renderHunter();

    await user.click(screen.getByRole('button', { name: /collapse hunter sections/i }));

    expect(container.querySelector('.module-subnav.collapsed')).not.toBeNull();
    expect(localStorage.getItem('hunter_subnav_collapsed')).toBe('true');
    expect(localStorage.getItem('scout_subnav_collapsed')).toBeNull();
  });
});
