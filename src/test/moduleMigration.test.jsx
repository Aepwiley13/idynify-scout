/**
 * Modules migrated into the global shell.
 *
 * Each of these used to be a self-contained application shell: its own 60px
 * icon rail listing every module, its own theme picker, settings button,
 * "back to Mission Control" button, user footer and Barry instance. Entering
 * one replaced the whole application chrome and leaving it replaced it again.
 *
 * Table-driven on purpose. The remaining migrations — Basecamp,
 * Reinforcements, Fallback, Command Center, Recon — each add one row here and
 * inherit the whole checklist, so no module can be migrated and quietly skip
 * a step.
 *
 * Module views are mocked: this tests the navigation layer, and the real ones
 * open Firestore connections.
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

const stub = (name) => ({ default: () => <div data-testid="view">{name}</div> });

vi.mock('../pages/Scout/AllLeads', () => stub('leads'));
vi.mock('../components/shared/SharedCompaniesView', () => stub('companies'));
vi.mock('../pages/Sniper/sections/PipelineSection', () => stub('pipeline'));
vi.mock('../pages/Sniper/sections/TargetsSection', () => stub('targets'));
vi.mock('../pages/Sniper/sections/TouchesSection', () => stub('touches'));
vi.mock('../pages/Sniper/sections/PlaybooksSection', () => stub('playbooks'));
vi.mock('../pages/Sniper/sections/OutcomesSection', () => stub('outcomes'));
vi.mock('../pages/Sniper/sections/SniperCompaniesSection', () => stub('sniper-companies'));
vi.mock('../pages/Basecamp/sections/PeopleSection', () => stub('bc-people'));
vi.mock('../pages/Basecamp/sections/CompaniesSection', () => stub('bc-companies'));
vi.mock('../pages/Basecamp/sections/EngagementCenter', () => stub('bc-engage'));
vi.mock('../components/csm/CSMDashboard', () => stub('csm'));
vi.mock('../pages/Reinforcements/sections/DashboardSection', () => stub('rf-dashboard'));
vi.mock('../pages/Reinforcements/sections/OpportunitiesSection', () => stub('rf-opps'));
vi.mock('../pages/Reinforcements/sections/LeaderboardSection', () => stub('rf-leaderboard'));
vi.mock('../pages/Reinforcements/sections/RecordReferralSection', () => stub('rf-record'));
vi.mock('../pages/Reinforcements/sections/NurtureSection', () => stub('rf-nurture'));
vi.mock('../pages/Fallback/sections/PeopleSection', () => stub('fb-people'));
vi.mock('../pages/Fallback/sections/CompaniesSection', () => stub('fb-companies'));
vi.mock('../pages/Fallback/sections/FallbackModule', () => stub('fb-comeback'));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ isProTier: true, loading: false }) }));

const { default: HunterMain } = await import('../pages/Hunter/HunterMain');
const { default: SniperMain } = await import('../pages/Sniper/SniperMain');
const { default: BasecampMain } = await import('../pages/Basecamp/BasecampMain');
const { default: ReinforcementsMain } = await import('../pages/Reinforcements/ReinforcementsMain');
const { default: FallbackMain } = await import('../pages/Fallback/FallbackMain');

/**
 * One row per migrated module. `otherModules` are labels the module's own rail
 * used to show — their absence is what proves the rail is gone.
 */
const MIGRATED = [
  {
    name: 'Hunter',
    Component: HunterMain,
    path: '/hunter',
    title: 'HUNTER',
    tagline: 'Engage and follow up',
    storageKey: 'hunter_subnav_collapsed',
    sections: [
      'Blitz Mode', 'All People', 'Companies', 'Follow Up Now',
      "Today's Actions", 'Replied', 'Active', 'New (Unengaged)',
    ],
    descriptions: ['Overdue engagement queue', 'Contacts who have responded'],
    activeTab: { query: '?tab=replied', expect: 'Replied' },
  },
  {
    name: 'Sniper',
    Component: SniperMain,
    path: '/sniper',
    title: 'SNIPER',
    tagline: 'Close deals',
    storageKey: 'sniper_subnav_collapsed',
    sections: [
      'People', 'Companies', 'Pipeline', 'Targets',
      'Touches', 'Playbooks', 'Outcomes',
    ],
    descriptions: ['Conversion board', 'Win/loss analytics'],
    activeTab: { query: '?tab=playbooks', expect: 'Playbooks' },
  },
  {
    name: 'Basecamp',
    Component: BasecampMain,
    path: '/basecamp',
    title: 'BASECAMP',
    tagline: 'Customer success and retention',
    storageKey: 'basecamp_subnav_collapsed',
    sections: ['People', 'Companies', 'Engage', 'CSM'],
    descriptions: ['Your contacts', 'Customer success'],
    activeTab: { query: '?tab=engage', expect: 'Engage' },
  },
  {
    name: 'Reinforcements',
    Component: ReinforcementsMain,
    path: '/reinforcements',
    title: 'REINFORCEMENTS',
    tagline: 'Referral and warm-intro network',
    storageKey: 'reinforcements_subnav_collapsed',
    sections: ['Dashboard', 'Opportunities', 'Leaderboard', 'Record', 'Nurture'],
    descriptions: ['Network overview', 'Top referral sources'],
    activeTab: { query: '?tab=nurture', expect: 'Nurture' },
  },
  {
    name: 'Fallback',
    Component: FallbackMain,
    path: '/fallback',
    title: 'FALLBACK',
    tagline: 'Re-engage archived and closed-lost',
    storageKey: 'fallback_subnav_collapsed',
    sections: ['Comeback', 'People', 'Companies'],
    descriptions: ['Re-engagement engine', 'Archived & lost people'],
    activeTab: { query: '?tab=companies', expect: 'Companies' },
  },
];

/** Labels the deleted icon rails used to show for OTHER modules. */
const OTHER_MODULE_RAIL_LABELS = [
  'SCOUT', 'HUNTER', 'SNIPER', 'BASECAMP', 'REINFORCEMENTS', 'FALLBACK', 'RECON',
];

function renderModule({ Component, path }, query = '') {
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });

  return render(
    <MemoryRouter initialEntries={[path + query]}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u1' }} userData={{}}>
          <Routes>
            <Route path={path} element={<Component />} />
          </Routes>
        </ShellProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => { localStorage.clear(); });

describe.each(MIGRATED)('$name — migrated into the shell', (mod) => {
  it('renders no module rail of its own', () => {
    const { container } = renderModule(mod);
    // Skip the module's own title: it legitimately appears in the sub-nav
    // panel header. Everything else in this list was a rail entry, and the
    // rail is what had to go.
    for (const label of OTHER_MODULE_RAIL_LABELS.filter(l => l !== mod.title)) {
      expect(within(container).queryByText(label)).toBeNull();
    }
  });

  it('mounts no Barry of its own', () => {
    // Each of these used to mount BarryChat on its own drawer_<module> thread.
    // Barry is the shell's now: one instance, one thread.
    const { container } = renderModule(mod);
    expect(within(container).queryByText(/barry/i)).toBeNull();
  });

  it('renders no settings, home or user-footer controls', () => {
    const { container } = renderModule(mod);
    expect(within(container).queryByText('aaron@idynify.com')).toBeNull();
    expect(within(container).queryByTitle('Mission Control')).toBeNull();
  });

  it('uses the shared sub-nav panel, not a local copy', () => {
    const { container } = renderModule(mod);
    expect(screen.getByRole('complementary', { name: new RegExp(`${mod.title} sections`, 'i') }))
      .toBeInTheDocument();
    expect(container.querySelector('.module-subnav')).not.toBeNull();
    expect(container.querySelector('.module-shell')).not.toBeNull();
  });

  it('names the module and its purpose in the panel header', () => {
    renderModule(mod);
    const panel = screen.getByRole('complementary', { name: new RegExp(`${mod.title} sections`, 'i') });
    expect(within(panel).getByText(mod.title)).toBeInTheDocument();
    expect(within(panel).getByText(mod.tagline)).toBeInTheDocument();
  });

  it('keeps every existing section and description', () => {
    renderModule(mod);
    const panel = screen.getByRole('complementary', { name: new RegExp(`${mod.title} sections`, 'i') });

    for (const section of mod.sections) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }
    for (const desc of mod.descriptions) {
      expect(within(panel).getByText(desc)).toBeInTheDocument();
    }
  });

  it('marks the active section from the URL', () => {
    renderModule(mod, mod.activeTab.query);
    const panel = screen.getByRole('complementary', { name: new RegExp(`${mod.title} sections`, 'i') });

    const active = within(panel).getAllByRole('button')
      .filter(b => b.getAttribute('aria-current') === 'true');

    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(mod.activeTab.expect);
  });

  it('collapses under its own storage key, leaving other modules alone', async () => {
    const user = userEvent.setup();
    const { container } = renderModule(mod);

    await user.click(screen.getByRole('button', { name: new RegExp(`collapse ${mod.title} sections`, 'i') }));

    expect(container.querySelector('.module-subnav.collapsed')).not.toBeNull();
    expect(localStorage.getItem(mod.storageKey)).toBe('true');

    for (const other of MIGRATED.filter(m => m.storageKey !== mod.storageKey)) {
      expect(localStorage.getItem(other.storageKey)).toBeNull();
    }
  });
});
