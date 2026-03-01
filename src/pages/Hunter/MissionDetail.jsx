import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  ArrowLeft,
  Target,
  Users,
  Clock,
  Sparkles,
  CheckCircle,
  Circle,
  SkipForward,
  PlayCircle,
  AlertCircle,
  Loader2,
  Zap,
  Send,
  MessageSquare,
  Phone,
  Link,
  Edit2,
  Check,
  X
} from 'lucide-react';
import {
  getSequencePlan,
  getContactSequenceState,
  resolveNextAction,
  SEQUENCE_STATUS,
  STEP_OUTCOME_LABELS
} from '../../utils/sequenceEngine';
import {
  getLabelById,
  OUTCOME_GOALS,
  ENGAGEMENT_STYLES,
  MISSION_TIMEFRAMES,
  NEXT_STEP_TYPES
} from '../../constants/structuredFields';
import './MissionDetail.css';

/**
 * MISSION DETAIL PAGE (Step 5)
 *
 * Overview/command surface for a mission.
 * Shows: mission strategy, sequence plan, per-contact progress.
 *
 * This is the OVERVIEW surface, not the execution surface.
 * Execution happens in HunterContactDrawer.
 *
 * Route: /hunter/mission/:missionId
 */

const STEP_TYPE_ICONS = {
  message: Send,
  follow_up: MessageSquare,
  call: Phone,
  resource: Link,
  introduction: Users
};

const STATUS_STYLES = {
  pending: { color: '#9ca3af', label: 'Pending' },
  active: { color: '#3b82f6', label: 'Active' },
  awaiting_outcome: { color: '#f59e0b', label: 'Awaiting Outcome' },
  completed: { color: '#10b981', label: 'Completed' }
};

export default function MissionDetail() {
  const navigate = useNavigate();
  const { missionId } = useParams();
  const [mission, setMission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pending step approval
  const [expandedApprovalContactId, setExpandedApprovalContactId] = useState(null);
  const [editingStep, setEditingStep] = useState(null); // { contactId, stepIndex }
  const [editStepContent, setEditStepContent] = useState({ subject: '', body: '' });
  const [approvalSaving, setApprovalSaving] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }

    // Real-time listener for mission updates
    const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
    const unsubscribe = onSnapshot(missionRef, (snap) => {
      if (snap.exists()) {
        setMission({ id: snap.id, ...snap.data() });
      } else {
        setError('Mission not found');
      }
      setLoading(false);
    }, (err) => {
      console.error('Error loading mission:', err);
      setError('Failed to load mission');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [missionId, navigate]);

  if (loading) {
    return (
      <div className="mission-detail">
        <div className="mission-detail-loading">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          <span>Loading mission...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mission-detail">
        <div className="mission-detail-error">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p>{error}</p>
          <button className="btn-back-mission" onClick={() => navigate('/hunter')}>
            <ArrowLeft className="w-4 h-4" /> Back to Hunter
          </button>
        </div>
      </div>
    );
  }

  const plan = getSequencePlan(mission);
  const contacts = mission?.contacts || [];

  async function handleApproveStep(contactId, stepIndex) {
    setApprovalSaving(true);
    const user = auth.currentUser;
    if (!user) return;
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).map(c => {
        if (c.contactId !== contactId) return c;
        const updatedSteps = (c.personalizedSteps || []).map(s =>
          s.stepIndex === stepIndex ? { ...s, status: 'approved' } : s
        );
        const allApproved = updatedSteps.every(s => s.status === 'approved');
        return { ...c, personalizedSteps: updatedSteps, personalizationStatus: allApproved ? 'approved' : 'pending_approval' };
      });
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Error approving step:', err);
    } finally {
      setApprovalSaving(false);
      setEditingStep(null);
    }
  }

  async function handleApproveAllForContact(contactId) {
    setApprovalSaving(true);
    const user = auth.currentUser;
    if (!user) return;
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).map(c =>
        c.contactId !== contactId ? c : {
          ...c,
          personalizationStatus: 'approved',
          personalizedSteps: (c.personalizedSteps || []).map(s => ({ ...s, status: 'approved' }))
        }
      );
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
      setExpandedApprovalContactId(null);
    } catch (err) {
      console.error('Error approving all steps:', err);
    } finally {
      setApprovalSaving(false);
    }
  }

  async function handleSaveStepEdit(contactId, stepIndex) {
    setApprovalSaving(true);
    const user = auth.currentUser;
    if (!user) return;
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).map(c => {
        if (c.contactId !== contactId) return c;
        const updatedSteps = (c.personalizedSteps || []).map(s =>
          s.stepIndex === stepIndex
            ? { ...s, subject: editStepContent.subject, body: editStepContent.body, status: 'approved' }
            : s
        );
        return { ...c, personalizedSteps: updatedSteps };
      });
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
      setEditingStep(null);
    } catch (err) {
      console.error('Error saving step edit:', err);
    } finally {
      setApprovalSaving(false);
    }
  }

  return (
    <div className="mission-detail">
      {/* Header */}
      <div className="mission-detail-header">
        <button className="btn-back-mission" onClick={() => navigate('/hunter')}>
          <ArrowLeft className="w-5 h-5" />
          Back to Hunter
        </button>
        <div className="mission-detail-title-section">
          <Target className="w-6 h-6 text-purple-400" />
          <div>
            <h1 className="mission-detail-title">{mission.name || 'Untitled Mission'}</h1>
            <span className="mission-detail-status">{mission.status || 'draft'}</span>
          </div>
        </div>
      </div>

      {/* Strategy Summary */}
      <div className="mission-strategy-card">
        <h3 className="strategy-card-title">
          <Sparkles className="w-5 h-5 text-purple-400" />
          Mission Strategy
        </h3>
        <div className="strategy-grid">
          <div className="strategy-item">
            <span className="strategy-label">Outcome Goal</span>
            <span className="strategy-value">{getLabelById(OUTCOME_GOALS, mission.outcome_goal) || '—'}</span>
          </div>
          <div className="strategy-item">
            <span className="strategy-label">Style</span>
            <span className="strategy-value">{getLabelById(ENGAGEMENT_STYLES, mission.engagement_style) || '—'}</span>
          </div>
          <div className="strategy-item">
            <span className="strategy-label">Timeframe</span>
            <span className="strategy-value">{getLabelById(MISSION_TIMEFRAMES, mission.timeframe) || '—'}</span>
          </div>
          <div className="strategy-item">
            <span className="strategy-label">First Action</span>
            <span className="strategy-value">{getLabelById(NEXT_STEP_TYPES, mission.next_step_type) || '—'}</span>
          </div>
        </div>
      </div>

      {/* Sequence Plan */}
      {plan && plan.steps && (
        <div className="mission-sequence-card">
          <h3 className="sequence-card-title">
            <Zap className="w-5 h-5 text-purple-400" />
            Sequence Plan ({plan.steps.length} steps)
          </h3>
          {plan.sequenceRationale && (
            <p className="sequence-rationale">{plan.sequenceRationale}</p>
          )}
          <div className="sequence-plan-steps">
            {plan.steps.map((step, idx) => {
              const StepIcon = STEP_TYPE_ICONS[step.stepType] || Circle;
              return (
                <div key={idx} className="plan-step-row">
                  <div className="plan-step-number">{step.stepNumber || idx + 1}</div>
                  <div className="plan-step-icon">
                    <StepIcon className="w-4 h-4" />
                  </div>
                  <div className="plan-step-content">
                    <span className="plan-step-action">{step.action}</span>
                    <span className="plan-step-meta">
                      {step.channel} · {step.suggestedTiming || `Day ${step.suggestedDayOffset || 0}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Contact Progress */}
      <div className="mission-contacts-card">
        <h3 className="contacts-card-title">
          <Users className="w-5 h-5 text-purple-400" />
          Contacts ({contacts.length})
        </h3>

        {contacts.length === 0 ? (
          <p className="contacts-empty">No contacts in this mission yet.</p>
        ) : (
          <div className="contacts-progress-list">
            {contacts.map((contactEntry, idx) => {
              const state = getContactSequenceState(mission, contactEntry.contactId);
              const nextAction = resolveNextAction(mission, contactEntry.contactId);
              const seqStatus = state?.status || SEQUENCE_STATUS.PENDING;
              const statusStyle = STATUS_STYLES[seqStatus] || STATUS_STYLES.pending;
              const currentStep = state?.currentStepIndex ?? 0;
              const totalSteps = plan?.steps?.length || 0;
              const lastOutcome = state?.lastOutcome;

              return (
                <div key={contactEntry.contactId || idx} className="contact-progress-row">
                  <div className="contact-progress-info">
                    <span className="contact-progress-name">{contactEntry.name || 'Unknown'}</span>
                    {contactEntry.email && (
                      <span className="contact-progress-email">{contactEntry.email}</span>
                    )}
                  </div>

                  <div className="contact-progress-status">
                    {/* Progress dots */}
                    {plan && totalSteps > 0 && (
                      <div className="contact-mini-progress">
                        {plan.steps.map((_, stepIdx) => {
                          const historyEntry = (state?.stepHistory || []).find(h => h.stepIndex === stepIdx);
                          let dotClass = 'mini-dot-upcoming';
                          if (historyEntry?.action === 'sent') dotClass = 'mini-dot-sent';
                          else if (historyEntry?.action === 'skipped') dotClass = 'mini-dot-skipped';
                          else if (historyEntry?.action === 'approved') dotClass = 'mini-dot-approved';
                          else if (stepIdx === currentStep) dotClass = 'mini-dot-current';

                          return <div key={stepIdx} className={`mini-dot ${dotClass}`} />;
                        })}
                      </div>
                    )}

                    <span className="contact-progress-badge" style={{ color: statusStyle.color }}>
                      {statusStyle.label}
                    </span>

                    {lastOutcome && (
                      <span className="contact-last-outcome">
                        {STEP_OUTCOME_LABELS[lastOutcome] || lastOutcome}
                      </span>
                    )}
                  </div>

                  <div className="contact-progress-action">
                    {contactEntry.personalizationStatus === 'generating' && (
                      <span className="action-hint action-hint-generating">
                        <Loader2 className="w-3 h-3 animate-spin" /> Personalizing...
                      </span>
                    )}
                    {contactEntry.personalizationStatus === 'pending_approval' && (
                      <button
                        className="action-hint action-hint-approval"
                        onClick={() => setExpandedApprovalContactId(
                          expandedApprovalContactId === contactEntry.contactId ? null : contactEntry.contactId
                        )}
                      >
                        <Sparkles className="w-3 h-3" />
                        {contactEntry.personalizedSteps?.filter(s => s.status === 'pending_approval').length} steps need approval
                      </button>
                    )}
                    {contactEntry.personalizationStatus !== 'generating' && contactEntry.personalizationStatus !== 'pending_approval' && (
                      <>
                        {nextAction.action === 'needs_outcome' && (
                          <span className="action-hint action-hint-outcome">Needs outcome</span>
                        )}
                        {nextAction.action === 'propose_step' && (
                          <span className="action-hint action-hint-ready">Ready for Step {currentStep + 1}</span>
                        )}
                        {nextAction.action === 'completed' && (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        )}
                      </>
                    )}
                  </div>

                  {/* Expandable step approval panel */}
                  {expandedApprovalContactId === contactEntry.contactId && contactEntry.personalizedSteps && (
                    <div className="step-approval-panel">
                      <div className="step-approval-header">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span>Barry personalized {contactEntry.personalizedSteps.length} steps — review before sending</span>
                        <button
                          className="btn-approve-all"
                          onClick={() => handleApproveAllForContact(contactEntry.contactId)}
                          disabled={approvalSaving}
                        >
                          <Check className="w-3 h-3" /> Approve All
                        </button>
                      </div>
                      {contactEntry.personalizedSteps.map((step) => (
                        <div
                          key={step.stepIndex}
                          className={`approval-step-card ${step.status === 'approved' ? 'approved' : ''}`}
                        >
                          <div className="approval-step-meta">
                            <span className="approval-step-num">Step {step.stepNumber}</span>
                            <span className="approval-step-channel">{step.channel}</span>
                            {step.status === 'approved' && (
                              <span className="approval-step-approved"><Check className="w-3 h-3" /> Approved</span>
                            )}
                          </div>

                          {editingStep?.contactId === contactEntry.contactId && editingStep?.stepIndex === step.stepIndex ? (
                            <div className="approval-step-editor">
                              {step.channel === 'email' && (
                                <input
                                  type="text"
                                  className="approval-edit-input"
                                  value={editStepContent.subject}
                                  onChange={e => setEditStepContent(p => ({ ...p, subject: e.target.value }))}
                                  placeholder="Subject line"
                                />
                              )}
                              <textarea
                                className="approval-edit-textarea"
                                value={editStepContent.body}
                                onChange={e => setEditStepContent(p => ({ ...p, body: e.target.value }))}
                                rows={4}
                              />
                              <div className="approval-edit-actions">
                                <button className="btn-secondary btn-xs" onClick={() => setEditingStep(null)}>Cancel</button>
                                <button
                                  className="btn-primary-hunter btn-xs"
                                  onClick={() => handleSaveStepEdit(contactEntry.contactId, step.stepIndex)}
                                  disabled={approvalSaving}
                                >
                                  Save & Approve
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {step.subject && <p className="approval-step-subject">Subject: {step.subject}</p>}
                              <p className="approval-step-body">{step.body}</p>
                              {step.toneNote && <p className="approval-step-tone"><Sparkles className="w-3 h-3" />{step.toneNote}</p>}
                              {step.status !== 'approved' && (
                                <div className="approval-step-actions">
                                  <button
                                    className="btn-edit-step"
                                    onClick={() => {
                                      setEditingStep({ contactId: contactEntry.contactId, stepIndex: step.stepIndex });
                                      setEditStepContent({ subject: step.subject || '', body: step.body || '' });
                                    }}
                                  >
                                    <Edit2 className="w-3 h-3" /> Edit
                                  </button>
                                  <button
                                    className="btn-approve-step"
                                    onClick={() => handleApproveStep(contactEntry.contactId, step.stepIndex)}
                                    disabled={approvalSaving}
                                  >
                                    <Check className="w-3 h-3" /> Approve
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Expected Outcome */}
      {plan?.expectedOutcome && (
        <div className="mission-expected-outcome">
          <Target className="w-4 h-4 text-purple-400" />
          <span><strong>Expected Outcome:</strong> {plan.expectedOutcome}</span>
        </div>
      )}
    </div>
  );
}
