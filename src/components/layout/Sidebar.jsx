/**
 * Sidebar — Layer 1 of the three-layer navigation.
 *
 *   [Layer 1]        [Layer 2]            [Layer 3]
 *   Wide sidebar  →  Module sub-nav   →   Content
 *   220px, fixed     190px, collapsible   fills the rest
 *
 * Always visible on every authenticated desktop route. Never collapses, never
 * changes width, no icon-only state, no hover-to-expand.
 *
 * Structure:
 *   IDYNIFY wordmark  → Mission Control
 *   Module list       → full text labels, active item as a filled violet pill
 *   Barry card        → pinned to the bottom, opens the Barry overlay
 *
 * Things this sidebar deliberately does NOT have, per the final brief:
 *   · group headers (PIPELINE / RELATIONSHIPS / INTELLIGENCE)
 *   · descriptive subtitles under module names
 *   · a theme toggle — Settings already owns a Themes section
 *   · Barry as a plain nav item — he lives in the card at the bottom only
 *   · a collapse control
 *
 * Order comes from SIDEBAR_ORDER in constants/navigationModel.js, which is the
 * single source of truth for what exists and what it is called.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Radar, Crosshair, Target, Tent, Shield, Archive, Eye, Users,
  ChevronRight,
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
 * The IDYNIFY wordmark.
 *
 * Renders the brand asset when it loads, and a styled text wordmark when it
 * does not. The fallback is not decoration: /assets/Idynify_logo1.png is not
 * in this repository (nor are the barry avatar or short mark), so without it
 * the top of the sidebar is blank in any environment where the assets are not
 * deployed — which is every environment this code has been run in so far.
 */
function Wordmark() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="sidebar-wordmark-text" aria-hidden="true">
        IDYNIFY
      </span>
    );
  }

  return (
    <img
      className="sidebar-wordmark-img"
      src={ASSETS.logoFull}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Barry's card. Barry is a persistent overlay, never a destination — the card
 * opens him, it does not navigate anywhere.
 */
function BarryCard({ onOpen, barryOpen, buttonRef }) {
  const [avatarFailed, setAvatarFailed] = useState(false);

  return (
    <button
      type="button"
      ref={buttonRef}
      className={`barry-card ${barryOpen ? 'open' : ''}`}
      onClick={onOpen}
      aria-label="Open Barry"
      aria-expanded={barryOpen}
    >
      <span className="barry-card-avatar">
        {avatarFailed ? (
          <span className="barry-card-avatar-fallback" aria-hidden="true">🐻</span>
        ) : (
          <img src={ASSETS.barryAvatar} alt="" onError={() => setAvatarFailed(true)} />
        )}
      </span>

      <span className="barry-card-body">
        <span className="barry-card-name">Barry</span>
        <span className="barry-card-role">AI SDR</span>
        <span className="barry-card-status">
          <span className="barry-card-dot" aria-hidden="true" />
          Online
        </span>
      </span>

      <ChevronRight size={16} className="barry-card-chevron" aria-hidden="true" />
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
  const { openBarry } = useShell();

  // Longest-prefix resolution keeps Scout lit on /scout/contact/:id — the
  // active module must stay obvious on nested routes, not just module hubs.
  const activeModule = resolveModule(location.pathname);

  const go = (path) => {
    navigate(path);
    onCloseMobileMenu();
  };

  return (
    <div className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      <button
        type="button"
        className="sidebar-wordmark"
        onClick={() => go(MISSION_CONTROL.path)}
        aria-label={`Idynify — go to ${MISSION_CONTROL.label}`}
      >
        <Wordmark />
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
                >
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
                  <span className="sidebar-module-label">{dest.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <BarryCard
          buttonRef={barryButtonRef}
          barryOpen={barryOpen}
          onOpen={() => (onToggleBarry ? onToggleBarry() : openBarry())}
        />
      </div>
    </div>
  );
};

export default Sidebar;
