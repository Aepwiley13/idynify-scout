/**
 * HunterMain — Hunter module content.
 *
 * MIGRATED INTO THE GLOBAL SHELL. This file used to be a self-contained
 * application shell: a 60px icon rail listing every module, a theme picker, a
 * settings button, a "back to Mission Control" button, a user footer and its
 * own Barry instance. Entering Hunter replaced the whole application chrome
 * and leaving it replaced the chrome again.
 *
 * Hunter now owns only what is Hunter's:
 *
 *   Global navigation  → MainLayout          (moves the user across Idynify)
 *   Module navigation  → ModuleSubNav        (changes the working view here)
 *
 * The sub-nav is the shared component, not a local copy — the sections and
 * their descriptions are unchanged, only the visual formatting now comes from
 * the same place Scout's does, so the two cannot drift apart.
 *
 * Barry comes from the shell: one instance, one conversation thread, carrying
 * the navigation context contract. Hunter no longer mounts its own.
 *
 * Hunter = pure execution. Strategy and setup live in Command Center.
 *
 * /hunter/blitz stays OUTSIDE the shell on purpose. It is a timed focus mode
 * with its own header and its own way back; chrome would defeat it.
 *
 * Mobile (max-width: 768px) keeps its original self-contained layout. Mobile
 * is out of scope; see constraint C3 in the Phase 0 assessment.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Users, CalendarCheck, AlertTriangle, Inbox, Zap, Sparkles,
  Building2, Palette, Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import SharedCompaniesView from '../../components/shared/SharedCompaniesView';
import { useT, useThemeCtx } from '../../theme/ThemeContext';
import { BRAND, THEMES, ASSETS } from '../../theme/tokens';
import ModuleSubNav from '../../components/layout/ModuleSubNav';
import AllLeads from '../Scout/AllLeads';

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
        <Palette size={16} color={BRAND.purple} />
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
                <div style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? BRAND.purple : T.text }}>
                  {theme.label}
                </div>
                <div style={{ fontSize: 10, color: T.textFaint }}>{theme.icon}</div>
              </div>
              {themeId === theme.id && <Check size={14} color={BRAND.purple} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function Av({ initials, color = BRAND.purple, size = 24 }) {
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

// ─── Hunter execution sub-nav items ──────────────────────────────────────────
// These mirror the ACTION_LENSES in AllLeads for execution-focused workflow.
const HUNTER_ITEMS = [
  { id: 'blitz',     label: 'Blitz Mode',      Icon: Zap,           desc: 'Rapid engagement — 10 contacts in 60s', route: '/hunter/blitz' },
  { id: 'all',       label: 'All People',      Icon: Users,         desc: 'Engagement card feed — work your board', filter: 'all'         },
  { id: 'companies', label: 'Companies',       Icon: Building2,     desc: 'Companies with engaged contacts'                               },
  { id: 'followup',  label: 'Follow Up Now',   Icon: AlertTriangle, desc: 'Overdue engagement queue',           filter: 'follow_up_due' },
  { id: 'today',     label: "Today's Actions", Icon: CalendarCheck, desc: 'Due follow-ups & priority contacts',  filter: 'today'         },
  { id: 'replied',   label: 'Replied',         Icon: Inbox,         desc: 'Contacts who have responded',        filter: 'replied'        },
  { id: 'active',    label: 'Active',          Icon: Sparkles,      desc: 'Currently in a sequence',            filter: 'in_mission'     },
  { id: 'new',       label: 'New (Unengaged)', Icon: Sparkles,      desc: 'Fresh contacts, not yet touched',    filter: 'new'            },
];

// Orange token for the settings accent, still used by the mobile top bar.
const SETTINGS_ORANGE = '#faaa20';

// ─── Tab → URL param mapping ──────────────────────────────────────────────────
// Note: 'blitz' is a full route (/hunter/blitz), not a tab param — excluded here.
const TAB_MAP = {
  today:     'today',
  followup:  'followup',
  replied:   'replied',
  active:    'active',
  new:       'new',
  all:       'all',
  companies: 'companies',
};


function HunterShellInner() {
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


  // Active tab follows the URL, and holds its last value when the URL is
  // silent — same rule as Scout, so the two modules behave identically.
  const tabParam = searchParams.get('tab') || location.state?.activeTab;
  const urlTab = tabParam ? TAB_MAP[tabParam] : null;

  const [activeTab, setActiveTab] = useState(urlTab || 'all');
  if (urlTab && urlTab !== activeTab) setActiveTab(urlTab);

  const switchTab = (tabId) => {
    const item = HUNTER_ITEMS.find(i => i.id === tabId);
    if (item?.route) {
      navigate(item.route);
      return;
    }
    setActiveTab(tabId);
    // No { replace: true }. Tab changes are navigation and belong in history:
    // previously every intra-module move was written with replace, so browser
    // Back skipped the whole module and exited Hunter entirely.
    setSearchParams({ tab: tabId });
  };

  const activeItem = HUNTER_ITEMS.find(i => i.id === activeTab) || HUNTER_ITEMS[0];
  const activeFilter = activeItem.filter;

  const renderMain = () => {
    if (activeTab === 'companies') {
      return (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SharedCompaniesView mode="hunter" />
        </div>
      );
    }
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <AllLeads mode="hunter" activeFilter={activeFilter} />
      </div>
    );
  };

  // ── Mobile layout ─────────────────────────────────────────────────────────────
  // ── Mobile ───────────────────────────────────────────────────────────────
  // Content only. Hunter used to render its own mobile top bar and a
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
        title="HUNTER"
        tagline="Engage and follow up"
        items={HUNTER_ITEMS}
        activeId={activeTab}
        onSelect={switchTab}
        storageKey="hunter_subnav_collapsed"
      />

      <div className="module-workspace">
        {renderMain()}
      </div>
    </div>
  );
}

/**
 * The pre-migration version resolved the signed-in user (including the
 * impersonation-aware variant) purely to render an email in a sidebar footer.
 * Identity is the shell's job now, so the resolution is gone rather than
 * moved. Views that need the user still fetch it via getEffectiveUser().
 */
export default function HunterMain() {
  return <HunterShellInner />;
}
