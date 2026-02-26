/**
 * MissionStepProgress — Visual step tracker for active missions.
 *
 * States:
 *   completed (✓) — step sent, outcome recorded
 *   current   (●) — step in progress (draft ready or loading)
 *   pending   (○) — future step, not yet generated
 */

export default function MissionStepProgress({ steps, currentStepIndex }) {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="msp-track">
      {steps.map((step, idx) => {
        const isDone = step.status === 'completed' || step.completed_at;
        const isCurrent = idx === currentStepIndex && !isDone;
        const label = `Step ${step.stepNumber}`;
        const subLabel = step.action || step.stepType || '';

        return (
          <div
            key={idx}
            className={`msp-step ${isDone ? 'msp-step--done' : isCurrent ? 'msp-step--current' : 'msp-step--pending'}`}
          >
            <div className="msp-dot">
              {isDone ? '✓' : isCurrent ? '●' : '○'}
            </div>
            <div className="msp-info">
              <span className="msp-label">{label}</span>
              {subLabel && <span className="msp-sub">{subLabel}</span>}
            </div>
            {idx < steps.length - 1 && <div className="msp-connector" />}
          </div>
        );
      })}
    </div>
  );
}
