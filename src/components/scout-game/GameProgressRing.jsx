/**
 * GameProgressRing — Circular progress indicator.
 * Renders a simple SVG ring showing engagements completed vs goal.
 */
export default function GameProgressRing({ current, total, size = 48 }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(current / Math.max(total, 1), 1);
  const offset = circumference - (progress * circumference);

  return (
    <div className="game-progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-color, #27272a)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={progress >= 1 ? 'var(--color-success, #22c55e)' : 'var(--color-accent, #8b5cf6)'}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <span className="game-progress-ring-text">{current}</span>
    </div>
  );
}
