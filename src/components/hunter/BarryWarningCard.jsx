import { AlertCircle } from 'lucide-react';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { auth } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import './BarryWarningCard.css';

/**
 * BARRY WARNING CARD — Sprint 2: Relationship Guardrail
 *
 * Renders Barry's conversational guardrail warning before message generation.
 * Not a modal, not a system warning — Barry speaks in his voice.
 *
 * Props:
 *   warning: { type, severity, message, actions[] }
 *   contactId: string
 *   onAction: (actionId) => void — called when user picks an action
 *   onDismiss: () => void — called when user dismisses without acting
 */
export default function BarryWarningCard({ warning, contactId, onAction, onDismiss }) {
  if (!warning) return null;

  async function handleAction(actionId) {
    // Log to timeline
    try {
      const user = getEffectiveUser();
      if (user?.uid && contactId) {
        logTimelineEvent({
          userId: user.uid,
          contactId,
          type: 'barry_guardrail_response',
          actor: ACTORS.USER,
          preview: `${warning.type}: ${actionId}`,
          metadata: {
            guardrail_type: warning.type,
            severity: warning.severity,
            action_taken: actionId,
            warning_message: warning.message
          }
        });
      }
    } catch (_) {
      // Non-blocking
    }

    onAction(actionId);
  }

  async function handleDismiss() {
    // Log dismissal
    try {
      const user = getEffectiveUser();
      if (user?.uid && contactId) {
        logTimelineEvent({
          userId: user.uid,
          contactId,
          type: 'barry_guardrail_shown',
          actor: ACTORS.BARRY,
          preview: `Guardrail: ${warning.type}`,
          metadata: {
            guardrail_type: warning.type,
            severity: warning.severity,
            dismissed: true
          }
        });
      }
    } catch (_) {
      // Non-blocking
    }

    onDismiss();
  }

  const severityClass = `barry-warning--${warning.severity || 'medium'}`;

  return (
    <div className={`barry-warning-card ${severityClass}`}>
      <div className="barry-warning-header">
        <AlertCircle className="barry-warning-icon" />
        <span className="barry-warning-label">Barry</span>
      </div>
      <p className="barry-warning-message">{warning.message}</p>
      <div className="barry-warning-actions">
        {warning.actions.map(action => (
          <button
            key={action.id}
            className={`barry-warning-btn ${action.id === 'send_anyway' || action.id === 'skip' ? 'barry-warning-btn--muted' : ''}`}
            onClick={() => handleAction(action.id)}
            title={action.description}
          >
            {action.label}
          </button>
        ))}
        <button
          className="barry-warning-btn barry-warning-btn--dismiss"
          onClick={handleDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
