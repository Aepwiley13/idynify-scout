import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc, collection, getDocs } from 'firebase/firestore';
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
  X,
  Plus,
  Search,
  Pause,
  Trash2,
  Flag,
  Reply
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

  // Task 3.2: Add/remove contacts from live mission
  const [showAddModal, setShowAddModal] = useState(false);
  const [allContacts, setAllContacts] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [addingContactId, setAddingContactId] = useState(null);
  const [contactSaving, setContactSaving] = useState(null); // contactId being pause/remove/converted

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

  // ── Task 3.2: Load all user contacts for the add-contact modal ─────────────
  async function loadAllContacts() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      setAllContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('[MissionDetail] loadAllContacts error:', err);
    }
  }

  // Add a contact to the mission + fire Barry personalization
  async function handleAddContact(contact) {
    const user = auth.currentUser;
    if (!user || addingContactId) return;
    setAddingContactId(contact.id);
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;

      const existing = snap.data().contacts || [];
      if (existing.some(c => c.contactId === contact.id)) {
        setAddingContactId(null);
        return; // already in mission
      }

      const newEntry = {
        contactId: contact.id,
        name: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        email: contact.email || null,
        phone: contact.phone || null,
        currentStepIndex: 0,
        lastTouchDate: null,
        status: 'active',
        sequenceStatus: 'pending',
        stepHistory: [],
        lastOutcome: null,
        personalizationStatus: 'generating',
        personalizedSteps: null,
        addedAt: new Date().toISOString(),
      };

      await updateDoc(missionRef, {
        contacts: [...existing, newEntry],
        updatedAt: new Date().toISOString(),
      });

      // Fire Barry personalization in background (non-blocking)
      const mission = snap.data();
      const stepsToGenerate = (mission.sequence?.steps || []).map((s, idx) => ({
        stepIndex: idx,
        stepNumber: idx + 1,
        channel: s.channel || 'email',
        action: s.action || '',
        suggestedTiming: s.suggestedTiming || '',
      }));
      if (stepsToGenerate.length > 0) {
        const authToken = await user.getIdToken();
        fetch('/.netlify/functions/barryGenerateSequenceStep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            missionId,
            contactId: contact.id,
            steps: stepsToGenerate,
          }),
        }).catch(err => console.warn('[MissionDetail] personalization fire-and-forget error:', err));
      }

      setShowAddModal(false);
      setContactSearch('');
    } catch (err) {
      console.error('[MissionDetail] handleAddContact error:', err);
    } finally {
      setAddingContactId(null);
    }
  }

  // Remove a contact from the mission
  async function handleRemoveContact(contactId) {
    const user = auth.currentUser;
    if (!user || contactSaving) return;
    setContactSaving(contactId);
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).filter(c => c.contactId !== contactId);
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[MissionDetail] handleRemoveContact error:', err);
    } finally {
      setContactSaving(null);
    }
  }

  // Pause/unpause a contact in the mission
  async function handleTogglePauseContact(contactId, currentStatus) {
    const user = auth.currentUser;
    if (!user || contactSaving) return;
    setContactSaving(contactId);
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).map(c =>
        c.contactId !== contactId ? c : { ...c, status: currentStatus === 'paused' ? 'active' : 'paused' }
      );
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[MissionDetail] handleTogglePauseContact error:', err);
    } finally {
      setContactSaving(null);
    }
  }

  // Mark contact as converted
  async function handleMarkConverted(contactId) {
    const user = auth.currentUser;
    if (!user || contactSaving) return;
    setContactSaving(contactId);
    try {
      const missionRef = doc(db, 'users', user.uid, 'missions', missionId);
      const snap = await getDoc(missionRef);
      if (!snap.exists()) return;
      const updatedContacts = (snap.data().contacts || []).map(c =>
        c.contactId !== contactId ? c : { ...c, sequenceStatus: 'completed', status: 'converted', lastOutcome: 'converted' }
      );
      await updateDoc(missionRef, { contacts: updatedContacts, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[MissionDetail] handleMarkConverted error:', err);
    } finally {
      setContactSaving(null);
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

      {/* Contact Progress — Task 3.1: Step progress grid */}
      <div className="mission-contacts-card">
        <div className="contacts-card-header">
          <h3 className="contacts-card-title">
            <Users className="w-5 h-5 text-purple-400" />
            Contacts ({contacts.length})
          </h3>
          {/* Task 3.2: Add Contact button */}
          <button
            className="btn-add-contact"
            onClick={() => { setShowAddModal(true); loadAllContacts(); }}
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        </div>

        {contacts.length === 0 ? (
          <p className="contacts-empty">No contacts in this mission yet. Add one above.</p>
        ) : (
          <>
            {/* ── Step Progress Grid ─────────────────────────────────────── */}
            {plan && plan.steps && plan.steps.length > 0 && (
              <div className="step-grid-container">
                <table className="step-grid">
                  <thead>
                    <tr>
                      <th className="step-grid-th step-grid-th-contact">Contact</th>
                      {plan.steps.map((step, idx) => (
                        <th key={idx} className="step-grid-th step-grid-th-step">
                          <div className="step-grid-header-cell">
                            <span className="step-grid-num">{idx + 1}</span>
                            <span className="step-grid-channel">{step.channel || 'email'}</span>
                          </div>
                        </th>
                      ))}
                      <th className="step-grid-th step-grid-th-status">Status</th>
                      <th className="step-grid-th step-grid-th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((contactEntry, rowIdx) => {
                      const stepHistory = contactEntry.stepHistory || [];
                      const seqStatus = contactEntry.sequenceStatus || 'pending';
                      const isPaused = contactEntry.status === 'paused';
                      const isConverted = contactEntry.status === 'converted';
                      const hasReplied = contactEntry.replyStatus === 'replied';
                      const isSaving = contactSaving === contactEntry.contactId;

                      // Derive cell state for each step
                      function getCellState(stepIdx) {
                        if (contactEntry.personalizationStatus === 'generating') return 'generating';
                        if (contactEntry.personalizationStatus === 'pending_approval') {
                          const step = contactEntry.personalizedSteps?.find(s => s.stepIndex === stepIdx);
                          if (step) return step.status === 'approved' ? 'approved' : 'pending_approval';
                        }
                        const histEntry = stepHistory.find(h => h.stepIndex === stepIdx);
                        if (!histEntry) {
                          const currentIdx = contactEntry.currentStepIndex ?? 0;
                          return stepIdx === currentIdx ? 'current' : 'upcoming';
                        }
                        if (histEntry.action === 'sent') return hasReplied && stepIdx === stepHistory.length - 1 ? 'replied' : 'sent';
                        if (histEntry.action === 'skipped') return 'skipped';
                        if (histEntry.action === 'approved') return 'approved';
                        return 'upcoming';
                      }

                      const CELL_CONFIGS = {
                        generating:       { icon: <Loader2 className="w-3 h-3 animate-spin" />, title: 'Personalizing...', cls: 'step-cell--generating' },
                        pending_approval: { icon: <Sparkles className="w-3 h-3" />,             title: 'Needs approval',   cls: 'step-cell--approval' },
                        approved:         { icon: <Check className="w-3 h-3" />,                title: 'Approved',         cls: 'step-cell--approved' },
                        sent:             { icon: <Send className="w-3 h-3" />,                 title: 'Sent',             cls: 'step-cell--sent' },
                        replied:          { icon: <Reply className="w-3 h-3" />,                title: 'Replied',          cls: 'step-cell--replied' },
                        skipped:          { icon: <SkipForward className="w-3 h-3" />,          title: 'Skipped',          cls: 'step-cell--skipped' },
                        current:          { icon: <Circle className="w-3 h-3" />,               title: 'Current step',     cls: 'step-cell--current' },
                        upcoming:         { icon: null,                                          title: 'Pending',          cls: 'step-cell--upcoming' },
                      };

                      return (
                        <>
                          <tr key={contactEntry.contactId || rowIdx} className={`step-grid-row ${isPaused ? 'step-grid-row--paused' : ''}`}>
                            <td className="step-grid-td step-grid-td-contact">
                              <div className="grid-contact-name">
                                {contactEntry.name || 'Unknown'}
                                {isPaused && <span className="grid-paused-badge">Paused</span>}
                                {isConverted && <span className="grid-converted-badge">Converted</span>}
                                {hasReplied && <span className="grid-replied-badge">Replied</span>}
                              </div>
                              {contactEntry.email && (
                                <div className="grid-contact-email">{contactEntry.email}</div>
                              )}
                            </td>

                            {plan.steps.map((_, stepIdx) => {
                              const cellState = getCellState(stepIdx);
                              const cfg = CELL_CONFIGS[cellState] || CELL_CONFIGS.upcoming;
                              return (
                                <td key={stepIdx} className="step-grid-td step-grid-td-step">
                                  <div className={`step-cell ${cfg.cls}`} title={cfg.title}>
                                    {cfg.icon}
                                  </div>
                                </td>
                              );
                            })}

                            <td className="step-grid-td step-grid-td-status">
                              {contactEntry.personalizationStatus === 'generating' && (
                                <span className="action-hint action-hint-generating">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Personalizing...
                                </span>
                              )}
                              {contactEntry.personalizationStatus === 'pending_approval' && (
                                <button
                                  className="action-hint action-hint-approval"
                                  onClick={() => {
                                    const closing = expandedApprovalContactId === contactEntry.contactId;
                                    setExpandedApprovalContactId(closing ? null : contactEntry.contactId);
                                    if (closing) setEditingStep(null);
                                  }}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  {contactEntry.personalizedSteps?.filter(s => s.status === 'pending_approval').length ?? 0} steps
                                </button>
                              )}
                              {contactEntry.personalizationStatus !== 'generating' && contactEntry.personalizationStatus !== 'pending_approval' && (
                                <span className="grid-status-badge" style={{ color: STATUS_STYLES[seqStatus]?.color || '#9ca3af' }}>
                                  {STATUS_STYLES[seqStatus]?.label || seqStatus}
                                </span>
                              )}
                            </td>

                            {/* Task 3.2: Per-contact controls */}
                            <td className="step-grid-td step-grid-td-controls">
                              <div className="contact-controls">
                                <button
                                  className="contact-ctrl-btn"
                                  title={isPaused ? 'Resume' : 'Pause'}
                                  disabled={isSaving || isConverted}
                                  onClick={() => handleTogglePauseContact(contactEntry.contactId, contactEntry.status)}
                                >
                                  <Pause className="w-3 h-3" />
                                </button>
                                <button
                                  className="contact-ctrl-btn"
                                  title="Mark converted"
                                  disabled={isSaving || isConverted}
                                  onClick={() => handleMarkConverted(contactEntry.contactId)}
                                >
                                  <Flag className="w-3 h-3" />
                                </button>
                                <button
                                  className="contact-ctrl-btn contact-ctrl-btn--danger"
                                  title="Remove from mission"
                                  disabled={isSaving}
                                  onClick={() => handleRemoveContact(contactEntry.contactId)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expandable step approval panel */}
                          {expandedApprovalContactId === contactEntry.contactId && contactEntry.personalizedSteps && (
                            <tr key={`approval-${contactEntry.contactId}`}>
                              <td colSpan={plan.steps.length + 3} style={{ padding: 0 }}>
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
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fallback for missions with no sequence plan (just show rows) */}
            {(!plan || !plan.steps || plan.steps.length === 0) && (
              <div className="contacts-progress-list">
                {contacts.map((contactEntry, idx) => (
                  <div key={contactEntry.contactId || idx} className="contact-progress-row">
                    <span className="contact-progress-name">{contactEntry.name || 'Unknown'}</span>
                    <span className="contact-progress-badge" style={{ color: '#9ca3af' }}>
                      {contactEntry.sequenceStatus || 'pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Task 3.2: Add Contact Modal */}
      {showAddModal && (
        <div className="add-contact-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="add-contact-modal" onClick={e => e.stopPropagation()}>
            <div className="add-contact-modal-header">
              <h3><Plus className="w-5 h-5" /> Add Contact to Mission</h3>
              <button className="btn-modal-close" onClick={() => setShowAddModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="add-contact-modal-sub">
              Barry will generate personalized steps for this contact. You'll approve before anything sends.
            </p>
            <div className="add-contact-search">
              <Search className="w-4 h-4" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="add-contact-list">
              {allContacts
                .filter(c => {
                  const alreadyIn = contacts.some(mc => mc.contactId === c.id);
                  if (alreadyIn) return false;
                  const q = contactSearch.toLowerCase();
                  if (!q) return true;
                  const name = (c.name || `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase();
                  return name.includes(q) || (c.email || '').toLowerCase().includes(q);
                })
                .slice(0, 20)
                .map(c => {
                  const name = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
                  const isAdding = addingContactId === c.id;
                  return (
                    <button
                      key={c.id}
                      className="add-contact-row"
                      onClick={() => handleAddContact(c)}
                      disabled={!!addingContactId}
                    >
                      <div className="add-contact-avatar">
                        {name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'}
                      </div>
                      <div className="add-contact-info">
                        <span className="add-contact-name">{name}</span>
                        {c.email && <span className="add-contact-email">{c.email}</span>}
                        {c.title && <span className="add-contact-title">{c.title}</span>}
                      </div>
                      {isAdding ? (
                        <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                      ) : (
                        <Plus className="w-4 h-4 text-purple-400" />
                      )}
                    </button>
                  );
                })}
              {allContacts.filter(c => !contacts.some(mc => mc.contactId === c.id)).length === 0 && (
                <p className="add-contact-empty">All your contacts are already in this mission.</p>
              )}
            </div>
          </div>
        </div>
      )}

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
