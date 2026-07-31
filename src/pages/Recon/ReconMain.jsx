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
  // ── Mobile ───────────────────────────────────────────────────────────────
  // Content only. Recon used to render its own mobile top bar and a
  // horizontal strip of its own sections beneath it — module navigation in the
  // one place a phone user's thumb cannot reach, while the bottom bar listed
  // MODULES, duplicating the hamburger.
  //
  // The shell owns all three surfaces now: hamburger for modules, bottom bar
  // for these sections, top bar for where you are.
  if (isMobile) {
    return (
      <div className="module-mobile">
        <Outlet />
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
