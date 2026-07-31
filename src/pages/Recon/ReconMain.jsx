/**
 * ReconMain — Recon module content.
 *
 * MIGRATED INTO THE GLOBAL SHELL. This file used to be a self-contained
 * application shell: a 60px icon rail listing every module, a theme picker, a
 * settings button, a "back to Mission Control" button, a user footer and its
 * own Barry instance.
 *
 * Recon now owns only what is Recon's:
 *
 *   Global navigation  → MainLayout          (moves the user across Idynify)
 *   Module navigation  → ModuleSubNav        (changes the working view here)
 *
 * Recon is the one module that always used REAL NESTED ROUTES rather than a
 * ?tab= param, which is why it was the only module with correct back-button
 * behaviour before this migration. That is preserved: its sections navigate,
 * they do not switch a local tab, and its children still render through
 * <Outlet/>. The sub-nav's active item is derived from the pathname, so the
 * panel and the address bar cannot disagree.
 *
 * Sections and their descriptions are unchanged — only the panel's visual
 * formatting now comes from the shared component the other modules use.
 *
 * Mobile (max-width: 768px) keeps its original self-contained layout. Mobile
 * is out of scope; see constraint C3 in the Phase 0 assessment.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Users, Target, MessageSquare,
  Shield, Swords, Zap, Brain,
  Palette, Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';
import ModuleSubNav from '../../components/layout/ModuleSubNav';

const RECON_INDIGO = '#6366f1';

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
        <Palette size={16} color={RECON_INDIGO} />
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
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? RECON_INDIGO : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={RECON_INDIGO} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function Av({ initials, size = 24 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${RECON_INDIGO}20`, border: `1.5px solid ${RECON_INDIGO}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 700, color: RECON_INDIGO, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// Orange token for settings accent
const SETTINGS_ORANGE = '#faaa20';


// ─── Recon sub-nav items ──────────────────────────────────────────────────────
const RECON_ITEMS = [
  { id: 'overview',          label: 'Overview',               Icon: LayoutDashboard, path: '/recon',                     desc: 'Training dashboard'      },
  { id: 'alignment-brief',   label: 'Alignment Brief',        Icon: FileText,        path: '/recon/alignment-brief',     desc: 'What Barry knows'        },
  { id: 'user-profile',      label: 'User Profile',           Icon: Users,           path: '/recon/user-profile',        desc: 'Section 0 — who you are' },
  { id: 'icp-intelligence',  label: 'ICP Intelligence',       Icon: Target,          path: '/recon/icp-intelligence',    desc: 'Who you target'          },
  { id: 'messaging',         label: 'Messaging & Voice',      Icon: MessageSquare,   path: '/recon/messaging',           desc: 'Value proposition'       },
  { id: 'objections',        label: 'Objections',             Icon: Shield,          path: '/recon/objections',          desc: 'Pain points & behavior'  },
  { id: 'competitive-intel', label: 'Competitive Intel',      Icon: Swords,          path: '/recon/competitive-intel',   desc: 'Your landscape'          },
  { id: 'buying-signals',    label: 'Buying Signals',         Icon: Zap,             path: '/recon/buying-signals',      desc: 'Intent triggers'         },
  { id: 'barry-training',    label: 'Barry Training',         Icon: Brain,           path: '/recon/barry-training',      desc: 'Direct AI training'      },
];


function ReconShellInner() {
  const T = useT();
  const navigate = useNavigate();
  const location = useLocation();

  const mql = window.matchMedia('(max-width: 768px)');
  const [isMobile, setIsMobile] = useState(() => mql.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  // Active item derived from the pathname, reversed so the longest match wins
  // and /recon/messaging does not resolve to the /recon overview.
  const activeItem = RECON_ITEMS.slice().reverse().find(
    it => location.pathname === it.path || location.pathname.startsWith(it.path + '/')
  )?.id || 'overview';

  // Recon's sections are routes, not tabs — selecting one navigates.
  const goToSection = (id) => {
    const item = RECON_ITEMS.find(it => it.id === id);
    if (item) navigate(item.path);
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
            {RECON_ITEMS.find(i => i.id === activeItem)?.label || 'Recon'}
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
            <Settings size={16} color={SETTINGS_ORANGE} />
          </div>
          <ThemePicker />
        </div>

        {/* Mobile horizontal tab nav */}
        <div style={{
          display: 'flex', overflowX: 'auto', flexShrink: 0,
          background: T.navBg, borderBottom: `1px solid ${T.border}`,
          padding: '0 6px',
        }}>
          {RECON_ITEMS.map(it => {
            const active = activeItem === it.id;
            return (
              <div
                key={it.id}
                onClick={() => navigate(it.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '9px 12px', flexShrink: 0,
                  borderBottom: `2px solid ${active ? RECON_INDIGO : 'transparent'}`,
                  color: active ? RECON_INDIGO : T.textMuted,
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', position: 'relative', zIndex: 1, paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}>
          <Outlet />
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
        title="RECON"
        tagline="ICP, messaging and market intelligence"
        items={RECON_ITEMS}
        activeId={activeItem}
        onSelect={goToSection}
        storageKey="recon_subnav_collapsed"
      />

      <div className="module-workspace">
        <Outlet />
      </div>
    </div>
  );
}

export default function ReconMain() {
  return <ReconShellInner />;
}
