import { Sparkles, Loader2 } from 'lucide-react';
import { STEP_OUTCOMES, STEP_OUTCOME_LABELS } from '../../utils/sequenceEngine';

/**
 * OUTCOME PROMPT (Step 5)
 *
 * Barry asks "What happened with Step X?" before proposing the next step.
 * Simple, fast, non-intrusive outcome recording.
 *
 * Shown when:
 * - Previous step was sent
 * - No outcome has been recorded yet
 * - User returns to the contact/mission
 *
 * Options are intentionally simple:
 * - No reply yet
 * - Replied positively
 * - Replied negatively
 * - Not sure yet
 */

const OUTCOME_OPTIONS = [
  {
    id: STEP_OUTCOMES.NO_REPLY,
    label: STEP_OUTCOME_LABELS[STEP_OUTCOMES.NO_REPLY],
    emoji: '...',
    color: '#94a3b8'
  },
  {
    id: STEP_OUTCOMES.REPLIED_POSITIVE,
    label: STEP_OUTCOME_LABELS[STEP_OUTCOMES.REPLIED_POSITIVE],
    emoji: '+',
    color: '#10b981'
  },
  {
    id: STEP_OUTCOMES.REPLIED_NEGATIVE,
    label: STEP_OUTCOME_LABELS[STEP_OUTCOMES.REPLIED_NEGATIVE],
    emoji: '-',
    color: '#ef4444'
  },
  {
    id: STEP_OUTCOMES.NOT_SURE,
    label: STEP_OUTCOME_LABELS[STEP_OUTCOMES.NOT_SURE],
    emoji: '?',
    color: '#f59e0b'
  }
];

export default function OutcomePrompt({ previousStep, previousStepIndex, onOutcomeSelected, loading }) {
  return (
    <div className="outcome-prompt">
      <div className="outcome-prompt-barry">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <div className="outcome-prompt-text">
          <p className="outcome-prompt-question">
            What happened with Step {previousStepIndex + 1}?
          </p>
          <p className="outcome-prompt-context">
            {previousStep?.action || 'Previous step'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="outcome-prompt-loading">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
          <span>Recording...</span>
        </div>
      ) : (
        <div className="outcome-options">
          {OUTCOME_OPTIONS.map(option => (
            <button
              key={option.id}
              className="outcome-option-btn"
              onClick={() => onOutcomeSelected(option.id)}
            >
              <span className="outcome-option-emoji" style={{ color: option.color }}>
                {option.emoji}
              </span>
              <span className="outcome-option-label">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
