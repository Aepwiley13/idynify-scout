/**
 * MOBILE NAVIGATION — the bottom bar's contents, per module.
 *
 * The Mobile Constitution, and the reason this file exists:
 *
 *   HAMBURGER  = change the workspace   (move between modules)
 *   BOTTOM BAR = change the view        (inside the current workspace)
 *   TOP BAR    = where you are          (+ search and notifications)
 *
 * Three surfaces, three jobs, no overlap. Before this, the bottom bar listed
 * MODULES — the same job the hamburger does — while each module rendered a
 * horizontal strip of its own SECTIONS just under the top bar. So the global
 * navigation appeared twice and the module navigation appeared in the one place
 * a phone user's thumb cannot comfortably reach. This file moves sections to
 * the bottom bar, which is what frees the strip to be deleted.
 *
 * WHY THE LISTS LIVE HERE AND NOT IN THE MODULES
 *
 * The bottom bar is the shell's, and the shell must not import nine module
 * files to draw it. So each module's mobile sections are declared here, keyed
 * to the same ids the module already uses.
 *
 * That is a second copy of a section list, which is exactly how nine diverging
 * copies of the module rail happened. `mobileNavigation.test.jsx` guards it:
 * every label below is checked against the labels the module actually renders
 * in its desktop sub-nav. Rename a section in one place and the test fails.
 *
 * `to` is a complete destination, so the bottom bar never has to know whether a
 * module navigates by `?tab=` (most of them) or by a real path (Recon).
 *
 * `section` is the module's real name for the item, given whenever the bar
 * shortens it — a 360px cell fits "Follow Up", not "Follow Up Now". Declaring
 * the full name is what lets the drift test compare exactly instead of
 * guessing at prefixes, so a rename cannot hide behind an abbreviation.
 */

import {
  Zap, Building2, Users, Plus, Settings, RefreshCw, TrendingUp, Gamepad2,
  AlertTriangle, CalendarCheck, Inbox, Sparkles, Target, Activity, BookOpen,
  BarChart3, HeartPulse, LayoutDashboard, Lightbulb, Award, PenLine, Heart,
  FileText, MessageSquare, Shield, Swords, Brain, Mail, Crosshair, Archive,
  CreditCard, Plug, Briefcase, Palette,
} from 'lucide-react';
import { BRAND, STATUS } from '../theme/tokens';

/**
 * The colour the active bottom-bar item takes, so the user always knows which
 * workspace they are in without reading the label.
 */
export const MODULE_COLORS = {
  'mission-control': BRAND.pink,
  scout: BRAND.cyan,
  hunter: BRAND.purple,
  sniper: '#06b6d4',
  basecamp: STATUS.green,
  reinforcements: STATUS.amber,
  fallback: '#f97316',
  recon: '#6366f1',
  'command-center': '#3b82f6',
  settings: '#faaa20',
};

/**
 * Bottom bar per module: at most four primary items, plus whatever overflows
 * into the module's own More sheet.
 *
 * Four is the ceiling because More is a fifth cell — five is the most that fits
 * a 360px screen without the labels truncating into initials.
 */
export const MODULE_BOTTOM_NAV = {
  scout: {
    primary: [
      { id: 'daily',     label: 'Daily',   Icon: Zap,       to: '/scout?tab=daily-leads',     section: 'Daily Discoveries' },
      { id: 'saved',     label: 'Saved',   Icon: Building2, to: '/scout?tab=saved-companies', section: 'Saved Companies' },
      { id: 'all',       label: 'People',  Icon: Users,     to: '/scout?tab=all-leads' },
      { id: 'scoutplus', label: 'Scout+',  Icon: Plus,      to: '/scout?tab=scout-plus' },
    ],
    overflow: [
      { id: 'cadences',    label: 'Cadences',     Icon: RefreshCw,  to: '/scout?tab=cadences' },
      { id: 'totalmarket', label: 'Total Market', Icon: TrendingUp, to: '/scout/total-market' },
      { id: 'icpsettings', label: 'ICP Settings', Icon: Settings,   to: '/scout?tab=icp-settings' },
      { id: 'game',        label: 'Game Mode',    Icon: Gamepad2,   to: '/scout/game' },
    ],
  },

  hunter: {
    primary: [
      // Blitz is chrome-free by design and lives outside the shell, so it
      // leaves the module rather than switching a view inside it. It is on the
      // bar because it is Hunter's headline action, not despite that.
      { id: 'blitz',     label: 'Blitz',      Icon: Zap,           to: '/hunter/blitz',        section: 'Blitz Mode' },
      { id: 'all',       label: 'All People', Icon: Users,         to: '/hunter?tab=all' },
      { id: 'companies', label: 'Companies',  Icon: Building2,     to: '/hunter?tab=companies' },
      { id: 'followup',  label: 'Follow Up',  Icon: AlertTriangle, to: '/hunter?tab=followup', section: 'Follow Up Now' },
    ],
    overflow: [
      { id: 'today',   label: "Today's Actions", Icon: CalendarCheck, to: '/hunter?tab=today' },
      { id: 'replied', label: 'Replied',         Icon: Inbox,         to: '/hunter?tab=replied' },
      { id: 'active',  label: 'Active',          Icon: Sparkles,      to: '/hunter?tab=active' },
      { id: 'new',     label: 'New (Unengaged)', Icon: Sparkles,      to: '/hunter?tab=new' },
    ],
  },

  sniper: {
    primary: [
      { id: 'people',    label: 'People',    Icon: Users,     to: '/sniper?tab=people' },
      { id: 'companies', label: 'Companies', Icon: Building2, to: '/sniper?tab=companies' },
      { id: 'pipeline',  label: 'Pipeline',  Icon: Target,    to: '/sniper?tab=pipeline' },
      { id: 'targets',   label: 'Targets',   Icon: Users,     to: '/sniper?tab=targets' },
    ],
    overflow: [
      { id: 'touches',   label: 'Touches',   Icon: Activity,  to: '/sniper?tab=touches' },
      { id: 'playbooks', label: 'Playbooks', Icon: BookOpen,  to: '/sniper?tab=playbooks' },
      { id: 'outcomes',  label: 'Outcomes',  Icon: BarChart3, to: '/sniper?tab=outcomes' },
    ],
  },

  basecamp: {
    primary: [
      { id: 'people',    label: 'People',    Icon: Users,      to: '/basecamp?tab=people' },
      { id: 'companies', label: 'Companies', Icon: Building2,  to: '/basecamp?tab=companies' },
      { id: 'engage',    label: 'Engage',    Icon: Zap,        to: '/basecamp?tab=engage' },
      { id: 'csm',       label: 'CSM',       Icon: HeartPulse, to: '/basecamp?tab=csm' },
    ],
    overflow: [],
  },

  reinforcements: {
    primary: [
      { id: 'dashboard',     label: 'Dashboard',     Icon: LayoutDashboard, to: '/reinforcements?tab=dashboard' },
      { id: 'opportunities', label: 'Opportunities', Icon: Lightbulb,       to: '/reinforcements?tab=opportunities' },
      { id: 'leaderboard',   label: 'Leaderboard',   Icon: Award,           to: '/reinforcements?tab=leaderboard' },
      { id: 'nurture',       label: 'Nurture',       Icon: Heart,           to: '/reinforcements?tab=nurture' },
    ],
    overflow: [
      { id: 'record', label: 'Record', Icon: PenLine, to: '/reinforcements?tab=record' },
    ],
  },

  fallback: {
    primary: [
      { id: 'comeback',  label: 'Comeback',  Icon: Sparkles,  to: '/fallback?tab=comeback' },
      { id: 'people',    label: 'People',    Icon: Users,     to: '/fallback?tab=people' },
      { id: 'companies', label: 'Companies', Icon: Building2, to: '/fallback?tab=companies' },
    ],
    overflow: [],
  },

  recon: {
    // Recon navigates by real path, not by ?tab=. The bottom bar does not need
    // to know that — `to` is a destination either way.
    primary: [
      { id: 'overview',         label: 'Overview',  Icon: LayoutDashboard, to: '/recon' },
      { id: 'icp-intelligence', label: 'ICP',       Icon: Target,          to: '/recon/icp-intelligence', section: 'ICP Intelligence' },
      { id: 'messaging',        label: 'Messaging', Icon: MessageSquare,   to: '/recon/messaging',        section: 'Messaging & Voice' },
      { id: 'barry-training',   label: 'Context',   Icon: Brain,           to: '/recon/barry-training',   section: 'What Barry Knows' },
    ],
    overflow: [
      { id: 'alignment-brief',   label: 'Alignment Brief',  Icon: FileText, to: '/recon/alignment-brief' },
      { id: 'user-profile',      label: 'User Profile',     Icon: Users,    to: '/recon/user-profile' },
      { id: 'objections',        label: 'Objections',       Icon: Shield,   to: '/recon/objections' },
      { id: 'competitive-intel', label: 'Competitive Intel', Icon: Swords,  to: '/recon/competitive-intel' },
      { id: 'buying-signals',    label: 'Buying Signals',   Icon: Zap,      to: '/recon/buying-signals' },
    ],
  },

  'command-center': {
    primary: [
      { id: 'people',    label: 'People',    Icon: Users,   to: '/command-center?tab=people' },
      { id: 'missions',  label: 'Missions',  Icon: Zap,     to: '/command-center?tab=missions' },
      { id: 'campaigns', label: 'Campaigns', Icon: Mail,    to: '/hunter/campaign/new' },
      { id: 'arsenal',   label: 'Arsenal',   Icon: Archive, to: '/command-center?tab=arsenal' },
    ],
    overflow: [
      { id: 'companies', label: 'Companies', Icon: Building2,  to: '/command-center?tab=companies' },
      { id: 'cadences',  label: 'Cadences',  Icon: RefreshCw,  to: '/scout/cadences' },
      { id: 'weapons',   label: 'Weapons',   Icon: Crosshair,  to: '/command-center?tab=weapons' },
      { id: 'go_to_war', label: 'Go To War', Icon: Swords,     to: '/command-center?tab=go_to_war' },
      { id: 'outcomes',  label: 'Outcomes',  Icon: BarChart3,  to: '/command-center?tab=outcomes' },
    ],
  },

  /**
   * Settings is not in the brief's table — it is not a module and it is not in
   * the hamburger's module list. It is in this one because the Constitution
   * applies to it: it is a workspace with seven views, and its horizontal
   * strip was the last one in the product. Extending the rule rather than
   * leaving one screen exempt.
   */
  settings: {
    primary: [
      { id: 'account',      label: 'Account',      Icon: Users,      to: '/settings' },
      { id: 'security',     label: 'Security',     Icon: Shield,     to: '/settings?tab=security' },
      { id: 'billing',      label: 'Billing',      Icon: CreditCard, to: '/settings?tab=billing' },
      { id: 'integrations', label: 'Integrations', Icon: Plug,       to: '/settings?tab=integrations' },
    ],
    overflow: [
      { id: 'services',   label: 'Your Services', Icon: Briefcase, to: '/settings?tab=services' },
      { id: 'hunter',     label: 'Hunter',        Icon: Settings,  to: '/settings?tab=hunter' },
      { id: 'appearance', label: 'Appearance',    Icon: Palette,   to: '/settings?tab=appearance' },
    ],
  },
};

/**
 * MISSION CONTROL IS NOT IN THE TABLE ABOVE, ON PURPOSE.
 *
 * The brief specifies a Mission Control bottom bar of
 * `[Priorities] [Pipeline] [Activity] [Barry]`. Those four sections do not
 * exist: `MissionControlDashboardV2` is a single scrolling dashboard — a module
 * grid and a "Top Recommended Companies" list — with no tabs, no routes and
 * nothing to switch between. Building them would be product work, and the brief
 * says module content changes by zero.
 *
 * The brief's other statement about Mission Control is implementable and is
 * what ships: "the global bottom bar should only appear when the user has no
 * active module context — i.e. on the Mission Control screen only, or as a
 * fallback." So Mission Control and anything unmatched fall through to
 * `GLOBAL_BOTTOM_NAV` below, and the module bar takes over inside a module.
 *
 * Flagged rather than invented.
 *
 * ── FUTURE UX — Mission Control's bottom bar ────────────────────────────────
 *
 * DECIDED, NOT YET BUILDABLE. When the Mission Control content sprint happens,
 * this is what the bar becomes — do not re-derive it:
 *
 *     Priorities · Today · Pipeline · Activity · Barry
 *
 * Five cells, not four-plus-More: there is no overflow, so nothing is hidden
 * and the fifth slot is free. Barry is a cell here rather than a floating
 * button because on Mission Control he is a destination — the screen exists to
 * decide what deserves attention, and he is how you ask.
 *
 * Each needs a real section behind it before it can ship. Today
 * `MissionControlDashboardV2` is one scrolling dashboard: a module grid and a
 * "Top Recommended Companies" list. Nothing routes, nothing switches. Adding
 * bar cells that scroll to anchors would be navigation pretending sections
 * exist, and the bar would lie about where you are the moment the user
 * scrolled.
 *
 * When the sections are real, add a `'mission-control'` entry to
 * MODULE_BOTTOM_NAV above and the fallback below stops applying to it — no
 * other change is needed. `moduleMigration.test.jsx` will then hold the entry
 * to the same drift guard as every other module.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const GLOBAL_BOTTOM_NAV = [
  { id: 'scout',    label: 'Scout',    Icon: Target,     to: '/scout?tab=all-leads' },
  { id: 'hunter',   label: 'Hunter',   Icon: Crosshair,  to: '/hunter?tab=all' },
  { id: 'sniper',   label: 'Sniper',   Icon: Target,     to: '/sniper?tab=people' },
  { id: 'basecamp', label: 'Basecamp', Icon: HeartPulse, to: '/basecamp?tab=people' },
];

/** The bottom bar for a module id, or null when it falls back to global. */
export function bottomNavFor(moduleId) {
  return MODULE_BOTTOM_NAV[moduleId] || null;
}

export function moduleColorFor(moduleId) {
  return MODULE_COLORS[moduleId] || BRAND.pink;
}
