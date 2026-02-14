import { Clock, Zap, Target } from 'lucide-react';
import { GAME_CONSTANTS } from '../../utils/buildAutoIntent';

/**
 * GameSessionBar — Persistent top bar showing session metrics.
 *
 * Layout: [Timer] [Engagements: 7/15] [Streak: 3]
 *
 * Timer: MM:SS countdown from 30:00. When exceeded, switches to
 * count-up with different styling. Never stops the session.
 * Per Section 12: goals are display-only, not enforced.
 */
export default function GameSessionBar({
  displayTime,
  elapsed,
  engagements,
  streak,
  isPaused
}) {
  const timeLimitMs = GAME_CONSTANTS.SESSION_WINDOW_MINUTES * 60 * 1000;
  const isOverTime = elapsed > timeLimitMs;
  const goalReached = engagements >= GAME_CONSTANTS.SESSION_GOAL;

  return (
    <div className={`game-session-bar ${isPaused ? 'paused' : ''}`}>
      {/* Timer */}
      <div className={`game-bar-item game-bar-timer ${isOverTime ? 'overtime' : ''}`}>
        <Clock className="w-4 h-4" />
        <span className="game-bar-value">{displayTime}</span>
        {isPaused && <span className="game-bar-badge">PAUSED</span>}
      </div>

      {/* Engagements */}
      <div className={`game-bar-item game-bar-engagements ${goalReached ? 'goal-reached' : ''}`}>
        <Target className="w-4 h-4" />
        <span className="game-bar-value">
          {engagements}/{GAME_CONSTANTS.SESSION_GOAL}
        </span>
      </div>

      {/* Streak */}
      {streak > 0 && (
        <div className={`game-bar-item game-bar-streak ${streak >= 5 ? 'hot-streak' : ''}`}>
          <Zap className="w-4 h-4" />
          <span className="game-bar-value">{streak}</span>
        </div>
      )}
    </div>
  );
}
