/**
 * PeopleMain — Command Center module content.
 *
 * MIGRATED INTO THE GLOBAL SHELL, and the last module to go. This file used to
 * be a self-contained application shell — its own 60px icon rail listing every
 * module, its own hand-built 190px sub-nav, a theme picker, a settings button,
 * a "back to Mission Control" button, a user footer and its own Barry instance.
 * Its own header said so: "This component is self-contained — it does NOT use
 * MainLayout."
 *
 * Command Center now owns only what is Command Center's:
 *
 *   Global navigation  → MainLayout        (moves the user across Idynify)
 *   Module navigation  → ModuleSubNav      (changes the working view here)
 *
 * MIGRATED AS-IS. Every section it contained it still contains, in the same
 * order, with the same descriptions and the same behaviour. Whether these nine
 * sections belong together behind one route is a real information-architecture
 * question — and deliberately not answered here. The shell gets finished and
 * made consistent first; the product decision is made against a consistent
 * shell rather than in the middle of a migration.
 *
 * Command Center is a first-class sidebar item. An earlier direction correction
 * said it was not a top-level module on the grounds that it already appeared in
 * Hunter's sub-nav — it does not, and that has been confirmed as an error in
 * the brief. It stays where it is.
 *
 * Mobile (max-width: 768px) keeps its original self-contained layout. Mobile is
 * out of scope; see constraint C3 in the Phase 0 assessment.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import {
  Users, Building2, Zap, Archive, BarChart3, Swords, Mail,
  Crosshair, Palette, Check, Plus, RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import ModuleSubNav from '../../components/layout/ModuleSubNav';
import AllLeads from './AllLeads';
import SharedCompaniesView from '../../components/shared/SharedCompaniesView';
import MissionsSection from '../Hunter/sections/MissionsSection';
import WeaponsSection from '../Hunter/sections/WeaponsSection';
import ArsenalSection from '../Hunter/sections/ArsenalSection';
import OutcomesSection from '../Hunter/sections/OutcomesSection';
import GoToWar from './GoToWar';
import NotificationCenter from '../../components/notifications/NotificationCenter';

// Command Center accent color
const CC_CYAN = BRAND.cyan;

// Orange token for settings accent (mobile top bar)
const SETTINGS_ORANGE = '#faaa20';

// ─── ThemePicker ──────────────────────────────────────────────────────────────
// Mobile only. The desktop copy went with the rest of the module's chrome —
// appearance is a shell-level setting, not a per-module one.
function ThemePicker({ dropUp = true }) {
  const T = useT();
  const { themeId, setThemeId } = useThemeCtx();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        title="Change theme"
        style={{
          width: 34, height: 34, borderRadius: 9, background: T.accentBg,
          border: `1px solid ${T.accentBdr}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <Palette size={16} color={CC_CYAN} />
      </div>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', ...(dropUp ? { bottom: 42, left: 0 } : { top: 42, right: 0 }), width: 226,
            background: T.cardBg, border: `1px solid ${T.border2}`,
            borderRadius: 14, padding: 14,
            boxShadow: `0 20px 60px ${T.isDark ? '#00000099' : '#00000020'}`,
            zIndex: 300, animation: 'fadeUp 0.15s ease',
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 2, color: T.textFaint, marginBottom: 10, fontWeight: 700 }}>
            APPEARANCE
          </div>
          {Object.values(THEMES).map(theme => (
            <div
              key={theme.id}
              onClick={() => { setThemeId(theme.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 9, cursor: 'pointer',
                background: themeId === theme.id ? T.accentBg : 'transparent',
                border: `1px solid ${themeId === theme.id ? T.accentBdr : 'transparent'}`,
                transition: 'all 0.12s', marginBottom: 4,
              }}
              onMouseEnter={e => { if (themeId !== theme.id) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (themeId !== theme.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                width: 34, height: 22, borderRadius: 6,
                background: theme.swatchBg, border: `1px solid ${T.border2}`, flexShrink: 0,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? CC_CYAN : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={CC_CYAN} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Command Center's sections — unchanged.
 *
 * `route` entries navigate to a sibling route inside the same shell rather than
 * switching a panel, the same way Scout's Total Market and Game Mode do. Before
 * the migration that navigation replaced the entire application chrome; now it
 * swaps only the content.
 */
const CC_ITEMS = [
  { id: 'people',     label: 'People',       Icon: Users,     desc: 'Full contacts roster — all view'  },
  { id: 'companies',  label: 'Companies',    Icon: Building2, desc: 'Full accounts roster — all view'  },
  { id: 'missions',   label: 'Missions',     Icon: Zap,       desc: 'Create and manage missions'       },
  { id: 'campaigns',  label: 'Campaigns',    Icon: Mail,      desc: 'Send emails to multiple contacts', route: '/hunter/campaign/new' },
  { id: 'cadences',   label: 'Cadences',     Icon: RefreshCw, desc: 'Bulk outreach history',            route: '/scout/cadences' },
  { id: 'go_to_war',  label: 'Go To War',    Icon: Swords,    desc: '8-phase bulk mission launcher'    },
  { id: 'weapons',    label: 'Weapons',      Icon: Crosshair, desc: 'Channel selector, message builder' },
  { id: 'arsenal',    label: 'Arsenal',      Icon: Archive,   desc: 'Saved message templates library'  },
  { id: 'outcomes',   label: 'Outcomes',     Icon: BarChart3, desc: 'Mission performance analytics'    },
];

// ─── Tab → URL param mapping ──────────────────────────────────────────────────
// Only the panel sections appear here. Campaigns and Cadences are routes, so
// they leave Command Center rather than selecting inside it.
const TAB_MAP = {
  missions:   'missions',
  people:     'people',
  companies:  'companies',
  go_to_war:  'go_to_war',
  weapons:    'weapons',
  arsenal:    'arsenal',
  outcomes:   'outcomes',
};

/** What bare /command-center means. One answer, in one place. */
const DEFAULT_SECTION = 'people';

// ─── Empty Missions CTA ───────────────────────────────────────────────────────
function EmptyMissionsCTA({ navigate, T }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, zIndex: 1, position: 'relative',
    }}>
      <div style={{
        maxWidth: 400, textAlign: 'center',
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 18, padding: '36px 32px',
        boxShadow: `0 8px 32px ${T.isDark ? '#00000040' : '#00000010'}`,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: `${CC_CYAN}18`, border: `1px solid ${CC_CYAN}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <Zap size={26} color={CC_CYAN} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
          Start your first mission
        </div>
        <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, marginBottom: 24 }}>
          Build your mission, assign people and companies, choose your weapons, and set sequences — all from Command Center.
        </div>
        <button
          onClick={() => navigate('/hunter/create-mission')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '11px 22px', borderRadius: 10, border: 'none',
            background: CC_CYAN, color: '#000',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            boxShadow: `0 4px 16px ${CC_CYAN}40`,
          }}
        >
          <Plus size={16} />
          Create Mission
        </button>
      </div>
    </div>
  );
}

// ─── PeopleShellInner ─────────────────────────────────────────────────────────
function PeopleShellInner({ user }) {
  const T = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const mql = window.matchMedia('(max-width: 768px)');
  const [isMobile, setIsMobile] = useState(() => mql.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  /**
   * The active section is DERIVED from the URL rather than mirrored into state
   * by an effect.
   *
   * The previous version held it in state and had an effect push the URL into
   * it, which meant that for one render after any navigation the panel showed
   * the old section while the address bar showed the new one. Deriving it makes
   * the two incapable of disagreeing. `location.state.activeTab` is still read:
   * older call sites navigate here that way.
   */
  const tabParam = searchParams.get('tab') || location.state?.activeTab || null;
  const activeSection = (tabParam && TAB_MAP[tabParam]) || DEFAULT_SECTION;

  const switchSection = (sectionId) => {
    const item = CC_ITEMS.find(i => i.id === sectionId);
    if (item?.route) {
      navigate(item.route);
      return;
    }
    // No { replace: true }. Section changes are navigation and belong in
    // history: previously every move inside Command Center was written with
    // replace, so browser Back skipped the whole module and left it entirely.
    setSearchParams({ tab: sectionId });
  };

  // Missions and campaigns data (needed for MissionsSection, OutcomesSection,
  // the missions count badge and the empty state).
  const [missions, setMissions] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [missionsLoading, setMissionsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        if (!user?.uid) return;
        const uid = user.uid;

        const missionsSnap = await getDocs(query(
          collection(db, 'users', uid, 'missions'),
          orderBy('createdAt', 'desc')
        ));
        setMissions(missionsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        const campaignsSnap = await getDocs(query(
          collection(db, 'users', uid, 'campaigns'),
          orderBy('createdAt', 'desc')
        ));
        setCampaigns(campaignsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error loading Command Center data:', err);
      } finally {
        setMissionsLoading(false);
      }
    }
    loadData();
  }, [user?.uid]);

  const activeMissionsCount = missions.filter(m => m.status === 'autopilot' || m.status === 'draft').length;
  const hasActiveMissions = activeMissionsCount > 0;

  // The missions count rides along on the item rather than being drawn by the
  // panel, so the panel stays generic and the count stays Command Center's.
  const subNavItems = CC_ITEMS.map(it =>
    it.id === 'missions' && activeMissionsCount > 0
      ? { ...it, badge: activeMissionsCount }
      : it
  );

  const renderMain = () => {
    switch (activeSection) {
      case 'missions':
        if (!missionsLoading && !hasActiveMissions) {
          return <EmptyMissionsCTA navigate={navigate} T={T} />;
        }
        return (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <MissionsSection missions={missions} loading={missionsLoading} />
          </div>
        );
      case 'people':
        return (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <AllLeads mode="people" />
          </div>
        );
      case 'companies':
        return (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <SharedCompaniesView mode="all" />
          </div>
        );
      case 'go_to_war':
        return (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <GoToWar />
          </div>
        );
      case 'weapons':
        return (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <WeaponsSection />
          </div>
        );
      case 'arsenal':
        return (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <ArsenalSection />
          </div>
        );
      case 'outcomes':
        return (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <OutcomesSection campaigns={campaigns} missions={missions} />
          </div>
        );
      default:
        return null;
    }
  };

  // ── Mobile — preserved from the pre-migration layout (constraint C3) ────────
  // ── Mobile ───────────────────────────────────────────────────────────────
  // Content only. Command Center used to render its own mobile top bar and a
  // horizontal strip of its own sections beneath it — module navigation in the
  // one place a phone user's thumb cannot reach, while the bottom bar listed
  // MODULES, duplicating the hamburger.
  //
  // The shell owns all three surfaces now: hamburger for modules, bottom bar
  // for these sections, top bar for where you are.
  if (isMobile) {
    return (
      <div className="module-mobile">
        {renderMain()}
      </div>
    );
  }

  // ── Desktop ────────────────────────────────────────────────────────────────
  // Layer 1 (the sidebar) is the shell's. Layer 2 — this panel — is Command
  // Center's, and is now the same component every other module renders rather
  // than the ninth hand-built copy of nearly the same thing.
  return (
    <div className="module-shell">
      <ModuleSubNav
        title="COMMAND CENTER"
        tagline="People, companies, missions and messaging"
        items={subNavItems}
        activeId={activeSection}
        onSelect={switchSection}
        storageKey="cc_subnav_collapsed"
      />

      <div className="module-workspace">
        {renderMain()}
      </div>
    </div>
  );
}

/**
 * Command Center still resolves the signed-in user, where the other migrated
 * modules dropped it. The difference is what it is for: elsewhere the
 * resolution existed only to print an email in a sidebar footer, and the footer
 * is the shell's now. Here it is impersonation-aware DATA resolution — the
 * missions and campaigns queries below are scoped by uid, so an admin viewing
 * another account has to see that account's missions, not their own.
 */
export default function PeopleMain() {
  const activeUser = useActiveUser();
  const [user, setUser] = useState(activeUser || auth.currentUser);

  useEffect(() => {
    if (activeUser?._isImpersonated) {
      setUser(activeUser);
      return;
    }
    const unsub = auth.onAuthStateChanged(u => setUser(u));
    return unsub;
  }, [activeUser]);

  return <PeopleShellInner user={user} />;
}
