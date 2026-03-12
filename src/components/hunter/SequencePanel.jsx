import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  Sparkles,
  Loader2,
  CheckCircle,
  Circle,
  SkipForward,
  Clock,
  MessageSquare,
  Phone,
  Send,
  Link,
  Users,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import {
  resolveNextAction,
  getSequencePlan,
  getContactSequenceState,
  recordStepApproved,
  recordStepSent,
  recordStepSkipped,
  recordStepOutcome,
  recordStepProposed,
  STEP_OUTCOMES,
  STEP_OUTCOME_LABELS,
  SEQUENCE_STATUS
} from '../../utils/sequenceEngine';
import StepApprovalCard from './StepApprovalCard';
import OutcomePrompt from './OutcomePrompt';
import './SequencePanel.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

/**
 * SEQUENCE PANEL (Step 5)
 *
 * Primary execution surface for engagement sequences.
 * Lives inside HunterContactDrawer.
 *
 * Responsibilities:
 * - Show current sequence status for a contact in a mission
 * - Present Barry's next step proposal
 * - Handle outcome recording ("What happened?")
 * - Handle step approval, content generation, and sending
 * - Show sequence progress overview
 */

const STEP_TYPE_ICONS = {
  message: Send,
  follow_up: MessageSquare,
  call: Phone,
  resource: Link,
  introduction: Users
};

const STEP_TYPE_LABELS = {
  message: 'Message',
  follow_up: 'Follow-Up',
  call: 'Call',
  resource: 'Resource',
  introduction: 'Introduction'
};

export default function SequencePanel({ contact, mission, missionId, onStepSent }) {
  const [loading, setLoading] = useState(false);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [contentError, setContentError] = useState(null);
  const [missionData, setMissionData] = useState(mission);

  // Resolve what to show
  const nextAction = resolveNextAction(missionData, contact.id);
  const plan = getSequencePlan(missionData);
  const sequenceState = getContactSequenceState(missionData, contact.id);

  // Refresh mission data from Firestore
  async function refreshMission() {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (snap.exists()) {
        setMissionData({ id: snap.id, ...snap.data() });
      }
    } catch (err) {
      console.error('[SequencePanel] Failed to refresh mission:', err);
    }
  }

  // Generate content for the current step (just-in-time)
  async function handleApproveStep(stepIndex) {
    setGeneratingContent(true);
    setContentError(null);
    setGeneratedContent(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const token = await user.getIdToken();
      const step = plan.steps[stepIndex];
      const state = getContactSequenceState(missionData, contact.id);

      // Record proposal in timeline
      recordStepProposed({
        userId: user.uid,
        contactId: contact.id,
        missionId,
        stepIndex,
        step
      });

      // Call barryGenerateSequenceStep for just-in-time content
      const response = await fetch('/.netlify/functions/barryGenerateSequenceStep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: token,
          contact: {
            name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
            firstName: contact.firstName,
            lastName: contact.lastName,
            title: contact.title || contact.current_position_title,
            company_name: contact.company_name || contact.current_company_name,
            relationship_type: contact.relationship_type,
            warmth_level: contact.warmth_level,
            strategic_value: contact.strategic_value,
            engagementIntent: contact.engagementIntent
          },
          missionFields: {
            outcome_goal: missionData.outcome_goal,
            engagement_style: missionData.engagement_style,
            timeframe: missionData.timeframe,
            next_step_type: missionData.next_step_type
          },
          stepPlan: step,
          stepIndex,
          stepHistory: state?.stepHistory || [],
          previousOutcome: state?.lastOutcome || null
        })
      });

      if (!response.ok) throw new Error('Failed to generate step content');

      const data = await response.json();
      if (data.success && data.generatedContent) {
        setGeneratedContent(data.generatedContent);

        // Record approval in sequence engine
        await recordStepApproved({
          userId: user.uid,
          contactId: contact.id,
          missionId,
          stepIndex,
          generatedContent: data.generatedContent
        });

        await refreshMission();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[SequencePanel] Content generation failed:', err);
      setContentError('Barry could not generate content for this step. Please try again.');
    } finally {
      setGeneratingContent(false);
    }
  }

  // Record that a step was sent
  async function handleStepSent(stepIndex) {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      await recordStepSent({
        userId: user.uid,
        contactId: contact.id,
        missionId,
        stepIndex
      });

      setGeneratedContent(null);
      await refreshMission();

      if (onStepSent) onStepSent();
    } catch (err) {
      console.error('[SequencePanel] Failed to record step sent:', err);
    }
  }

  // Skip a step
  async function handleSkipStep(stepIndex) {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      setLoading(true);
      await recordStepSkipped({
        userId: user.uid,
        contactId: contact.id,
        missionId,
        stepIndex
      });

      setGeneratedContent(null);
      await refreshMission();
    } catch (err) {
      console.error('[SequencePanel] Failed to skip step:', err);
    } finally {
      setLoading(false);
    }
  }

  // Record outcome for previous step
  async function handleOutcomeRecorded(stepIndex, outcome) {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      setLoading(true);
      await recordStepOutcome({
        userId: user.uid,
        contactId: contact.id,
        missionId,
        stepIndex,
        outcome
      });

      await refreshMission();
    } catch (err) {
      console.error('[SequencePanel] Failed to record outcome:', err);
    } finally {
      setLoading(false);
    }
  }

  // No sequence plan exists
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return null;
  }

  // Sequence completed
  if (nextAction.action === 'completed') {
    return (
      <div className="sequence-panel">
        <div className="sequence-panel-header">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className="sequence-panel-title">Sequence Complete</span>
        </div>
        <div className="sequence-complete-banner">
          <CheckCircle className="w-8 h-8 text-green-400" />
          <p>All sequence steps have been completed for this contact.</p>
        </div>
        <SequenceProgressBar plan={plan} sequenceState={sequenceState} />
      </div>
    );
  }

  return (
    <div className="sequence-panel">
      <div className="sequence-panel-header">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <span className="sequence-panel-title">Engagement Sequence</span>
        <span className="sequence-panel-progress">
          Step {(sequenceState?.currentStepIndex ?? 0) + 1} of {plan.steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <SequenceProgressBar plan={plan} sequenceState={sequenceState} />

      {/* Outcome prompt — Barry asks "What happened?" */}
      {nextAction.action === 'needs_outcome' && (
        <OutcomePrompt
          previousStep={nextAction.previousStep}
          previousStepIndex={nextAction.previousStepIndex}
          onOutcomeSelected={(outcome) => handleOutcomeRecorded(nextAction.previousStepIndex, outcome)}
          loading={loading}
        />
      )}

      {/* Step approval card — propose next step */}
      {nextAction.action === 'propose_step' && !generatedContent && (
        <StepApprovalCard
          step={nextAction.step}
          stepIndex={nextAction.stepIndex}
          totalSteps={nextAction.totalSteps}
          previousOutcome={nextAction.previousOutcome}
          onApprove={() => handleApproveStep(nextAction.stepIndex)}
          onSkip={() => handleSkipStep(nextAction.stepIndex)}
          loading={generatingContent}
          error={contentError}
        />
      )}

      {/* Generated content review */}
      {generatedContent && (
        <GeneratedContentReview
          content={generatedContent}
          step={plan.steps[generatedContent.stepIndex]}
          stepIndex={generatedContent.stepIndex}
          contact={contact}
          onSent={() => handleStepSent(generatedContent.stepIndex)}
          onBack={() => setGeneratedContent(null)}
        />
      )}
    </div>
  );
}

/**
 * Visual progress bar showing sequence step statuses.
 */
function SequenceProgressBar({ plan, sequenceState }) {
  if (!plan?.steps) return null;

  const history = sequenceState?.stepHistory || [];
  const currentIndex = sequenceState?.currentStepIndex ?? 0;

  return (
    <div className="sequence-progress">
      {plan.steps.map((step, idx) => {
        const historyEntry = history.find(h => h.stepIndex === idx);
        let status = 'upcoming';
        if (historyEntry?.action === 'sent') status = 'sent';
        else if (historyEntry?.action === 'approved') status = 'approved';
        else if (historyEntry?.action === 'skipped') status = 'skipped';
        else if (idx === currentIndex) status = 'current';

        const StepIcon = STEP_TYPE_ICONS[step.stepType] || Circle;

        return (
          <div key={idx} className={`sequence-progress-step ${status}`}>
            <div className={`progress-step-dot ${status}`}>
              {status === 'sent' ? (
                <CheckCircle className="w-4 h-4" />
              ) : status === 'skipped' ? (
                <SkipForward className="w-4 h-4" />
              ) : (
                <StepIcon className="w-4 h-4" />
              )}
            </div>
            {idx < plan.steps.length - 1 && (
              <div className={`progress-step-connector ${status === 'sent' || status === 'skipped' ? 'done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Review and send generated content.
 */
function GeneratedContentReview({ content, step, stepIndex, contact, onSent, onBack }) {
  const [subject, setSubject] = useState(content.subject || '');
  const [body, setBody] = useState(content.body || '');
  const [sending, setSending] = useState(false);

  const firstName = contact.firstName || 'this person';

  async function handleSend() {
    setSending(true);
    // The actual send happens through the existing weapon system
    // We just record that the step was sent in the sequence
    onSent();
    setSending(false);
  }

  return (
    <div className="generated-content-review">
      <div className="content-review-header">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span>Barry's draft for Step {stepIndex + 1}</span>
      </div>

      {content.toneNote && (
        <p className="content-tone-note">{content.toneNote}</p>
      )}
      {content.adaptationNote && (
        <p className="content-adaptation-note">{content.adaptationNote}</p>
      )}

      {content.channel === 'email' && subject && (
        <div className="content-field">
          <label>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="content-subject-input"
          />
        </div>
      )}

      <div className="content-field">
        <label>{content.channel === 'phone' ? 'Talking Points' : 'Message'}</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="content-body-textarea"
          rows={content.channel === 'text' ? 3 : 6}
        />
      </div>

      <div className="content-review-actions">
        <button className="btn-secondary-seq" onClick={onBack}>
          Back
        </button>
        <button
          className="btn-primary-seq"
          onClick={handleSend}
          disabled={!body.trim() || sending}
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {content.channel === 'email' ? 'Send Email' : content.channel === 'phone' ? 'Mark as Called' : 'Send'}
        </button>
      </div>
    </div>
  );
}
