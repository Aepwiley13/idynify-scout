/**
 * "The sidebar disappears when navigating to the CSM tab."
 *
 * Two panels answer to that description and only one of them was ever at
 * risk:
 *
 *   Layer 1 — the GLOBAL sidebar (Mission Control, Scout, Hunter, …). It is a
 *             sibling of `.main-content` in MainLayout, and the boundary lives
 *             deep inside `.main-content`, wrapping `<Outlet/>`. A boundary
 *             cannot unmount its own siblings, so this one was never
 *             removable by a module crash.
 *
 *   Layer 2 — Basecamp's own 190px sub-nav (People / Companies / Engage /
 *             CSM). This one really did vanish, because the shell-level
 *             boundary caught the crash ABOVE BasecampMain — replacing the
 *             whole module, sub-nav included. A user who hit the broken CSM
 *             tab had no way back to a working section.
 *
 * The fix is a second boundary inside the module, wrapping the section only.
 * This test pins that: when the CSM section throws, Basecamp's sub-nav is
 * still on screen and the other sections are still reachable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Sections are stubbed — this test is about containment, not their contents.
vi.mock('../pages/Basecamp/sections/PeopleSection', () => ({
  default: () => <div data-testid="section">people section</div>,
}));
vi.mock('../pages/Basecamp/sections/CompaniesSection', () => ({
  default: () => <div data-testid="section">companies section</div>,
}));
vi.mock('../pages/Basecamp/sections/EngagementCenter', () => ({
  default: () => <div data-testid="section">engage section</div>,
}));

// The section under test throws on render — standing in for whatever the CSM
// dashboard hits on a given day. The original was `Illegal constructor`.
vi.mock('../components/csm/CSMDashboard', () => ({
  default: () => {
    throw new TypeError('Illegal constructor');
  },
}));

// Pro tier, so the CSM tab renders the dashboard rather than the teaser.
vi.mock('../hooks/useSubscription', () => ({
  useSubscription: () => ({ tier: 'pro', isProTier: true, loading: false }),
}));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'user-1',
  getEffectiveUser: () => ({ uid: 'user-1' }),
}));

import BasecampMain from '../pages/Basecamp/BasecampMain';
import { ThemeProvider } from '../theme/ThemeContext';

function renderBasecamp(tab) {
  return render(
    <MemoryRouter initialEntries={[`/basecamp?tab=${tab}`]}>
      <ThemeProvider>
        <BasecampMain />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('a broken Basecamp section does not take Basecamp with it', () => {
  beforeEach(() => {
    // Desktop, so the sub-nav renders. (Mobile puts these same sections on the
    // bottom bar, which the shell owns and the module cannot break.)
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the module sub-nav on screen when CSM throws', () => {
    renderBasecamp('csm');

    // The failure is reported...
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/CSM could not load/i)).toBeInTheDocument();

    // ...and every other section is still one click away.
    expect(screen.getByText('BASECAMP')).toBeInTheDocument();
    for (const label of ['People', 'Companies', 'Engage', 'CSM']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('lets the user click out of the broken section into a working one', async () => {
    const user = userEvent.setup();
    renderBasecamp('csm');

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByText('People'));

    expect(screen.getByTestId('section')).toHaveTextContent('people section');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the section that failed, not the module', () => {
    renderBasecamp('csm');
    // "Basecamp could not load" would be a lie — three quarters of it loaded.
    expect(screen.queryByText(/Basecamp could not load/i)).not.toBeInTheDocument();
  });
});
