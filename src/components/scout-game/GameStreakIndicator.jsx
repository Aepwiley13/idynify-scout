import { Zap } from 'lucide-react';

/**
 * GameStreakIndicator — Streak counter with visual emphasis.
 * Displays current streak with escalating visual intensity.
 *
 * Streak thresholds:
 *   0: hidden
 *   1-2: subtle
 *   3-4: visible
 *   5+: "hot streak" with accent color
 */
export default function GameStreakIndicator({ streak, bestStreak }) {
  if (!streak || streak < 1) return null;

  const tier = streak >= 5 ? 'hot' : streak >= 3 ? 'warm' : 'cool';

  return (
    <div className={`game-streak-indicator streak-${tier}`}>
      <Zap className="w-4 h-4" />
      <span className="game-streak-count">{streak}</span>
      {streak >= 3 && <span className="game-streak-label">streak</span>}
      {bestStreak && streak >= bestStreak && streak >= 3 && (
        <span className="game-streak-best">BEST</span>
      )}
    </div>
  );
}
