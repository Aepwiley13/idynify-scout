/**
 * Contact Hub's switch, and what it does to navigation.
 *
 * OFF is the default and must be indistinguishable from the Contact Hub not
 * existing: no sidebar entry, no mobile drawer entry, and /contact-hub
 * resolving like any unknown path. ON adds exactly one destination, directly
 * under Mission Control, and changes nothing else.
 *
 * The switch is read once, at module load, from the build's environment. Each
 * case below stubs the variable and loads fresh copies of the modules.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { contactHubEnabledFrom, CONTACT_HUB_PATH, contactHubPersonPath } from '../constants/contactHub';

const BASELINE_SIDEBAR = [
  'Mission Control', 'Scout', 'Hunter', 'Sniper', 'Basecamp', 'Recon', 'Reinforcements', 'Fallback', 'Command Center',
];

async function loadWith(value) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv('VITE_CONTACT_HUB', '');
  else vi.stubEnv('VITE_CONTACT_HUB', value);
  const hub = await import('../constants/contactHub');
  const nav = await import('../constants/navigationModel');
  const mobile = await import('../constants/mobileNavigation');
  return { hub, nav, mobile };
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('the switch value', () => {
  it('is on only for an explicit on', () => {
    for (const value of ['on', 'true', '1']) expect(contactHubEnabledFrom(value)).toBe(true);
  });

  it('is off for everything else, including unset', () => {
    for (const value of [undefined, null, '', 'off', 'false', '0', 'ON', 'yes', 'enabled', ' on']) {
      expect(contactHubEnabledFrom(value)).toBe(false);
    }
  });

  it('builds its two paths in one place', () => {
    expect(CONTACT_HUB_PATH).toBe('/contact-hub');
    expect(contactHubPersonPath('abc')).toBe('/contact-hub/person/abc');
    expect(contactHubPersonPath('a/b c')).toBe('/contact-hub/person/a%2Fb%20c');
  });
});

describe('switch OFF (the default)', () => {
  it('is off when the variable is not set', async () => {
    const { hub } = await loadWith(undefined);
    expect(hub.CONTACT_HUB.enabled).toBe(false);
  });

  it('is off when the variable says off', async () => {
    const { hub } = await loadWith('off');
    expect(hub.CONTACT_HUB.enabled).toBe(false);
  });

  it('the sidebar is exactly the list it was before Contact Hub existed', async () => {
    const { nav } = await loadWith(undefined);
    expect(nav.sidebarDestinations().map((d) => d.label)).toEqual(BASELINE_SIDEBAR);
    expect(nav.SIDEBAR_ORDER).not.toContain('contact-hub');
  });

  it('the mobile drawer has no Contact Hub, and Mission Control stands alone at the top', async () => {
    const { nav } = await loadWith(undefined);
    const sections = nav.mobileDrawerSections();
    expect(sections[0].destinations.map((d) => d.label)).toEqual(['Mission Control']);
    expect(sections.flatMap((s) => s.destinations).map((d) => d.id)).not.toContain('contact-hub');
  });

  it('/contact-hub belongs to no module: it resolves like any unknown path', async () => {
    const { nav } = await loadWith(undefined);
    expect(nav.resolveModule('/contact-hub').id).toBe('mission-control');
    expect(nav.resolveModule('/contact-hub/person/c1').id).toBe('mission-control');
    expect(nav.resolveModule('/no-such-page').id).toBe('mission-control');
    expect(nav.resolveDestination('contact-hub')).toBeNull();
    expect(nav.UNGROUPED_DESTINATIONS.map((d) => d.id)).toEqual(['command-center', 'settings', 'barry']);
  });
});

describe('switch ON', () => {
  it('adds Contact Hub directly under Mission Control, and nothing else moves', async () => {
    const { nav } = await loadWith('on');
    const labels = nav.sidebarDestinations().map((d) => d.label);
    expect(labels).toEqual(['Mission Control', 'Contact Hub', ...BASELINE_SIDEBAR.slice(1)]);
  });

  it('the mobile drawer shows it with Mission Control at the top, not at the bottom with Command Center', async () => {
    const { nav } = await loadWith('on');
    const sections = nav.mobileDrawerSections();
    expect(sections[0].destinations.map((d) => d.label)).toEqual(['Mission Control', 'Contact Hub']);
    const last = sections[sections.length - 1];
    expect(last.destinations.map((d) => d.label)).toEqual(['Command Center']);
    // Listed once.
    expect(sections.flatMap((s) => s.destinations).filter((d) => d.id === 'contact-hub')).toHaveLength(1);
  });

  it('both Contact Hub paths resolve to it, and other paths are unaffected', async () => {
    const { nav } = await loadWith('on');
    expect(nav.resolveModule('/contact-hub').label).toBe('Contact Hub');
    expect(nav.resolveModule('/contact-hub/person/c1').label).toBe('Contact Hub');
    expect(nav.resolveModule('/command-center').label).toBe('Command Center');
    expect(nav.resolveModule('/contact/c1').id).toBe('mission-control');
    expect(nav.resolveBarryModule('/contact-hub')).toBe('default');
  });

  it('the mobile bar shows one view, My People, and no overflow', async () => {
    const { mobile } = await loadWith('on');
    const bar = mobile.bottomNavFor('contact-hub');
    expect(bar.primary.map((i) => i.label)).toEqual(['My People']);
    expect(bar.primary[0].to).toBe('/contact-hub');
    expect(bar.overflow).toBeUndefined();
  });
});

describe('App.jsx takes its Contact Hub routes from the switch-guarded function only', () => {
  // The routes themselves are exercised with a real router in
  // contactHubRoutes.test.jsx. This pins the one thing that test cannot see:
  // that App.jsx has no second, unguarded way in.
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

  it('calls contactHubRoutes() exactly once and names no Contact Hub component itself', () => {
    expect(app.match(/\{contactHubRoutes\(\)\}/g)).toHaveLength(1);
    expect(app).not.toMatch(/<ContactHubMain|<HubPeople|<HubPerson/);
  });

  it('has no hand-written route or redirect to /contact-hub', () => {
    expect(app).not.toMatch(/path="\/contact-hub/);
    expect(app).not.toMatch(/to="\/contact-hub/);
  });
});
