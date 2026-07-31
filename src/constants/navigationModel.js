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
};

/**
 * Modules in locked order within their groups.
 *
 * These carried an `inScope` flag marking the Sprint 1 vertical slice, which
 * distinguished the modules living in the global shell from the ones still
 * shipping their own. Every module is in the shell now, so the distinction has
 * no referent and the flag is gone rather than left saying something untrue.
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
  },
  {
    id: 'hunter',
    railLabel: 'HUNTER',
    label: 'Hunter',
    path: '/hunter',
    group: NAV_GROUPS.PIPELINE,
    barryModule: 'hunter',
    description: 'Engage and follow up',
  },
  {
    id: 'sniper',
    railLabel: 'SNIPER',
    label: 'Sniper',
    path: '/sniper',
    group: NAV_GROUPS.PIPELINE,
    barryModule: 'sniper',
    description: 'Close deals',
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
  },
  {
    id: 'reinforcements',
    railLabel: 'REINFORCEMENTS',
    label: 'Reinforcements',
    path: '/reinforcements',
    group: NAV_GROUPS.RELATIONSHIPS,
    barryModule: 'reinforcements',
    description: 'Referral and warm-intro network',
  },
  {
    id: 'fallback',
    railLabel: 'FALLBACK',
    label: 'Fallback',
    path: '/fallback',
    group: NAV_GROUPS.RELATIONSHIPS,
    barryModule: 'fallback',
    description: 'Re-engage archived and closed-lost',
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
  },
];

/** Rendering order for the sidebar's grouped section. */
export const GROUP_ORDER = [
  NAV_GROUPS.PIPELINE,
  NAV_GROUPS.RELATIONSHIPS,
  NAV_GROUPS.INTELLIGENCE,
];

/**
 * Settings. A destination, not a module — it has no place in SIDEBAR_ORDER
 * because it is reached from the top bar's user menu and the mobile drawer.
 *
 * It is in ALL_DESTINATIONS all the same, so resolveModule('/settings') gives
 * the shell a real answer. Without it /settings fell through to the
 * Mission Control fallback and the breadcrumb read "Mission Control" while the
 * user was plainly in Settings.
 */
export const SETTINGS = {
  id: 'settings',
  label: 'Settings',
  railLabel: 'SETTINGS',
  path: '/settings',
  barryModule: 'default',
  description: 'Account, security, billing and appearance',
};

/** Utility links below the divider. Not modules; never grouped with them. */
export const UTILITY_LINKS = [
  SETTINGS,
  { id: 'help', label: 'Help / Support', path: null, action: 'support' },
];

/**
 * Command Center. A first-class sidebar item, last in the list.
 *
 * It sits outside PIPELINE / RELATIONSHIPS / INTELLIGENCE because the locked
 * IA does not place it in any of them — not because it is a lesser
 * destination. An earlier direction correction said Command Center "is not a
 * top-level module" on the grounds that it already appeared in Hunter's
 * sub-nav; it does not, and that has been confirmed as an error in the brief.
 */
export const COMMAND_CENTER = {
  id: 'command-center',
  label: 'Command Center',
  railLabel: 'COMMAND CENTER',
  path: '/command-center',
  barryModule: 'command-center',
  description: 'People, companies, missions and messaging',
};

/**
 * Destinations that belong to no NAV_GROUP.
 *
 * Named for the grouping, not for visibility — these are not "lesser"
 * destinations. Command Center is a first-class sidebar item; Settings is
 * reached from the top bar's user menu and the mobile drawer. What they share
 * is that the locked IA puts neither in PIPELINE, RELATIONSHIPS or
 * INTELLIGENCE. SIDEBAR_ORDER, below, is what decides who draws in the
 * sidebar.
 */
export const UNGROUPED_DESTINATIONS = [COMMAND_CENTER, SETTINGS];

const ALL_DESTINATIONS = [MISSION_CONTROL, ...MODULES, ...UNGROUPED_DESTINATIONS];

/**
 * SIDEBAR ORDER — the exact top-to-bottom order of the wide sidebar.
 *
 * Deliberately a flat list, not derived from GROUP_ORDER. The final brief
 * specifies this order explicitly and states that the Pipeline /
 * Relationships / Intelligence grouping is an architectural decision, not a
 * visual one in this sidebar style — so no group headers render, and Recon
 * sits between Basecamp and Reinforcements rather than after Fallback.
 *
 * GROUP_ORDER and modulesInGroup() are kept: the grouping still describes the
 * product's architecture and is used elsewhere. It just is not what the
 * sidebar draws.
 */
export const SIDEBAR_ORDER = [
  'mission-control',
  'scout',
  'hunter',
  'sniper',
  'basecamp',
  'recon',
  'reinforcements',
  'fallback',
  'command-center',
];

/** The sidebar's destinations, in the exact order above. */
export function sidebarDestinations() {
  return SIDEBAR_ORDER
    .map(id => ALL_DESTINATIONS.find(d => d.id === id))
    .filter(Boolean);
}

/**
 * The same destinations, grouped, for the MOBILE hamburger drawer.
 *
 * Desktop deliberately draws a flat list — the final nav brief says the
 * Pipeline / Relationships / Intelligence split is an architectural decision,
 * not a visual one in that sidebar style. The mobile drawer is a different
 * surface with a different job: it is the only place modules are listed at all,
 * so it is where the shape of the platform has to be legible.
 *
 * Returns sections, each `{ label, destinations }`. `label: null` means an
 * ungrouped run that renders without a heading — Mission Control at the top,
 * and Command Center at the bottom, both of which sit outside the three groups.
 * Same objects, same order within groups; only the presentation differs.
 */
export function mobileDrawerSections() {
  const byId = id => ALL_DESTINATIONS.find(d => d.id === id);
  const inGroup = group =>
    SIDEBAR_ORDER.map(byId).filter(d => d && d.group === group);

  const grouped = new Set(
    GROUP_ORDER.flatMap(g => inGroup(g)).map(d => d.id)
  );

  // Anything in the sidebar that belongs to no group and is not Mission
  // Control. Derived rather than hard-coded, so a new ungrouped destination
  // appears here instead of silently vanishing from mobile.
  const ungrouped = SIDEBAR_ORDER
    .map(byId)
    .filter(d => d && d.id !== MISSION_CONTROL.id && !grouped.has(d.id));

  return [
    { label: null, destinations: [MISSION_CONTROL] },
    ...GROUP_ORDER.map(g => ({ label: g, destinations: inGroup(g) })),
    ...(ungrouped.length ? [{ label: null, destinations: ungrouped }] : []),
  ].filter(s => s.destinations.length > 0);
}

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
