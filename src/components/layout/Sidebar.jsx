/**
 * Sidebar — global navigation for the Idynify shell.
 *
 * Renders the LOCKED information architecture from constants/navigationModel.js:
 *
 *   Mission Control
 *
 *   PIPELINE        Scout · Hunter · Sniper
 *   RELATIONSHIPS   Basecamp · Reinforcements · Fallback
 *   INTELLIGENCE    Recon
 *   ─────────────
 *   Settings · Help / Support
 *
 * Design decisions taken from the Sprint 1 brief, recorded here so they are
 * not silently reversed:
 *
 *  - Groups are NOT collapsible. The brief is explicit: "Groups do not add
 *    unnecessary interaction to hide a small number of items." Three items do
 *    not justify a disclosure control. The previous sidebar had eight
 *    independently collapsible pillars containing up to nine items each.
 *  - Labels come from navigationModel and nowhere else. There is no second
 *    place to spell a destination's name.
 *  - No new badges, counters or animations. Sidebar collapse is retained
 *    because it already existed and carries no state risk.
 *  - Module sub-navigation is NOT here. Changing the view inside Scout is
 *    Scout's job; this sidebar only moves the user across Idynify.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Radar, Crosshair, Target, Tent, Shield, Archive, Eye,
  Settings, LifeBuoy, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  MISSION_CONTROL,
  GROUP_ORDER,
  modulesInGroup,
  resolveModule,
} from '../../constants/navigationModel';
import { useThemeCtx } from '../../theme/ThemeContext';
import { THEMES, ASSETS } from '../../theme/tokens';
import { useShell } from '../../context/ShellContext';
import './Sidebar.css';

/** Icons live in the view layer; navigationModel stays presentation-free. */
const MODULE_ICONS = {
  scout: Radar,
  hunter: Crosshair,
  sniper: Target,
  basecamp: Tent,
  reinforcements: Shield,
  fallback: Archive,
  recon: Eye,
};

const Sidebar = ({
  mobileMenuOpen = false,
  onCloseMobileMenu = () => {},
  onToggleBarry,
  barryOpen = false,
  barryButtonRef,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const { themeId, setThemeId } = useThemeCtx();
  const isLightTheme = !THEMES[themeId]?.isDark;
  const navigate = useNavigate();
  const location = useLocation();
  const { openBarry } = useShell();

  // Active module resolves by longest path prefix, so /scout/contact/abc keeps
  // Scout lit. This is what "current location remains clear on nested routes"
  // requires — the previous implementation lost the highlight on detail pages.
  const activeModule = resolveModule(location.pathname);

  const go = (path) => {
    navigate(path);
    onCloseMobileMenu();
  };

  const handleBarryClick = () => {
    if (onToggleBarry) onToggleBarry();
    else openBarry();
  };

  const renderModule = (mod) => {
    const Icon = MODULE_ICONS[mod.id] || Radar;
    const active = activeModule.id === mod.id;

    return (
      <li key={mod.id}>
        <button
          type="button"
          className={`nav-item ${active ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => go(mod.path)}
          title={isCollapsed ? mod.label : ''}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={18} strokeWidth={2} />
          {!isCollapsed && (
            <div className="nav-item-content">
              <span className="nav-item-label">{mod.label}</span>
              {mod.description && (
                <span className="nav-item-sublabel">{mod.description}</span>
              )}
            </div>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      {/* ── Mission Control — stands alone, above the groups ── */}
      <div className="sidebar-header">
        <button
          type="button"
          className={`mission-control-link ${activeModule.id === MISSION_CONTROL.id ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => go(MISSION_CONTROL.path)}
          title={isCollapsed ? MISSION_CONTROL.label : ''}
          aria-current={activeModule.id === MISSION_CONTROL.id ? 'page' : undefined}
        >
          <Home size={18} strokeWidth={2} />
          {!isCollapsed && <span>{MISSION_CONTROL.label}</span>}
        </button>
      </div>

      {/* ── Grouped modules — always expanded ── */}
      <nav className="sidebar-nav" aria-label="Global navigation">
        {GROUP_ORDER.map(group => (
          <div className="nav-group" key={group} data-group={group.toLowerCase()}>
            {!isCollapsed && <div className="nav-group-label">{group}</div>}
            <ul className="nav-group-items">
              {modulesInGroup(group).map(renderModule)}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Utility links below the divider ── */}
      <div className="sidebar-utility">
        <button
          type="button"
          className={`settings-toggle settings-accent ${isCollapsed ? 'collapsed' : ''} ${location.pathname === '/settings' ? 'active' : ''}`}
          onClick={() => go('/settings')}
          title={isCollapsed ? 'Settings' : ''}
          aria-label="Settings"
        >
          <Settings size={16} />
          {!isCollapsed && <span className="settings-toggle-label">Settings</span>}
        </button>

        <button
          type="button"
          className={`settings-toggle ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => {
            // Crisp is already mounted for authenticated users (CrispChat).
            // Reuse it rather than introducing a second support surface.
            if (window.$crisp) {
              window.$crisp.push(['do', 'chat:open']);
            } else {
              window.open('mailto:support@idynify.com', '_blank');
            }
            onCloseMobileMenu();
          }}
          title={isCollapsed ? 'Help / Support' : ''}
          aria-label="Help and support"
        >
          <LifeBuoy size={16} />
          {!isCollapsed && <span className="settings-toggle-label">Help / Support</span>}
        </button>

        {/* Barry — a control, not a destination. Never a nav item.
            "Barry recommends. Navigation controls. Modules execute." */}
        <button
          type="button"
          ref={barryButtonRef}
          className={`settings-toggle barry-toggle ${isCollapsed ? 'collapsed' : ''} ${barryOpen ? 'active' : ''}`}
          onClick={handleBarryClick}
          title={isCollapsed ? 'Barry' : ''}
          aria-label="Open Barry"
          aria-expanded={barryOpen}
        >
          <img
            src={ASSETS.barryAvatar}
            alt=""
            className="barry-toggle-avatar"
            onError={e => { e.target.style.display = 'none'; }}
          />
          {!isCollapsed && <span className="settings-toggle-label">Barry</span>}
        </button>
      </div>

      {/* ── Theme picker — pre-existing capability, preserved ── */}
      <div style={{ position: 'relative' }}>
        {themePanelOpen && (
          <div className="theme-panel">
            <div className="theme-panel-title">Appearance</div>
            {Object.values(THEMES).map(theme => (
              <button
                type="button"
                key={theme.id}
                className={`theme-panel-option ${themeId === theme.id ? 'selected' : ''}`}
                onClick={() => { setThemeId(theme.id); setThemePanelOpen(false); }}
              >
                <span className="theme-swatch" style={{ background: theme.swatchBg }} />
                <span className="theme-panel-label">{theme.label}</span>
                {themeId === theme.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`theme-toggle ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => setThemePanelOpen(o => !o)}
          title="Change theme"
          aria-label="Change theme"
          aria-expanded={themePanelOpen}
        >
          <span className="theme-toggle-icon" aria-hidden="true">◐</span>
          {!isCollapsed && <span className="theme-toggle-label">{isLightTheme ? 'Light' : 'Dark'} theme</span>}
        </button>
      </div>

      <button
        type="button"
        className="collapse-toggle"
        onClick={() => setIsCollapsed(v => !v)}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </div>
  );
};

export default Sidebar;
