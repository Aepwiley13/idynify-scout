/**
 * Sidebar — the global icon rail.
 *
 * ~64px. Fixed. It never changes shape, width or structure, on any route.
 * The rail is infrastructure: it tells you where you are and gets out of the
 * way so the content area can do the work.
 *
 * Renders the LOCKED information architecture from constants/navigationModel.js:
 *
 *   [Idynify mark]
 *   ──────────────
 *   Mission Control          (stands alone)
 *   ──────────────
 *   Scout · Hunter · Sniper                  PIPELINE
 *   ──────────────
 *   Basecamp · Reinforcements · Fallback     RELATIONSHIPS
 *   ──────────────
 *   Recon                                    INTELLIGENCE
 *   ──────────────
 *   Settings · Help / Support
 *   ──────────────
 *   Barry · Account
 *
 * Decisions worth not re-litigating:
 *
 *  - Groups are communicated by DIVIDERS, not permanent text headers. The
 *    headers cost vertical space the rail cannot spare. Screen readers still
 *    get the grouping: each group is a <ul> with an accessible name, which is
 *    the non-visual equivalent of the header that was removed.
 *  - Labels appear on the ACTIVE item only. Everything else is icon plus a
 *    hover/focus tooltip carrying the full locked label.
 *  - No collapse control. A rail that can change width is a rail that can
 *    surprise you; the whole point is that it is always the same.
 *  - Barry sits at the bottom with the account, below a divider, because he
 *    is a persistent overlay and not a destination. Navigation controls,
 *    Barry recommends.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Radar, Crosshair, Target, Tent, Shield, Archive, Eye,
  Settings, LifeBuoy, Check,
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
import { auth } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
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

/**
 * Place a tooltip against its button, in viewport coordinates.
 *
 * The tooltip is `position: fixed` rather than absolutely positioned inside
 * the button, because the nav scrolls when the module list outgrows a short
 * viewport — and a scroll container clips on BOTH axes. CSS cannot express
 * "scroll vertically, overflow horizontally": `overflow-y: auto` forces
 * `overflow-x` to compute to `auto` as well, so an absolutely positioned
 * tooltip is cut off at the rail's edge with only its arrow escaping.
 *
 * Fixed positioning takes it out of the clip entirely. The cost is these few
 * lines of measurement, which is the same trade Linear and Slack make by
 * portalling their rail tooltips.
 */
function positionTooltip(button) {
  const tip = button?.querySelector('.rail-tooltip');
  if (!tip) return;
  const r = button.getBoundingClientRect();
  tip.style.top = `${r.top + r.height / 2}px`;
  tip.style.left = `${r.right + 10}px`;
}

/**
 * One rail button. Icon always; label only when active; tooltip always.
 *
 * The tooltip carries the full locked label even when the visible rail label
 * is an abbreviation, so "MC" is never the only name a user is offered.
 */
function RailButton({
  icon,
  label,
  railLabel,
  active = false,
  onClick,
  className = '',
  children,
}) {
  // Lifted to a local rather than destructured as `icon: Icon`: this repo has
  // no eslint-plugin-react, so JSX references do not count as usage and the
  // config compensates with varsIgnorePattern '^[A-Z_]' — which covers
  // variables but not destructured parameters.
  const Icon = icon;
  const ref = useRef(null);

  return (
    <button
      ref={ref}
      type="button"
      className={`rail-btn ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
      onMouseEnter={() => positionTooltip(ref.current)}
      onFocus={() => positionTooltip(ref.current)}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {children ?? <Icon size={18} strokeWidth={active ? 2.25 : 1.9} aria-hidden="true" />}
      {active && <span className="rail-btn-label">{railLabel || label}</span>}
      <span className="rail-tooltip" role="presentation">{label}</span>
    </button>
  );
}

function RailDivider() {
  return <div className="rail-divider" role="presentation" />;
}

/**
 * Barry's avatar, with a glyph fallback.
 *
 * The old rails hid the <img> on error, which left an empty button whenever
 * the asset failed to load — and Barry is the one control in the rail with no
 * icon to fall back to. A bear keeps the trigger visible and recognisable.
 */
function BarryIcon() {
  const [failed, setFailed] = useState(false);

  if (failed) return <span className="rail-barry-fallback" aria-hidden="true">🐻</span>;

  return (
    <img
      className="rail-barry-avatar"
      src={ASSETS.barryAvatar}
      alt=""
      onError={() => setFailed(true)}
    />
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
  const { themeId, setThemeId } = useThemeCtx();
  const activeUser = useActiveUser();

  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  // Active module resolves by longest path prefix, so /scout/contact/abc keeps
  // Scout lit. Nested routes previously lost the highlight entirely.
  const activeModule = resolveModule(location.pathname);

  const email = activeUser?.email || auth.currentUser?.email || '';
  const initials = (email.slice(0, 2) || 'ID').toUpperCase();

  useEffect(() => {
    if (!accountOpen) return undefined;
    const onDocClick = (e) => {
      if (!accountRef.current?.contains(e.target)) setAccountOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

  const go = (path) => {
    navigate(path);
    onCloseMobileMenu();
  };

  const openSupport = () => {
    // Crisp is already mounted for authenticated users. Reuse it rather than
    // standing up a second support surface.
    if (window.$crisp) window.$crisp.push(['do', 'chat:open']);
    else window.open('mailto:support@idynify.com', '_blank');
    onCloseMobileMenu();
  };

  const renderGroup = (group) => (
    <ul className="rail-group" key={group} aria-label={group.toLowerCase()}>
      {modulesInGroup(group).map(mod => (
        <li key={mod.id}>
          <RailButton
            icon={MODULE_ICONS[mod.id] || Radar}
            label={mod.label}
            railLabel={mod.railLabel}
            active={activeModule.id === mod.id}
            onClick={() => go(mod.path)}
          />
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`sidebar rail ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      {/* Brand mark. Intentionally not a control: Mission Control is its own
          labelled item directly below, and two controls doing the same thing
          is the duplication this navigation work exists to remove. */}
      <div className="rail-brand" aria-hidden="true">
        <img
          src={ASSETS.logoMark}
          alt=""
          onError={e => { e.target.style.display = 'none'; }}
        />
      </div>

      <RailDivider />

      <nav className="rail-nav" aria-label="Global navigation">
        {/* Mission Control stands alone, outside the groups. */}
        <ul className="rail-group">
          <li>
            <RailButton
              icon={Home}
              label={MISSION_CONTROL.label}
              railLabel={MISSION_CONTROL.railLabel}
              active={activeModule.id === MISSION_CONTROL.id}
              onClick={() => go(MISSION_CONTROL.path)}
            />
          </li>
        </ul>

        {GROUP_ORDER.map((group, i) => (
          <div key={group} className="rail-group-wrap">
            <RailDivider />
            {renderGroup(group, i)}
          </div>
        ))}
      </nav>

      {/* Utility */}
      <RailDivider />
      <ul className="rail-group">
        <li>
          <RailButton
            icon={Settings}
            label="Settings"
            railLabel="SET"
            active={location.pathname === '/settings'}
            onClick={() => go('/settings')}
            className="rail-btn-settings"
          />
        </li>
        <li>
          <RailButton icon={LifeBuoy} label="Help / Support" onClick={openSupport} />
        </li>
      </ul>

      {/* Barry + account */}
      <RailDivider />
      <ul className="rail-group rail-group-end">
        <li>
          <button
            type="button"
            ref={barryButtonRef}
            className={`rail-btn rail-btn-barry ${barryOpen ? 'active' : ''}`}
            onClick={() => (onToggleBarry ? onToggleBarry() : openBarry())}
            aria-label="Barry"
            aria-expanded={barryOpen}
          >
            <BarryIcon />
            <span className="rail-tooltip" role="presentation">Barry</span>
          </button>
        </li>

        <li className="rail-account" ref={accountRef}>
          <button
            type="button"
            className={`rail-btn rail-btn-account ${accountOpen ? 'active' : ''}`}
            onClick={() => setAccountOpen(o => !o)}
            aria-label="Account and appearance"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
          >
            <span className="rail-avatar">{initials}</span>
            <span className="rail-tooltip" role="presentation">{email || 'Account'}</span>
          </button>

          {accountOpen && (
            <div className="rail-account-menu" role="menu">
              <div className="rail-account-identity">
                <span className="rail-avatar lg">{initials}</span>
                <div className="rail-account-meta">
                  <span className="rail-account-email">{email || 'Signed in'}</span>
                  <span className="rail-account-theme">{THEMES[themeId]?.label || 'Theme'}</span>
                </div>
              </div>

              {/* Theme switching lived in the old text sidebar. The rail has no
                  room for a theme row, and the capability should not vanish
                  with the redesign — it belongs with identity, which is also
                  where the Hunter rail surfaced the active theme name. */}
              <div className="rail-account-section">Appearance</div>
              {Object.values(THEMES).map(theme => (
                <button
                  type="button"
                  key={theme.id}
                  role="menuitemradio"
                  aria-checked={themeId === theme.id}
                  className={`rail-account-theme-option ${themeId === theme.id ? 'selected' : ''}`}
                  onClick={() => { setThemeId(theme.id); setAccountOpen(false); }}
                >
                  <span className="rail-theme-swatch" style={{ background: theme.swatchBg }} />
                  <span>{theme.label}</span>
                  {themeId === theme.id && <Check size={13} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </li>
      </ul>
    </div>
  );
};

export default Sidebar;
