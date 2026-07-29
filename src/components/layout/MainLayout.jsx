import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import MoreSheet from './MoreSheet';
import BarrySessionHistoryPanel from '../barry/BarrySessionHistoryPanel';
import BarryChatPanel from '../dashboard/BarryChatPanel';
import { User, Menu, Settings, LogOut, History } from 'lucide-react';
import { auth } from '../../firebase/config';
import { useActiveUserId } from '../../context/ImpersonationContext';
import './MainLayout.css';

const MainLayout = ({ children, user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const activeUserId = useActiveUserId();

  // ── Global Barry shell state ──────────────────────────────────────────────
  // BarryChatPanel is mounted once here and stays mounted; the sidebar button
  // toggles `barryOpen`. Orientation flows up from the panel; page KPI context
  // flows up from the routed page. Both flow back down to the routed page.
  const [barryOpen, setBarryOpen] = useState(false);
  const [orientation, setOrientation] = useState({
    status: 'loading',
    brief: null,
    suggestedPrompts: [],
    mode: null,
    error: null,
  });
  const [barryPageContext, setBarryPageContext] = useState({
    kpiContext: {},
    kpiContextReady: false,
  });

  const barryButtonRef = useRef(null);
  const barryHostRef = useRef(null);
  const prevBarryOpen = useRef(false);

  // Focus trap: while open, move focus into the panel and cycle Tab/Shift+Tab
  // within it. Hand-rolled — no dependency.
  useEffect(() => {
    if (!barryOpen) return;
    const host = barryHostRef.current;
    if (!host) return;

    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(host.querySelectorAll(selector)).filter((el) => el.offsetParent !== null);

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

  // Return focus to the Sidebar Barry button when the panel closes.
  useEffect(() => {
    if (prevBarryOpen.current && !barryOpen) {
      barryButtonRef.current?.focus();
    }
    prevBarryOpen.current = barryOpen;
  }, [barryOpen]);

  const handleLogout = async () => {
    try {
      await auth.signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Get page title based on current route
  const getPageTitle = () => {
    const pathname = location.pathname;
    // Read tab from URL search params (new) with fallback to location.state (legacy)
    const urlTab = new URLSearchParams(location.search).get('tab');
    const activeTab = urlTab || location.state?.activeTab;

    if (pathname === '/mission-control-v2') {
      return 'Mission Control';
    }

    if (pathname === '/onboarding/barry') {
      return 'ICP Setup — Barry';
    }

    // Company Profile page - focused view
    if (pathname.match(/^\/scout\/company\/[^/]+$/)) {
      return 'Company Profile';
    }

    // Company People page
    if (pathname.match(/^\/scout\/company\/[^/]+\/leads$/)) {
      return 'Company People';
    }

    // Contact Profile page
    if (pathname.match(/^\/scout\/contact\/[^/]+$/)) {
      return 'Contact Profile';
    }

    // Total Market — full addressable-market view
    if (pathname === '/scout/total-market') {
      return 'Total Market';
    }

    // Scout main pages with tabs
    if (pathname === '/scout') {
      if (activeTab === 'all-leads' || !activeTab) {
        return 'People';
      }
      if (activeTab === 'company-search') return 'Company Search';
      if (activeTab === 'saved-companies') return 'Saved Companies';
      if (activeTab === 'all-leads') return 'People';
      if (activeTab === 'total-market') return 'Total Market';
      if (activeTab === 'icp-settings') return 'ICP Settings';
      if (activeTab === 'scout-plus') return 'Scout+';
    }

    if (pathname === '/hunter') return 'Hunter';
    if (pathname.startsWith('/hunter/create-mission')) return 'Create Mission';
    if (pathname.match(/^\/hunter\/mission\//)) return 'Mission Detail';

    // RECON pages — new top-level pillar
    if (pathname === '/recon') return 'RECON';
    if (pathname === '/recon/icp-intelligence') return 'ICP Intelligence';
    if (pathname === '/recon/messaging') return 'Messaging & Voice';
    if (pathname === '/recon/objections') return 'Objections & Constraints';
    if (pathname === '/recon/competitive-intel') return 'Competitive Intel';
    if (pathname === '/recon/buying-signals') return 'Buying Signals';
    if (pathname === '/recon/barry-training') return 'Barry Training';
    if (pathname.match(/^\/recon\/section\//)) return 'RECON Section';

    // Legacy RECON path
    if (pathname.startsWith('/mission-control-v2/recon')) return 'RECON';
    if (pathname === '/people') return 'All People';
    if (pathname === '/settings') return 'Settings';
    if (pathname === '/admin') return 'Admin';

    return 'Idynify Scout';
  };

  return (
    <div className="main-layout">
      <Sidebar
        mobileMenuOpen={mobileMenuOpen}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        onToggleBarry={() => setBarryOpen((o) => !o)}
        barryOpen={barryOpen}
        barryButtonRef={barryButtonRef}
      />

      {/* Mobile Menu Backdrop */}
      {mobileMenuOpen && (
        <div
          className="mobile-menu-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="main-content">
        {/* Top Bar */}
        <header className="top-bar">
          <div className="top-bar-left">
            <button
              className="mobile-menu-trigger"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={24} />
            </button>
            <h1 className="page-title">{getPageTitle()}</h1>
          </div>

          <div className="top-bar-right">
            {/* Barry session history */}
            <button
              className="topbar-settings-btn"
              onClick={() => setHistoryOpen(true)}
              aria-label="Barry session history"
              title="Session History"
            >
              <History size={20} />
            </button>
            {/* Settings shortcut — visible on mobile portrait at top of screen */}
            <button
              className={`topbar-settings-btn ${location.pathname === '/settings' ? 'active' : ''}`}
              onClick={() => navigate('/settings')}
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={20} />
            </button>
            {user && (
              <>
                <div className="user-info">
                  <User size={16} />
                  <span>{user.email}</span>
                </div>
                <button
                  className="logout-button"
                  onClick={handleLogout}
                  title="Logout"
                >
                  <LogOut size={18} />
                  <span>Logout</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content">
          {React.isValidElement(children)
            ? React.cloneElement(children, {
                orientation,
                openBarry: () => setBarryOpen(true),
                setBarryPageContext,
              })
            : children}
        </main>
      </div>

      {/* Bottom Navigation — mobile only (rendered outside main-content so it's always fixed) */}
      <BottomNav onOpenMore={() => setMoreSheetOpen(true)} />

      {/* More Sheet — slide-up overlay for secondary navigation on mobile */}
      <MoreSheet isOpen={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} />

      {/* Barry session history panel */}
      <BarrySessionHistoryPanel isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />

      {/* Global Barry panel host — always mounted; visibility toggled via inert
          + aria-hidden so BarryChatPanel keeps its orientation and conversation
          state across open/close cycles. */}
      <div
        ref={barryHostRef}
        className="barry-panel-host"
        role="dialog"
        aria-modal={barryOpen ? 'true' : undefined}
        aria-label="Barry AI Assistant"
        aria-hidden={!barryOpen}
        inert={!barryOpen ? '' : undefined}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') setBarryOpen(false); }}
      >
        <BarryChatPanel
          userId={activeUserId || auth.currentUser?.uid}
          kpiContext={barryPageContext.kpiContext}
          kpiContextReady={barryPageContext.kpiContextReady}
          onOrientationChange={setOrientation}
        />
      </div>
    </div>
  );
};

export default MainLayout;
