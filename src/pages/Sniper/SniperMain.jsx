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
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Activity, BookOpen, BarChart3, Users, Building2, Target,
  Palette, Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';
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

  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

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
  if (isMobile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: '100dvh', width: '100%',
        background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
        color: T.text, overflow: 'hidden', position: 'relative',
      }}>
        <style>{`
          * { box-sizing: border-box; }
          button, input, select, textarea { font-family: Inter, system-ui, sans-serif; }
          ::-webkit-scrollbar { width: 3px; height: 3px; }
          ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
          @keyframes twinkle { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
          @keyframes fadeUp  { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
          input::placeholder, textarea::placeholder { color: ${T.textFaint}; }
        `}</style>

        {/* Mobile top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', borderBottom: `1px solid ${T.border}`,
          background: T.railBg, flexShrink: 0, zIndex: 2,
        }}>
          <div
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, overflow: 'hidden', cursor: 'pointer',
              boxShadow: `0 2px 10px ${BRAND.pink}40`,
            }}
          >
            <img src={ASSETS.logoMark} alt="Mission Control"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '✦'; }}
            />
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>
            {SNIPER_ITEMS.find(i => i.id === activeTab)?.label || 'SNIPER'}
          </div>
          <div
            onClick={() => navigate('/settings')}
            title="Settings"
            style={{
              width: 34, height: 34, borderRadius: 9,
              background: location.pathname === '/settings' ? 'rgba(250,170,32,0.15)' : T.accentBg,
              border: `1px solid ${location.pathname === '/settings' ? SETTINGS_ORANGE : T.accentBdr}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            <SettingsIcon size={16} color={SETTINGS_ORANGE} />
          </div>
          <ThemePicker />
        </div>

        {/* Mobile horizontal tab nav */}
        <div style={{
          display: 'flex', overflowX: 'auto', flexShrink: 0,
          background: T.navBg, borderBottom: `1px solid ${T.border}`,
          padding: '0 6px',
        }}>
          {SNIPER_ITEMS.map(it => {
            const active = activeTab === it.id;
            return (
              <div
                key={it.id}
                onClick={() => switchTab(it.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '9px 12px', flexShrink: 0,
                  borderBottom: `2px solid ${active ? SNIPER_TEAL : 'transparent'}`,
                  color: active ? SNIPER_TEAL : T.textMuted,
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'all 0.12s',
                }}
              >
                <it.Icon size={12} />
                {it.label}
              </div>
            );
          })}
        </div>

        {/* Mobile main content — paddingBottom leaves room for BottomNav */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1, paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}>
          {renderMain()}
        </div>

        {/* Cross-module bottom nav */}
        <BottomNav onOpenMore={() => setMoreSheetOpen(true)} />
        <MoreSheet isOpen={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} />
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
