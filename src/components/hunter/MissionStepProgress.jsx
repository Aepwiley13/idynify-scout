/**
 * MissionStepProgress — Visual step tracker for active missions.
 *
 * Three visually distinct states:
 *   ✓ completed — step sent, outcome recorded, relative time + outcome tag shown
 *   ● current   — step in progress (prominent, accent color)
 *   ○ pending   — future step, muted
 *
 * Example:
 *   ✓ Step 1: Send intro  ·  3 days ago  ·  [Positive reply 👍]
 *   ● Step 2: Follow up   ← current
 *   ○ Step 3: Meeting request
 */

import { formatDistanceToNow } from 'date-fns';

const OUTCOME_TAGS = {
  no_reply:       { label: 'No reply',        emoji: '⏳' },
  positive_reply: { label: 'Positive reply',  emoji: '👍' },
  neutral_reply:  { label: 'Neutral reply',   emoji: '↔️' },
  negative_reply: { label: 'Negative reply',  emoji: '✕' },
  scheduled:      { label: 'Scheduled',       emoji: '📅' },
  not_interested: { label: 'Not interested',  emoji: '🚫' }
};

function relativeTime(isoString) {
  if (!isoString) return null;
  try {
    return formatDistanceToNow(new Date(isoString), { addSuffix: true });
  } catch {
    return null;
  }
}

export default function MissionStepProgress({ steps, currentStepIndex }) {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="msp-track">
      {steps.map((step, idx) => {
        const isDone = step.status === 'completed' || !!step.completed_at;
        const isCurrent = idx === currentStepIndex && !isDone;
        const isPending = !isDone && !isCurrent;

        const stateClass = isDone ? 'msp-step--done'
          : isCurrent ? 'msp-step--current'
          : 'msp-step--pending';

        const icon = isDone ? '✓' : isCurrent ? '●' : '○';
        const label = step.action || step.stepType || `Step ${step.stepNumber}`;
        const timeStr = isDone ? relativeTime(step.completed_at || step.sent_at) : null;
        const outcomeTag = isDone && step.outcome ? OUTCOME_TAGS[step.outcome] : null;

        return (
          <div key={idx} className={`msp-step ${stateClass}`}>
            {/* Connector line above (except first step) */}
            {idx > 0 && <div className="msp-connector-above" />}

            <div className="msp-dot-wrap">
              <div className="msp-dot">{icon}</div>
            </div>

            <div className="msp-info">
              <div className="msp-row">
                <span className="msp-label">
                  Step {step.stepNumber || idx + 1}:{' '}
                  <span className={isPending ? 'msp-label-muted' : ''}>{label}</span>
                </span>
                {isCurrent && (
                  <span className="msp-current-indicator">← current</span>
                )}
              </div>

              {(timeStr || outcomeTag) && (
                <div className="msp-meta">
                  {timeStr && <span className="msp-time">{timeStr}</span>}
                  {outcomeTag && (
                    <span className="msp-outcome-tag">
                      {outcomeTag.emoji} {outcomeTag.label}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
