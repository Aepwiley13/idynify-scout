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
import { Menu, History, Search, ChevronRight, LifeBuoy } from 'lucide-react';
import Sidebar from './Sidebar';
import UserMenu from './UserMenu';
import BottomNav from './BottomNav';
import MoreSheet from './MoreSheet';
import ModuleMoreSheet from './ModuleMoreSheet';
import ModuleErrorBoundary from './ModuleErrorBoundary';
import BarrySessionHistoryPanel from '../barry/BarrySessionHistoryPanel';
import BarryChatPanel from '../dashboard/BarryChatPanel';
import NotificationCenter from '../notifications/NotificationCenter';
import QuickEngageDrawer from '../engage/QuickEngageDrawer';
import ShellAnnouncements from './ShellAnnouncements';
import CommandBar from './CommandBar';
import { auth } from '../../firebase/config';
import { useActiveUserId } from '../../context/ImpersonationContext';
import { ShellProvider, useShell } from '../../context/ShellContext';
import { resolveModule, resolveDestination, MISSION_CONTROL } from '../../constants/navigationModel';
import { supportMailto } from '../../constants/support';
import { bottomNavFor } from '../../constants/mobileNavigation';
import { useT } from '../../theme/ThemeContext';
import './MainLayout.css';

/* MODULES_WITH_OWN_MOBILE_NAV is gone.
 *
 * It listed the modules that shipped their own mobile bottom nav, so the shell
 * would yield rather than stack a second one on top — a holding position from
 * Phase 0 constraint C3, kept while mobile was out of scope. Mobile is in scope
 * now: no module renders navigation of its own, the shell's bottom bar shows
 * the current module's SECTIONS, and there is nothing left to yield to. */

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
  const [commandBarOpen, setCommandBarOpen] = React.useState(false);

  const {
    shellUser,
    barryOpen, openBarry, closeBarry, toggleBarry,
    setOrientation,
    sidebarMode,
    barryPageContext,
    navigationContext,
    quickEngage,
    arrival,
  } = useShell();

  const barryButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const barryHostRef = useRef(null);

  const module = resolveModule(location.pathname);
  const moduleHasOwnMore = Boolean(bottomNavFor(module.id)?.overflow?.length);

  /**
   * The module the BREADCRUMB names.
   *
   * /contact/:id and /company/:id belong to no module by design — that is what
   * makes them reachable from every module without dragging Scout's shell
   * along. So the trail comes from where the user actually came from, which
   * the canonical page declares via useArrival(). Without an arrival (a
   * bookmark, a refresh, a pasted link) this falls back to path resolution,
   * which lands on Mission Control — honest, since there is no origin to name.
   *
   * Only the breadcrumb is overridden. The bottom nav, the More sheet and the
   * content padding still follow the route, because those describe where the
   * user IS, not how they got here.
   */
  const breadcrumbModule = resolveDestination(arrival?.originModuleId) ?? module;

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
        user={shellUser ?? user}
        onLogout={handleLogout}
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
              module={breadcrumbModule}
              entityLabel={navigationContext?.entity_label}
              onNavigate={navigate}
            />
          </div>

          <div className="top-bar-right">
            {/* Global search. The affordance sat here disabled through Phase 0
                because no global search existed — an honest placeholder rather
                than a dead input. It exists now: CommandBar, mounted once at
                the bottom of this shell, opened from here or with ⌘K.
                Focus returns to this button when the overlay closes, because
                CommandBar restores whatever had focus when it opened. */}
            <button
              className={`topbar-icon-btn${commandBarOpen ? ' active' : ''}`}
              onClick={() => setCommandBarOpen(true)}
              aria-label="Search contacts and companies"
              aria-haspopup="dialog"
              aria-expanded={commandBarOpen}
              title="Search (⌘K)"
            >
              <Search size={18} />
            </button>

            {activeUserId && <NotificationCenter userId={activeUserId} T={T} />}

            <button
              className="topbar-icon-btn topbar-desktop-only"
              onClick={() => setHistoryOpen(true)}
              aria-label="Barry session history"
              title="Session history"
            >
              <History size={18} />
            </button>

            {/* Help / Support. Was a Crisp-if-loaded / mailto-if-not fork
                pointing at support@idynify.com, an address nothing answers —
                so the fallback path silently went nowhere. One destination
                now, shared with the mobile drawer. */}
            <a
              className="topbar-icon-btn topbar-desktop-only"
              href={supportMailto()}
              aria-label="Help and support"
              title="Help / Support"
            >
              <LifeBuoy size={18} aria-hidden="true" />
            </a>

            {/* Settings and Log out are inside this menu now, and the email
                with them. The top bar was showing the raw address on every
                screen next to a bordered Log out button. */}
            {user && <UserMenu user={shellUser ?? user} onLogout={handleLogout} />}
          </div>
        </header>

        {/* The content boundary. Routes swap here; nothing above or beside
            this element re-mounts. */}
        {/* Module content, inside a boundary.
            A module that throws used to unmount the whole tree — on a dark
            theme, a black screen with no message and no navigation. The
            boundary sits INSIDE the shell, so a broken section leaves the
            hamburger, the bottom bar and Barry working and the user can go
            somewhere else.

            Keyed by pathname AND search. Most modules switch sections with
            ?tab=, so keying on pathname alone meant a section that threw kept
            showing its error after the user picked a different tab — the
            module looked permanently broken when only one section was. This
            is the shell's LAST RESORT; modules put a closer boundary around
            their own section content so their sub-nav survives. */}
        <main className={`page-content ${fullBleed ? 'page-content-full' : ''}`}>
          <ModuleErrorBoundary
            resetKey={location.pathname + location.search}
            moduleLabel={module.label}
          >
            {children ?? <Outlet />}
          </ModuleErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom nav — the module's sections, always. */}
      <BottomNav onOpenMore={() => setMoreSheetOpen(true)} moreButtonRef={moreButtonRef} />

      {/* Two More surfaces, never both.
          Inside a module with overflow sections, More belongs to the module.
          On Mission Control, Settings or anything unmatched, the bar lists
          modules and More is the global sheet. Which one opens follows from
          which bar is showing, so the trigger and its sheet always agree. */}
      {moduleHasOwnMore ? (
        <ModuleMoreSheet
          isOpen={moreSheetOpen}
          onClose={() => setMoreSheetOpen(false)}
        />
      ) : (
        <MoreSheet
          isOpen={moreSheetOpen}
          onClose={() => setMoreSheetOpen(false)}
          onOpenBarry={() => openBarry({ returnFocusTo: moreButtonRef.current })}
        />
      )}

      <BarrySessionHistoryPanel isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />

      {/* Global search overlay. Mounted here — once, above every route — and
          never conditionally: the ⌘K listener lives inside it, so unmounting
          while closed would take the shortcut with it. It renders no panel
          until opened. */}
      <CommandBar
        isOpen={commandBarOpen}
        onOpen={() => setCommandBarOpen(true)}
        onClose={() => setCommandBarOpen(false)}
      />

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
