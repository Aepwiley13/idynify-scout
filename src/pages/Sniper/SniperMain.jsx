/**
 * SniperMain.jsx — Two-column nav shell for the SNIPER module.
 *
 * Architecture:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Icon Rail (60px)  │  Sub-Nav (190px)  │  Main Content  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * SNIPER = post-demo conversion pipeline. Contacts here have already had
 * a meeting — the goal is to convert them into customers.
 *
 * This component is self-contained — it does NOT use MainLayout.
 * The App.jsx /sniper route must NOT use withLayout={true}.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Radar, Crosshair, Eye, Target,
  LayoutDashboard, Activity, BookOpen, BarChart3, Users, Building2,
  Palette, Check, ChevronLeft, ChevronRight,
  Settings as SettingsIcon, Home, Trophy,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import { auth } from '../../firebase/config';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';

// Sniper sections
import PipelineSection         from './sections/PipelineSection';
import TargetsSection          from './sections/TargetsSection';
import TouchesSection          from './sections/TouchesSection';
import PlaybooksSection        from './sections/PlaybooksSection';
import OutcomesSection         from './sections/OutcomesSection';
import SniperCompaniesSection  from './sections/SniperCompaniesSection';
import AllLeads                from '../Scout/AllLeads';

const SNIPER_TEAL = '#14b8a6';

// ─── Particles ───────────────────────────────────────────────────────────────
function Particles() {
  const stars = Array.from({ length: 55 }, () => ({
    x: Math.random() * 100, y: Math.random() * 100,
    size: Math.random() * 1.8 + 0.4, op: Math.random() * 0.4 + 0.08,
    dur: Math.random() * 4 + 3, delay: Math.random() * 5,
  }));
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {stars.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size, borderRadius: '50%', background: '#fff',
          opacity: s.op,
          animation: `twinkle ${s.dur}s ease-in-out infinite`,
          animationDelay: `${s.delay}s`,
        }} />
      ))}
    </div>
  );
}

// ─── BarryAvatar ─────────────────────────────────────────────────────────────
function BarryAvatar({ size = 28, style = {} }) {
  const glow = `0 0 ${size * 0.5}px ${BRAND.cyan}50`;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
      border: `2px solid ${BRAND.cyan}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.46, flexShrink: 0, boxShadow: glow, overflow: 'hidden', ...style,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry AI"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

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

// ─── Module rail config ───────────────────────────────────────────────────────
const MODULE_RAIL = [
  { id: 'scout',  label: 'SCOUT',  Icon: Radar,     route: '/scout'  },
  { id: 'hunter', label: 'HUNTER', Icon: Crosshair, route: '/hunter' },
  { id: 'recon',  label: 'RECON',  Icon: Eye,       route: '/recon'  },
  { id: 'sniper', label: 'SNIPER', Icon: Target,    route: null      }, // active module
];

// ─── SNIPER sub-nav items ─────────────────────────────────────────────────────
const SNIPER_ITEMS = [
  { id: 'pipeline',  label: 'Pipeline',  Icon: Target,         desc: 'Conversion board'     },
  { id: 'targets',   label: 'Targets',   Icon: Users,          desc: 'All contacts'         },
  { id: 'companies', label: 'Companies', Icon: Building2,      desc: 'Saved companies'      },
  { id: 'people',    label: 'People',    Icon: Users,          desc: 'Add to pipeline'      },
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

// ─── SniperShellInner ─────────────────────────────────────────────────────────
function SniperShellInner({ user }) {
  const T = useT();
  const { themeId } = useThemeCtx();
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

  const tabParam = searchParams.get('tab') || location.state?.activeTab || 'pipeline';
  const initialTab = TAB_MAP[tabParam] || 'pipeline';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [subNavOpen, setSubNavOpen] = useState(() => localStorage.getItem('sniper_subnav_collapsed') !== 'true');

  useEffect(() => {
    const tab = searchParams.get('tab') || location.state?.activeTab;
    if (tab && TAB_MAP[tab]) setActiveTab(TAB_MAP[tab]);
    else if (!tab) setActiveTab('pipeline');
  }, [searchParams, location.state?.activeTab]);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId }, { replace: true });
  };

  const userInitials = (user?.email || 'SN').slice(0, 2).toUpperCase();

  const renderMain = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'pipeline'  && <PipelineSection />}
        {activeTab === 'targets'   && <TargetsSection />}
        {activeTab === 'companies' && <SniperCompaniesSection />}
        {activeTab === 'people'    && <AllLeads mode="sniper" />}
        {activeTab === 'touches'   && <TouchesSection />}
        {activeTab === 'playbooks' && <PlaybooksSection />}
        {activeTab === 'outcomes'  && <OutcomesSection />}
      </div>
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

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100%',
      background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      color: T.text, overflow: 'hidden', position: 'relative',
      transition: 'background 0.25s, color 0.25s',
    }}>
      <style>{`
        * { box-sizing: border-box; }
        button, input, select, textarea { font-family: Inter, system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
        @keyframes twinkle  { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
        @keyframes slideIn  { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
        input::placeholder, textarea::placeholder  { color: ${T.textFaint}; }
      `}</style>

      {T.particles && <Particles />}

      {/* ── ICON RAIL ── */}
      <div style={{
        width: 60, flexShrink: 0, background: T.railBg,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 13, paddingBottom: 13, gap: 3,
        position: 'relative', zIndex: 2, transition: 'background 0.25s',
      }}>
        {/* Logo mark → Mission Control button */}
        <div
          onClick={() => navigate('/mission-control-v2')}
          title="Mission Control"
          style={{
            width: 34, height: 34, borderRadius: 9,
            background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, marginBottom: 16,
            boxShadow: `0 4px 18px ${BRAND.pink}50`, flexShrink: 0, overflow: 'hidden',
            cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = `0 6px 22px ${BRAND.pink}70`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 4px 18px ${BRAND.pink}50`; }}
        >
          <img
            src={ASSETS.logoMark}
            alt="Mission Control"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '✦'; }}
          />
        </div>

        {/* Module icons */}
        {MODULE_RAIL.map(mod => {
          const active = mod.id === 'sniper';
          return (
            <div
              key={mod.id}
              onClick={() => { if (mod.route) navigate(mod.route); }}
              title={mod.label}
              style={{
                width: 40, height: 40, borderRadius: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                background: active ? `${SNIPER_TEAL}18` : 'transparent',
                border: `1px solid ${active ? SNIPER_TEAL + '50' : 'transparent'}`,
                gap: 1, transition: 'all 0.15s', marginBottom: 2,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <mod.Icon size={14} color={active ? SNIPER_TEAL : T.textFaint} />
              <span style={{ fontSize: 7, letterSpacing: 0.5, color: active ? SNIPER_TEAL : T.textFaint, marginTop: 1 }}>
                {mod.label}
              </span>
            </div>
          );
        })}

        {/* Bottom: Home + Settings + Theme + Barry */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
          <div
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 1, transition: 'all 0.15s',
              background: 'transparent', border: '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.border = `1px solid ${BRAND.pink}40`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
          >
            <Home size={14} color={T.textFaint} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: T.textFaint }}>MC</span>
          </div>
          <div
            onClick={() => navigate('/settings')}
            title="SETTINGS"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 1, transition: 'all 0.15s',
              background: location.pathname === '/settings' ? 'rgba(250,170,32,0.15)' : 'transparent',
              border: `1px solid ${location.pathname === '/settings' ? SETTINGS_ORANGE : 'transparent'}`,
              boxShadow: location.pathname === '/settings' ? `0 0 12px rgba(250,170,32,0.4)` : 'none',
            }}
            onMouseEnter={e => { if (location.pathname !== '/settings') { e.currentTarget.style.background = T.surface; e.currentTarget.style.border = `1px solid rgba(250,170,32,0.3)`; } }}
            onMouseLeave={e => { if (location.pathname !== '/settings') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; } }}
          >
            <SettingsIcon size={14} color={location.pathname === '/settings' ? SETTINGS_ORANGE : T.textFaint} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: location.pathname === '/settings' ? SETTINGS_ORANGE : T.textFaint }}>
              SET
            </span>
          </div>
          <ThemePicker />
          <div title="Barry AI" style={{ cursor: 'pointer' }}>
            <BarryAvatar size={34} style={{ boxShadow: `0 0 14px ${BRAND.cyan}50` }} />
          </div>
        </div>
      </div>

      {/* ── SUB-NAV (collapsible) ── */}
      <div style={{
        width: subNavOpen ? 190 : 0, flexShrink: 0, background: T.navBg,
        borderRight: subNavOpen ? `1px solid ${T.border}` : 'none',
        display: 'flex', flexDirection: 'column',
        position: 'relative', zIndex: 2,
        transition: 'width 0.2s ease, background 0.25s',
        overflow: 'hidden',
      }}>
        <div style={{ width: 190, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Sub-nav header */}
          <div style={{
            padding: '13px 13px 9px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, color: SNIPER_TEAL, fontWeight: 700, marginBottom: 1 }}>
                SNIPER
              </div>
              <div style={{ fontSize: 9, color: T.textFaint }}>Conversion pipeline</div>
            </div>
            <div
              onClick={() => { setSubNavOpen(false); localStorage.setItem('sniper_subnav_collapsed', 'true'); }}
              title="Collapse sidebar"
              style={{
                width: 22, height: 22, borderRadius: 6,
                background: T.surface, border: `1px solid ${T.border2}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <ChevronLeft size={12} color={T.textFaint} />
            </div>
          </div>

          {/* Sub-nav items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 7px' }}>
            {SNIPER_ITEMS.map(it => {
              const active = activeTab === it.id;
              return (
                <div
                  key={it.id}
                  onClick={() => switchTab(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                    borderRadius: 8, cursor: 'pointer', marginBottom: 1,
                    background: active ? `${SNIPER_TEAL}12` : 'transparent',
                    borderLeft: `2px solid ${active ? SNIPER_TEAL : 'transparent'}`,
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <it.Icon size={13} color={active ? SNIPER_TEAL : T.textFaint} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      color: active ? SNIPER_TEAL : T.textMuted,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {it.label}
                    </div>
                    <div style={{ fontSize: 9, color: T.textFaint, marginTop: 1 }}>{it.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* User footer */}
          <div style={{
            padding: '9px 11px', borderTop: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
          }}>
            <Av initials={userInitials} color={SNIPER_TEAL} size={24} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email || 'user@idynify.com'}
              </div>
              <div style={{ fontSize: 8, color: T.textFaint }}>
                {THEMES[themeId]?.label || 'Mission Control'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-nav expand button (when collapsed) */}
      {!subNavOpen && (
        <div
          onClick={() => { setSubNavOpen(true); localStorage.setItem('sniper_subnav_collapsed', 'false'); }}
          title="Expand sidebar"
          style={{
            position: 'absolute', left: 60, top: 13, zIndex: 3,
            width: 22, height: 22, borderRadius: '0 6px 6px 0',
            background: T.navBg, border: `1px solid ${T.border}`, borderLeft: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ChevronRight size={12} color={T.textFaint} />
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative', zIndex: 1,
        transition: 'background 0.25s',
      }}>
        {renderMain()}
      </div>
    </div>
  );
}

// ─── SniperMain (public export) ───────────────────────────────────────────────
export default function SniperMain() {
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  return <SniperShellInner user={user} />;
}
