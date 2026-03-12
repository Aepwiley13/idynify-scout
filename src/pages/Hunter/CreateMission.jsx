import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useActiveUserId, useImpersonation } from '../../context/ImpersonationContext';
import { ArrowLeft, Target, Users, Sparkles, Rocket, CheckCircle, Edit2, Trash2, Crosshair, Clock, Zap, ArrowRight, Loader2 } from 'lucide-react';
import { getAllGoals, createMissionFromTemplate } from '../../utils/missionTemplates';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS } from '../../utils/contactStateMachine';
import {
  OUTCOME_GOALS,
  ENGAGEMENT_STYLES,
  MISSION_TIMEFRAMES,
  NEXT_STEP_TYPES,
  getLabelById,
  getDescriptionById
} from '../../constants/structuredFields';
import './CreateMission.css';

/**
 * CREATE MISSION WIZARD (Step 4 Update)
 *
 * Intent-driven mission builder for Hunter.
 * Philosophy: User declares goal → Defines strategy → Barry proposes orchestration → User approves → Autopilot
 *
 * Steps:
 * 1. Choose Goal (book meetings, warm conversations, re-engage)
 * 2. Define Mission Strategy (outcome_goal, engagement_style, timeframe, next_step_type)
 * 3. Review Barry's Orchestration + Micro-Sequence
 * 4. Select Contacts
 * 5. Launch Mission (name it and put on autopilot)
 *
 * Guardrail: All micro-sequence steps are approval-gated. Nothing sends without user confirmation.
 */

export default function CreateMission() {
  const navigate = useNavigate();
  const location = useLocation();
  const impersonatedUserId = useActiveUserId();
  const { isImpersonating } = useImpersonation();
  const getEffectiveUser = () => {
    const realUser = auth.currentUser;
    if (!realUser) return null;
    if (isImpersonating && impersonatedUserId) {
      return { uid: impersonatedUserId, getIdToken: () => realUser.getIdToken() };
    }
    return realUser;
  };
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [missionData, setMissionData] = useState(null);
  const [allContacts, setAllContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [missionName, setMissionName] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 6: Campaign association (optional)
  const [campaignId, setCampaignId] = useState(null);

  // Step 4: Mission strategy fields
  const [outcomeGoal, setOutcomeGoal] = useState(null);
  const [engagementStyle, setEngagementStyle] = useState(null);
  const [timeframe, setTimeframe] = useState(null);
  const [nextStepType, setNextStepType] = useState(null);

  // Step 4: Micro-sequence from Barry
  const [microSequence, setMicroSequence] = useState(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceError, setSequenceError] = useState(null);

  // Template step editing state
  const [editingStepIndex, setEditingStepIndex] = useState(null);
  const [editingStepContent, setEditingStepContent] = useState({ subject: '', body: '' });

  // Task 1.4: Micro-sequence step editing
  const [editingMicroStepIndex, setEditingMicroStepIndex] = useState(null);
  const [editingMicroStepContent, setEditingMicroStepContent] = useState({ action: '', channel: '', timing: '' });

  const goals = getAllGoals();

  useEffect(() => {
    loadContacts();

    // Pre-select contact if coming from contact profile
    const params = new URLSearchParams(location.search);
    const contactId = params.get('contactId');
    if (contactId) {
      setSelectedContactIds([contactId]);
    }

    // Step 6: Accept campaignId from URL params or location state
    const campaignIdParam = params.get('campaignId') || location.state?.campaignId;
    if (campaignIdParam) {
      setCampaignId(campaignIdParam);
    }
  }, [location.search, location.state]);

  async function loadContacts() {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const contactsSnapshot = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setAllContacts(contactsList);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  }

  function handleSelectGoal(goal) {
    setSelectedGoal(goal);
    setCurrentStep(2);
  }

  // Step 4: Generate mission with strategy fields and request micro-sequence
  async function handleStrategyComplete() {
    const missionFields = {
      outcome_goal: outcomeGoal,
      engagement_style: engagementStyle,
      timeframe: timeframe,
      next_step_type: nextStepType
    };

    // Create mission from template with structured fields
    const mission = createMissionFromTemplate(
      selectedGoal.id,
      selectedGoal.defaultName,
      [],
      missionFields
    );
    setMissionData(mission);
    setMissionName(mission.name);

    // Move to orchestration review
    setCurrentStep(3);

    // Generate micro-sequence from Barry
    await generateMicroSequence(missionFields);
  }

  async function generateMicroSequence(missionFields) {
    setSequenceLoading(true);
    setSequenceError(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const token = await user.getIdToken();

      const response = await fetch('/.netlify/functions/barryGenerateMissionSequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: token,
          missionFields,
          contacts: selectedContactIds.length > 0
            ? allContacts.filter(c => selectedContactIds.includes(c.id))
            : []
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate sequence');
      }

      const data = await response.json();
      if (data.success && data.microSequence) {
        setMicroSequence(data.microSequence);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error generating micro-sequence:', error);
      setSequenceError('Barry could not generate a sequence right now. You can continue without one.');
    } finally {
      setSequenceLoading(false);
    }
  }

  function handleToggleStep(stepIndex) {
    const updated = { ...missionData };
    updated.steps[stepIndex].enabled = !updated.steps[stepIndex].enabled;
    setMissionData(updated);
  }

  function handleRemoveStep(stepIndex) {
    if (editingStepIndex === stepIndex) setEditingStepIndex(null);
    const updated = { ...missionData };
    updated.steps = updated.steps.filter((_, index) => index !== stepIndex);
    setMissionData(updated);
  }

  function handleEditStep(stepIndex) {
    const step = missionData.steps[stepIndex];
    setEditingStepContent({
      subject: step.subject || '',
      body: step.body || step.description || ''
    });
    setEditingStepIndex(stepIndex);
  }

  function handleSaveStep(stepIndex) {
    const updated = { ...missionData };
    updated.steps[stepIndex] = {
      ...updated.steps[stepIndex],
      subject: editingStepContent.subject,
      body: editingStepContent.body
    };
    setMissionData(updated);
    setEditingStepIndex(null);
  }

  function handleCancelEdit() {
    setEditingStepIndex(null);
  }

  // Task 1.4: Micro-sequence step editing
  function handleEditMicroStep(index) {
    const step = microSequence.steps[index];
    setEditingMicroStepContent({
      action: step.action || '',
      channel: step.channel || 'email',
      timing: step.suggestedTiming || step.timing || ''
    });
    setEditingMicroStepIndex(index);
  }

  function handleSaveMicroStep(index) {
    const updated = { ...microSequence };
    updated.steps = updated.steps.map((s, i) =>
      i === index
        ? { ...s, ...editingMicroStepContent, suggestedTiming: editingMicroStepContent.timing }
        : s
    );
    setMicroSequence(updated);
    setEditingMicroStepIndex(null);
  }

  function handleCancelMicroEdit() {
    setEditingMicroStepIndex(null);
  }

  function toggleContactSelection(contactId) {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  }

  async function handleLaunchMission() {
    setLoading(true);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      // Get selected contacts with full data
      const selectedContacts = allContacts.filter(c => selectedContactIds.includes(c.id));

      // Create final mission data with structured fields
      const finalMission = {
        ...missionData,
        name: missionName || missionData.name,
        userId: user.uid,
        // Step 4: Ensure structured fields are persisted
        outcome_goal: outcomeGoal,
        engagement_style: engagementStyle,
        timeframe: timeframe,
        next_step_type: nextStepType,
        microSequence: microSequence || null,
        // Step 5: Store sequence plan for SequenceEngine consumption
        sequence: microSequence ? {
          steps: microSequence.steps,
          sequenceRationale: microSequence.sequenceRationale,
          expectedOutcome: microSequence.expectedOutcome,
          totalSteps: microSequence.steps?.length || 0,
          generatedAt: microSequence.generatedAt || new Date().toISOString()
        } : null,
        // Step 6: Campaign association (for dashboard cross-referencing)
        campaignId: campaignId || null,
        // Step 5: Initialize per-contact sequence state
        // Step 6: Denormalize firstName/lastName for dashboard rendering
        contacts: selectedContacts.map(contact => ({
          contactId: contact.id,
          name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
          firstName: contact.firstName || null,
          lastName: contact.lastName || null,
          email: contact.email || null,
          phone: contact.phone || null,
          currentStepIndex: 0,
          lastTouchDate: null,
          status: 'active',
          outcomes: [],
          // Step 5: Sequence state fields
          sequenceStatus: microSequence ? 'active' : 'pending',
          stepHistory: [],
          lastOutcome: null
        })),
        status: 'autopilot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to Firestore
      const docRef = await addDoc(collection(db, 'users', user.uid, 'missions'), finalMission);

      // Log timeline event: mission_assigned for each contact
      const missionDisplayName = missionName || missionData.name;
      selectedContactIds.forEach(contactId => {
        logTimelineEvent({
          userId: user.uid,
          contactId,
          type: 'mission_assigned',
          actor: ACTORS.USER,
          preview: missionDisplayName,
          metadata: {
            missionId: docRef.id,
            missionName: missionDisplayName,
            goalName: selectedGoal?.name || null,
            outcomeGoal: outcomeGoal,
            engagementStyle: engagementStyle,
            timeframe: timeframe,
            nextStepType: nextStepType
          }
        });

        // State Machine: Mission assigned → Active Mission
        updateContactStatus({
          userId: user.uid,
          contactId,
          trigger: STATUS_TRIGGERS.MISSION_ASSIGNED
        });
      });

      // Navigate to mission detail
      navigate(`/hunter/mission/${docRef.id}`);
    } catch (error) {
      console.error('Error launching mission:', error);
      alert('Failed to launch mission. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const allStrategyFieldsSet = outcomeGoal && engagementStyle && timeframe && nextStepType;
  const canProceedToStep3 = missionData && missionData.steps.some(s => s.enabled);
  const canLaunch = selectedContactIds.length > 0 && missionName.trim() !== '';

  // Channel icon mapping for micro-sequence display
  const channelIcons = {
    email: '✉️',
    text: '💬',
    phone: '📞',
    linkedin: '🔗',
    calendar: '📅'
  };

  return (
    <div className="create-mission">
      {/* Header */}
      <div className="create-mission-header">
        <button className="btn-back" onClick={() => navigate('/hunter')}>
          <ArrowLeft className="w-5 h-5" />
          Back to Hunter
        </button>
        <div className="create-mission-progress">
          <span className={`progress-dot ${currentStep >= 1 ? 'active' : ''}`}>1</span>
          <div className={`progress-connector ${currentStep > 1 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 2 ? 'active' : ''}`}>2</span>
          <div className={`progress-connector ${currentStep > 2 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 3 ? 'active' : ''}`}>3</span>
          <div className={`progress-connector ${currentStep > 3 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 4 ? 'active' : ''}`}>4</span>
          <div className={`progress-connector ${currentStep > 4 ? 'active' : ''}`}></div>
          <span className={`progress-dot ${currentStep >= 5 ? 'active' : ''}`}>5</span>
        </div>
      </div>

      {/* Step 1: Choose Goal */}
      {currentStep === 1 && (
        <div className="mission-step">
          <div className="step-header">
            <Target className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">What's your goal?</h1>
            <p className="step-description">Choose the outcome you want to achieve</p>
          </div>

          <div className="goals-grid">
            {goals.map(goal => (
              <div
                key={goal.id}
                className="goal-card"
                onClick={() => handleSelectGoal(goal)}
              >
                <div className="goal-icon">{goal.icon}</div>
                <h3 className="goal-name">{goal.name}</h3>
                <p className="goal-description">{goal.description}</p>
                <div className="goal-steps-preview">
                  {goal.steps.length} touchpoints
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Define Mission Strategy (NEW — Step 4) */}
      {currentStep === 2 && (
        <div className="mission-step">
          <div className="step-header">
            <Crosshair className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Define Your Mission Strategy</h1>
            <p className="step-description">
              Set the parameters so Barry can plan an intentional sequence, not just a single message
            </p>
          </div>

          <div className="strategy-fields">
            {/* Outcome Goal */}
            <div className="strategy-field-group">
              <h3 className="strategy-field-label">
                <Target className="w-5 h-5" />
                Outcome Goal
              </h3>
              <p className="strategy-field-hint">What is this mission trying to achieve?</p>
              <div className="strategy-options">
                {OUTCOME_GOALS.map(option => (
                  <button
                    key={option.id}
                    className={`strategy-option ${outcomeGoal === option.id ? 'selected' : ''}`}
                    onClick={() => setOutcomeGoal(option.id)}
                  >
                    <span className="strategy-option-label">{option.label}</span>
                    <span className="strategy-option-desc">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Engagement Style */}
            <div className="strategy-field-group">
              <h3 className="strategy-field-label">
                <Zap className="w-5 h-5" />
                Engagement Style
              </h3>
              <p className="strategy-field-hint">How much attention does this deserve?</p>
              <div className="strategy-options strategy-options-row">
                {ENGAGEMENT_STYLES.map(option => (
                  <button
                    key={option.id}
                    className={`strategy-option strategy-option-wide ${engagementStyle === option.id ? 'selected' : ''}`}
                    onClick={() => setEngagementStyle(option.id)}
                  >
                    <span className="strategy-option-label">{option.label}</span>
                    <span className="strategy-option-desc">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Timeframe */}
            <div className="strategy-field-group">
              <h3 className="strategy-field-label">
                <Clock className="w-5 h-5" />
                Timeframe
              </h3>
              <p className="strategy-field-hint">How urgent is this mission?</p>
              <div className="strategy-options strategy-options-row">
                {MISSION_TIMEFRAMES.map(option => (
                  <button
                    key={option.id}
                    className={`strategy-option strategy-option-wide ${timeframe === option.id ? 'selected' : ''}`}
                    onClick={() => setTimeframe(option.id)}
                  >
                    <span className="strategy-option-label">{option.label}</span>
                    <span className="strategy-option-desc">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Next Step Type */}
            <div className="strategy-field-group">
              <h3 className="strategy-field-label">
                <ArrowRight className="w-5 h-5" />
                Next Step Type
              </h3>
              <p className="strategy-field-hint">What type of action should Barry plan toward first?</p>
              <div className="strategy-options">
                {NEXT_STEP_TYPES.map(option => (
                  <button
                    key={option.id}
                    className={`strategy-option ${nextStepType === option.id ? 'selected' : ''}`}
                    onClick={() => setNextStepType(option.id)}
                  >
                    <span className="strategy-option-label">{option.label}</span>
                    <span className="strategy-option-desc">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(1)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={handleStrategyComplete}
              disabled={!allStrategyFieldsSet}
            >
              Next: Review Orchestration →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review Orchestration + Micro-Sequence */}
      {currentStep === 3 && missionData && (
        <div className="mission-step">
          <div className="step-header">
            <Sparkles className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Barry's Proposed Orchestration</h1>
            <p className="step-description">
              Review the template sequence and Barry's suggested micro-sequence below.
            </p>
          </div>

          {/* Mission Strategy Summary */}
          <div className="strategy-summary">
            <div className="strategy-summary-item">
              <span className="strategy-summary-label">Goal</span>
              <span className="strategy-summary-value">{getLabelById(OUTCOME_GOALS, outcomeGoal)}</span>
            </div>
            <div className="strategy-summary-item">
              <span className="strategy-summary-label">Style</span>
              <span className="strategy-summary-value">{getLabelById(ENGAGEMENT_STYLES, engagementStyle)}</span>
            </div>
            <div className="strategy-summary-item">
              <span className="strategy-summary-label">Timeframe</span>
              <span className="strategy-summary-value">{getLabelById(MISSION_TIMEFRAMES, timeframe)}</span>
            </div>
            <div className="strategy-summary-item">
              <span className="strategy-summary-label">First Action</span>
              <span className="strategy-summary-value">{getLabelById(NEXT_STEP_TYPES, nextStepType)}</span>
            </div>
          </div>

          {/* Barry's Micro-Sequence */}
          <div className="micro-sequence-section">
            <h3 className="micro-sequence-title">
              <Sparkles className="w-5 h-5 text-purple-400" />
              Barry's Suggested Sequence
            </h3>

            {sequenceLoading && (
              <div className="micro-sequence-loading">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                <span>Barry is planning your sequence...</span>
              </div>
            )}

            {sequenceError && (
              <div className="micro-sequence-error">
                <p>{sequenceError}</p>
              </div>
            )}

            {microSequence && !sequenceLoading && (
              <div className="micro-sequence-content">
                <p className="micro-sequence-rationale">{microSequence.sequenceRationale}</p>

                <div className="micro-sequence-steps">
                  {microSequence.steps.map((step, index) => (
                    <div key={index} className="micro-step">
                      {editingMicroStepIndex === index ? (
                        /* ── Inline editor (Task 1.4) ── */
                        <div className="micro-step-editor">
                          <div className="micro-step-editor-row">
                            <label className="micro-step-editor-label">What Barry does</label>
                            <textarea
                              className="micro-step-editor-textarea"
                              value={editingMicroStepContent.action}
                              onChange={e => setEditingMicroStepContent(prev => ({ ...prev, action: e.target.value }))}
                              rows={2}
                              placeholder="Describe what this step should accomplish..."
                            />
                          </div>
                          <div className="micro-step-editor-inline">
                            <div className="micro-step-editor-row micro-step-editor-row--half">
                              <label className="micro-step-editor-label">Channel</label>
                              <select
                                className="micro-step-editor-select"
                                value={editingMicroStepContent.channel}
                                onChange={e => setEditingMicroStepContent(prev => ({ ...prev, channel: e.target.value }))}
                              >
                                {['email', 'text', 'phone', 'linkedin', 'calendar'].map(c => (
                                  <option key={c} value={c}>{channelIcons[c]} {c}</option>
                                ))}
                              </select>
                            </div>
                            <div className="micro-step-editor-row micro-step-editor-row--half">
                              <label className="micro-step-editor-label">Timing</label>
                              <input
                                type="text"
                                className="micro-step-editor-input"
                                value={editingMicroStepContent.timing}
                                onChange={e => setEditingMicroStepContent(prev => ({ ...prev, timing: e.target.value }))}
                                placeholder="e.g. Day 3"
                              />
                            </div>
                          </div>
                          <div className="step-editor-actions">
                            <button className="btn-secondary btn-sm" onClick={handleCancelMicroEdit}>
                              Cancel
                            </button>
                            <button className="btn-primary-hunter btn-sm" onClick={() => handleSaveMicroStep(index)}>
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="micro-step-header">
                            <div className="micro-step-number">{step.stepNumber}</div>
                            <div className="micro-step-timing">{step.suggestedTiming || step.timing}</div>
                            <div className="micro-step-channel">
                              {channelIcons[step.channel] || '📨'} {step.channel}
                            </div>
                            <button
                              className="btn-icon micro-step-edit-btn"
                              onClick={() => handleEditMicroStep(index)}
                              title="Edit this step"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="micro-step-body">
                            <p className="micro-step-action">{step.action}</p>
                            <p className="micro-step-purpose">{step.purpose}</p>
                          </div>
                          <div className="micro-step-approval">
                            <CheckCircle className="w-4 h-4" />
                            Requires your approval
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="micro-sequence-outcome">
                  <strong>Expected Outcome:</strong> {microSequence.expectedOutcome}
                </div>
              </div>
            )}
          </div>

          {/* Template Orchestration Timeline */}
          <div className="orchestration-section-label">Template Touchpoints</div>
          <div className="orchestration-timeline">
            {missionData.steps.map((step, index) => (
              <div
                key={step.id}
                className={`timeline-step ${!step.enabled ? 'disabled' : ''}`}
              >
                <div className="timeline-marker">
                  <div className="timeline-dot"></div>
                  {index < missionData.steps.length - 1 && <div className="timeline-line"></div>}
                </div>
                <div className="timeline-content">
                  <div className="timeline-header">
                    <div className="timeline-info">
                      <span className="timeline-timing">{step.timing}</span>
                      <span className="timeline-label">{step.label}</span>
                    </div>
                    <div className="timeline-actions">
                      <button
                        className="btn-icon"
                        onClick={() => handleToggleStep(index)}
                        title={step.enabled ? 'Disable step' : 'Enable step'}
                      >
                        <CheckCircle className={`w-5 h-5 ${step.enabled ? 'text-green-400' : 'text-gray-500'}`} />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => editingStepIndex === index ? handleCancelEdit() : handleEditStep(index)}
                        title={editingStepIndex === index ? 'Cancel edit' : 'Edit message'}
                      >
                        <Edit2 className={`w-5 h-5 ${editingStepIndex === index ? 'text-purple-400' : ''}`} />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => handleRemoveStep(index)}
                        title="Remove step"
                      >
                        <Trash2 className="w-5 h-5 text-red-400" />
                      </button>
                    </div>
                  </div>

                  {editingStepIndex === index ? (
                    <div className="step-inline-editor">
                      {step.weapon === 'email' && (
                        <div className="step-editor-field">
                          <label className="step-editor-label">Subject line</label>
                          <input
                            type="text"
                            className="step-editor-input"
                            value={editingStepContent.subject}
                            onChange={e => setEditingStepContent(prev => ({ ...prev, subject: e.target.value }))}
                            placeholder="e.g. Quick question about your team's outreach"
                          />
                        </div>
                      )}
                      <div className="step-editor-field">
                        <label className="step-editor-label">
                          {step.weapon === 'phone' ? 'Call notes / talking points' : 'Message'}
                        </label>
                        <textarea
                          className="step-editor-textarea"
                          value={editingStepContent.body}
                          onChange={e => setEditingStepContent(prev => ({ ...prev, body: e.target.value }))}
                          placeholder={
                            step.weapon === 'phone'
                              ? 'Key points to cover on the call...'
                              : step.weapon === 'text'
                              ? 'Short, conversational message (160 chars ideal)...'
                              : 'Your message content. Barry will personalize this per contact when they\'re added to the mission.'
                          }
                          rows={step.weapon === 'text' ? 3 : 5}
                        />
                        {step.weapon === 'text' && (
                          <span className="step-editor-charcount">
                            {editingStepContent.body.length} / 160
                          </span>
                        )}
                      </div>
                      <div className="step-editor-actions">
                        <button
                          className="btn-secondary btn-sm"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-primary-hunter btn-sm"
                          onClick={() => handleSaveStep(index)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="timeline-description">
                        {step.body || step.description}
                        {step.body && step.subject && (
                          <span className="step-subject-preview"> — Subject: "{step.subject}"</span>
                        )}
                      </p>
                      <div className="timeline-meta">
                        <span className="weapon-badge">{step.weapon}</span>
                        <span className="type-badge">{step.type}</span>
                        {step.body && <span className="type-badge text-green-400">✓ Custom message</span>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(2)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(4)}
              disabled={!canProceedToStep3}
            >
              Next: Select Contacts →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Select Contacts */}
      {currentStep === 4 && (
        <div className="mission-step">
          <div className="step-header">
            <Users className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Who should enter this mission?</h1>
            <p className="step-description">
              Selected: {selectedContactIds.length} contact{selectedContactIds.length !== 1 ? 's' : ''}
            </p>
          </div>

          {allContacts.length === 0 ? (
            <div className="empty-state">
              <Users className="w-12 h-12 text-gray-500" />
              <p>No contacts found. Add contacts in Scout first.</p>
              <button className="btn-primary-hunter" onClick={() => navigate('/scout')}>
                Go to Scout
              </button>
            </div>
          ) : (
            <div className="contacts-list">
              {allContacts.map(contact => (
                <div
                  key={contact.id}
                  className={`contact-item ${selectedContactIds.includes(contact.id) ? 'selected' : ''}`}
                  onClick={() => toggleContactSelection(contact.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedContactIds.includes(contact.id)}
                    onChange={() => {}}
                    className="contact-checkbox"
                  />
                  <div className="contact-info">
                    <div className="contact-name">{contact.firstName} {contact.lastName}</div>
                    <div className="contact-meta">
                      {contact.email && contact.email}
                      {contact.phone && ` • ${contact.phone}`}
                      {contact.title && ` • ${contact.title}`}
                      {contact.company_name && ` • ${contact.company_name}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(3)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={() => setCurrentStep(5)}
              disabled={selectedContactIds.length === 0}
            >
              Next: Launch Mission →
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Name & Launch */}
      {currentStep === 5 && (
        <div className="mission-step">
          <div className="step-header">
            <Rocket className="w-8 h-8 text-purple-400" />
            <h1 className="step-title">Ready to Launch</h1>
            <p className="step-description">Give your mission a name and put it on autopilot</p>
          </div>

          <div className="mission-summary">
            <div className="summary-card">
              <h3>Mission Summary</h3>
              <div className="summary-row">
                <span className="summary-label">Goal:</span>
                <span className="summary-value">{selectedGoal?.name}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Outcome:</span>
                <span className="summary-value">{getLabelById(OUTCOME_GOALS, outcomeGoal)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Style:</span>
                <span className="summary-value">{getLabelById(ENGAGEMENT_STYLES, engagementStyle)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Timeframe:</span>
                <span className="summary-value">{getLabelById(MISSION_TIMEFRAMES, timeframe)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">First Action:</span>
                <span className="summary-value">{getLabelById(NEXT_STEP_TYPES, nextStepType)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Touchpoints:</span>
                <span className="summary-value">
                  {missionData.steps.filter(s => s.enabled).length} active steps
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Contacts:</span>
                <span className="summary-value">{selectedContactIds.length} people</span>
              </div>
              {microSequence && (
                <div className="summary-row">
                  <span className="summary-label">Sequence:</span>
                  <span className="summary-value">
                    {microSequence.steps.length}-step micro-sequence (approval-gated)
                  </span>
                </div>
              )}
            </div>

            <div className="mission-name-input">
              <label>Mission Name</label>
              <input
                type="text"
                value={missionName}
                onChange={(e) => setMissionName(e.target.value)}
                placeholder="e.g., Q1 Warm Outreach"
                className="form-input"
              />
            </div>
          </div>

          <div className="step-actions">
            <button className="btn-secondary" onClick={() => setCurrentStep(4)}>
              ← Back
            </button>
            <button
              className="btn-primary-hunter"
              onClick={handleLaunchMission}
              disabled={!canLaunch || loading}
            >
              {loading ? 'Launching...' : (
                <>
                  <Rocket className="w-5 h-5" />
                  Launch Mission
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
