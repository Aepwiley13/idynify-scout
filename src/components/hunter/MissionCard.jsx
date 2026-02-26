/**
 * MissionCard — Full mission card with Barry's draft UI.
 *
 * States (in order):
 *   1. Loading    — contact info immediate, "Barry is loading context..." indicator
 *   2. Draft      — AngleSelector + EditableMessageField + MissionStepProgress
 *   3. Sent       — HunterOutcomeOverlay (record what happened)
 *   4. Next step  — loading next draft, or mission complete
 *   5. Error      — retry + manual write fallback
 *
 * Real-time: listens to users/{uid}/missions/{missionId} for draft updates.
 * The draft appears without page refresh — the onSnapshot fires when Barry writes it.
 *
 * First-contact path:
 *   If contact.hunter_intake is not completed, shows inline intake prompt.
 *   Completing intake triggers draft regeneration via barryHunterGenerateStep.
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
import './MissionCard.css';

// Relationship state color map
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

export default function MissionCard({ contact, onMissionComplete }) {
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

  // Intake state (first-contact path)
  const [showIntake, setShowIntake] = useState(false);

  const unsubRef = useRef(null);
  const missionId = contact.active_mission_id;

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

      // Pre-load the recommended angle when draft arrives
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
    if (!step || !subject || !message) return;

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

    // Check if there's a next step
    const nextIdx = currentStepIndex + 1;
    const totalSteps = mission?.steps?.length || 0;

    if (nextIdx >= totalSteps) {
      // All steps done — mission is over
      if (onMissionComplete) onMissionComplete(outcomeId);
      return;
    }

    // Terminal outcomes — no next draft
    if (['scheduled', 'not_interested'].includes(outcomeId)) {
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
      setSelectedAngle(null);  // Reset angle selection for the new step
    } catch (err) {
      console.error('[MissionCard] Next step generation error:', err);
      setNextStepError(err.message);
    } finally {
      setGeneratingNextStep(false);
    }
  }, [missionId, currentStepIndex, mission, contact.id, onMissionComplete]);

  // ── Handle retry (processing_error) ───────────────────────────────────────
  const handleRetry = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      // Clear error flag
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        processing_error: null,
        processing_error_at: null,
        hunter_status: 'engaged_pending',
        active_mission_id: null,
        updated_at: new Date().toISOString()
      });
      // The parent HunterDashboard will re-detect engaged_pending and re-call barryHunterProcessEngage
    } catch (err) {
      console.error('[MissionCard] Retry error:', err);
    }
  }, [contact.id]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const stateColor = STATE_COLORS[contact.relationship_state] || '#6b7280';
  const isPending = contact.hunter_status === 'engaged_pending';
  const hasError = !!contact.processing_error;

  const currentStep = mission?.steps?.[currentStepIndex];
  const draft = currentStep?.draft;
  const stepSent = !!currentStep?.sent_at;
  const needsIntake = !contact.hunter_intake?.completed_at && !contact.hunter_intake?.skipped;

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

      {/* Error state — never a blank screen */}
      {hasError && (
        <div className="mc-error">
          <p className="mc-error-msg">Barry hit a snag loading context for this contact.</p>
          <div className="mc-error-actions">
            <button className="mc-btn mc-btn--retry" onClick={handleRetry}>
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
            <button className="mc-btn mc-btn--manual" onClick={() => setShowOutcome(false)}>
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
              ? `Reviewing your history with ${contact.first_name || name} and what we know about ${contact.company_name || 'their company'}.`
              : 'Loading mission data...'}
          </p>
        </div>
      )}

      {/* First-contact intake prompt */}
      {!hasError && !isPending && !missionLoading && needsIntake && mission && (
        <div className="mc-intake-prompt">
          <p className="mc-intake-note">
            {draft?.limited_context
              ? `Working with limited context on ${contact.first_name || name} — complete the intake to sharpen this draft.`
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
              <button
                className="mc-btn mc-btn--retry"
                onClick={() => setNextStepError(null)}
              >
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

              {/* Send button */}
              {selectedAngle && !stepSent && (
                <div className="mc-actions">
                  <button
                    className="mc-btn mc-btn--send"
                    onClick={handleSend}
                    disabled={!message.trim()}
                  >
                    <Send className="w-4 h-4" />
                    Send →
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
