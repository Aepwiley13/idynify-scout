import { Zap } from 'lucide-react';

/**
 * GameStreakIndicator — Streak counter with visual emphasis.
 * Displays current streak with escalating visual intensity.
 *
 * CTO-approved streak tier thresholds (locked):
 *   0-2: hidden (no indicator)
 *   3-4: COOL — earned without being a barrier to first reward
 *   5-7: WARM — signals real momentum
 *   8+:  HOT  — legitimately impressive in a 30-min session
 */
const STREAK_TIERS = {
  COOL: 3,
  WARM: 5,
  HOT: 8
};

export default function GameStreakIndicator({ streak, bestStreak }) {
  if (!streak || streak < STREAK_TIERS.COOL) return null;

  const tier = streak >= STREAK_TIERS.HOT ? 'hot' : streak >= STREAK_TIERS.WARM ? 'warm' : 'cool';

  return (
    <div className={`game-streak-indicator streak-${tier}`}>
      <Zap className="w-4 h-4" />
      <span className="game-streak-count">{streak}</span>
      <span className="game-streak-label">streak</span>
      {bestStreak && streak >= bestStreak && (
        <span className="game-streak-best">BEST</span>
      )}
    </div>
  );
}
