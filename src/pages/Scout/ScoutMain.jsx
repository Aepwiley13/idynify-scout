/**
 * ScoutMain.jsx — Two-column nav shell for the Scout module.
 *
 * Architecture:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Icon Rail (60px)  │  Sub-Nav (190px)  │  Main Content  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * This component is self-contained — it does NOT use MainLayout.
 * The App.jsx /scout route must NOT use withLayout={true}.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { auth } from '../../firebase/config';
import {
  Radar, Crosshair, Eye, Target,
  Zap, Building2, Users, Plus,
  Palette, Check, Settings, ChevronLeft, ChevronRight, Home,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import DailyLeads from './DailyLeads';
import SavedCompanies from './SavedCompanies';
import AllLeads from './AllLeads';
import CompanyProfileView from './CompanyProfileView';
import ScoutPlus from './ScoutPlus';
import ICPSettings from './ICPSettings';

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

// ─── Particles (Mission Control only) ────────────────────────────────────────
// Generated once at module load — stable, decorative, never changes
const PARTICLE_STARS = Array.from({ length: 55 }, () => ({
  x: Math.random() * 100, y: Math.random() * 100,
  size: Math.random() * 1.8 + 0.4, op: Math.random() * 0.4 + 0.08,
  dur: Math.random() * 4 + 3, delay: Math.random() * 5,
}));

function Particles() {
  const stars = PARTICLE_STARS;
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
function Av({ initials, color = BRAND.pink, size = 24 }) {
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

// Orange token for settings accent
const SETTINGS_ORANGE = '#faaa20';

// ─── Nav config ──────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  { id: 'allpeople', label: 'COMMAND CENTER', Icon: Users, route: '/people', items: [] },
  {
    id: 'scout', label: 'SCOUT', Icon: Radar, route: null,
    items: [
      { id: 'daily',     label: 'Daily Discoveries', Icon: Zap,       desc: 'Review Queue'       },
      { id: 'saved',     label: 'Saved Companies',   Icon: Building2, desc: 'Hunt list'          },
      { id: 'all',       label: 'People',             Icon: Users,     desc: 'Your network'      },
      { id: 'scoutplus',   label: 'Scout+',           Icon: Plus,     desc: 'Add contacts'       },
      { id: 'icpsettings', label: 'ICP Settings',     Icon: Settings, desc: 'Targeting criteria' },
    ],
  },
  { id: 'hunter',    label: 'HUNTER',  Icon: Crosshair, route: '/hunter', items: [] },
  { id: 'recon',     label: 'RECON',   Icon: Eye,       route: '/recon',  items: [] },
  { id: 'sniper',    label: 'SNIPER',  Icon: Target,    route: '/sniper', items: [] },
];

// ─── ScoutShellInner ─────────────────────────────────────────────────────────
function ScoutShellInner({ user }) {
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

  // Tab ↔ internal item ID mapping
  const TAB_TO_ITEM = {
    'daily-leads':     'daily',
    'saved-companies': 'saved',
    'all-leads':       'all',
    'icp-settings':    'icpsettings',
    'scout-plus':      'scoutplus',
    'company-search':  'scoutplus',
  };
  // Build ITEM_TO_TAB explicitly — deriving it from Object.fromEntries(TAB_TO_ITEM) is
  // unsafe because both 'scout-plus' and 'company-search' map to 'scoutplus', causing
  // the last entry ('company-search') to win and produce the wrong canonical URL.
  const ITEM_TO_TAB = {
    'daily':       'daily-leads',
    'saved':       'saved-companies',
    'all':         'all-leads',
    'icpsettings': 'icp-settings',
    'scoutplus':   'scout-plus',
  };

  // Read tab from URL (?tab=company-search) with fallback to legacy location.state
  const tabParam = searchParams.get('tab') || location.state?.activeTab || 'daily-leads';
  const initialItem = TAB_TO_ITEM[tabParam] || 'daily';

  const [activeSection, setActiveSection] = useState('scout');
  const [activeItem, setActiveItem] = useState(initialItem);
  const [drillCompanyId, setDrillCompanyId] = useState(null);
  const [subNavOpen, setSubNavOpen] = useState(() => localStorage.getItem('scout_subnav_collapsed') !== 'true');

  // Sync tab when URL search params change (e.g. navigating from Sidebar).
  // setState inside the effect is intentional — URL params are external state
  // that must be mirrored into local state to drive rendering.
  useEffect(() => {
    const tab = searchParams.get('tab') || location.state?.activeTab;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab && TAB_TO_ITEM[tab]) setActiveItem(TAB_TO_ITEM[tab]);
    else if (!tab) setActiveItem('daily');
  }, [searchParams, location.state?.activeTab]); // TAB_TO_ITEM is a stable module-level constant

  // Helper: switch tab and update URL
  const switchItem = (itemId) => {
    setDrillCompanyId(null);
    setActiveItem(itemId);
    const tab = ITEM_TO_TAB[itemId] || 'daily-leads';
    setSearchParams({ tab }, { replace: true });
  };

  const section = NAV_SECTIONS.find(s => s.id === activeSection);

  const handleSectionClick = (sec) => {
    if (sec.locked) return;
    if (sec.route) { navigate(sec.route); return; }
    if (sec.directTo) {
      setDrillCompanyId(null);
      setActiveSection(sec.directTo.section);
      setActiveItem(sec.directTo.item);
      const tab = ITEM_TO_TAB[sec.directTo.item] || 'daily-leads';
      setSearchParams({ tab }, { replace: true });
      return;
    }
    setDrillCompanyId(null);
    setActiveSection(sec.id);
    setActiveItem(sec.items[0]?.id || '');
  };

  const renderMain = () => {
    // Company profile drill-in (overrides the current panel)
    if (drillCompanyId) {
      return (
        <CompanyProfileView
          companyId={drillCompanyId}
          onBack={() => setDrillCompanyId(null)}
        />
      );
    }

    if (activeItem === 'daily')       return <DailyLeads onNavigate={switchItem} />;
    if (activeItem === 'saved')       return <SavedCompanies onSelectCompany={id => { setDrillCompanyId(id); }} />;
    if (activeItem === 'all')         return <AllLeads mode="scout" />;
    if (activeItem === 'scoutplus')   return <ScoutPlus />;
    if (activeItem === 'icpsettings') return <ICPSettings />;
    // Placeholder for any future unbuilt sections
    const item = section?.items.find(i => i.id === activeItem);
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
        <div style={{ textAlign: 'center', color: T.textFaint }}>
          {item?.Icon && <item.Icon size={44} color={T.textFaint} style={{ marginBottom: 12, opacity: 0.4 }} />}
          <div style={{ fontSize: 12, color: T.textMuted, letterSpacing: 1 }}>{item?.label?.toUpperCase()}</div>
          <div style={{ fontSize: 11, marginTop: 5, color: T.textFaint }}>{item?.desc}</div>
        </div>
      </div>
    );
  };

  const userInitials = (user?.email || 'AW').slice(0, 2).toUpperCase();

  // ── Mobile layout ────────────────────────────────────────────────────────────
  // Bottom nav items: the 5 most navigable scout sub-items (Scout+ is a CTA, not a nav target)
  const MOBILE_BOTTOM_NAV = [
    { id: 'daily',       label: 'Daily',   Icon: Zap       },
    { id: 'saved',       label: 'Saved',   Icon: Building2 },
    { id: 'all',         label: 'People',  Icon: Users     },
    { id: 'scoutplus',   label: 'Scout+',  Icon: Plus      },
    { id: 'icpsettings', label: 'ICP',     Icon: Settings  },
  ];

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
          button, input { font-family: Inter, system-ui, sans-serif; }
          ::-webkit-scrollbar { width: 3px; height: 3px; }
          ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
          @keyframes twinkle { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
          @keyframes slideIn { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
          @keyframes slideUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
          @keyframes fadeUp  { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
          input::placeholder { color: ${T.textFaint}; }
        `}</style>

        {/* ── Mobile top bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 10px', borderBottom: `1px solid ${T.border}`,
          background: T.railBg, flexShrink: 0, zIndex: 2,
        }}>
          {/* Logo */}
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, overflow: 'hidden',
          }}>
            <img src={ASSETS.logoMark} alt="Idynify"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '✦'; }}
            />
          </div>

          {/* Section nav icons */}
          <div style={{ flex: 1, display: 'flex', gap: 3, overflowX: 'auto' }}>
            {NAV_SECTIONS.map(sec => {
              // COMMAND CENTER (directTo) is active when its target item is selected
              // SCOUT is active only when not in a directTo sub-view
              const hasActiveDirectTo = NAV_SECTIONS.some(
                s => s.directTo && s.directTo.section === 'scout' && activeItem === s.directTo.item
              );
              const active = sec.directTo
                ? (activeSection === sec.directTo.section && activeItem === sec.directTo.item)
                : sec.route
                  ? location.pathname === sec.route
                  : sec.id === 'scout'
                    ? (activeSection === 'scout' && !hasActiveDirectTo)
                    : activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => !sec.locked && handleSectionClick(sec)}
                  title={sec.label}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 3, padding: '8px 10px', borderRadius: 8, flexShrink: 0,
                    minHeight: 44, minWidth: 44,
                    background: active ? T.accentBg : 'transparent',
                    border: `1px solid ${active ? T.accentBdr : 'transparent'}`,
                    cursor: sec.locked ? 'not-allowed' : 'pointer',
                    opacity: sec.locked ? 0.32 : 1,
                    transition: 'all 0.15s',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <sec.Icon size={16} color={active ? BRAND.pink : T.textFaint} />
                  <span style={{ fontSize: 10, letterSpacing: 0.4, fontWeight: active ? 700 : 400, color: active ? BRAND.pink : T.textFaint, lineHeight: 1 }}>
                    {sec.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Controls */}
          <div
            onClick={() => navigate('/settings')}
            title="Settings"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: T.accentBg, border: `1px solid ${T.accentBdr}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Settings size={14} color={SETTINGS_ORANGE} />
          </div>
          <ThemePicker />
        </div>

        {/* ── Mobile main content ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
          {renderMain()}
        </div>

        {/* ── Mobile bottom nav ── */}
        <div style={{
          display: 'flex', flexShrink: 0,
          background: T.railBg, borderTop: `1px solid ${T.border}`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
          {MOBILE_BOTTOM_NAV.map(it => {
            const active = activeItem === it.id;
            return (
              <button
                key={it.id}
                onClick={() => switchItem(it.id)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 3, padding: '10px 4px',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', minHeight: 56,
                  color: active ? BRAND.pink : T.textFaint,
                  transition: 'color 0.15s',
                  WebkitTapHighlightColor: 'transparent',
                  position: 'relative',
                }}
              >
                {active && (
                  <div style={{
                    position: 'absolute', top: 0, left: '20%', right: '20%', height: 2,
                    background: BRAND.pink, borderRadius: '0 0 2px 2px',
                    boxShadow: `0 0 8px ${BRAND.pink}`,
                  }} />
                )}
                <it.Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, letterSpacing: 0.3, lineHeight: 1 }}>
                  {it.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Desktop layout ───────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100%',
      background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      color: T.text, overflow: 'hidden', position: 'relative',
      transition: 'background 0.25s, color 0.25s',
    }}>
      <style>{`
        * { box-sizing: border-box; }
        button, input { font-family: Inter, system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
        @keyframes twinkle  { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
        @keyframes slideIn  { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
        input::placeholder  { color: ${T.textFaint}; }
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

        {NAV_SECTIONS.map(sec => {
          const active = sec.directTo
            ? (activeSection === sec.directTo.section && activeItem === sec.directTo.item)
            : activeSection === sec.id;
          return (
            <div
              key={sec.id}
              onClick={() => handleSectionClick(sec)}
              title={sec.label}
              style={{
                width: 52, height: 46, borderRadius: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: sec.locked ? 'not-allowed' : 'pointer',
                background: active ? T.accentBg : 'transparent',
                border: `1px solid ${active ? T.accentBdr : 'transparent'}`,
                gap: 1, transition: 'all 0.15s', marginBottom: 2,
                opacity: sec.locked ? 0.32 : 1,
              }}
              onMouseEnter={e => { if (!active && !sec.locked) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <sec.Icon size={14} color={active ? BRAND.pink : T.textFaint} />
              <span style={{ fontSize: 7, letterSpacing: 0, color: active ? BRAND.pink : T.textFaint, marginTop: 2, textAlign: 'center', width: '100%', lineHeight: 1.3 }}>
                {sec.label}
              </span>
            </div>
          );
        })}

        {/* Bottom: Mission Control + Settings + Theme + Barry */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
          {/* Mission Control rail icon */}
          <div
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 1, transition: 'all 0.15s',
              background: 'transparent',
              border: '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.border = `1px solid ${BRAND.pink}40`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
          >
            <Home size={14} color={T.textFaint} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: T.textFaint }}>
              MC
            </span>
          </div>
          {/* Settings rail icon */}
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
            <Settings size={14} color={location.pathname === '/settings' ? SETTINGS_ORANGE : T.textFaint} />
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
          <div style={{ padding: '13px 13px 9px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, color: BRAND.pink, fontWeight: 700, marginBottom: 1 }}>
                {section?.label}
              </div>
              <div style={{ fontSize: 9, color: T.textFaint }}>{section?.items.length} modules</div>
            </div>
            <div
              onClick={() => { setSubNavOpen(false); localStorage.setItem('scout_subnav_collapsed', 'true'); }}
              title="Collapse sidebar"
              style={{ width: 22, height: 22, borderRadius: 6, background: T.surface, border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >
              <ChevronLeft size={12} color={T.textFaint} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 7px' }}>
            {section?.items.map(it => {
              const active = activeItem === it.id;
              return (
                <div
                  key={it.id}
                  onClick={() => switchItem(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                    borderRadius: 8, cursor: 'pointer', marginBottom: 1,
                    background: active ? T.accentBg : 'transparent',
                    borderLeft: `2px solid ${active ? BRAND.pink : 'transparent'}`,
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <it.Icon size={13} color={active ? BRAND.pink : T.textFaint} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      color: active ? BRAND.pink : T.textMuted,
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
          <div style={{ padding: '9px 11px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <Av initials={userInitials} color={BRAND.pink} size={24} />
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

      {/* Sub-nav expand button (shown when collapsed) */}
      {!subNavOpen && (
        <div
          onClick={() => { setSubNavOpen(true); localStorage.setItem('scout_subnav_collapsed', 'false'); }}
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

// ─── ScoutMain (public export) ────────────────────────────────────────────────
export default function ScoutMain() {
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  return (
    <ScoutShellInner user={user} />
  );
}
