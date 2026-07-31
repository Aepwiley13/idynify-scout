/**
 * navigationModel — the locked information architecture.
 *
 * These tests exist because the pre-migration codebase declared the module
 * list NINE times (Sidebar plus eight module shells) and the copies had
 * already diverged: Mission Control's grid said "HOMEBASE" while every rail
 * and the route said "Basecamp". A single source of truth only stays true if
 * something checks it.
 */

import { describe, it, expect } from 'vitest';
import {
  MISSION_CONTROL,
  MODULES,
  GROUP_ORDER,
  NAV_GROUPS,
  modulesInGroup,
  resolveModule,
  resolveModuleLabel,
  resolveBarryModule,
  sidebarDestinations,
} from '../constants/navigationModel';

describe('navigationModel — locked hierarchy', () => {
  it('matches the locked IA exactly', () => {
    expect(GROUP_ORDER).toEqual([
      NAV_GROUPS.PIPELINE,
      NAV_GROUPS.RELATIONSHIPS,
      NAV_GROUPS.INTELLIGENCE,
    ]);

    expect(modulesInGroup(NAV_GROUPS.PIPELINE).map(m => m.label))
      .toEqual(['Scout', 'Hunter', 'Sniper']);
    expect(modulesInGroup(NAV_GROUPS.RELATIONSHIPS).map(m => m.label))
      .toEqual(['Basecamp', 'Reinforcements', 'Fallback']);
    expect(modulesInGroup(NAV_GROUPS.INTELLIGENCE).map(m => m.label))
      .toEqual(['Recon']);
  });

  it('keeps Mission Control out of the groups — it stands alone', () => {
    expect(MODULES.find(m => m.id === MISSION_CONTROL.id)).toBeUndefined();
  });

  it('gives every module exactly one label and one path', () => {
    const labels = MODULES.map(m => m.label);
    const paths = MODULES.map(m => m.path);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never spells Basecamp as Homebase', () => {
    // The regression this guards: Mission Control's module grid labelled the
    // module HOMEBASE on the first screen a new user ever sees.
    const serialised = JSON.stringify(MODULES).toLowerCase();
    expect(serialised).not.toContain('homebase');
  });
});

describe('SIDEBAR_ORDER — what the wide sidebar draws', () => {
  it('is the exact order from the final brief, including Command Center', () => {
    expect(sidebarDestinations().map(d => d.label)).toEqual([
      'Mission Control',
      'Scout', 'Hunter', 'Sniper',
      'Basecamp', 'Recon', 'Reinforcements', 'Fallback',
      'Command Center',
    ]);
  });

  it('is deliberately NOT the group order', () => {
    // The brief puts Recon between Basecamp and Reinforcements and states the
    // grouping is architectural, not visual. GROUP_ORDER still describes the
    // architecture; it just is not what the sidebar draws.
    const grouped = GROUP_ORDER.flatMap(g => modulesInGroup(g).map(m => m.label));
    const drawn = sidebarDestinations()
      .map(d => d.label)
      .filter(l => l !== 'Mission Control' && l !== 'Command Center');

    expect(drawn).not.toEqual(grouped);
    expect([...drawn].sort()).toEqual([...grouped].sort());
  });

  it('names every entry it draws', () => {
    for (const dest of sidebarDestinations()) {
      expect(dest.label).toBeTruthy();
      expect(dest.path).toBeTruthy();
    }
  });
});

describe('resolveModule — active module on nested routes', () => {
  it('resolves a module hub', () => {
    expect(resolveModule('/scout').id).toBe('scout');
    expect(resolveModule('/hunter').id).toBe('hunter');
  });

  it('keeps the parent module active on nested routes', () => {
    // Before the migration the sidebar lost its highlight entirely on detail
    // pages, so a user on a contact could not tell which module they were in.
    expect(resolveModule('/scout/contact/abc123').id).toBe('scout');
    expect(resolveModule('/scout/company/xyz/leads').id).toBe('scout');
    expect(resolveModule('/scout/total-market').id).toBe('scout');
  });

  it('does not let a prefix match steal a longer path', () => {
    expect(resolveModule('/recon/icp-intelligence').id).toBe('recon');
    expect(resolveModule('/reinforcements').id).toBe('reinforcements');
  });

  it('routes the legacy Mission Control recon path to Recon, not Mission Control', () => {
    expect(resolveModule('/mission-control-v2/recon').id).toBe('recon');
    expect(resolveModule('/mission-control-v2').id).toBe('mission-control');
  });

  it('falls back to Mission Control for unknown routes', () => {
    expect(resolveModule('/nonexistent').id).toBe('mission-control');
    expect(resolveModule('').id).toBe('mission-control');
  });

  it('exposes the locked label for a route', () => {
    expect(resolveModuleLabel('/basecamp')).toBe('Basecamp');
    expect(resolveModuleLabel('/scout/contact/abc')).toBe('Scout');
  });
});

describe('resolveBarryModule', () => {
  it('gives Basecamp its own persona rather than the guide persona', () => {
    // The old route maps sent /basecamp to 'homebase' (GUIDE) while the module
    // itself declared 'basecamp' (CSM) — so the intended persona was
    // unreachable through navigation.
    expect(resolveBarryModule('/basecamp')).toBe('basecamp');
  });

  it('maps each module to a persona key', () => {
    expect(resolveBarryModule('/scout')).toBe('scout');
    expect(resolveBarryModule('/scout/contact/1')).toBe('scout');
    expect(resolveBarryModule('/command-center')).toBe('command-center');
  });
});
