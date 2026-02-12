import {
  Sparkles,
  Loader2,
  CheckCircle,
  SkipForward,
  Send,
  MessageSquare,
  Phone,
  Link,
  Users,
  Clock,
  AlertCircle
} from 'lucide-react';

/**
 * STEP APPROVAL CARD (Step 5)
 *
 * Clean, focused UI for approving a single sequence step.
 * Shows: step type, channel, purpose, reasoning, timing.
 * Actions: Approve (generate content) or Skip.
 *
 * "Clean, fast, non-heavy approval UX per step" — from spec.
 */

const CHANNEL_ICONS = {
  email: Send,
  text: MessageSquare,
  phone: Phone,
  linkedin: Link,
  calendar: Clock
};

const CHANNEL_LABELS = {
  email: 'Email',
  text: 'Text',
  phone: 'Call',
  linkedin: 'LinkedIn',
  calendar: 'Calendar'
};

const STEP_TYPE_LABELS = {
  message: 'Message',
  follow_up: 'Follow-Up',
  call: 'Call',
  resource: 'Resource',
  introduction: 'Introduction'
};

export default function StepApprovalCard({
  step,
  stepIndex,
  totalSteps,
  previousOutcome,
  onApprove,
  onSkip,
  loading,
  error
}) {
  const ChannelIcon = CHANNEL_ICONS[step.channel] || Send;
  const stepTypeLabel = STEP_TYPE_LABELS[step.stepType] || step.stepType;
  const channelLabel = CHANNEL_LABELS[step.channel] || step.channel;

  return (
    <div className="step-approval-card">
      {/* Barry intro */}
      <div className="step-approval-barry">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <span className="step-approval-barry-text">
          {stepIndex === 0
            ? "Here's your first move."
            : previousOutcome
              ? "Based on what happened, here's what I suggest next."
              : "Ready for the next step."
          }
        </span>
      </div>

      {/* Step card */}
      <div className="step-card">
        <div className="step-card-header">
          <div className="step-card-number">Step {stepIndex + 1}</div>
          <div className="step-card-badges">
            <span className="step-badge step-badge-type">{stepTypeLabel}</span>
            <span className="step-badge step-badge-channel">
              <ChannelIcon className="w-3 h-3" />
              {channelLabel}
            </span>
          </div>
          {step.suggestedTiming && (
            <span className="step-card-timing">
              <Clock className="w-3 h-3" />
              {step.suggestedTiming}
            </span>
          )}
        </div>

        <p className="step-card-action">{step.action}</p>
        <p className="step-card-purpose">{step.purpose}</p>

        {step.reasoning && (
          <div className="step-card-reasoning">
            <Sparkles className="w-3 h-3" />
            <span>{step.reasoning}</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="step-approval-error">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="step-approval-actions">
        <button
          className="btn-skip-step"
          onClick={onSkip}
          disabled={loading}
        >
          <SkipForward className="w-4 h-4" />
          Skip
        </button>
        <button
          className="btn-approve-step"
          onClick={onApprove}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Barry is writing...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Approve & Generate
            </>
          )}
        </button>
      </div>
    </div>
  );
}
