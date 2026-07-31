/**
 * SniperMain — Sniper module content.
 *
 * MIGRATED INTO THE GLOBAL SHELL. This file used to be a self-contained
 * application shell: a 60px icon rail listing every module, a theme picker, a
 * settings button, a "back to Mission Control" button, a user footer and its
 * own Barry instance.
 *
 * Sniper now owns only what is Sniper's:
 *
 *   Global navigation  → MainLayout          (moves the user across Idynify)
 *   Module navigation  → ModuleSubNav        (changes the working view here)
 *
 * Sections and their descriptions are unchanged — only the panel's visual
 * formatting now comes from the same shared component Scout and Hunter use,
 * so the three cannot drift apart.
 *
 * Barry comes from the shell: one instance, one conversation thread, carrying
 * the navigation context contract.
 *
 * SNIPER = post-demo conversion pipeline. Contacts here have already had a
 * meeting; the goal is converting them into customers.
 *
 * Mobile (max-width: 768px) keeps its original self-contained layout. Mobile
 * is out of scope; see constraint C3 in the Phase 0 assessment.
 */
import { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  Activity, BookOpen, BarChart3, Users, Building2, Target,
  Palette, Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import ModuleSubNav from '../../components/layout/ModuleSubNav';

// Sniper sections
import PipelineSection         from './sections/PipelineSection';
import TargetsSection          from './sections/TargetsSection';
import TouchesSection          from './sections/TouchesSection';
import PlaybooksSection        from './sections/PlaybooksSection';
import OutcomesSection         from './sections/OutcomesSection';
import SniperCompaniesSection  from './sections/SniperCompaniesSection';
import AllLeads                from '../Scout/AllLeads';

const SNIPER_TEAL = '#14b8a6';

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
        <Palette size={16} color={BRAND.pink} />
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
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? BRAND.pink : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={BRAND.pink} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function Av({ initials, color = SNIPER_TEAL, size = 24 }) {
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

// ─── SNIPER sub-nav items ─────────────────────────────────────────────────────
const SNIPER_ITEMS = [
  { id: 'people',    label: 'People',    Icon: Users,          desc: 'Add to pipeline'      },
  { id: 'companies', label: 'Companies', Icon: Building2,      desc: 'Saved companies'      },
  { id: 'pipeline',  label: 'Pipeline',  Icon: Target,         desc: 'Conversion board'     },
  { id: 'targets',   label: 'Targets',   Icon: Users,          desc: 'All contacts'         },
  { id: 'touches',   label: 'Touches',   Icon: Activity,       desc: 'Follow-up log'        },
  { id: 'playbooks', label: 'Playbooks', Icon: BookOpen,       desc: 'Conversion sequences' },
  { id: 'outcomes',  label: 'Outcomes',  Icon: BarChart3,      desc: 'Win/loss analytics'   },
];

const SETTINGS_ORANGE = '#faaa20';

const TAB_MAP = {
  pipeline:  'pipeline',
  targets:   'targets',
  companies: 'companies',
  people:    'people',
  touches:   'touches',
  playbooks: 'playbooks',
  outcomes:  'outcomes',
};


function SniperShellInner() {
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
  // silent — same rule as Scout and Hunter, so the modules behave alike.
  const tabParam = searchParams.get('tab') || location.state?.activeTab;
  const urlTab = tabParam ? TAB_MAP[tabParam] : null;

  const [activeTab, setActiveTab] = useState(urlTab || 'people');
  if (urlTab && urlTab !== activeTab) setActiveTab(urlTab);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    // No { replace: true }. Tab changes are navigation and belong in history:
    // previously every intra-module move was written with replace, so browser
    // Back skipped the whole module and exited Sniper entirely.
    setSearchParams({ tab: tabId });
  };

  const renderMain = () => (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {activeTab === 'pipeline'  && <PipelineSection />}
      {activeTab === 'targets'   && <TargetsSection />}
      {activeTab === 'companies' && <SniperCompaniesSection />}
      {activeTab === 'people'    && <AllLeads mode="sniper" />}
      {activeTab === 'touches'   && <TouchesSection />}
      {activeTab === 'playbooks' && <PlaybooksSection />}
      {activeTab === 'outcomes'  && <OutcomesSection />}
    </div>
  );

  // ── Mobile layout ──────────────────────────────────────────────────────────
  // ── Mobile ───────────────────────────────────────────────────────────────
  // Content only. Sniper used to render its own mobile top bar and a
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
        title="SNIPER"
        tagline="Close deals"
        items={SNIPER_ITEMS}
        activeId={activeTab}
        onSelect={switchTab}
        storageKey="sniper_subnav_collapsed"
      />

      <div className="module-workspace">
        {renderMain()}
      </div>
    </div>
  );
}

/**
 * The pre-migration version resolved the signed-in user purely to render an
 * email in a sidebar footer. Identity is the shell's job now.
 */
export default function SniperMain() {
  return <SniperShellInner />;
}
