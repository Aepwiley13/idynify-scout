import { Target, Users, RefreshCw, UserPlus } from 'lucide-react';
import { SESSION_MODE_LIST } from '../../utils/buildAutoIntent';

const ICONS = {
  Target,
  Users,
  RefreshCw,
  Handshake: UserPlus // UserPlus as stand-in for Handshake
};

/**
 * GameSessionStart — Session mode selector. One tap to begin.
 *
 * Renders 4 session mode cards in a 2x2 grid. Each card is a large
 * touch target (G9: one-handed, thumb-reachable). Single tap starts session.
 */
export default function GameSessionStart({ onSelectMode }) {
  return (
    <div className="game-session-start">
      <div className="game-start-header">
        <h2>Scout Game</h2>
        <p>Pick your session mode. What are you doing today?</p>
      </div>

      <div className="game-mode-grid">
        {SESSION_MODE_LIST.map((mode) => {
          const Icon = ICONS[mode.icon] || Target;
          return (
            <button
              key={mode.id}
              className="game-mode-card"
              onClick={() => onSelectMode(mode.id)}
            >
              <Icon className="game-mode-icon" />
              <span className="game-mode-label">{mode.label}</span>
              <span className="game-mode-desc">{mode.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
