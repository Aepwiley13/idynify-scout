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
 *   · a theme toggle — Settings owns Appearance, and the top bar's user menu
 *     owns the one-click light/dark switch
 *   · Barry as a plain nav item — he is the card / icon at the bottom only
 *
 * ON MOBILE this same component is the hamburger drawer, and it grows a tail:
 * a close control, Settings, Help, and the account block with Log out. Those
 * are display:none above 768px, where they live in the top bar's user menu
 * instead. The drawer has no top bar, so without them mobile would be the one
 * surface with no route to Settings, support or logging out.
 *
 * Order comes from SIDEBAR_ORDER in constants/navigationModel.js, the single
 * source of truth for what exists and what it is called.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Radar, Crosshair, Target, Tent, Shield, Archive, Eye, Users,
  ChevronRight, ChevronLeft, Settings, LifeBuoy, LogOut, X,
} from 'lucide-react';
import {
  MISSION_CONTROL,
  sidebarDestinations,
  mobileDrawerSections,
  resolveModule,
} from '../../constants/navigationModel';
import { supportMailto } from '../../constants/support';
import { displayNameFor, initialsFor } from '../../utils/userIdentity';
import { ASSETS } from '../../theme/tokens';
import { useShell } from '../../context/ShellContext';
import { useIsMobile } from '../../hooks/useIsMobile';
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
 * Wide mode serves optimized derivatives (AVIF → WebP → PNG) via <picture>,
 * sized at 204×68 (2× the 34px render height). Falls back to a CSS wordmark
 * if the asset 404s. The auth surface has its own BrandMark that references
 * AUTH_ASSETS with different fallback and accessibility patterns — the two
 * are deliberately independent.
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

  const opt = ASSETS.logoFullOptimized;
  return failed ? (
    <span className="sidebar-wordmark-text" aria-hidden="true">IDYNIFY</span>
  ) : (
    <picture>
      <source srcSet={opt.webp} type="image/webp" />
      <img
        className="sidebar-wordmark-img"
        src={opt.png}
        alt=""
        width={opt.width}
        height={opt.height}
        onError={() => setFailed(true)}
      />
    </picture>
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

/**
 * One module row. Shared by the desktop list and the mobile grouped drawer so
 * the two cannot drift apart.
 */
function ModuleLink({ dest, compact, active, onGo }) {
  const Icon = MODULE_ICONS[dest.id] || Radar;
  return (
    <button
      type="button"
      className={`sidebar-module ${active ? 'active' : ''}`}
      onClick={() => onGo(dest.path)}
      aria-current={active ? 'page' : undefined}
      aria-label={dest.label}
      title={compact ? dest.label : undefined}
    >
      <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
      <span className="sidebar-module-label" aria-hidden={compact ? 'true' : undefined}>
        {/* Compact shows the short rail label; the accessible name stays the
            full locked label either way, so "MC" is never the only name on
            offer. */}
        {compact ? (dest.railLabel || dest.label) : dest.label}
      </span>
    </button>
  );
}

const Sidebar = ({
  mobileMenuOpen = false,
  onCloseMobileMenu = () => {},
  onToggleBarry,
  barryOpen = false,
  barryButtonRef,
  user,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { openBarry, sidebarMode, toggleSidebar } = useShell();
  const isMobile = useIsMobile();

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

      {/* Mobile only. On desktop this sidebar is always open, so a close
          control would have nothing to close. On mobile it is a drawer, and a
          drawer whose only exit is a tap on the 100px of page still showing
          beside it is a drawer people get stuck in. */}
      <button
        type="button"
        className="sidebar-mobile-close"
        onClick={onCloseMobileMenu}
        aria-label="Close navigation menu"
      >
        <X size={18} aria-hidden="true" />
      </button>

      {/* DESKTOP — the flat, locked order. Unchanged. */}
      {!isMobile && (
      <nav className="sidebar-nav sidebar-nav-flat" aria-label="Global navigation">
        <ul className="sidebar-modules">
          {sidebarDestinations().map(dest => (
            <li key={dest.id}>
              <ModuleLink
                dest={dest}
                compact={compact}
                active={activeModule.id === dest.id}
                onGo={go}
              />
            </li>
          ))}
        </ul>
      </nav>
      )}

      {/* MOBILE — the same destinations, grouped.
          Two arrangements rather than one, because the orders genuinely
          differ: desktop puts Recon between Basecamp and Reinforcements, while
          grouped puts it under INTELLIGENCE after Fallback. One list cannot be
          both. They share ModuleLink, so a change to how a module renders
          cannot land on one surface and miss the other.

          Only one is BUILT, not merely hidden: two landmarks both labelled
          "Global navigation" is one stylesheet failure away from rendering
          both, and it makes every query against the sidebar ambiguous. */}
      {isMobile && (
      <nav className="sidebar-nav sidebar-nav-grouped" aria-label="Global navigation">
        {mobileDrawerSections().map((section, i) => (
          <div className="sidebar-group" key={section.label || `ungrouped-${i}`}>
            {/* Not a button and not tappable: a group is a description of the
                platform, not a destination. */}
            {section.label && (
              <div className="sidebar-group-label" aria-hidden="true">{section.label}</div>
            )}
            <ul className="sidebar-modules" aria-label={section.label || undefined}>
              {section.destinations.map(dest => (
                <li key={dest.id}>
                  <ModuleLink
                    dest={dest}
                    compact={false}
                    active={activeModule.id === dest.id}
                    onGo={go}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      )}

      {/* ── Mobile drawer tail ──
          Settings, Help and the account, all mobile-only.

          On desktop these live in the top bar's user menu, which the drawer
          does not render — so without this block the mobile drawer would be
          the one surface in the product from which Settings, Help and Log out
          are all unreachable. The desktop sidebar is unchanged: every element
          here is display:none above 768px. */}
      <div className="sidebar-mobile-tail">
        <div className="sidebar-mobile-sep" />

        <button
          type="button"
          className="sidebar-mobile-link"
          onClick={() => go('/settings')}
        >
          <Settings size={17} aria-hidden="true" />
          <span>Settings</span>
        </button>

        <a
          className="sidebar-mobile-link"
          href={supportMailto()}
          onClick={onCloseMobileMenu}
        >
          <LifeBuoy size={17} aria-hidden="true" />
          <span>Help</span>
        </a>

        <div className="sidebar-mobile-sep" />

        <div className="sidebar-mobile-user">
          <span className="sidebar-mobile-avatar" aria-hidden="true">{initialsFor(user)}</span>
          <span className="sidebar-mobile-identity">
            <span className="sidebar-mobile-name">{displayNameFor(user) || user?.email}</span>
            <span className="sidebar-mobile-email">{user?.email}</span>
          </span>
        </div>

        <button
          type="button"
          className="sidebar-mobile-link danger"
          onClick={() => { onCloseMobileMenu(); onLogout?.(); }}
        >
          <LogOut size={17} aria-hidden="true" />
          <span>Log out</span>
        </button>
      </div>

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
