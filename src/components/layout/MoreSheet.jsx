/**
 * MoreSheet.jsx — Shared slide-up bottom sheet for mobile secondary navigation.
 *
 * Shows all modules not in the primary bottom nav (Recon, Game, Reinforcements,
 * Command Center) plus utility links (Mission Control, Settings, Theme toggle).
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
import { Home, Users, Settings, LogOut, X, Brain, Zap, Shield, Target, RotateCcw } from 'lucide-react';
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
          <span className="more-sheet-title">All Modules</span>
          <button className="more-sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="more-sheet-grid">
          {/* Modules not in primary bottom nav */}
          <button className="more-sheet-item" onClick={() => go('/recon')}>
            <Brain size={22} />
            <span>Recon</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/scout/game')}>
            <Zap size={22} />
            <span>Game</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/reinforcements')}>
            <Shield size={22} />
            <span>Reinforcements</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/command-center')}>
            <Users size={22} />
            <span>Command Center</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/fallback')}>
            <RotateCcw size={22} />
            <span>Fallback</span>
          </button>

          {/* Utility */}
          <button className="more-sheet-item" onClick={() => go('/mission-control-v2')}>
            <Home size={22} />
            <span>Mission Control</span>
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
          <a
            href="https://buy.stripe.com/7sY9ASeNR0tr1Ng25b4ZG01"
            target="_blank"
            rel="noopener noreferrer"
            className="more-sheet-item"
            style={{ textDecoration: 'none' }}
            onClick={onClose}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>💛</span>
            <span>Support Us</span>
          </a>
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
