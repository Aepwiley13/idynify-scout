/**
 * ScoutMain — Scout module content.
 *
 * BEFORE the shell migration this file was a self-contained application
 * shell: a 60px icon rail listing all eight modules, a 190px sub-nav column,
 * a theme picker, a settings button, a "back to Mission Control" button, a
 * user footer and its own Barry instance. It explicitly did NOT use
 * MainLayout, so entering Scout replaced the entire application chrome and
 * leaving it replaced the chrome again.
 *
 * NOW Scout owns only what is Scout's:
 *
 *   Global navigation  → MainLayout        (moves the user across Idynify)
 *   Module navigation  → this file         (changes the working view in Scout)
 *
 * That is the whole distinction. If a control moves you to another module it
 * belongs to the shell; if it changes what you are looking at inside Scout it
 * belongs here.
 *
 * Contact Profile renders through <Outlet/> as a contextual panel over the
 * list. Because /scout/contact/:id is a CHILD route of /scout, this component
 * never unmounts when a contact opens — the list, its filters and its scroll
 * position are still there when the panel closes. Nothing is rebuilt.
 *
 * Mobile (max-width: 768px) keeps its original self-contained layout. Mobile
 * is out of scope this sprint; see constraint C3 in the Phase 0 assessment.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, Outlet, useParams } from 'react-router-dom';
import {
  Users, Building2, Zap, Plus, Settings, RefreshCw, TrendingUp, Gamepad2,
  Radar, Crosshair, Target, Tent, Shield, Eye, Archive,
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { MODULES, MISSION_CONTROL } from '../../constants/navigationModel';
import DailyLeads from './DailyLeads';
import SavedCompanies from './SavedCompanies';
import AllLeads from './AllLeads';
import CompanyProfileView from './CompanyProfileView';
import ScoutPlus from './ScoutPlus';
import ICPSettings from './ICPSettings';
import CadencesList from './CadencesList';
import './ScoutMain.css';

/**
 * Scout's working views.
 *
 * `route` entries navigate to a sibling route inside the same shell rather
 * than switching a panel. Total Market and Game Mode are in this list on
 * purpose: before the migration they existed ONLY in the global sidebar,
 * which was not rendered on /scout — so two of Scout's own features were
 * unreachable from Scout. One list now defines what Scout contains.
 */
const SCOUT_VIEWS = [
  { id: 'daily',       label: 'Daily Discoveries', Icon: Zap,        desc: 'Review queue' },
  { id: 'all',         label: 'People',            Icon: Users,      desc: 'My leads' },
  { id: 'saved',       label: 'Saved Companies',   Icon: Building2,  desc: 'Hunt list' },
  { id: 'scoutplus',   label: 'Scout+',            Icon: Plus,       desc: 'Add contacts' },
  { id: 'cadences',    label: 'Cadences',          Icon: RefreshCw,  desc: 'Bulk outreach history' },
  { id: 'totalmarket', label: 'Total Market',      Icon: TrendingUp, desc: 'Full addressable market', route: '/scout/total-market' },
  { id: 'icpsettings', label: 'ICP Settings',      Icon: Settings,   desc: 'Targeting criteria' },
  { id: 'game',        label: 'Game Mode',         Icon: Gamepad2,   desc: '15 in 30 — beta', route: '/scout/game' },
];

/** URL ?tab= value ⇄ internal view id. */
const TAB_TO_VIEW = {
  'daily-leads':     'daily',
  'saved-companies': 'saved',
  'all-leads':       'all',
  'icp-settings':    'icpsettings',
  'scout-plus':      'scoutplus',
  'company-search':  'scoutplus',
  'cadences':        'cadences',
};

// Built explicitly rather than by inverting TAB_TO_VIEW: two tabs map to
// 'scoutplus', so an automatic inversion would pick whichever came last and
// produce the wrong canonical URL.
const VIEW_TO_TAB = {
  daily:       'daily-leads',
  saved:       'saved-companies',
  all:         'all-leads',
  icpsettings: 'icp-settings',
  scoutplus:   'scout-plus',
  cadences:    'cadences',
};

/**
 * What bare /scout means. ONE answer, in one place.
 *
 * Previously three places disagreed: ScoutMain's initial state said People,
 * an effect immediately overrode it to Daily Discoveries, and both the
 * sidebar highlight and the page title said People — so the header said one
 * thing while the content showed another. Daily Discoveries is kept because
 * it is where users actually land today; the fix is that the tab strip now
 * shows it as active, so nothing disagrees.
 */
const DEFAULT_VIEW = 'daily';

// Mobile-only module list. Sourced from navigationModel so it cannot drift
// from the sidebar the way the eight hand-maintained MODULE_RAIL copies did.
const MOBILE_MODULE_ICONS = {
  scout: Radar, hunter: Crosshair, sniper: Target,
  basecamp: Tent, reinforcements: Shield, recon: Eye, fallback: Archive,
};

function ScoutShellInner() {
  const T = useT();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const mql = window.matchMedia('(max-width: 768px)');
  const [isMobile, setIsMobile] = useState(() => mql.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [drillCompanyId, setDrillCompanyId] = useState(null);

  // Active view follows the URL when the URL says anything, and holds its
  // last value when it does not.
  //
  // Why it has to hold: the contact panel lives at /scout/contact/:id, which
  // carries no ?tab=. If the view were derived from the URL alone it would
  // snap back to the default the moment a contact opened — the list would
  // silently change underneath the panel, and closing would land the user
  // somewhere they never chose. Holding the last view is what makes "Scout
  // state is preserved when opening and closing a contact" true.
  const tabParam = searchParams.get('tab');
  const urlView = tabParam ? TAB_TO_VIEW[tabParam] : null;

  const [activeView, setActiveView] = useState(urlView || DEFAULT_VIEW);
  if (urlView && urlView !== activeView) setActiveView(urlView);

  // A contact panel is open when the child route matched.
  const contactPanelOpen = Boolean(params.contactId);

  const switchView = (viewId) => {
    const view = SCOUT_VIEWS.find(v => v.id === viewId);
    if (view?.route) {
      navigate(view.route);
      return;
    }
    setDrillCompanyId(null);
    setActiveView(viewId);
    // No { replace: true }. Tab changes are navigation and belong in history:
    // previously every intra-module move was written with replace, so browser
    // Back skipped the whole module and exited Scout entirely.
    setSearchParams({ tab: VIEW_TO_TAB[viewId] || 'all-leads' });
  };

  /**
   * Closing the contact panel returns to the view the user was actually in,
   * not to Scout's default. The list underneath never unmounted, so this is a
   * genuine return — same filters, same scroll position, nothing refetched.
   *
   * Memoised, and handed down through a memoised context object: the panel
   * uses this as an effect dependency and as the prop that puts ContactProfile
   * into panel mode, so a fresh function each render would churn both.
   */
  const closeContactPanel = useCallback(() => {
    navigate(`/scout?tab=${VIEW_TO_TAB[activeView] || 'all-leads'}`);
  }, [navigate, activeView]);

  const outletContext = useMemo(() => ({ onClose: closeContactPanel }), [closeContactPanel]);

  const renderView = () => {
    if (drillCompanyId) {
      return <CompanyProfileView companyId={drillCompanyId} onBack={() => setDrillCompanyId(null)} />;
    }
    if (activeView === 'daily')       return <DailyLeads onNavigate={switchView} />;
    if (activeView === 'saved')       return <SavedCompanies onSelectCompany={setDrillCompanyId} />;
    if (activeView === 'all')         return <AllLeads mode="scout" />;
    if (activeView === 'scoutplus')   return <ScoutPlus />;
    if (activeView === 'icpsettings') return <ICPSettings />;
    if (activeView === 'cadences')    return <CadencesList />;
    return null;
  };

  // ── Mobile — preserved from the pre-migration layout (constraint C3) ─────
  if (isMobile) {
    const MOBILE_BOTTOM_NAV = [
      { id: 'daily',     label: 'Daily',  Icon: Zap },
      { id: 'saved',     label: 'Saved',  Icon: Building2 },
      { id: 'all',       label: 'People', Icon: Users },
      { id: 'scoutplus', label: 'Scout+', Icon: Plus },
      { id: 'icpsettings', label: 'ICP',  Icon: Settings },
    ];

    return (
      <div className="scout-mobile" style={{ background: T.appBg, color: T.text }}>
        <div className="scout-mobile-topbar" style={{ background: T.railBg, borderColor: T.border }}>
          <button
            type="button"
            className="scout-mobile-home"
            onClick={() => navigate(MISSION_CONTROL.path)}
            aria-label={MISSION_CONTROL.label}
          >
            <img src={ASSETS.logoMark} alt="" onError={e => { e.target.style.display = 'none'; }} />
          </button>
          <div className="scout-mobile-modules">
            {MODULES.map(mod => {
              const Icon = MOBILE_MODULE_ICONS[mod.id] || Radar;
              const active = mod.id === 'scout';
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => navigate(mod.path)}
                  className={`scout-mobile-module ${active ? 'active' : ''}`}
                  title={mod.label}
                >
                  <Icon size={16} />
                  <span>{mod.label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="scout-mobile-home"
            onClick={() => navigate('/settings')}
            aria-label="Settings"
          >
            <Settings size={15} />
          </button>
        </div>

        <div className="scout-mobile-content">{renderView()}</div>
        {contactPanelOpen && <Outlet context={outletContext} />}

        <div className="scout-mobile-bottomnav" style={{ background: T.railBg, borderColor: T.border }}>
          {MOBILE_BOTTOM_NAV.map(it => {
            const active = activeView === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => switchView(it.id)}
                className={`scout-mobile-tab ${active ? 'active' : ''}`}
                style={{ color: active ? BRAND.pink : T.textFaint }}
              >
                <it.Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                <span>{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Desktop — content only. The shell owns everything around this. ───────
  return (
    <div className="scout-module">
      {/* Module navigation: changes the working view INSIDE Scout.
          The user can see the active module (sidebar + breadcrumb, owned by
          the shell) and the active Scout view (here) at the same time. */}
      <nav className="scout-views" aria-label="Scout views">
        {SCOUT_VIEWS.map(view => {
          const active = !view.route && activeView === view.id;
          return (
            <button
              key={view.id}
              type="button"
              className={`scout-view-tab ${active ? 'active' : ''}`}
              onClick={() => switchView(view.id)}
              title={view.desc}
              aria-current={active ? 'true' : undefined}
            >
              <view.Icon size={15} aria-hidden="true" />
              <span>{view.label}</span>
            </button>
          );
        })}
      </nav>

      <div className={`scout-workspace ${contactPanelOpen ? 'with-panel' : ''}`}>
        <div className="scout-list" aria-hidden={contactPanelOpen ? undefined : undefined}>
          {renderView()}
        </div>

        {/* Contact panel slot. Renders the /scout/contact/:contactId child
            route. Scout stays mounted underneath — closing restores exactly
            what was here, with no state to rebuild. */}
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

/**
 * The pre-migration version of this component resolved the signed-in user
 * (including the impersonation-aware variant) purely to render an email in a
 * sidebar footer. Identity is the shell's job now, and every other shell
 * repeated the same block — so the resolution is gone rather than moved.
 * Views that need the user still fetch it themselves via getEffectiveUser().
 */
export default function ScoutMain() {
  return <ScoutShellInner />;
}
