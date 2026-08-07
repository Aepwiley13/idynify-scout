/**
 * The navigation contract: destinations, intent, and where the breadcrumb
 * points.
 *
 * These are pure-function tests on purpose. The helpers exist so that "which
 * URL, carrying what" is decided in ONE place rather than at twenty call
 * sites, and that decision is exactly what is asserted here — no router, no
 * DOM, no mocking of things that are not the subject.
 */

import { describe, it, expect } from 'vitest';
import {
  buildContactNavigation,
  buildCompanyNavigation,
  contactPath,
  companyPath,
  contactPanelPath,
  readNavigationIntent,
  originModuleId,
  barrySessionKey,
  NAVIGATION_INTENT_KEY,
  DISPLAY_MODES,
  ENTRY_POINTS,
} from '../utils/navigation';
import { resolveModule } from '../constants/navigationModel';

describe('canonical paths', () => {
  it('are module-agnostic', () => {
    expect(contactPath('c1')).toBe('/contact/c1');
    expect(companyPath('co1')).toBe('/company/co1');
  });

  it('do not resolve to Scout', () => {
    // The entire point of the sprint in one assertion: the contact route no
    // longer belongs to Scout, so the shell cannot conclude the user is in it.
    expect(resolveModule('/contact/c1').id).not.toBe('scout');
    expect(resolveModule('/company/co1').id).not.toBe('scout');
  });

  it('keep Scout’s panel route for panel mode', () => {
    expect(contactPanelPath('c1')).toBe('/scout/contact/c1');
    // Still Scout's — because in panel mode the user genuinely IS in Scout,
    // with the list mounted behind the panel.
    expect(resolveModule('/scout/contact/c1').id).toBe('scout');
  });
});

describe('buildContactNavigation', () => {
  it('carries the full Mission Control intent', () => {
    const { to, options } = buildContactNavigation({
      contactId: 'c1',
      entryPoint: ENTRY_POINTS.MISSION_CONTROL,
      reason: 'next_step_overdue',
      recommendedAction: 'complete_step',
      priorityId: 'p1',
      taskId: 't1',
      returnTo: '/mission-control-v2',
      displayMode: DISPLAY_MODES.PAGE,
    });

    expect(to).toBe('/contact/c1');
    expect(options.state[NAVIGATION_INTENT_KEY]).toEqual({
      entityType: 'contact',
      entityId: 'c1',
      entryPoint: 'mission_control',
      reason: 'next_step_overdue',
      recommendedAction: 'complete_step',
      priorityId: 'p1',
      taskId: 't1',
      returnTo: '/mission-control-v2',
      displayMode: 'page',
    });
  });

  it('routes panel mode to Scout’s child route', () => {
    const { to } = buildContactNavigation({ contactId: 'c1', displayMode: DISPLAY_MODES.PANEL });
    expect(to).toBe('/scout/contact/c1');
  });

  it('omits absent fields rather than carrying nulls', () => {
    const { options } = buildContactNavigation({ contactId: 'c1' });
    const intent = options.state[NAVIGATION_INTENT_KEY];

    expect(intent).not.toHaveProperty('reason');
    expect(intent).not.toHaveProperty('priorityId');
    expect(intent).not.toHaveProperty('returnTo');
  });

  it('refuses to navigate without an id', () => {
    expect(() => buildContactNavigation({})).toThrow(/contactId is required/);
    expect(() => buildCompanyNavigation({})).toThrow(/companyId is required/);
  });
});

describe('readNavigationIntent', () => {
  const intent = { entityType: 'contact', entityId: 'c1', reason: 'next_step_overdue' };
  const location = { state: { [NAVIGATION_INTENT_KEY]: intent } };

  it('returns the intent for the entity it was built for', () => {
    expect(readNavigationIntent(location, { entityType: 'contact', entityId: 'c1' })).toBe(intent);
  });

  it('returns null for a DIFFERENT contact on the same route', () => {
    // React Router preserves location.state across a param change, so without
    // this guard, clicking through from contact A to contact B would show B an
    // arrival banner explaining A's overdue follow-up.
    expect(readNavigationIntent(location, { entityType: 'contact', entityId: 'c2' })).toBeNull();
  });

  it('returns null for a different entity type', () => {
    expect(readNavigationIntent(location, { entityType: 'company', entityId: 'c1' })).toBeNull();
  });

  it('returns null when there is no state at all', () => {
    expect(readNavigationIntent({}, { entityType: 'contact', entityId: 'c1' })).toBeNull();
    expect(readNavigationIntent(null, { entityType: 'contact', entityId: 'c1' })).toBeNull();
  });
});

describe('panel mode implies a list behind it', () => {
  // The staging bug this encodes: Scout+'s "Go to Lead" used panel mode, and
  // panel mode routes under /scout — which mounts ScoutMain on its default tab.
  // Saving a contact through a FORM dropped the user onto Daily Lead Insights
  // with their new contact panelled over a list they had never opened.
  //
  // The rule: panel mode is only correct when the user was already looking at
  // the list it opens over. Every other origin gets the page.
  const ORIGINS_WITH_A_LIST = ['scout', 'hunter'];

  it('routes panel mode under /scout, which is why it needs a list', () => {
    const { to } = buildContactNavigation({ contactId: 'c1', displayMode: DISPLAY_MODES.PANEL });
    expect(to.startsWith('/scout/')).toBe(true);
  });

  it('Scout+ opens the page, not the panel', () => {
    const { to, options } = buildContactNavigation({
      contactId: 'c1',
      entryPoint: ENTRY_POINTS.SCOUT_PLUS,
      returnTo: '/scout?tab=scout-plus',
      displayMode: DISPLAY_MODES.PAGE,
    });

    expect(to).toBe('/contact/c1');
    expect(options.state[NAVIGATION_INTENT_KEY].entryPoint).toBe('scout_plus');
  });

  it('Scout+ is not one of the origins that has a list behind it', () => {
    expect(ORIGINS_WITH_A_LIST).not.toContain(ENTRY_POINTS.SCOUT_PLUS);
  });

  it('Scout+ still shows Scout in the breadcrumb', () => {
    // A distinct entry point for display purposes, the same module for
    // navigational ones. Scout+ lives inside Scout.
    expect(originModuleId({ entryPoint: ENTRY_POINTS.SCOUT_PLUS }, resolveModule)).toBe('scout');
  });

  it('Scout+ returnTo is a route that actually resolves', () => {
    // `/scout/scout-plus` matches nothing and falls through to the catch-all,
    // which would send Back to the homepage. Scout's views are query params.
    const { options } = buildContactNavigation({
      contactId: 'c1',
      entryPoint: ENTRY_POINTS.SCOUT_PLUS,
      returnTo: '/scout?tab=scout-plus',
    });
    const { returnTo } = options.state[NAVIGATION_INTENT_KEY];

    expect(resolveModule(returnTo.split('?')[0]).id).toBe('scout');
  });
});

describe('originModuleId — what the breadcrumb names', () => {
  it('names the module the user clicked from', () => {
    expect(originModuleId({ entryPoint: 'mission_control' }, resolveModule)).toBe('mission-control');
    expect(originModuleId({ entryPoint: 'hunter' }, resolveModule)).toBe('hunter');
  });

  it('falls back to returnTo for the Command Bar, which is not a place', () => {
    expect(originModuleId(
      { entryPoint: 'command_bar', returnTo: '/hunter?tab=all' },
      resolveModule,
    )).toBe('hunter');
  });

  it('is null with nothing to go on, so the shell falls back to the route', () => {
    expect(originModuleId(null, resolveModule)).toBeNull();
    expect(originModuleId({ entryPoint: 'direct' }, resolveModule)).toBeNull();
  });
});

describe('barrySessionKey — contact-scoped memory, per-module sessions', () => {
  it('keys the session by entity AND originating module', () => {
    expect(barrySessionKey({ entryPoint: 'mission_control' }, 'c1')).toEqual({
      entityType: 'contact',
      entityId: 'c1',
      sessionType: 'follow_up',
      sourceModule: 'mission_control',
    });
  });

  it('gives the same contact different sessions from different modules', () => {
    const fromMC = barrySessionKey({ entryPoint: 'mission_control' }, 'c1');
    const fromHunter = barrySessionKey({ entryPoint: 'hunter' }, 'c1');

    // Same person — memory is shared.
    expect(fromMC.entityId).toBe(fromHunter.entityId);
    // Different conversation — a follow-up nudge is not an outreach draft.
    expect(fromMC.sessionType).not.toBe(fromHunter.sessionType);
  });

  it('has no key without an entity', () => {
    expect(barrySessionKey({ entryPoint: 'hunter' }, null)).toBeNull();
  });
});
