/**
 * NEXT BEST STEP
 *
 * Operation People First — Missions are dead. Long live Next Best Step.
 *
 * Barry proposes a contextual next action after every engagement.
 * User confirms. It logs. The app pulls them back at the right time.
 *
 * This is not a game. This is not a mission. It is the obvious next
 * move in a real relationship — surfaced automatically so the user
 * never has to hold relationship state in their head.
 *
 * Barry proposes. User confirms. Relationship compounds.
 */

import { useState, useEffect } from 'react';
import {
  Clock, RefreshCw, Users, ChevronDown, MessageSquare,
  CheckCircle, ArrowRight, Zap, X, Calendar,
  TrendingUp, AlertCircle, ThumbsDown
} from 'lucide-react';
import {
  collection, query, orderBy, limit, getDocs,
  doc, updateDoc, addDoc, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import './NextBestStep.css';

// ── Step Types ───────────────────────────────────────────

const STEP_TYPES = {
  follow_up: {
    id: 'follow_up',
    icon: Clock,
    label: 'Follow Up',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.25)'
  },
  try_new_channel: {
    id: 'try_new_channel',
    icon: RefreshCw,
    label: 'Try Different Channel',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.08)',
    borderColor: 'rgba(59, 130, 246, 0.25)'
  },
  referral_opportunity: {
    id: 'referral_opportunity',
    icon: Users,
    label: 'Referral Opportunity',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)'
  },
  low_touch: {
    id: 'low_touch',
    icon: TrendingUp,
    label: 'Move to Low-Touch',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.08)',
    borderColor: 'rgba(139, 92, 246, 0.25)'
  },
  accelerate: {
    id: 'accelerate',
    icon: Zap,
    label: 'Accelerate',
    color: '#7c3aed',
    bgColor: 'rgba(124, 58, 237, 0.08)',
    borderColor: 'rgba(124, 58, 237, 0.25)'
  },
  schedule_meeting: {
    id: 'schedule_meeting',
    icon: Calendar,
    label: 'Schedule Meeting',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.08)',
    borderColor: 'rgba(6, 182, 212, 0.25)'
  }
};

// Follow-up timing options
const FOLLOWUP_TIMINGS = [
  { id: '2d', label: '2 days', days: 2 },
  { id: '3d', label: '3 days', days: 3 },
  { id: '1w', label: '1 week', days: 7 },
  { id: '2w', label: '2 weeks', days: 14 },
  { id: '1m', label: '1 month', days: 30 }
];

// ── Derive proposal from engagement history ───────────────

function deriveNextBestStep(contact, events) {
  const sentEvents = events.filter(e => e.type === 'message_sent');
  const lastSent = sentEvents[0];
  const daysSinceLastSent = lastSent?.timestamp
    ? (Date.now() - (lastSent.timestamp.toDate
        ? lastSent.timestamp.toDate()
        : new Date(lastSent.timestamp)).getTime()) / (1000 * 60 * 60 * 24)
    : null;

  const contactStatus = contact?.contact_status || contact?.lead_status;

  // No engagement yet — suggest starting
  if (sentEvents.length === 0) return null;

  // They replied — accelerate
  if (contactStatus === 'replied' || contactStatus === 'engaged') {
    return {
      type: 'accelerate',
      message: `${contact?.firstName || 'They'} replied — this is momentum. Keep it going.`,
      suggestion: 'Book a call or send a value-led follow-up while the door is open.',
      timing: null
    };
  }

  // Multiple sends, no reply — try a new channel
  if (sentEvents.length >= 2 && daysSinceLastSent > 5) {
    const channels = sentEvents.map(e => e.metadata?.channel).filter(Boolean);
    const uniqueChannels = [...new Set(channels)];
    if (uniqueChannels.length === 1) {
      return {
        type: 'try_new_channel',
        message: `${sentEvents.length} messages via ${uniqueChannels[0]} — no response yet.`,
        suggestion: 'Switch channels. The right message in the wrong place gets ignored.',
        timing: null
      };
    }
  }

  // Single send, awaiting reply
  if (sentEvents.length === 1 && daysSinceLastSent > 3) {
    return {
      type: 'follow_up',
      message: `Sent ${Math.round(daysSinceLastSent)} days ago — no reply yet.`,
      suggestion: `Barry recommends a warm follow-up. Want him to draft it?`,
      timing: '3d'
    };
  }

  // Many attempts, consider low-touch
  if (sentEvents.length >= 3 && daysSinceLastSent > 10) {
    return {
      type: 'low_touch',
      message: `${sentEvents.length} attempts — no response in ${Math.round(daysSinceLastSent)} days.`,
      suggestion: `Is this still a priority? Move to low-touch and check back in a month.`,
      timing: '1m'
    };
  }

  // Standard follow-up if recent send
  if (daysSinceLastSent !== null && daysSinceLastSent > 2) {
    return {
      type: 'follow_up',
      message: `Last contacted ${Math.round(daysSinceLastSent)} day${daysSinceLastSent >= 2 ? 's' : ''} ago.`,
      suggestion: 'Time for a follow-up. Barry will draft it with full context loaded.',
      timing: '2d'
    };
  }

  return null;
}

// ── Component ────────────────────────────────────────────

export default function NextBestStep({ contact, onEngageClick, onStepConfirmed }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selectedTiming, setSelectedTiming] = useState(null);
  const [activeStep, setActiveStep] = useState(null); // existing queued step

  useEffect(() => {
    if (contact?.id) loadData();
  }, [contact?.id]);

  async function loadData() {
    const user = auth.currentUser;
    if (!user || !contact?.id) {
      setLoading(false);
      return;
    }

    try {
      // Load recent timeline events
      const timelineRef = collection(db, 'users', user.uid, 'contacts', contact.id, 'timeline');
      const q = query(timelineRef, orderBy('timestamp', 'desc'), limit(15));
      const snap = await getDocs(q);
      const evts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEvents(evts);

      // Check for existing queued next step
      const queuedStep = evts.find(e => e.type === 'next_step_queued' && e.metadata?.status !== 'completed');
      if (queuedStep) {
        setActiveStep(queuedStep);
        setLoading(false);
        return;
      }

      // Derive proposal from events
      const derived = deriveNextBestStep(contact, evts);
      setProposal(derived);
      if (derived?.timing) {
        setSelectedTiming(derived.timing);
      }
    } catch (err) {
      console.error('[NextBestStep] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    const user = auth.currentUser;
    if (!user || !contact?.id || !proposal) return;

    try {
      setConfirming(true);

      // Calculate due date
      let dueDate = null;
      const timing = FOLLOWUP_TIMINGS.find(t => t.id === selectedTiming);
      if (timing) {
        const due = new Date();
        due.setDate(due.getDate() + timing.days);
        dueDate = due.toISOString();
      }

      // Log to timeline
      await logTimelineEvent(user.uid, contact.id, {
        type: 'next_step_queued',
        actor: ACTORS.BARRY,
        preview: proposal.suggestion,
        metadata: {
          stepType: proposal.type,
          stepLabel: STEP_TYPES[proposal.type]?.label || proposal.type,
          dueDate,
          timing: selectedTiming,
          message: proposal.message,
          status: 'pending'
        }
      });

      // Update contact with next_step_due
      if (dueDate) {
        const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
        await updateDoc(contactRef, {
          next_step_due: dueDate,
          next_step_type: proposal.type,
          updated_at: new Date().toISOString()
        });
      }

      setConfirmed(true);
      setConfirming(false);

      if (onStepConfirmed) {
        onStepConfirmed({
          type: proposal.type,
          dueDate,
          message: proposal.message
        });
      }

      // If the step involves engagement, open Barry
      if (['follow_up', 'try_new_channel', 'accelerate', 'schedule_meeting'].includes(proposal.type)) {
        setTimeout(() => {
          if (onEngageClick) onEngageClick();
        }, 800);
      }

    } catch (err) {
      console.error('[NextBestStep] Failed to confirm step:', err);
      setConfirming(false);
    }
  }

  // ── Render: loading ──

  if (loading) return null;

  // ── Render: dismissed ──

  if (dismissed) return null;

  // ── Render: active queued step ──

  if (activeStep && !confirmed) {
    const stepConfig = STEP_TYPES[activeStep.metadata?.stepType] || STEP_TYPES.follow_up;
    const StepIcon = stepConfig.icon;
    const dueDate = activeStep.metadata?.dueDate
      ? new Date(activeStep.metadata.dueDate)
      : null;
    const isOverdue = dueDate && dueDate < new Date();

    return (
      <div
        className="nbs-container nbs-active"
        style={{
          '--nbs-color': stepConfig.color,
          '--nbs-bg': stepConfig.bgColor,
          '--nbs-border': stepConfig.borderColor
        }}
      >
        <div className="nbs-header">
          <div className="nbs-header-left">
            <span className="nbs-barry-badge">Barry</span>
            <span className="nbs-header-title">Next Step Queued</span>
          </div>
          {isOverdue && (
            <span className="nbs-overdue-tag">Overdue</span>
          )}
        </div>

        <div className="nbs-active-step">
          <div className="nbs-active-icon-wrap">
            <StepIcon className="nbs-active-icon" />
          </div>
          <div className="nbs-active-content">
            <span className="nbs-active-label">{stepConfig.label}</span>
            <p className="nbs-active-preview">{activeStep.metadata?.message || activeStep.preview}</p>
            {dueDate && (
              <span className={`nbs-active-due ${isOverdue ? 'nbs-due-overdue' : ''}`}>
                <Clock className="w-3 h-3" />
                {isOverdue ? 'Was due' : 'Due'} {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        <div className="nbs-active-actions">
          <button
            className="nbs-act-btn nbs-act-primary"
            onClick={() => onEngageClick && onEngageClick()}
          >
            <Zap className="w-4 h-4" />
            Open with Barry
            <ArrowRight className="w-3 h-3" />
          </button>
          <button
            className="nbs-act-btn nbs-act-secondary"
            onClick={() => setActiveStep(null)}
          >
            View Proposal
          </button>
        </div>
      </div>
    );
  }

  // ── Render: confirmed ──

  if (confirmed) {
    return (
      <div className="nbs-container nbs-confirmed">
        <div className="nbs-confirmed-inner">
          <CheckCircle className="nbs-confirmed-icon" />
          <div className="nbs-confirmed-text">
            <span className="nbs-confirmed-title">Next step queued</span>
            <span className="nbs-confirmed-sub">
              Barry will have full context ready when you return.
            </span>
          </div>
          {['follow_up', 'try_new_channel', 'accelerate'].includes(proposal?.type) && (
            <button
              className="nbs-act-btn nbs-act-primary nbs-act-sm"
              onClick={() => onEngageClick && onEngageClick()}
            >
              Engage Now
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Render: no proposal ──

  if (!proposal) return null;

  const stepConfig = STEP_TYPES[proposal.type] || STEP_TYPES.follow_up;
  const StepIcon = stepConfig.icon;

  return (
    <div
      className="nbs-container"
      style={{
        '--nbs-color': stepConfig.color,
        '--nbs-bg': stepConfig.bgColor,
        '--nbs-border': stepConfig.borderColor
      }}
    >
      {/* Header */}
      <div className="nbs-header">
        <div className="nbs-header-left">
          <span className="nbs-barry-badge">Barry</span>
          <span className="nbs-header-title">Next Best Step</span>
        </div>
        <button
          className="nbs-dismiss-btn"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Proposal body */}
      <div className="nbs-proposal">
        <div className="nbs-proposal-type">
          <div className="nbs-type-icon-wrap">
            <StepIcon className="nbs-type-icon" />
          </div>
          <span className="nbs-type-label">{stepConfig.label}</span>
        </div>

        <p className="nbs-proposal-message">{proposal.message}</p>
        <p className="nbs-proposal-suggestion">{proposal.suggestion}</p>
      </div>

      {/* Timing selector for follow-ups */}
      {(proposal.type === 'follow_up' || proposal.type === 'low_touch') && (
        <div className="nbs-timing">
          <span className="nbs-timing-label">Follow up in</span>
          <div className="nbs-timing-options">
            {FOLLOWUP_TIMINGS.map(t => (
              <button
                key={t.id}
                className={`nbs-timing-btn ${selectedTiming === t.id ? 'nbs-timing-active' : ''}`}
                onClick={() => setSelectedTiming(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="nbs-actions">
        <button
          className="nbs-act-btn nbs-act-primary"
          onClick={handleConfirm}
          disabled={confirming}
        >
          {confirming ? (
            <>
              <Clock className="w-4 h-4 nbs-spin" />
              Confirming...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              {proposal.type === 'follow_up' || proposal.type === 'low_touch'
                ? `Queue for ${FOLLOWUP_TIMINGS.find(t => t.id === selectedTiming)?.label || 'later'}`
                : 'Confirm & Open Barry'}
              <ArrowRight className="w-3 h-3" />
            </>
          )}
        </button>

        {(proposal.type === 'follow_up' || proposal.type === 'try_new_channel') && (
          <button
            className="nbs-act-btn nbs-act-secondary"
            onClick={() => onEngageClick && onEngageClick()}
          >
            <Zap className="w-4 h-4" />
            Engage Now Instead
          </button>
        )}

        <button
          className="nbs-act-btn nbs-act-dismiss"
          onClick={() => setDismissed(true)}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
          Not now
        </button>
      </div>
    </div>
  );
}
