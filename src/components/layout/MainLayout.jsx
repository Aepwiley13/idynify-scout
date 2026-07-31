/**
 * MainLayout — the one global application shell.
 *
 * Sprint 1 shell migration. Before this change MainLayout was applied per
 * route via <ProtectedRoute withLayout>, which meant React rebuilt the whole
 * element tree on every navigation and the shell — sidebar, top bar and Barry
 * alike — unmounted and remounted on each transition. Eight modules avoided it
 * entirely by shipping their own chrome.
 *
 * Now MainLayout mounts once, beneath the router, and routes render into
 * <Outlet/>. The sidebar does not unmount. Barry does not unmount. The top bar
 * does not swap.
 *
 * MainLayout OWNS
 *   global sidebar · top bar · breadcrumb · global search mount ·
 *   notifications · account + logout · settings access · Barry container and
 *   visibility · Quick Engage host · stage-transition announcements ·
 *   the main content boundary
 *
 * MainLayout DOES NOT OWN
 *   module filters · module tables · contact actions · pipeline controls ·
 *   module business logic · module data fetching · module empty states
 *
 * Two render modes, both supported during the incremental migration:
 *   <MainLayout user={u} />            → renders <Outlet/>  (layout route)
 *   <MainLayout user={u}>{child}</…>   → renders child      (legacy wrapper,
 *                                        retained for rollback layer 1)
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { User, Menu, Settings, LogOut, History, Search, ChevronRight, LifeBuoy } from 'lucide-react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import MoreSheet from './MoreSheet';
import BarrySessionHistoryPanel from '../barry/BarrySessionHistoryPanel';
import BarryChatPanel from '../dashboard/BarryChatPanel';
import NotificationCenter from '../notifications/NotificationCenter';
import QuickEngageDrawer from '../engage/QuickEngageDrawer';
import ShellAnnouncements from './ShellAnnouncements';
import { auth } from '../../firebase/config';
import { useActiveUserId } from '../../context/ImpersonationContext';
import { ShellProvider, useShell } from '../../context/ShellContext';
import { resolveModule, MISSION_CONTROL } from '../../constants/navigationModel';
import { useT } from '../../theme/ThemeContext';
import './MainLayout.css';

/**
 * Modules that still render their own mobile bottom navigation.
 *
 * Constraint C3 from the Phase 0 assessment: bringing Scout into the shell
 * would give mobile Scout two bottom navs — the shell's and its own. Mobile
 * is out of scope this sprint, so the shell yields on those routes rather
 * than stacking. Desktop is unaffected. Removed when the mobile sprint
 * reconciles the two.
 */
const MODULES_WITH_OWN_MOBILE_NAV = [
  '/scout', '/hunter', '/sniper', '/basecamp', '/reinforcements', '/fallback',
  '/recon', '/command-center',
];

function ownsItsMobileNav(pathname) {
  return MODULES_WITH_OWN_MOBILE_NAV.some(
    p => pathname === p || pathname.startsWith(p + '?')
  );
}

/**
 * Breadcrumb: Mission Control ▸ Scout ▸ <entity>
 *
 * Answers "where am I" and "how did I get here" in one line. The entity
 * segment is supplied by the module through useShellEntity(), so a contact
 * panel names the person without the shell knowing anything about contacts.
 */
function Breadcrumb({ module, entityLabel, onNavigate }) {
  const crumbs = [];

  if (module.id !== MISSION_CONTROL.id) {
    crumbs.push({ label: MISSION_CONTROL.label, path: MISSION_CONTROL.path });
  }
  crumbs.push({ label: module.label, path: module.path });
  if (entityLabel) crumbs.push({ label: entityLabel, path: null });

  return (
    <nav className="shell-breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span className="shell-breadcrumb-item" key={`${crumb.label}-${i}`}>
            {i > 0 && <ChevronRight size={13} className="shell-breadcrumb-sep" aria-hidden="true" />}
            {isLast || !crumb.path ? (
              <span className="shell-breadcrumb-current" aria-current="page">{crumb.label}</span>
            ) : (
              <button type="button" className="shell-breadcrumb-link" onClick={() => onNavigate(crumb.path)}>
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── ShellChrome — consumes the shell it is rendered inside ──────────────────

function ShellChrome({ children, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const T = useT();
  const activeUserId = useActiveUserId();

  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const {
    barryOpen, openBarry, closeBarry, toggleBarry,
    setOrientation,
    sidebarMode,
    barryPageContext,
    navigationContext,
    quickEngage,
  } = useShell();

  const barryButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const barryHostRef = useRef(null);

  const module = resolveModule(location.pathname);

  // Route-aware Barry readiness. Only Mission Control reports KPI context
  // upward, so gate on the real signal there and treat every other route as
  // ready immediately — Barry initialises with empty context rather than
  // hanging on a skeleton. Deterministic; no timer.
  const isMissionControl = location.pathname === MISSION_CONTROL.path;
  const effectiveKpiContextReady = isMissionControl
    ? barryPageContext.kpiContextReady
    : true;

  // Focus trap while Barry is open. Hand-rolled — no dependency.
  useEffect(() => {
    if (!barryOpen) return undefined;
    const host = barryHostRef.current;
    if (!host) return undefined;

    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(host.querySelectorAll(selector)).filter(el => el.offsetParent !== null);

    (getFocusable()[0] || host).focus();

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    host.addEventListener('keydown', onKeyDown);
    return () => host.removeEventListener('keydown', onKeyDown);
  }, [barryOpen]);

  const handleLogout = useCallback(async () => {
    try {
      await auth.signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  }, [navigate]);

  // Content is full-bleed for module hubs that manage their own padding;
  // padded for document-style screens. Scout renders its own view chrome.
  const fullBleed = module.id !== MISSION_CONTROL.id;

  return (
    <div className={`main-layout ${fullBleed ? 'shell-fixed-height' : ''} sidebar-${sidebarMode}`}>
      <Sidebar
        mobileMenuOpen={mobileMenuOpen}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        onToggleBarry={() => toggleBarry({ returnFocusTo: barryButtonRef.current })}
        barryOpen={barryOpen}
        barryButtonRef={barryButtonRef}
      />

      {mobileMenuOpen && (
        <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      <div className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            <button
              className="mobile-menu-trigger"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={24} />
            </button>
            <Breadcrumb
              module={module}
              entityLabel={navigationContext?.entity_label}
              onNavigate={navigate}
            />
          </div>

          <div className="top-bar-right">
            {/* Global search — mount point reserved, feature not built.
                Phase 0 constraint C2: the brief lists a global search entry
                point among shell responsibilities, but no global search
                exists in the product. A disabled, labelled affordance is
                honest; a non-functional input would not be. */}
            <button
              className="topbar-icon-btn"
              disabled
              aria-label="Global search — coming soon"
              title="Global search — coming soon"
            >
              <Search size={18} />
            </button>

            {activeUserId && <NotificationCenter userId={activeUserId} T={T} />}

            <button
              className="topbar-icon-btn"
              onClick={() => setHistoryOpen(true)}
              aria-label="Barry session history"
              title="Session history"
            >
              <History size={18} />
            </button>

            {/* Help / Support moved here from the sidebar: the final brief's
                sidebar is wordmark + modules + Barry card only, and dropping
                the control outright would have removed the only in-product
                route to support. Reuses the Crisp widget already mounted for
                authenticated users rather than adding a second surface. */}
            <button
              className="topbar-icon-btn"
              onClick={() => {
                if (window.$crisp) window.$crisp.push(['do', 'chat:open']);
                else window.open('mailto:support@idynify.com', '_blank');
              }}
              aria-label="Help and support"
              title="Help / Support"
            >
              <LifeBuoy size={18} />
            </button>

            <button
              className={`topbar-icon-btn ${location.pathname === '/settings' ? 'active' : ''}`}
              onClick={() => navigate('/settings')}
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={18} />
            </button>

            {user && (
              <>
                <div className="user-info">
                  <User size={16} />
                  <span>{user.email}</span>
                </div>
                <button className="logout-button" onClick={handleLogout} title="Log out">
                  <LogOut size={18} />
                  <span>Log out</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* The content boundary. Routes swap here; nothing above or beside
            this element re-mounts. */}
        <main className={`page-content ${fullBleed ? 'page-content-full' : ''}`}>
          {children ?? <Outlet />}
        </main>
      </div>

      {/* Mobile bottom nav — suppressed on modules that still ship their own
          (Phase 0 constraint C3). */}
      {!ownsItsMobileNav(location.pathname) && (
        <BottomNav onOpenMore={() => setMoreSheetOpen(true)} moreButtonRef={moreButtonRef} />
      )}

      <MoreSheet
        isOpen={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        onOpenBarry={() => openBarry({ returnFocusTo: moreButtonRef.current })}
      />

      <BarrySessionHistoryPanel isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />

      {/* Stage-transition announcements. Only explicit announce() calls
          surface here — routine navigation never produces one. */}
      <ShellAnnouncements />

      {/* Quick Engage — shell-hosted so it overlays whatever is underneath
          without unmounting it. Closing restores exact prior context. */}
      {quickEngage && <QuickEngageDrawer />}

      {/* Barry — always mounted, visibility toggled via inert + aria-hidden so
          conversation and orientation state survive open/close AND navigation.
          This is the whole point of the shell: one Barry, one thread. */}
      <div
        ref={barryHostRef}
        className="barry-panel-host"
        role="dialog"
        aria-modal={barryOpen ? 'true' : undefined}
        aria-label="Barry"
        aria-hidden={!barryOpen}
        inert={!barryOpen ? '' : undefined}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') closeBarry(); }}
      >
        <button
          type="button"
          className="barry-host-close"
          onClick={closeBarry}
          aria-label="Close Barry"
        >
          ✕
        </button>
        <BarryChatPanel
          userId={activeUserId || auth.currentUser?.uid}
          kpiContext={barryPageContext.kpiContext}
          kpiContextReady={effectiveKpiContextReady}
          onOrientationChange={setOrientation}
          navigationContext={navigationContext}
        />
      </div>
    </div>
  );
}

// ─── MainLayout — provides the shell, then renders its chrome ────────────────

const MainLayout = ({ children, user, userData }) => (
  <ShellProvider user={user} userData={userData}>
    <ShellChrome user={user}>{children}</ShellChrome>
  </ShellProvider>
);

export default MainLayout;
