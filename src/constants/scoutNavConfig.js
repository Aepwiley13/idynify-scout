/**
 * scoutNavConfig.js — Shared Scout tab/route config.
 *
 * Single source of truth for the Scout module's URL tab params and their
 * corresponding internal section IDs. Consumed by:
 *  - ScoutMain.jsx  (tab ↔ activeItem sync, sub-nav rendering)
 *  - AllLeads.jsx   (mobile hamburger drawer nav links)
 *
 * Keeping these in one place prevents label/route drift if Scout sections
 * are renamed or new ones are added.
 */

/**
 * Maps URL ?tab= param → internal section ID.
 * Note: both 'scout-plus' and 'company-search' map to 'scoutplus'. This is
 * intentional — do NOT derive ITEM_TO_TAB from this via Object.fromEntries
 * as the last entry would win and produce the wrong canonical URL.
 */
export const SCOUT_TAB_TO_ITEM = {
  'daily-leads':     'daily',
  'saved-companies': 'saved',
  'all-leads':       'all',
  'icp-settings':    'icpsettings',
  'scout-plus':      'scoutplus',
  'company-search':  'scoutplus',
};

/** Maps internal section ID → canonical URL ?tab= param. */
export const SCOUT_ITEM_TO_TAB = {
  daily:       'daily-leads',
  saved:       'saved-companies',
  all:         'all-leads',
  icpsettings: 'icp-settings',
  scoutplus:   'scout-plus',
};

/**
 * Nav items shown in the AllLeads mobile hamburger drawer.
 * Each entry is { label, tab } where `tab` is the ?tab= URL param.
 */
export const SCOUT_DRAWER_NAV_ITEMS = [
  { label: 'Daily Discoveries', tab: 'daily-leads'     },
  { label: 'Saved Companies',   tab: 'saved-companies' },
  { label: 'Scout+',            tab: 'scout-plus'      },
  { label: 'ICP Settings',      tab: 'icp-settings'    },
];
