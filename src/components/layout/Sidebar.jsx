/**
 * Sidebar — Layer 1 of the three-layer navigation.
 *
 *   [Layer 1]        [Layer 2]            [Layer 3]
 *   Sidebar       →  Module sub-nav   →   Content
 *   220px / 64px     190px, collapsible   fills the rest
 *
 * Two modes, toggled by the chevron on the sidebar's right edge and
 * remembered across navigation and reload:
 *
 *   wide (default)  220px · IDYNIFY wordmark · full module names · Barry card
 *   compact          64px · ID mark · icon + short label · Barry icon
 *
 * The mode lives in ShellContext rather than here, because the content area is
 * offset by a margin that has to match the sidebar's width — one owner means
 * the two can never disagree.
 *
 * The toggle is independent of Layer 2: collapsing the sidebar does not touch
 * the module sub-nav panel, and vice versa.
 *
 * Things this sidebar deliberately does NOT have:
 *   · group headers (PIPELINE / RELATIONSHIPS / INTELLIGENCE)
 *   · descriptive subtitles under module names
 *   · a theme toggle — Settings already owns a Themes section
 *   · Barry as a plain nav item — he is the card / icon at the bottom only
 *
 * Order comes from SIDEBAR_ORDER in constants/navigationModel.js, the single
 * source of truth for what exists and what it is called.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Radar, Crosshair, Target, Tent, Shield, Archive, Eye, Users,
  ChevronRight, ChevronLeft,
} from 'lucide-react';
import {
  MISSION_CONTROL,
  sidebarDestinations,
  resolveModule,
} from '../../constants/navigationModel';
import { ASSETS } from '../../theme/tokens';
import { useShell } from '../../context/ShellContext';
import './Sidebar.css';

/** Icons live in the view layer; navigationModel stays presentation-free. */
const MODULE_ICONS = {
  'mission-control': Home,
  scout: Radar,
  hunter: Crosshair,
  sniper: Target,
  basecamp: Tent,
  recon: Eye,
  reinforcements: Users,
  fallback: Archive,
  'command-center': Users,
};

/**
 * Brand mark — full wordmark in wide mode, square mark in compact.
 *
 * Both fall back rather than rendering nothing. /assets/Idynify_logo1.png,
 * Short_Logo_Idynify.png and barry_AI.jpg are not in this repository, so
 * without fallbacks the top of the sidebar is blank in any environment where
 * the assets are not deployed. Flagged for Aaron — a CSS wordmark is a
 * safety net, not the shipping brand asset.
 */
function BrandMark({ compact }) {
  const [failed, setFailed] = useState(false);

  if (compact) {
    return failed ? (
      <span className="sidebar-mark-fallback" aria-hidden="true">ID</span>
    ) : (
      <img
        className="sidebar-mark-img"
        src={ASSETS.logoMark}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  }

  return failed ? (
    <span className="sidebar-wordmark-text" aria-hidden="true">IDYNIFY</span>
  ) : (
    <img
      className="sidebar-wordmark-img"
      src={ASSETS.logoFull}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Barry. A card in wide mode, an icon in compact. Never a nav item — he is a
 * persistent overlay, so this opens him rather than navigating anywhere.
 */
function BarryControl({ compact, onOpen, barryOpen, buttonRef }) {
  const [avatarFailed, setAvatarFailed] = useState(false);

  const avatar = avatarFailed ? (
    <span className="barry-avatar-fallback" aria-hidden="true">🐻</span>
  ) : (
    <img src={ASSETS.barryAvatar} alt="" onError={() => setAvatarFailed(true)} />
  );

  return (
    <button
      type="button"
      ref={buttonRef}
      className={`barry-card ${compact ? 'compact' : ''} ${barryOpen ? 'open' : ''}`}
      onClick={onOpen}
      aria-label="Open Barry"
      aria-expanded={barryOpen}
      title={compact ? 'Barry' : undefined}
    >
      <span className="barry-card-avatar">{avatar}</span>
      {!compact && (
        <>
          <span className="barry-card-name">Barry</span>
          <ChevronRight size={16} className="barry-card-chevron" aria-hidden="true" />
        </>
      )}
    </button>
  );
}

const Sidebar = ({
  mobileMenuOpen = false,
  onCloseMobileMenu = () => {},
  onToggleBarry,
  barryOpen = false,
  barryButtonRef,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { openBarry, sidebarMode, toggleSidebar } = useShell();

  const compact = sidebarMode === 'compact';

  // Longest-prefix resolution keeps Scout lit on /scout/contact/:id — the
  // active module must stay obvious on nested routes, not just module hubs.
  const activeModule = resolveModule(location.pathname);

  const go = (path) => {
    navigate(path);
    onCloseMobileMenu();
  };

  return (
    <div className={`sidebar ${compact ? 'compact' : 'wide'} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      <button
        type="button"
        className="sidebar-brand"
        onClick={() => go(MISSION_CONTROL.path)}
        aria-label={`Idynify — go to ${MISSION_CONTROL.label}`}
      >
        <BrandMark compact={compact} />
      </button>

      {/* Right-edge toggle, near the top. Independent of the sub-nav panel. */}
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggleSidebar}
        aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!compact}
        title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {compact
          ? <ChevronRight size={12} aria-hidden="true" />
          : <ChevronLeft size={12} aria-hidden="true" />}
      </button>

      <nav className="sidebar-nav" aria-label="Global navigation">
        <ul className="sidebar-modules">
          {sidebarDestinations().map(dest => {
            const Icon = MODULE_ICONS[dest.id] || Radar;
            const active = activeModule.id === dest.id;
            return (
              <li key={dest.id}>
                <button
                  type="button"
                  className={`sidebar-module ${active ? 'active' : ''}`}
                  onClick={() => go(dest.path)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={dest.label}
                  title={compact ? dest.label : undefined}
                >
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
                  <span className="sidebar-module-label" aria-hidden={compact ? 'true' : undefined}>
                    {/* Compact shows the short rail label; the accessible name
                        stays the full locked label either way, so "MC" is
                        never the only name on offer. */}
                    {compact ? (dest.railLabel || dest.label) : dest.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <BarryControl
          compact={compact}
          buttonRef={barryButtonRef}
          barryOpen={barryOpen}
          onOpen={() => (onToggleBarry ? onToggleBarry() : openBarry())}
        />
      </div>
    </div>
  );
};

export default Sidebar;
