/**
 * navigationModel — THE single source of truth for Idynify's global navigation.
 *
 * Locked information architecture (Sprint 1 brief). Do not reopen without
 * explicit product + architecture approval.
 *
 *   MISSION CONTROL
 *
 *   PIPELINE        Scout · Hunter · Sniper
 *   RELATIONSHIPS   Basecamp · Reinforcements · Fallback
 *   INTELLIGENCE    Recon
 *   ─────────────
 *   Settings · Help / Support
 *
 * Why this file exists
 * --------------------
 * Before the shell migration the same module list was declared nine times —
 * once in Sidebar.jsx and once in each of the eight module shells — as
 * MODULE_RAIL / NAV_SECTIONS. Those copies had already diverged: Mission
 * Control's grid labelled Basecamp "HOMEBASE" while every rail said
 * "BASECAMP", and Barry's route map sent /basecamp to a 'homebase' persona
 * that was never the one the module intended.
 *
 * One list. One label per destination. Divergence becomes impossible rather
 * than merely discouraged.
 *
 * LABEL is the locked vocabulary. It is the only string any surface may use
 * for a destination — sidebar, breadcrumb, page title, Barry, or copy.
 */

/** Group identifiers — visual grouping only, not navigable destinations. */
export const NAV_GROUPS = {
  PIPELINE: 'PIPELINE',
  RELATIONSHIPS: 'RELATIONSHIPS',
  INTELLIGENCE: 'INTELLIGENCE',
};

/**
 * Mission Control stands alone above the groups, per the locked IA.
 * `barryModule` is the key into BarryChat/MODULE_CONFIG for persona + accent.
 */
export const MISSION_CONTROL = {
  id: 'mission-control',
  label: 'Mission Control',
  // railLabel is a DISPLAY ABBREVIATION for the 60px icon rail, never an
  // alternative name. `label` remains the locked vocabulary and is what the
  // tooltip, breadcrumb and every piece of copy must use. This exists only
  // because "Mission Control" does not fit under a 20px icon.
  railLabel: 'MC',
  path: '/mission-control-v2',
  barryModule: 'default',
  inScope: true,
};

/**
 * Modules in locked order within their groups.
 *
 * `inScope` marks the Sprint 1 vertical slice. Out-of-scope modules appear
 * in the sidebar and retain their current routes and self-contained shells,
 * exactly as the brief requires — they are real destinations, not fakes.
 */
export const MODULES = [
  // ── PIPELINE ──────────────────────────────────────────────────────────────
  {
    id: 'scout',
    railLabel: 'SCOUT',
    label: 'Scout',
    path: '/scout',
    group: NAV_GROUPS.PIPELINE,
    barryModule: 'scout',
    description: 'Find and qualify prospects',
    inScope: true,
  },
  {
    id: 'hunter',
    railLabel: 'HUNTER',
    label: 'Hunter',
    path: '/hunter',
    group: NAV_GROUPS.PIPELINE,
    barryModule: 'hunter',
    description: 'Engage and follow up',
    inScope: false,
  },
  {
    id: 'sniper',
    railLabel: 'SNIPER',
    label: 'Sniper',
    path: '/sniper',
    group: NAV_GROUPS.PIPELINE,
    barryModule: 'sniper',
    description: 'Close deals',
    inScope: false,
  },

  // ── RELATIONSHIPS ─────────────────────────────────────────────────────────
  {
    id: 'basecamp',
    railLabel: 'BASECAMP',
    label: 'Basecamp',
    path: '/basecamp',
    group: NAV_GROUPS.RELATIONSHIPS,
    // The module's own shell declares BARRY_MODULE = 'basecamp' (the CSM
    // persona). The old route maps sent /basecamp to 'homebase' (the GUIDE
    // persona), so the intended persona was unreachable. Locked to the
    // module's own declaration.
    barryModule: 'basecamp',
    description: 'Customer success and retention',
    inScope: false,
  },
  {
    id: 'reinforcements',
    railLabel: 'REINFORCEMENTS',
    label: 'Reinforcements',
    path: '/reinforcements',
    group: NAV_GROUPS.RELATIONSHIPS,
    barryModule: 'reinforcements',
    description: 'Referral and warm-intro network',
    inScope: false,
  },
  {
    id: 'fallback',
    railLabel: 'FALLBACK',
    label: 'Fallback',
    path: '/fallback',
    group: NAV_GROUPS.RELATIONSHIPS,
    barryModule: 'fallback',
    description: 'Re-engage archived and closed-lost',
    inScope: false,
  },

  // ── INTELLIGENCE ──────────────────────────────────────────────────────────
  {
    id: 'recon',
    railLabel: 'RECON',
    label: 'Recon',
    path: '/recon',
    group: NAV_GROUPS.INTELLIGENCE,
    barryModule: 'recon',
    description: 'ICP, messaging and market intelligence',
    inScope: false,
  },
];

/** Rendering order for the sidebar's grouped section. */
export const GROUP_ORDER = [
  NAV_GROUPS.PIPELINE,
  NAV_GROUPS.RELATIONSHIPS,
  NAV_GROUPS.INTELLIGENCE,
];

/** Utility links below the divider. Not modules; never grouped with them. */
export const UTILITY_LINKS = [
  { id: 'settings', label: 'Settings', path: '/settings' },
  { id: 'help', label: 'Help / Support', path: null, action: 'support' },
];

/**
 * Command Center is a real destination that the locked IA does not list as a
 * module. It keeps its route and its shell; it is reachable from Mission
 * Control. Recorded here so route→module resolution stays exhaustive and
 * Barry gets the right persona there.
 */
export const UNLISTED_DESTINATIONS = [
  { id: 'command-center', label: 'Command Center', path: '/command-center', barryModule: 'command-center' },
];

const ALL_DESTINATIONS = [MISSION_CONTROL, ...MODULES, ...UNLISTED_DESTINATIONS];

/**
 * Resolve a pathname to its owning module.
 *
 * Longest-prefix wins so /scout/contact/x resolves to scout, not to a
 * shorter accidental match. Mission Control is matched exactly because its
 * legacy path (/mission-control-v2/recon) belongs to Recon, not to it.
 */
export function resolveModule(pathname) {
  if (!pathname) return MISSION_CONTROL;

  if (pathname === MISSION_CONTROL.path) return MISSION_CONTROL;
  if (pathname.startsWith('/mission-control-v2/recon')) {
    return MODULES.find(m => m.id === 'recon');
  }

  let best = null;
  for (const dest of ALL_DESTINATIONS) {
    if (!dest.path) continue;
    if (pathname === dest.path || pathname.startsWith(dest.path + '/')) {
      if (!best || dest.path.length > best.path.length) best = dest;
    }
  }
  return best || MISSION_CONTROL;
}

/** Locked label for a pathname's module. Never invent a synonym for these. */
export function resolveModuleLabel(pathname) {
  return resolveModule(pathname).label;
}

/** Barry persona key for a pathname. One mapping, used by the shell only. */
export function resolveBarryModule(pathname) {
  return resolveModule(pathname).barryModule || 'default';
}

/** Modules belonging to a group, in locked order. */
export function modulesInGroup(group) {
  return MODULES.filter(m => m.group === group);
}
