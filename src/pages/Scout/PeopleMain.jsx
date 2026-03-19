/**
 * PeopleMain.jsx — Two-column nav shell for the Command Center module.
 *
 * Architecture:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Icon Rail (60px)  │  Sub-Nav (190px)  │  Main Content  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * This component is self-contained — it does NOT use MainLayout.
 * The App.jsx /people route must NOT use withLayout={true}.
 *
 * Command Center = strategy and setup hub.
 * Sections: Missions, People, Companies, Weapons, Arsenal, Outcomes
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import {
  Radar, Crosshair, Eye, Target, Tent, Shield, Users, Building2,
  Zap, Archive, BarChart3, Swords,
  Palette, Check, ChevronLeft, ChevronRight, Home,
  Settings as SettingsIcon, Plus,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';
import AllLeads from './AllLeads';
import BarryChat, { MODULE_CONFIG } from '../../components/barry/BarryChat';
import { useBarryContext } from '../../context/barryContextStore';
import SharedCompaniesView from '../../components/shared/SharedCompaniesView';
import MissionsSection from '../Hunter/sections/MissionsSection';
import WeaponsSection from '../Hunter/sections/WeaponsSection';
import ArsenalSection from '../Hunter/sections/ArsenalSection';
import OutcomesSection from '../Hunter/sections/OutcomesSection';
import GoToWar from './GoToWar';

// Command Center accent color
const CC_CYAN = BRAND.cyan;

// Orange token for settings accent
const SETTINGS_ORANGE = '#faaa20';

const BARRY_MODULE = 'command-center';
const BARRY_CHAKRA = MODULE_CONFIG[BARRY_MODULE]?.color ?? '#00c4d4';

// ─── Particles ────────────────────────────────────────────────────────────────
const PARTICLE_STARS = Array.from({ length: 55 }, () => ({
  x: Math.random() * 100, y: Math.random() * 100,
  size: Math.random() * 1.8 + 0.4, op: Math.random() * 0.4 + 0.08,
  dur: Math.random() * 4 + 3, delay: Math.random() * 5,
}));

function Particles() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {PARTICLE_STARS.map((s, i) => (
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

// ─── BarryAvatar ──────────────────────────────────────────────────────────────
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

// ─── ThemePicker ──────────────────────────────────────────────────────────────
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
        <Palette size={16} color={CC_CYAN} />
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

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ initials, color = CC_CYAN, size = 24 }) {
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
  { id: 'people',         label: 'COMMAND CENTER', Icon: Users,     route: null               }, // active module
  { id: 'scout',          label: 'SCOUT',          Icon: Radar,     route: '/scout'           },
  { id: 'hunter',         label: 'HUNTER',         Icon: Crosshair, route: '/hunter'          },
  { id: 'sniper',         label: 'SNIPER',         Icon: Target,    route: '/sniper'          },
  { id: 'basecamp',       label: 'BASECAMP',       Icon: Tent,      route: '/basecamp'        },
  { id: 'reinforcements', label: 'REINFORCEMENTS', Icon: Shield,    route: '/reinforcements'  },
  { id: 'recon',          label: 'RECON',          Icon: Eye,       route: '/recon'           },
];

// ─── Command Center sub-nav items ─────────────────────────────────────────────
const CC_ITEMS = [
  { id: 'people',     label: 'People',       Icon: Users,     desc: 'Full contacts roster — all view'  },
  { id: 'companies',  label: 'Companies',    Icon: Building2, desc: 'Full accounts roster — all view'  },
  { id: 'missions',   label: 'Missions',     Icon: Zap,       desc: 'Create and manage campaigns'      },
  { id: 'go_to_war',  label: 'Go To War',    Icon: Swords,    desc: '8-phase bulk mission launcher'    },
  { id: 'weapons',    label: 'Weapons',      Icon: Crosshair, desc: 'Channel selector, message builder' },
  { id: 'arsenal',    label: 'Arsenal',      Icon: Archive,   desc: 'Saved message templates library'  },
  { id: 'outcomes',   label: 'Outcomes',     Icon: BarChart3, desc: 'Mission performance analytics'    },
];

// ─── Tab → URL param mapping ──────────────────────────────────────────────────
const TAB_MAP = {
  missions:   'missions',
  people:     'people',
  companies:  'companies',
  go_to_war:  'go_to_war',
  weapons:    'weapons',
  arsenal:    'arsenal',
  outcomes:   'outcomes',
};

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
  const [subNavOpen, setSubNavOpen] = useState(() => localStorage.getItem('cc_subnav_collapsed') !== 'true');
  const [barryOpen, setBarryOpen] = useState(false);
  const barryCtx = useBarryContext();

  // Resolve active section from URL param or legacy localStorage
  const tabParam = searchParams.get('tab') || location.state?.activeTab || null;
  const initialSection = (tabParam && TAB_MAP[tabParam]) || 'people';
  const [activeSection, setActiveSection] = useState(initialSection);

  // Sync section when URL params change
  useEffect(() => {
    const tab = searchParams.get('tab') || location.state?.activeTab;
    if (tab && TAB_MAP[tab]) setActiveSection(TAB_MAP[tab]);
    else if (!tab) setActiveSection('people');
  }, [searchParams, location.state?.activeTab]);

  const switchSection = (sectionId) => {
    setActiveSection(sectionId);
    setSearchParams({ tab: sectionId }, { replace: true });
  };

  // Missions and campaigns data (needed for MissionsSection, OutcomesSection, and empty state)
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

  const userInitials = (user?.email || 'CC').slice(0, 2).toUpperCase();

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
          <div style={{ flex: 1, overflow: 'auto' }}>
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
          button, input { font-family: Inter, system-ui, sans-serif; }
          ::-webkit-scrollbar { width: 3px; height: 3px; }
          ::-webkit-scrollbar-thumb { background: ${T.isDark ? '#333' : '#ccc'}; border-radius: 3px; }
          @keyframes twinkle { 0%,100%{opacity:0.2} 50%{opacity:0.05} }
          @keyframes fadeUp  { from{opacity:0;transform:translateY(6px)}  to{opacity:1;transform:translateY(0)} }
          input::placeholder { color: ${T.textFaint}; }
        `}</style>

        {/* Mobile top bar */}
        <div style={{
          flexShrink: 0, zIndex: 2,
          background: T.railBg, borderBottom: `1px solid ${T.border}`,
        }}>
          {/* Row 1: logo + title + theme + settings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px' }}>
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
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: 0.3 }}>
              Command Center
            </div>
            <ThemePicker />
            <div
              onClick={() => navigate('/settings')}
              title="Settings"
              style={{
                width: 34, height: 34, borderRadius: 9,
                background: T.accentBg, border: `1px solid ${T.accentBdr}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              <SettingsIcon size={16} color={SETTINGS_ORANGE} />
            </div>
          </div>

          {/* Row 2: section tabs */}
          <div style={{ display: 'flex', overflowX: 'auto', gap: 0, padding: '0 14px 8px' }}>
            {CC_ITEMS.map(item => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => switchSection(item.id)}
                  style={{
                    flexShrink: 0, padding: '7px 12px', border: 'none', borderRadius: 8,
                    background: active ? `${CC_CYAN}18` : 'transparent',
                    color: active ? CC_CYAN : T.textFaint,
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                    borderBottom: active ? `2px solid ${CC_CYAN}` : '2px solid transparent',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                  }}
                >
                  <item.Icon size={12} />
                  {item.label}
                  {item.id === 'missions' && activeMissionsCount > 0 && (
                    <span style={{
                      minWidth: 14, height: 14, borderRadius: 7,
                      background: CC_CYAN, color: '#000',
                      fontSize: 8, fontWeight: 700, padding: '0 3px',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {activeMissionsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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

  // ── Desktop layout ──────────────────────────────────────────────────────────
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

        {/* Module icons */}
        {MODULE_RAIL.map(mod => {
          const active = mod.id === 'people';
          return (
            <div
              key={mod.id}
              onClick={() => { if (mod.route) navigate(mod.route); }}
              title={mod.label}
              style={{
                width: 52, height: 46, borderRadius: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: mod.route ? 'pointer' : 'default',
                background: active ? T.accentBg : 'transparent',
                border: `1px solid ${active ? T.accentBdr : 'transparent'}`,
                gap: 1, transition: 'all 0.15s', marginBottom: 2,
              }}
              onMouseEnter={e => { if (!active && mod.route) e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <mod.Icon size={14} color={active ? CC_CYAN : T.textFaint} />
              <span style={{ fontSize: 7, letterSpacing: 0, color: active ? CC_CYAN : T.textFaint, marginTop: 2, textAlign: 'center', width: '100%', lineHeight: 1.3 }}>
                {mod.label}
              </span>
            </div>
          );
        })}

        {/* Bottom: MC + Settings + Theme + Barry */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center' }}>
          {/* Mission Control rail icon */}
          <div
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
            style={{
              width: 40, height: 40, borderRadius: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 1, transition: 'all 0.15s',
              background: 'transparent', border: '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.border = `1px solid ${CC_CYAN}40`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
          >
            <Home size={14} color={T.textFaint} />
            <span style={{ fontSize: 7, letterSpacing: 0.5, marginTop: 1, color: T.textFaint }}>MC</span>
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
              <div style={{ fontSize: 9, letterSpacing: 2, color: CC_CYAN, fontWeight: 700, marginBottom: 1 }}>
                COMMAND CENTER
              </div>
              <div style={{ fontSize: 9, color: T.textFaint }}>{CC_ITEMS.length} sections</div>

            </div>
            <div
              onClick={() => { setSubNavOpen(false); localStorage.setItem('cc_subnav_collapsed', 'true'); }}
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
            {CC_ITEMS.map(it => {
              const active = activeSection === it.id;
              return (
                <div
                  key={it.id}
                  onClick={() => switchSection(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                    borderRadius: 8, marginBottom: 1, cursor: 'pointer',
                    background: active ? T.accentBg : 'transparent',
                    borderLeft: `2px solid ${active ? CC_CYAN : 'transparent'}`,
                    transition: 'all 0.12s', position: 'relative',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <it.Icon size={13} color={active ? CC_CYAN : T.textFaint} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      color: active ? CC_CYAN : T.textMuted,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {it.label}
                    </div>
                    <div style={{ fontSize: 9, color: T.textFaint, marginTop: 1 }}>{it.desc}</div>
                  </div>
                  {/* Badge for missions count */}
                  {it.id === 'missions' && activeMissionsCount > 0 && (
                    <span style={{
                      minWidth: 16, height: 16, borderRadius: 8,
                      background: CC_CYAN, color: '#000',
                      fontSize: 9, fontWeight: 700, padding: '0 4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {activeMissionsCount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* User footer */}
          <div style={{
            padding: '9px 11px', borderTop: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
          }}>
            <Av initials={userInitials} color={CC_CYAN} size={24} />
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
          onClick={() => { setSubNavOpen(true); localStorage.setItem('cc_subnav_collapsed', 'false'); }}
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

// ─── PeopleMain (public export) ───────────────────────────────────────────────
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
