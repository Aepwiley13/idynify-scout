/**
 * ReinforcementsMain — Reinforcements module content.
 *
 * MIGRATED INTO THE GLOBAL SHELL. This file used to be a self-contained
 * application shell: a 60px icon rail listing every module, a theme picker, a
 * settings button, a "back to Mission Control" button, a user footer and its
 * own Barry instance.
 *
 * Reinforcements now owns only what is Reinforcements':
 *
 *   Global navigation  → MainLayout          (moves the user across Idynify)
 *   Module navigation  → ModuleSubNav        (changes the working view here)
 *
 * Sections and their descriptions are unchanged — only the panel's visual
 * formatting now comes from the shared component the other modules use.
 *
 * Mobile (max-width: 768px) keeps its original self-contained layout. Mobile
 * is out of scope; see constraint C3 in the Phase 0 assessment.
 */
import { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, Lightbulb, Award, PenLine, Heart,
  Palette, Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import ModuleSubNav from '../../components/layout/ModuleSubNav';

// Reinforcements sections
import DashboardSection      from './sections/DashboardSection';
import OpportunitiesSection  from './sections/OpportunitiesSection';
import LeaderboardSection    from './sections/LeaderboardSection';
import RecordReferralSection from './sections/RecordReferralSection';
import NurtureSection        from './sections/NurtureSection';

const REINFORCEMENTS_AMBER = '#f59e0b';

// ─── ThemePicker ─────────────────────────────────────────────────────────────
function ThemePicker() {
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
        <Palette size={16} color={REINFORCEMENTS_AMBER} />
      </div>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 42, left: 0, width: 226,
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
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? REINFORCEMENTS_AMBER : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={REINFORCEMENTS_AMBER} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function Av({ initials, color = REINFORCEMENTS_AMBER, size = 24 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${color}20`, border: `1.5px solid ${color}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 700, color, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ─── REINFORCEMENTS sub-nav items ───────────────────────────────────────────
const REINFORCEMENTS_ITEMS = [
  { id: 'dashboard',     label: 'Dashboard',     Icon: LayoutDashboard, desc: 'Network overview'      },
  { id: 'opportunities', label: 'Opportunities', Icon: Lightbulb,       desc: 'Intro suggestions'     },
  { id: 'leaderboard',   label: 'Leaderboard',   Icon: Award,           desc: 'Top referral sources'  },
  { id: 'record',        label: 'Record',        Icon: PenLine,         desc: 'Log a referral'        },
  { id: 'nurture',       label: 'Nurture',       Icon: Heart,           desc: 'Stay-in-touch alerts'  },
];

const SETTINGS_ORANGE = '#faaa20';

const TAB_MAP = {
  dashboard:     'dashboard',
  opportunities: 'opportunities',
  leaderboard:   'leaderboard',
  record:        'record',
  nurture:       'nurture',
};


function ReinforcementsShellInner() {
  const T = useT();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const mql = window.matchMedia('(max-width: 768px)');
  const [isMobile, setIsMobile] = useState(() => mql.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // Active tab follows the URL, and holds its last value when the URL is
  // silent — same rule as the other migrated modules.
  const tabParam = searchParams.get('tab') || location.state?.activeTab;
  const urlTab = tabParam ? TAB_MAP[tabParam] : null;

  const [activeTab, setActiveTab] = useState(urlTab || 'dashboard');
  if (urlTab && urlTab !== activeTab) setActiveTab(urlTab);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    // No { replace: true }. Tab changes are navigation and belong in history.
    setSearchParams({ tab: tabId });
  };

  const renderMain = () => (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {activeTab === 'dashboard'     && <DashboardSection />}
      {activeTab === 'opportunities' && <OpportunitiesSection />}
      {activeTab === 'leaderboard'   && <LeaderboardSection />}
      {activeTab === 'record'        && <RecordReferralSection />}
      {activeTab === 'nurture'       && <NurtureSection />}
    </div>
  );

  // ── Mobile layout ──────────────────────────────────────────────────────────
  // ── Mobile ───────────────────────────────────────────────────────────────
  // Content only. Reinforcements used to render its own mobile top bar and a
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

  // ── Desktop — content only. The shell owns everything around this. ───────
  return (
    <div className="module-shell">
      <ModuleSubNav
        title="REINFORCEMENTS"
        tagline="Referral and warm-intro network"
        items={REINFORCEMENTS_ITEMS}
        activeId={activeTab}
        onSelect={switchTab}
        storageKey="reinforcements_subnav_collapsed"
      />

      <div className="module-workspace">
        {renderMain()}
      </div>
    </div>
  );
}

export default function ReinforcementsMain() {
  return <ReinforcementsShellInner />;
}
