/**
 * MissionCard — Full mission card with Barry's draft UI.
 *
 * Sprint 4 additions:
 *   - MISSION_CTA_LABELS: "Send →" button label is now dynamic based on outcome_goal
 *   - Barry context line: reflects reconEnhanced status and confidence level
 *   - RECON confidence warnings: <40% → warning, 40-79% → partial note, 80%+ → silent
 *   - next_outcome_goal suggestion: shown after outcome is recorded, dismissable
 *   - reconConfidencePct prop flows in from HunterDashboard → ActiveMissionsView
 *
 * States (in order):
 *   1. Loading    — contact info immediate, "Barry is loading context..." indicator
 *   2. Draft      — AngleSelector + EditableMessageField + MissionStepProgress
 *   3. Sent       — HunterOutcomeOverlay (record what happened)
 *   4. Next step  — loading next draft, or mission complete
 *   5. Error      — retry + manual write fallback
 *
 * Real-time: listens to users/{uid}/missions/{missionId} for draft updates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Sparkles, RefreshCw, Edit3, Send, ChevronDown, ChevronUp } from 'lucide-react';
import AngleSelector from './AngleSelector';
import EditableMessageField from './EditableMessageField';
import MissionStepProgress from './MissionStepProgress';
import HunterOutcomeOverlay from './HunterOutcomeOverlay';
import HunterMicroIntake from './HunterMicroIntake';
import { predictNextOutcomeGoal } from '../../utils/nextOutcomeGoal';
import './MissionCard.css';

// ── CTA labels for the Send button (dynamic by outcome_goal) ────────────────
const MISSION_CTA_LABELS = {
  enter_conversation:  'Start Conversation',
  build_rapport:       'Build Rapport',
  deepen_conversation: 'Deepen Relationship',
  reconnect:           'Reconnect',
  rebuild_relationship: 'Rebuild Trust',
  get_introduction:    'Request Introduction',
  define_next_step:    'Advance Mission',
  schedule_meeting:    'Schedule Meeting',
  close_deal:          'Close Deal',
  ask_for_referral:    'Ask for Referral',
  default:             'Send Message'
};

// ── Relationship state color map ─────────────────────────────────────────────
const STATE_COLORS = {
  unaware:          '#6b7280',
  aware:            '#60a5fa',
  engaged:          '#34d399',
  warm:             '#f59e0b',
  trusted:          '#a78bfa',
  advocate:         '#ec4899',
  dormant:          '#9ca3af',
  strained:         '#f87171',
  strategic_partner: '#fbbf24'
};

export default function MissionCard({ contact, reconConfidencePct, onMissionComplete }) {
  const [mission, setMission] = useState(null);
  const [missionError, setMissionError] = useState(null);
  const [missionLoading, setMissionLoading] = useState(true);

  // Current step state
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedAngle, setSelectedAngle] = useState(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  // UI flow state
  const [showOutcome, setShowOutcome] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [generatingNextStep, setGeneratingNextStep] = useState(false);
  const [nextStepError, setNextStepError] = useState(null);

  // Next outcome goal suggestion (shown after outcome recorded)
  const [nextGoalSuggestion, setNextGoalSuggestion] = useState(null);

  // Intake state (first-contact path)
  const [showIntake, setShowIntake] = useState(false);

  const unsubRef = useRef(null);
  const missionId = contact.active_mission_id;
  const firstName = contact.first_name || contact.name?.split(' ')[0] || 'them';

  // ── Subscribe to mission document ─────────────────────────────────────────
  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !missionId) {
      setMissionLoading(false);
      return;
    }

    const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
    unsubRef.current = onSnapshot(missionRef, snap => {
      if (!snap.exists()) {
        setMissionError('Mission not found.');
        setMissionLoading(false);
        return;
      }

      const data = snap.data();
      setMission(data);
      setMissionLoading(false);
      setMissionError(null);

      // Determine current step index from status
      const idx = (data.steps || []).findIndex(s => s.status === 'current');
      const activeIdx = idx >= 0 ? idx : 0;
      setCurrentStepIndex(activeIdx);

      // Pre-load the recommended angle when draft arrives (only on first load)
      const step = (data.steps || [])[activeIdx];
      if (step?.draft && !selectedAngle) {
        const rec = step.draft.recommended_angle || step.draft.angles?.[0]?.id;
        if (rec) {
          setSelectedAngle(rec);
          const angle = step.draft.angles?.find(a => a.id === rec);
          if (angle) {
            setSubject(angle.subject || '');
            setMessage(angle.message || '');
          }
        }
      }
    }, err => {
      console.error('[MissionCard] Mission listener error:', err);
      setMissionError('Error loading mission data.');
      setMissionLoading(false);
    });

    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [missionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle angle selection ─────────────────────────────────────────────────
  const handleAngleSelect = useCallback((angleId) => {
    setSelectedAngle(angleId);
    const step = mission?.steps?.[currentStepIndex];
    const angle = step?.draft?.angles?.find(a => a.id === angleId);
    if (angle) {
      setSubject(angle.subject || '');
      setMessage(angle.message || '');
    }
  }, [mission, currentStepIndex]);

  const handleFieldChange = useCallback((field, value) => {
    if (field === 'subject') setSubject(value);
    else setMessage(value);
  }, []);

  // ── Handle "Send" — record step as sent ───────────────────────────────────
  const handleSend = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !missionId) return;

    const step = mission?.steps?.[currentStepIndex];
    if (!step || !message) return;

    try {
      const updatePath = {};
      updatePath[`steps.${currentStepIndex}.sent_at`] = new Date().toISOString();
      updatePath[`steps.${currentStepIndex}.sent_angle`] = selectedAngle;
      updatePath[`steps.${currentStepIndex}.sent_subject`] = subject;
      updatePath[`steps.${currentStepIndex}.sent_message`] = message;
      updatePath['updated_at'] = new Date().toISOString();

      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), updatePath);
      setShowOutcome(true);
    } catch (err) {
      console.error('[MissionCard] Send error:', err);
    }
  }, [missionId, mission, currentStepIndex, selectedAngle, subject, message]);

  // ── Handle outcome recording → generate next step ─────────────────────────
  const handleOutcomeRecorded = useCallback(async (outcomeId, newRelationshipState) => {
    const user = auth.currentUser;
    if (!user || !missionId) return;
    setShowOutcome(false);

    // Write outcome to mission step + mark step completed
    try {
      const updatePath = {};
      updatePath[`steps.${currentStepIndex}.outcome`] = outcomeId;
      updatePath[`steps.${currentStepIndex}.outcome_at`] = new Date().toISOString();
      updatePath[`steps.${currentStepIndex}.completed_at`] = new Date().toISOString();
      updatePath[`steps.${currentStepIndex}.status`] = 'completed';
      updatePath['updated_at'] = new Date().toISOString();

      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), updatePath);
    } catch (err) {
      console.error('[MissionCard] Outcome write error:', err);
    }

    // Predict next outcome_goal suggestion
    const effectiveState = newRelationshipState || contact.relationship_state;
    const suggestion = predictNextOutcomeGoal(
      effectiveState, mission?.outcome_goal, outcomeId
    );
    if (suggestion && !mission?.next_goal_dismissed) {
      setNextGoalSuggestion(suggestion);
    }

    // Check if there's a next step
    const nextIdx = currentStepIndex + 1;
    const totalSteps = mission?.steps?.length || 0;

    if (nextIdx >= totalSteps || ['scheduled', 'not_interested'].includes(outcomeId)) {
      if (onMissionComplete) onMissionComplete(outcomeId);
      return;
    }

    // Generate next step draft
    setGeneratingNextStep(true);
    setNextStepError(null);

    try {
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/barryHunterGenerateStep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          missionId,
          stepIndex: nextIdx,
          previousOutcome: outcomeId
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Step generation failed');

      // The onSnapshot above will pick up the new draft automatically
      setSelectedAngle(null);
    } catch (err) {
      console.error('[MissionCard] Next step generation error:', err);
      setNextStepError(err.message);
    } finally {
      setGeneratingNextStep(false);
    }
  }, [missionId, currentStepIndex, mission, contact.id, contact.relationship_state, onMissionComplete]);

  // ── Handle next goal adoption ──────────────────────────────────────────────
  const handleAdoptNextGoal = useCallback(async () => {
    if (!nextGoalSuggestion) return;
    const user = auth.currentUser;
    if (!user) return;

    try {
      // Update mission and contact with new outcome_goal
      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
        outcome_goal: nextGoalSuggestion.goal,
        updated_at: new Date().toISOString()
      });
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        outcome_goal: nextGoalSuggestion.goal,
        updated_at: new Date().toISOString()
      });
      setNextGoalSuggestion(null);
    } catch (err) {
      console.error('[MissionCard] Adopt goal error:', err);
    }
  }, [nextGoalSuggestion, missionId, contact.id]);

  const handleDismissNextGoal = useCallback(async () => {
    setNextGoalSuggestion(null);
    const user = auth.currentUser;
    if (!user || !missionId) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
        next_goal_dismissed: true,
        updated_at: new Date().toISOString()
      });
    } catch (_) {}
  }, [missionId]);

  // ── Handle retry (processing_error) ───────────────────────────────────────
  const handleRetry = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        processing_error: null,
        processing_error_at: null,
        hunter_status: 'engaged_pending',
        active_mission_id: null,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[MissionCard] Retry error:', err);
    }
  }, [contact.id]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const stateColor = STATE_COLORS[contact.relationship_state] || '#6b7280';
  const isPending = contact.hunter_status === 'engaged_pending';
  const hasError = !!contact.processing_error;

  const currentStep = mission?.steps?.[currentStepIndex];
  const draft = currentStep?.draft;
  const stepSent = !!currentStep?.sent_at;
  const needsIntake = !contact.hunter_intake?.completed_at && !contact.hunter_intake?.skipped;

  // Dynamic send button label
  const sendCTALabel = MISSION_CTA_LABELS[mission?.outcome_goal] || MISSION_CTA_LABELS.default;

  // Barry context line (reconEnhanced-aware)
  const confidence = reconConfidencePct ?? 0;
  const reconEnhanced = confidence >= 40;
  let barryContextLine = null;
  if (!isPending && !hasError && mission) {
    if (reconEnhanced && confidence >= 80) {
      barryContextLine = null;  // 80%+ → Barry just works, no note needed
    } else if (reconEnhanced) {
      barryContextLine = `RECON is ${confidence}% complete — messages will improve as you add more.`;
    } else {
      barryContextLine = `Working with limited context on ${firstName} — complete RECON to sharpen these messages.`;
    }
  }

  return (
    <div className="mc-card">
      {/* Header: contact info — always visible immediately */}
      <div className="mc-header">
        <div className="mc-avatar">{initials}</div>
        <div className="mc-contact-info">
          <div className="mc-name">{name}</div>
          <div className="mc-sub">
            {[contact.title, contact.company_name].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="mc-badges">
          <span className="mc-state-badge" style={{ backgroundColor: stateColor }}>
            {contact.relationship_state || 'unaware'}
          </span>
          {mission?.outcome_goal && (
            <span className="mc-goal-badge">
              🎯 {mission.outcome_goal.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      {/* Barry reasoning line */}
      {mission?.barry_reasoning && !isPending && !hasError && (
        <div className="mc-barry-reasoning">
          <Sparkles className="w-3.5 h-3.5 mc-sparkle" />
          <span>{mission.barry_reasoning}</span>
        </div>
      )}

      {/* RECON confidence context line */}
      {barryContextLine && (
        <div className={`mc-recon-context ${confidence < 40 ? 'mc-recon-context--warn' : 'mc-recon-context--partial'}`}>
          {barryContextLine}
        </div>
      )}

      {/* Error state — never a blank screen */}
      {hasError && (
        <div className="mc-error">
          <p className="mc-error-msg">Barry hit a snag loading context for this contact.</p>
          <div className="mc-error-actions">
            <button className="mc-btn mc-btn--retry" onClick={handleRetry}>
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
            <button className="mc-btn mc-btn--manual">
              <Edit3 className="w-4 h-4" /> Write manually
            </button>
          </div>
        </div>
      )}

      {/* Loading state — contact info is already visible above */}
      {!hasError && (isPending || missionLoading) && (
        <div className="mc-loading">
          <div className="mc-loading-dots">
            <span /><span /><span />
          </div>
          <p className="mc-loading-text">
            {isPending
              ? `Reviewing your history with ${firstName} and what we know about ${contact.company_name || 'their company'}.`
              : 'Loading mission data...'}
          </p>
        </div>
      )}

      {/* First-contact intake prompt */}
      {!hasError && !isPending && !missionLoading && needsIntake && mission && (
        <div className="mc-intake-prompt">
          <p className="mc-intake-note">
            {draft?.limited_context
              ? `Working with limited context on ${firstName} — complete the intake to sharpen this draft.`
              : `Tell Barry more about this contact to get a sharper draft.`}
          </p>
          <button
            className="mc-btn mc-btn--intake"
            onClick={() => setShowIntake(true)}
          >
            Complete intake
          </button>
        </div>
      )}

      {/* Intake overlay */}
      {showIntake && (
        <HunterMicroIntake
          contacts={[contact]}
          onComplete={() => setShowIntake(false)}
          onDismiss={() => setShowIntake(false)}
        />
      )}

      {/* Draft ready — main interaction surface */}
      {!hasError && !isPending && !missionLoading && mission && !showOutcome && (
        <>
          {!draft && !generatingNextStep && (
            <div className="mc-loading">
              <div className="mc-loading-dots"><span /><span /><span /></div>
              <p className="mc-loading-text">Barry is drafting your message...</p>
            </div>
          )}

          {generatingNextStep && (
            <div className="mc-loading">
              <div className="mc-loading-dots"><span /><span /><span /></div>
              <p className="mc-loading-text">Barry is adapting your next message...</p>
            </div>
          )}

          {nextStepError && (
            <div className="mc-error">
              <p className="mc-error-msg">Could not generate next step: {nextStepError}</p>
              <button className="mc-btn mc-btn--retry" onClick={() => setNextStepError(null)}>
                Dismiss
              </button>
            </div>
          )}

          {draft && !generatingNextStep && (
            <>
              {/* Step header */}
              <div className="mc-step-header">
                <span className="mc-step-label">
                  STEP {currentStepIndex + 1} OF {mission.steps?.length || 1}
                </span>
                {currentStep?.barry_note && (
                  <span className="mc-barry-note">{currentStep.barry_note}</span>
                )}
              </div>

              {/* Angle selector */}
              <AngleSelector
                angles={draft.angles}
                selectedAngle={selectedAngle}
                recommendedAngle={draft.recommended_angle}
                onSelect={handleAngleSelect}
              />

              {/* Editable message field */}
              {selectedAngle && (
                <EditableMessageField
                  subject={subject}
                  message={message}
                  onChange={handleFieldChange}
                />
              )}

              {/* Send button — dynamic CTA label */}
              {selectedAngle && !stepSent && (
                <div className="mc-actions">
                  <button
                    className="mc-btn mc-btn--send"
                    onClick={handleSend}
                    disabled={!message.trim()}
                  >
                    <Send className="w-4 h-4" />
                    {sendCTALabel}
                  </button>
                </div>
              )}

              {stepSent && (
                <button
                  className="mc-outcome-cta"
                  onClick={() => setShowOutcome(true)}
                >
                  What happened? Record outcome →
                </button>
              )}
            </>
          )}

          {/* Step progress */}
          {mission.steps && mission.steps.length > 1 && (
            <div className="mc-steps-section">
              <button
                className="mc-steps-toggle"
                onClick={() => setShowSteps(s => !s)}
              >
                Mission steps
                {showSteps ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showSteps && (
                <MissionStepProgress
                  steps={mission.steps}
                  currentStepIndex={currentStepIndex}
                />
              )}
            </div>
          )}

          {/* Next outcome goal suggestion */}
          {nextGoalSuggestion && !mission?.next_goal_dismissed && (
            <div className="mc-next-goal">
              <div className="mc-next-goal-header">── WHAT'S NEXT ──</div>
              <div className="mc-next-goal-body">
                <Sparkles className="w-3.5 h-3.5 mc-sparkle" />
                <span>Barry suggests: <strong>{nextGoalSuggestion.label}</strong></span>
              </div>
              <div className="mc-next-goal-actions">
                <button className="mc-btn mc-btn--adopt-goal" onClick={handleAdoptNextGoal}>
                  Make this the goal
                </button>
                <button className="mc-btn mc-btn--dismiss-goal" onClick={handleDismissNextGoal}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Outcome overlay */}
      {showOutcome && (
        <HunterOutcomeOverlay
          contact={contact}
          stepDescription={currentStep?.action}
          onOutcomeRecorded={handleOutcomeRecorded}
        />
      )}
    </div>
  );
}
