import { AlertCircle, RefreshCw, SkipForward } from 'lucide-react';

/**
 * GameErrorCard — Error state with retry.
 *
 * Per Edge Case 1 (Section 11): Barry returns 0 messages →
 * show error + retry button. Don't auto-advance. Don't count as engagement.
 *
 * Per Edge Case 7: Barry generation timeout → show loading state on card,
 * retry when card becomes active.
 */
export default function GameErrorCard({ error, onRetry, onSkip }) {
  return (
    <div className="game-card game-error-card">
      <div className="game-error-card-body">
        <AlertCircle className="w-6 h-6 game-error-icon" />
        <h3>Message generation failed</h3>
        <p className="game-error-message">{error || 'Barry could not generate messages for this card.'}</p>
      </div>

      <div className="game-error-card-actions">
        <button className="game-error-retry-btn" onClick={onRetry}>
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
        <button className="game-error-skip-btn" onClick={onSkip}>
          <SkipForward className="w-4 h-4" />
          Skip this card
        </button>
      </div>
    </div>
  );
}
