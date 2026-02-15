import { CheckCircle, Clock, Zap, TrendingUp, ArrowRight, RotateCcw } from 'lucide-react';
import { GAME_CONSTANTS } from '../../utils/buildAutoIntent';

/**
 * GameSessionSummary — End-of-session results screen.
 *
 * Per Section 12: "15 in 30" is a performance target, not a hard limit.
 * No punitive behavior for "failed" sessions. Session "completes" visually
 * when either threshold is reached with a celebratory state, but user
 * can continue engaging.
 */
export default function GameSessionSummary({
  engagements,
  elapsed,
  bestStreak,
  fastest,
  average,
  skipped,
  deferred,
  goalReached,
  onNewSession,
  onExit
}) {
  const formatTime = (ms) => {
    if (!ms) return '--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const formatDuration = (ms) => {
    if (!ms) return '--';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return formatTime(ms);
  };

  return (
    <div className="game-session-summary">
      <div className="game-summary-header">
        {goalReached ? (
          <>
            <CheckCircle className="w-8 h-8 game-summary-icon-success" />
            <h2>Session Complete</h2>
            <p>You hit your target. Nice work.</p>
          </>
        ) : (
          <>
            <TrendingUp className="w-8 h-8 game-summary-icon-progress" />
            <h2>Session Ended</h2>
            <p>{engagements} engagement{engagements !== 1 ? 's' : ''} completed.</p>
          </>
        )}
      </div>

      <div className="game-summary-stats">
        <div className="game-summary-stat">
          <span className="game-summary-stat-label">Engagements</span>
          <span className="game-summary-stat-value">
            {engagements} / {GAME_CONSTANTS.SESSION_GOAL}
          </span>
        </div>

        <div className="game-summary-stat">
          <Clock className="w-4 h-4" />
          <span className="game-summary-stat-label">Time</span>
          <span className="game-summary-stat-value">{formatTime(elapsed)}</span>
        </div>

        <div className="game-summary-stat">
          <Zap className="w-4 h-4" />
          <span className="game-summary-stat-label">Best Streak</span>
          <span className="game-summary-stat-value">{bestStreak || 0}</span>
        </div>

        {fastest && (
          <div className="game-summary-stat">
            <span className="game-summary-stat-label">Fastest</span>
            <span className="game-summary-stat-value">{formatDuration(fastest)}</span>
          </div>
        )}

        {average && (
          <div className="game-summary-stat">
            <span className="game-summary-stat-label">Average</span>
            <span className="game-summary-stat-value">{formatDuration(average)}</span>
          </div>
        )}

        {(skipped > 0 || deferred > 0) && (
          <div className="game-summary-stat game-summary-stat-secondary">
            {skipped > 0 && <span>Skipped: {skipped}</span>}
            {deferred > 0 && <span>Saved for later: {deferred}</span>}
          </div>
        )}
      </div>

      <div className="game-summary-actions">
        <button className="game-summary-btn-primary" onClick={onNewSession}>
          <RotateCcw className="w-4 h-4" />
          New Session
        </button>
        <button className="game-summary-btn-secondary" onClick={onExit}>
          <ArrowRight className="w-4 h-4" />
          Back to Scout
        </button>
      </div>
    </div>
  );
}
