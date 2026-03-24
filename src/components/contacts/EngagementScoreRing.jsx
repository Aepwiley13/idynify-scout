/**
 * ENGAGEMENT SCORE RING
 *
 * Visual 0–100 ring showing relationship health computed by healthScore.js.
 * Labels: Healthy (70+), Neutral (40–69), At Risk (0–39).
 * Also surfaces a human-readable engagement label from the design:
 * Cold → Warming → Strong engagement → Advocate
 */

import { computeHealthScore } from '../../services/healthScore';
import { useT } from '../../theme/ThemeContext';

function getEngagementLabel(score) {
  if (score >= 80) return 'Strong engagement';
  if (score >= 60) return 'Good engagement';
  if (score >= 40) return 'Warming up';
  return 'Cold';
}

export default function EngagementScoreRing({ contact }) {
  const T = useT();
  const { score, color } = computeHealthScore(contact);
  const label = getEngagementLabel(score);

  const size = 96;
  const radius = 34;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - score / 100);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      padding: '16px 0 8px',
    }}>
      {/* Ring */}
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Background track */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={T.border2 || '#2a2a3a'}
            strokeWidth={strokeWidth}
          />
          {/* Score arc */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        {/* Score number overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
        }}>
          <span style={{
            fontSize: 24,
            fontWeight: 800,
            color: T.text,
            lineHeight: 1,
          }}>
            {score}
          </span>
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            color: T.textFaint,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            score
          </span>
        </div>
      </div>
      {/* Label */}
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color,
      }}>
        {label}
      </span>
    </div>
  );
}
