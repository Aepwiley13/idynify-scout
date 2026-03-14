import { AlertCircle } from 'lucide-react';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { STATUS, BRAND } from '../../theme/tokens';
import './BarryWarningCard.css';

// Severity → color mapping using design tokens
const SEVERITY_COLORS = {
  high:   STATUS.amber,   // #f59e0b
  medium: BRAND.cyan,     // #00c4cc
  low:    BRAND.purple    // #7c3aed
};

/**
 * BARRY WARNING CARD — Sprint 2: Relationship Guardrail
 *
 * Renders Barry's conversational guardrail warning before message generation.
 * Not a modal, not a system warning — Barry speaks in his voice.
 *
 * Colors are driven from theme tokens (STATUS/BRAND) via inline styles.
 * The CSS file handles layout, animation, and hover states only.
 */
export default function BarryWarningCard({ warning, contactId, onAction, onDismiss }) {
  if (!warning) return null;

  const T = useT();
  const color = SEVERITY_COLORS[warning.severity] || SEVERITY_COLORS.medium;

  async function handleAction(actionId) {
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

  return (
    <div
      className="barry-warning-card"
      style={{
        background: `${color}14`,
        border: `1.5px solid ${color}4D`,
      }}
    >
      <div className="barry-warning-header">
        <AlertCircle className="barry-warning-icon" style={{ color: `${color}B3` }} />
        <span className="barry-warning-label" style={{ color: `${color}CC` }}>Barry</span>
      </div>
      <p className="barry-warning-message" style={{ color: T.text }}>{warning.message}</p>
      <div className="barry-warning-actions">
        {warning.actions.map((action, i) => (
          <button
            key={action.id}
            className={`barry-warning-btn ${action.id === 'send_anyway' || action.id === 'skip' ? 'barry-warning-btn--muted' : ''}`}
            onClick={() => handleAction(action.id)}
            title={action.description}
            style={i === 0 ? {
              background: `${color}1F`,
              borderColor: `${color}4D`,
              color: color,
            } : {
              color: T.textMuted,
            }}
          >
            {action.label}
          </button>
        ))}
        <button
          className="barry-warning-btn barry-warning-btn--dismiss"
          onClick={handleDismiss}
          style={{ color: T.textMuted }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
