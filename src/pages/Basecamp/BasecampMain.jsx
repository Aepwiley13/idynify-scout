/**
 * BasecampMain.jsx — Two-column nav shell for the BASECAMP module.
 *
 * Architecture:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Icon Rail (60px)  │  Sub-Nav (190px)  │  Main Content  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * BASECAMP = Customer management hub. Users manage their People and Companies
 * here — the home base for all customer relationships.
 *
 * This component is self-contained — it does NOT use MainLayout.
 * The App.jsx /basecamp route must NOT use withLayout={true}.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Radar, Crosshair, Eye, Target, Tent, Shield, Archive,
  Users, Building2, Zap, HeartPulse, Lock,
  Palette, Check, ChevronLeft, ChevronRight,
  Settings as SettingsIcon, Home,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import { auth } from '../../firebase/config';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';
import BarryChat, { MODULE_CONFIG } from '../../components/barry/BarryChat';
import { useBarryContext } from '../../context/barryContextStore';
import { useActiveUser } from '../../context/ImpersonationContext';

import { useSubscription } from '../../hooks/useSubscription';

// Basecamp sections
import PeopleSection       from './sections/PeopleSection';
import CompaniesSection    from './sections/CompaniesSection';
import EngagementCenter    from './sections/EngagementCenter';
import CSMDashboard        from '../../components/csm/CSMDashboard';

const BASECAMP_GREEN = '#22c55e';

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
        <Palette size={16} color={BASECAMP_GREEN} />
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
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? BASECAMP_GREEN : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={BASECAMP_GREEN} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function Av({ initials, color = BASECAMP_GREEN, size = 24 }) {
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
  { id: 'people',         label: 'COMMAND CENTER', Icon: Users,     route: '/command-center' },
  { id: 'scout',          label: 'SCOUT',          Icon: Radar,     route: '/scout'          },
  { id: 'hunter',         label: 'HUNTER',         Icon: Crosshair, route: '/hunter'         },
  { id: 'sniper',         label: 'SNIPER',         Icon: Target,    route: '/sniper'         },
  { id: 'basecamp',       label: 'BASECAMP',       Icon: Tent,      route: null              }, // active module
  { id: 'reinforcements', label: 'REINFORCEMENTS', Icon: Shield,    route: '/reinforcements' },
  { id: 'recon',          label: 'RECON',          Icon: Eye,       route: '/recon'          },
  { id: 'fallback',       label: 'FALLBACK',       Icon: Archive,   route: '/fallback'       },
];

// ─── BASECAMP sub-nav items ─────────────────────────────────────────────────
const BASECAMP_ITEMS = [
  { id: 'people',     label: 'People',     Icon: Users,      desc: 'Your contacts'    },
  { id: 'companies',  label: 'Companies',  Icon: Building2,  desc: 'Your companies'   },
  { id: 'engage',     label: 'Engage',     Icon: Zap,        desc: 'Run waves'        },
  { id: 'csm',        label: 'CSM',        Icon: HeartPulse, desc: 'Customer success'  },
];

const SETTINGS_ORANGE = '#faaa20';

const BARRY_MODULE = 'basecamp';
const BARRY_CHAKRA = MODULE_CONFIG[BARRY_MODULE]?.color ?? '#00c4d4';

const TAB_MAP = {
  people:    'people',
  companies: 'companies',
  engage:    'engage',
  csm:       'csm',
};

// ─── CSM Tier Teaser (shown to starter users) ──────────────────────────────
function CSMTeaser({ T }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 40, textAlign: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: `${BASECAMP_GREEN}15`, border: `1px solid ${BASECAMP_GREEN}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
      }}>
        <Lock size={28} color={BASECAMP_GREEN} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
        Customer Success Module
      </div>
      <div style={{ fontSize: 13, color: T.textMuted, maxWidth: 360, lineHeight: 1.6, marginBottom: 20 }}>
        Track customer health scores, milestone progress, and renewal risk — all in one view.
        Upgrade to Pro to unlock the CSM module.
      </div>
      <a
        href="/settings?tab=billing"
        style={{
          padding: '10px 24px', borderRadius: 8, border: 'none',
          background: `linear-gradient(135deg,${BASECAMP_GREEN},#14b8a6)`,
          color: '#fff', fontSize: 13, fontWeight: 600,
          textDecoration: 'none', display: 'inline-block',
        }}
      >
        Upgrade to Pro
      </a>
    </div>
  );
}

// ─── BasecampShellInner ─────────────────────────────────────────────────────
function BasecampShellInner({ user }) {
  const T = useT();
  const { themeId } = useThemeCtx();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isProTier, loading: tierLoading } = useSubscription();

  const mql = window.matchMedia('(max-width: 768px)');
  const [isMobile, setIsMobile] = useState(() => mql.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  const tabParam = searchParams.get('tab') || location.state?.activeTab || 'people';
  const initialTab = TAB_MAP[tabParam] || 'people';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [subNavOpen, setSubNavOpen] = useState(() => localStorage.getItem('basecamp_subnav_collapsed') !== 'true');
  const [barryOpen, setBarryOpen] = useState(false);
  const barryCtx = useBarryContext();

  useEffect(() => {
    const tab = searchParams.get('tab') || location.state?.activeTab;
    if (tab && TAB_MAP[tab]) setActiveTab(TAB_MAP[tab]);
    else if (!tab) setActiveTab('people');
  }, [searchParams, location.state?.activeTab]);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId }, { replace: true });
  };

  const userInitials = (user?.email || 'BC').slice(0, 2).toUpperCase();

  const renderMain = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'people'    && <PeopleSection />}
        {activeTab === 'companies' && <CompaniesSection />}
        {activeTab === 'engage'    && <EngagementCenter />}
        {activeTab === 'csm'       && (isProTier ? <CSMDashboard userId={user?.uid} /> : <CSMTeaser T={T} />)}
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
              background: `linear-gradient(135deg,${BASECAMP_GREEN},${BRAND.cyan})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, overflow: 'hidden', cursor: 'pointer',
              boxShadow: `0 2px 10px ${BASECAMP_GREEN}40`,
            }}
          >
            <img src={ASSETS.logoMark} alt="Mission Control"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '✦'; }}
            />
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>
            {BASECAMP_ITEMS.find(i => i.id === activeTab)?.label || 'Basecamp'}
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
          {BASECAMP_ITEMS.map(it => {
            const active = activeTab === it.id;
            return (
              <div
                key={it.id}
                onClick={() => switchTab(it.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '9px 12px', flexShrink: 0,
                  borderBottom: `2px solid ${active ? BASECAMP_GREEN : 'transparent'}`,
                  color: active ? BASECAMP_GREEN : T.textMuted,
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
            background: `linear-gradient(135deg,${BASECAMP_GREEN},${BRAND.cyan})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, marginBottom: 16,
            boxShadow: `0 4px 18px ${BASECAMP_GREEN}50`, flexShrink: 0, overflow: 'hidden',
            cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = `0 6px 22px ${BASECAMP_GREEN}70`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 4px 18px ${BASECAMP_GREEN}50`; }}
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
          const active = mod.id === 'basecamp';
          return (
            <div
              key={mod.id}
              onClick={() => { if (mod.route) navigate(mod.route); }}
              title={mod.label}
              style={{
                width: 52, height: 46, borderRadius: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                background: active ? `${BASECAMP_GREEN}18` : 'transparent',
                border: `1px solid ${active ? BASECAMP_GREEN + '50' : 'transparent'}`,
                gap: 1, transition: 'all 0.15s', marginBottom: 2,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <mod.Icon size={14} color={active ? BASECAMP_GREEN : T.textFaint} />
              <span style={{ fontSize: 7, letterSpacing: 0, color: active ? BASECAMP_GREEN : T.textFaint, marginTop: 2, textAlign: 'center', width: '100%', lineHeight: 1.3 }}>
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
            onMouseEnter={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.border = `1px solid ${BASECAMP_GREEN}40`; }}
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
          <div
            onClick={() => setBarryOpen(o => !o)}
            title="Barry AI"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 1, transition: 'all 0.15s',
              background: barryOpen ? `${BARRY_CHAKRA}20` : 'transparent',
              border: `1px solid ${barryOpen ? BARRY_CHAKRA : 'transparent'}`,
              boxShadow: barryOpen ? `0 0 12px ${BARRY_CHAKRA}40` : 'none',
            }}
            onMouseEnter={e => { if (!barryOpen) e.currentTarget.style.background = T.surface; }}
            onMouseLeave={e => { if (!barryOpen) e.currentTarget.style.background = 'transparent'; }}
          >
            <BarryAvatar size={22} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: barryOpen ? BARRY_CHAKRA : T.textFaint }}>
              BARRY
            </span>
          </div>
          {barryOpen && (
            <BarryChat module={BARRY_MODULE} context={barryCtx} onClose={() => setBarryOpen(false)} />
          )}
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
              <div style={{ fontSize: 9, letterSpacing: 2, color: BASECAMP_GREEN, fontWeight: 700, marginBottom: 1 }}>
                BASECAMP
              </div>
              <div style={{ fontSize: 9, color: T.textFaint }}>Customer management</div>
            </div>
            <div
              onClick={() => { setSubNavOpen(false); localStorage.setItem('basecamp_subnav_collapsed', 'true'); }}
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
            {BASECAMP_ITEMS.map(it => {
              const active = activeTab === it.id;
              return (
                <div
                  key={it.id}
                  onClick={() => switchTab(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                    borderRadius: 8, cursor: 'pointer', marginBottom: 1,
                    background: active ? `${BASECAMP_GREEN}12` : 'transparent',
                    borderLeft: `2px solid ${active ? BASECAMP_GREEN : 'transparent'}`,
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <it.Icon size={13} color={active ? BASECAMP_GREEN : T.textFaint} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      color: active ? BASECAMP_GREEN : T.textMuted,
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
            <Av initials={userInitials} color={BASECAMP_GREEN} size={24} />
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
          onClick={() => { setSubNavOpen(true); localStorage.setItem('basecamp_subnav_collapsed', 'false'); }}
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

// ─── BasecampMain (public export) ───────────────────────────────────────────
export default function BasecampMain() {
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

  return <BasecampShellInner user={user} />;
}
