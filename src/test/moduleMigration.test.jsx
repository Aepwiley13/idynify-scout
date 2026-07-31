/**
 * Modules migrated into the global shell.
 *
 * Each of these used to be a self-contained application shell: its own 60px
 * icon rail listing every module, its own theme picker, settings button,
 * "back to Mission Control" button, user footer and Barry instance. Entering
 * one replaced the whole application chrome and leaving it replaced it again.
 *
 * Table-driven on purpose: each migration adds one row here and inherits the
 * whole checklist, so no module could be migrated and quietly skip a step.
 * All seven are now in the table.
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
import { MODULE_BOTTOM_NAV } from '../constants/mobileNavigation';

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
vi.mock('../pages/Hunter/sections/MissionsSection', () => stub('cc-missions'));
vi.mock('../pages/Hunter/sections/WeaponsSection', () => stub('cc-weapons'));
vi.mock('../pages/Hunter/sections/ArsenalSection', () => stub('cc-arsenal'));
vi.mock('../pages/Hunter/sections/OutcomesSection', () => stub('cc-outcomes'));
vi.mock('../pages/Scout/GoToWar', () => stub('cc-gotowar'));
vi.mock('../components/notifications/NotificationCenter', () => stub('notifications'));
vi.mock('../components/serviceProfiles/ServiceProfileSetup', () => stub('service-setup'));
vi.mock('../utils/mfa', () => ({
  isMfaEnrolled: async () => false,
  getEnrolledFactors: async () => [],
  startTotpEnrollment: () => {}, completeTotpEnrollment: () => {}, unenrollFactor: () => {},
}));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ isProTier: true, loading: false }) }));
// Settings' preference hook calls doc(db, …) inside an effect. With a stubbed
// db that throws synchronously, before the promise its .catch is attached to
// exists — so the rejection escapes and takes the render down. Mocked here
// like every other Firestore-touching dependency in this file.
vi.mock('../hooks/useUserPreference', () => ({
  useUserPreference: (_key, initial) => [initial, () => {}],
}));

const { default: HunterMain } = await import('../pages/Hunter/HunterMain');
const { default: SniperMain } = await import('../pages/Sniper/SniperMain');
const { default: BasecampMain } = await import('../pages/Basecamp/BasecampMain');
const { default: ReinforcementsMain } = await import('../pages/Reinforcements/ReinforcementsMain');
const { default: FallbackMain } = await import('../pages/Fallback/FallbackMain');
const { default: ReconMain } = await import('../pages/Recon/ReconMain');
const { default: PeopleMain } = await import('../pages/Scout/PeopleMain');
const { default: UserSettings } = await import('../pages/UserSettings');

/**
 * One row per migrated module. `otherModules` are labels the module's own rail
 * used to show — their absence is what proves the rail is gone.
 */
const MIGRATED = [
  {
    name: 'Hunter',
    moduleId: 'hunter',
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
    moduleId: 'sniper',
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
    moduleId: 'basecamp',
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
    moduleId: 'reinforcements',
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
    moduleId: 'fallback',
    Component: FallbackMain,
    path: '/fallback',
    title: 'FALLBACK',
    tagline: 'Re-engage archived and closed-lost',
    storageKey: 'fallback_subnav_collapsed',
    sections: ['Comeback', 'People', 'Companies'],
    descriptions: ['Re-engagement engine', 'Archived & lost people'],
    activeTab: { query: '?tab=companies', expect: 'Companies' },
  },
  {
    name: 'Recon',
    moduleId: 'recon',
    Component: ReconMain,
    path: '/recon',
    title: 'RECON',
    tagline: 'ICP, messaging and market intelligence',
    storageKey: 'recon_subnav_collapsed',
    sections: [
      'Overview', 'Alignment Brief', 'User Profile', 'ICP Intelligence',
      'Messaging & Voice', 'Objections', 'Competitive Intel',
      'Buying Signals', 'Barry Training',
    ],
    descriptions: ['Training dashboard', 'What Barry knows'],
    // Recon's sections are ROUTES, not tabs — the active item is derived from
    // the pathname, so this row exercises a different resolution path.
    activeTab: { query: '', path: '/recon/messaging', expect: 'Messaging & Voice' },
  },
  {
    name: 'Command Center',
    moduleId: 'command-center',
    Component: PeopleMain,
    path: '/command-center',
    title: 'COMMAND CENTER',
    tagline: 'People, companies, missions and messaging',
    storageKey: 'cc_subnav_collapsed',
    // Migrated AS-IS. All nine sections, in the order the module had them.
    // Whether they belong together is a product question for after the shell
    // is consistent; this row's job is to prove the migration changed none of
    // them.
    sections: [
      'People', 'Companies', 'Missions', 'Campaigns', 'Cadences',
      'Go To War', 'Weapons', 'Arsenal', 'Outcomes',
    ],
    descriptions: ['8-phase bulk mission launcher', 'Saved message templates library'],
    activeTab: { query: '?tab=arsenal', expect: 'Arsenal' },
  },
  {
    name: 'Settings',
    moduleId: 'settings',
    Component: UserSettings,
    path: '/settings',
    title: 'SETTINGS',
    tagline: 'Account, security, billing and appearance',
    storageKey: 'settings_subnav_collapsed',
    sections: [
      'Account', 'Security', 'Billing', 'Integrations',
      'Your Services', 'Hunter', 'Appearance',
    ],
    descriptions: ['Password and two-factor', 'Themes and mission sounds'],
    // Settings holds its section in local state rather than the URL — it
    // always did, and that is out of scope here — so this row asserts the
    // default rather than a deep link.
    activeTab: { query: '', expect: 'Account' },
  },
];

/** Labels the deleted icon rails used to show for OTHER modules. */
const OTHER_MODULE_RAIL_LABELS = [
  'SCOUT', 'HUNTER', 'SNIPER', 'BASECAMP', 'REINFORCEMENTS', 'FALLBACK', 'RECON',
  'COMMAND CENTER',
];

function renderModule(mod, query = '', at = null) {
  // Assigned rather than destructured in the signature: the repo's ESLint
  // config has no react plugin, so a JSX-only reference to a destructured
  // PARAM does not count as usage and no-unused-vars fires on it.
  const Component = mod.Component;
  const path = mod.path;

  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });

  return render(
    <MemoryRouter initialEntries={[at || path + query]}>
      <ThemeProvider>
        <ShellProvider user={{ id: 'u1' }} userData={{}}>
          <Routes>
            {/* Wildcard child so route-driven modules (Recon) resolve their
                nested paths; tab-driven modules ignore it. */}
            <Route path={path} element={<Component />}>
              <Route path="*" element={null} />
            </Route>
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
    //
    // Checked structurally, not by text: Recon legitimately has sections named
    // "Barry Training" and "What Barry knows", and a /barry/i text query would
    // fail on those while still missing an actual mounted Barry.
    const { container } = renderModule(mod);
    expect(container.querySelector('img[alt="Barry"]')).toBeNull();
    expect(container.querySelector('[class*="barry-card"]')).toBeNull();
    expect(container.querySelector('[class*="barry-chat"]')).toBeNull();
    expect(container.querySelector('[class*="rail-btn-barry"]')).toBeNull();
  });

  it('renders no settings, home or user-footer controls', () => {
    const { container } = renderModule(mod);

    // Scoped to the sub-nav panel, which is where every module's deleted user
    // footer printed the signed-in email. Not container-wide: Settings' own
    // Account section legitimately displays the email as content, and a
    // container-wide query cannot tell "chrome we removed" from "the field the
    // screen exists to show".
    const panel = screen.getByRole('complementary', { name: new RegExp(`${mod.title} sections`, 'i') });
    expect(within(panel).queryByText('aaron@idynify.com')).toBeNull();
    expect(within(panel).queryByText(/@idynify\.com$/)).toBeNull();

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

  it('the mobile bottom bar names sections this module actually has', () => {
    // constants/mobileNavigation.js is a SECOND copy of each module's section
    // list — the shell must not import nine module files to draw the bottom
    // bar. A second copy is exactly how nine diverging module rails happened,
    // so every label there is checked against the labels the module really
    // renders. Rename a section in one place and this fails.
    //
    // The bar abbreviates on purpose — a 360px cell fits "Follow Up", not
    // "Follow Up Now" — so items that shorten a name declare the real one in
    // `section`. That lets this compare EXACTLY rather than guessing at
    // prefixes, which would let a rename hide behind an abbreviation.
    const config = MODULE_BOTTOM_NAV[mod.moduleId];
    if (!config) return;

    renderModule(mod);
    const panel = screen.getByRole('complementary', { name: new RegExp(`${mod.title} sections`, 'i') });
    const real = within(panel).getAllByRole('button')
      .map(b => b.querySelector('.module-subnav-item-label')?.textContent)
      .filter(Boolean);

    for (const item of [...config.primary, ...config.overflow]) {
      const name = item.section || item.label;
      expect(real, `${mod.name}: "${name}" is not one of its sections`).toContain(name);
    }
  });

  it('the mobile bottom bar reaches every section, between the bar and its More sheet', () => {
    // The strip under the top bar is gone, so if a section is in neither the
    // bar nor the More sheet it is unreachable on a phone.
    const config = MODULE_BOTTOM_NAV[mod.moduleId];
    if (!config) return;

    const reachable = [...config.primary, ...config.overflow].map(i => i.section || i.label);
    for (const section of mod.sections) {
      expect(reachable, `${mod.name} section "${section}" is unreachable on mobile`).toContain(section);
    }
  });

  it('marks the active section from the URL', () => {
    renderModule(mod, mod.activeTab.query, mod.activeTab.path);
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
