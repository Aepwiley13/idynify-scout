/**
 * MoreSheet.jsx — Shared slide-up bottom sheet for mobile secondary navigation.
 *
 * Overflow for the bottom nav: the modules that are not Scout, Hunter, Sniper
 * or Basecamp, plus Barry and the two account-level actions.
 *
 * MODULES ONLY. It used to also list Game, Missions, Campaigns and Cadences —
 * Game is a Scout section, and Missions, Campaigns and Cadences are Command
 * Center sections. A sheet titled "All Modules" that mixes modules with four
 * arbitrary sub-sections of two of them teaches the wrong shape of the
 * product, and it is the same list that has to stay correct as sections move.
 * They are all still reachable, one level in, from the module that owns them.
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
import { Home, Users, Settings, LogOut, X, Brain, Shield, RotateCcw, Moon, Sun } from 'lucide-react';
import { auth } from '../../firebase/config';
import { useThemeToggle } from '../../theme/useThemeToggle';

export default function MoreSheet({ isOpen, onClose, isAdmin = false, onOpenBarry }) {
  const navigate = useNavigate();
  const { isDark, nextLabel, toggleTheme } = useThemeToggle();

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
          {/* Barry — mobile entry point to the globally-mounted shell panel */}
          <button
            className="more-sheet-item"
            onClick={() => { onOpenBarry?.(); onClose(); }}
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>🐻</span>
            <span>Barry</span>
          </button>

          {/* Modules not in the primary bottom nav */}
          <button className="more-sheet-item" onClick={() => go('/recon')}>
            <Brain size={22} />
            <span>Recon</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/reinforcements')}>
            <Shield size={22} />
            <span>Reinforcements</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/fallback')}>
            <RotateCcw size={22} />
            <span>Fallback</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/command-center')}>
            <Users size={22} />
            <span>Command Center</span>
          </button>
          <button className="more-sheet-item" onClick={() => go('/mission-control-v2')}>
            <Home size={22} />
            <span>Mission Control</span>
          </button>
        </div>

        <div className="more-sheet-sep" />

        <div className="more-sheet-grid">
          <button className="more-sheet-item" onClick={() => go('/settings')}>
            <Settings size={22} />
            <span>Settings</span>
          </button>
          {/* A toggle, not a destination. It used to be labelled with the
              theme you were leaving ("Light Mode" while in light mode), which
              read as the current state rather than as what tapping would do. */}
          <button className="more-sheet-item" onClick={() => { toggleTheme(); onClose(); }}>
            {isDark ? <Sun size={22} /> : <Moon size={22} />}
            <span>{nextLabel}</span>
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
