/**
 * MoreSheet.jsx — Shared slide-up bottom sheet for mobile secondary navigation.
 *
 * Used by MainLayout (wrapped routes) and every self-contained module shell
 * (Scout, Hunter, Recon, Sniper, MissionControlDashboardV2) so there is a
 * single source of truth for the "More" overlay design.
 *
 * Styling comes from the `.more-sheet-*` CSS classes defined in MainLayout.css.
 * Dark-theme overrides are applied automatically when the root element carries
 * the `theme-dark` class (set by ThemeContext).
 *
 * Props:
 *   isOpen   — boolean, controls visibility
 *   onClose  — () => void
 *   isAdmin  — boolean (optional), shows Admin tile when true
 */
import { useNavigate } from 'react-router-dom';
import { Home, Users, Settings, LogOut, X } from 'lucide-react';
import { auth } from '../../firebase/config';
import { useThemeCtx } from '../../theme/ThemeContext';
import { THEMES } from '../../theme/tokens';

export default function MoreSheet({ isOpen, onClose, isAdmin = false }) {
  const navigate = useNavigate();
  const { themeId, setThemeId } = useThemeCtx();
  const isLightTheme = !THEMES[themeId]?.isDark;

  if (!isOpen) return null;

  const go = (path) => { navigate(path); onClose(); };

  return (
    <div className="more-sheet-backdrop" onClick={onClose}>
      <div className="more-sheet" onClick={e => e.stopPropagation()}>
        <div className="more-sheet-handle" />

        <div className="more-sheet-header">
          <span className="more-sheet-title">More</span>
          <button className="more-sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="more-sheet-grid">
          <button className="more-sheet-item" onClick={() => go('/mission-control-v2')}>
            <Home size={22} />
            <span>Mission Control</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/people')}>
            <Users size={22} />
            <span>All People</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/settings')}>
            <Settings size={22} />
            <span>Settings</span>
          </button>
          <button
            className="more-sheet-item"
            onClick={() => { setThemeId(isLightTheme ? 'mission' : 'workspace'); onClose(); }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>{isLightTheme ? '🌙' : '☀️'}</span>
            <span>{isLightTheme ? 'Dark Mode' : 'Light Mode'}</span>
          </button>
          {isAdmin && (
            <button className="more-sheet-item" onClick={() => go('/admin')}>
              <span style={{ fontSize: 22 }}>🔧</span>
              <span>Admin</span>
            </button>
          )}
        </div>

        <button
          className="more-sheet-logout"
          onClick={async () => { onClose(); await auth.signOut(); navigate('/login'); }}
        >
          <LogOut size={18} />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}
