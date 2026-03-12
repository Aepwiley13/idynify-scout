/**
 * PERSISTENT ENGAGE BAR
 *
 * Operation People First — Squad Beta deliverable.
 *
 * This kills the pop-up. Engagement is now a permanent, stateful presence
 * at the top of every contact profile — always visible, always resumable.
 *
 * Design principles:
 * — Shows the complete current engagement state at a glance
 * — Context is loaded before the user clicks anything
 * — Zero dead ends: channel blocked → pivot inline, no reset
 * — Every action is one click from this bar
 */

import { useState, useEffect } from 'react';
import {
  Zap, Mail, Phone, Linkedin, MessageSquare, Calendar,
  Clock, CheckCircle, AlertCircle, ArrowRight, ChevronDown,
  ChevronUp, RefreshCw, Send, Target, Loader, Reply
} from 'lucide-react';
import { collection, query, orderBy, limit, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS } from '../../utils/contactStateMachine';
import { updateContactMemory } from '../../services/barryMemoryService';
import './PersistentEngageBar.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// ── Engagement state derived from timeline ───────────────

// Zero-state sub-state derivation.
// Returns the right sublabel and CTA text based on whether Barry has context.
// See src/schemas/engagementSchema.js ZERO_STATE_BEHAVIOR for the full spec.
function getZeroStateConfig(contact) {
  const barryContext = contact?.barryContext;
  const firstName = contact?.firstName || contact?.name?.split(' ')[0] || 'this contact';

  if (barryContext?.suggestedFirstMove) {
    // Sub-state A: Barry has a specific suggestion
    const suggestion = barryContext.suggestedFirstMove.length > 80
      ? barryContext.suggestedFirstMove.slice(0, 77) + '...'
      : barryContext.suggestedFirstMove;
    return {
      sublabel: suggestion,
      cta: "Start with Barry's Suggestion",
      ctaColor: '#7c3aed',
      analyzing: false
    };
  }

  if (barryContext) {
    // Sub-state B: Barry has context but no specific suggestion yet
    return {
      sublabel: `Barry knows who ${firstName} is — ready when you are`,
      cta: 'Start Engagement',
      ctaColor: '#7c3aed',
      analyzing: false
    };
  }

  // Sub-state C: Barry is still generating context
  return {
    sublabel: 'Barry is analyzing this contact...',
    cta: 'Start Engagement',
    ctaColor: '#9ca3af',
    analyzing: true
  };
}

const ENGAGE_STATES = {
  not_started: {
    label: 'Not Started',
    sublabel: 'Barry is ready to engage', // overridden at render time by getZeroStateConfig()
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.08)',
    borderColor: 'rgba(107, 114, 128, 0.2)',
    icon: Target,
    cta: 'Start Engagement',             // overridden at render time by getZeroStateConfig()
    ctaColor: '#7c3aed'                  // overridden at render time by getZeroStateConfig()
  },
  in_progress: {
    label: 'In Progress',
    sublabel: 'Engagement active — Barry has context loaded',
    color: '#7c3aed',
    bgColor: 'rgba(124, 58, 237, 0.06)',
    borderColor: 'rgba(124, 58, 237, 0.25)',
    icon: Zap,
    cta: 'Continue',
    ctaColor: '#7c3aed'
  },
  awaiting_reply: {
    label: 'Awaiting Reply',
    sublabel: 'Message sent — waiting for response',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.06)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
    icon: Clock,
    cta: 'Follow Up',
    ctaColor: '#d97706'
  },
  follow_up_due: {
    label: 'Follow-Up Due',
    sublabel: "Barry flagged this — time to reconnect",
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.06)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
    icon: AlertCircle,
    cta: 'Follow Up Now',
    ctaColor: '#dc2626'
  },
  converted: {
    label: 'Converted',
    sublabel: 'Relationship active — use Barry to maintain it',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.06)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    icon: CheckCircle,
    cta: 'Engage',
    ctaColor: '#059669'
  }
};

const CHANNELS = [
  { id: 'email', icon: Mail, label: 'Email', field: 'email', altField: 'work_email' },
  { id: 'phone', icon: Phone, label: 'Call', field: 'phone_mobile', altField: 'phone_direct' },
  { id: 'linkedin', icon: Linkedin, label: 'LinkedIn', field: 'linkedin_url', altField: null },
  { id: 'text', icon: MessageSquare, label: 'Text', field: 'phone_mobile', altField: 'phone' },
  { id: 'calendar', icon: Calendar, label: 'Meeting', field: null, altField: null }
];

function getChannelAvailability(contact, channelId) {
  const ch = CHANNELS.find(c => c.id === channelId);
  if (!ch) return 'unavailable';
  if (!ch.field) return 'available'; // calendar always available
  const has = !!(contact[ch.field] || (ch.altField && contact[ch.altField]));
  return has ? 'available' : 'unavailable';
}

function deriveEngageState(contact, lastEvents) {
  const status = contact.contact_status || contact.lead_status || contact.status;

  if (status === 'converted' || status === 'customer') return 'converted';

  if (!lastEvents || lastEvents.length === 0) return 'not_started';

  const lastSent = lastEvents.find(e => e.type === 'message_sent');
  const lastGenerated = lastEvents.find(e => e.type === 'message_generated');
  const nextStepQueued = lastEvents.find(e => e.type === 'next_step_queued');

  // Check if follow-up is overdue
  if (nextStepQueued && nextStepQueued.metadata?.dueDate) {
    const due = new Date(nextStepQueued.metadata.dueDate);
    if (due < new Date()) return 'follow_up_due';
  }

  if (contact.next_step_due) {
    const due = new Date(contact.next_step_due);
    if (due < new Date()) return 'follow_up_due';
  }

  if (lastSent) {
    // Check if they replied (contact status)
    if (status === 'replied' || status === 'meeting_booked') return 'in_progress';

    // Check if message was sent > 7 days ago with no reply
    const sentDate = lastSent.timestamp?.toDate
      ? lastSent.timestamp.toDate()
      : new Date(lastSent.timestamp);
    const daysSince = (Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) return 'follow_up_due';

    return 'awaiting_reply';
  }

  if (lastGenerated) return 'in_progress';

  return 'not_started';
}

function formatLastActivity(events) {
  if (!events || events.length === 0) return null;
  const last = events[0];
  if (!last.timestamp) return null;

  const date = last.timestamp.toDate ? last.timestamp.toDate() : new Date(last.timestamp);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getLastEventLabel(events) {
  if (!events || events.length === 0) return null;
  const last = events[0];
  const labels = {
    message_sent: 'Message sent',
    message_generated: 'Barry generated messages',
    next_step_queued: 'Next step queued',
    sequence_step_sent: 'Step sent',
    contact_status_changed: 'Status updated'
  };
  return labels[last.type] || null;
}

// ── Component ────────────────────────────────────────────

const REPLY_CHANNELS = [
  { id: 'text', icon: MessageSquare, label: 'Text / SMS' },
  { id: 'email', icon: Mail, label: 'Email' },
  { id: 'phone', icon: Phone, label: 'Phone Call' },
  { id: 'linkedin', icon: Linkedin, label: 'LinkedIn' },
  { id: 'other', icon: RefreshCw, label: 'Other' }
];

export default function PersistentEngageBar({ contact, onEngageClick }) {
  const [engageState, setEngageState] = useState('not_started');
  const [lastEvents, setLastEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [messageCount, setMessageCount] = useState(0);

  // Log external reply state (they replied to us)
  const [showLogReply, setShowLogReply] = useState(false);
  const [replyChannel, setReplyChannel] = useState(null);
  const [replyNote, setReplyNote] = useState('');
  const [loggingReply, setLoggingReply] = useState(false);
  const [replyLogged, setReplyLogged] = useState(false);

  // Brief Barry state (I reached out, mark done + save context)
  const [showBriefBarry, setShowBriefBarry] = useState(false);
  const [briefChannel, setBriefChannel] = useState(null);
  const [briefContext, setBriefContext] = useState('');
  const [briefingSaving, setBriefingSaving] = useState(false);
  const [briefSaved, setBriefSaved] = useState(false);

  useEffect(() => {
    if (contact?.id) {
      loadEngagementState();
    }
  }, [contact?.id]);

  async function loadEngagementState() {
    const user = getEffectiveUser();
    if (!user || !contact?.id) {
      setLoading(false);
      return;
    }

    try {
      const timelineRef = collection(
        db, 'users', user.uid, 'contacts', contact.id, 'timeline'
      );
      const q = query(timelineRef, orderBy('timestamp', 'desc'), limit(10));
      const snap = await getDocs(q);
      const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLastEvents(events);

      const sentCount = events.filter(e => e.type === 'message_sent').length;
      setMessageCount(sentCount);

      const state = deriveEngageState(contact, events);
      setEngageState(state);
    } catch (err) {
      console.error('[PersistentEngageBar] Failed to load timeline:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogReply() {
    const user = getEffectiveUser();
    if (!user || !contact?.id || !replyChannel) return;

    try {
      setLoggingReply(true);

      // Update contact status → In Conversation
      await updateContactStatus({
        userId: user.uid,
        contactId: contact.id,
        trigger: STATUS_TRIGGERS.POSITIVE_REPLY,
        currentStatus: contact.contact_status
      });

      // Log reply_received timeline event
      await logTimelineEvent({
        userId: user.uid,
        contactId: contact.id,
        type: 'reply_received',
        actor: ACTORS.USER,
        preview: replyNote || `Reply received via ${replyChannel}`,
        metadata: {
          channel: replyChannel,
          note: replyNote || null
        }
      });

      // Queue a follow-up email next step
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3);

      await logTimelineEvent({
        userId: user.uid,
        contactId: contact.id,
        type: 'next_step_queued',
        actor: ACTORS.BARRY,
        preview: 'Send a check-in email to keep the conversation going.',
        metadata: {
          stepType: 'follow_up',
          stepLabel: 'Follow Up via Email',
          channel: 'email',
          dueDate: dueDate.toISOString(),
          timing: '3d',
          message: `${contact.firstName || 'They'} replied via ${replyChannel} — follow up with a check-in email.`,
          status: 'pending'
        }
      });

      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        next_step_due: dueDate.toISOString(),
        next_step_type: 'follow_up',
        updated_at: new Date().toISOString()
      });

      setReplyLogged(true);
      setLoggingReply(false);
      setShowLogReply(false);
      setEngageState('in_progress');
    } catch (err) {
      console.error('[PersistentEngageBar] Failed to log reply:', err);
      setLoggingReply(false);
    }
  }

  async function handleBriefBarry() {
    const user = getEffectiveUser();
    if (!user || !contact?.id || !briefChannel || !briefContext.trim()) return;

    try {
      setBriefingSaving(true);

      // Save context into Barry's memory
      await updateContactMemory(user.uid, contact.id, {
        channel: briefChannel,
        outcome: 'message_sent',
        summary: briefContext.trim(),
        newFacts: [briefContext.trim()],
        gotReply: false,
        replyValence: null
      });

      // Log a timeline event for the external outreach
      await logTimelineEvent({
        userId: user.uid,
        contactId: contact.id,
        type: 'outreach_logged',
        actor: ACTORS.USER,
        preview: briefContext.trim(),
        metadata: {
          channel: briefChannel,
          context: briefContext.trim()
        }
      });

      setBriefSaved(true);
      setBriefingSaving(false);
      setShowBriefBarry(false);
      setBriefChannel(null);
      setBriefContext('');
    } catch (err) {
      console.error('[PersistentEngageBar] Failed to brief Barry:', err);
      setBriefingSaving(false);
    }
  }

  const baseConfig = ENGAGE_STATES[engageState] || ENGAGE_STATES.not_started;

  // For not_started, apply zero-state sub-state logic (A/B/C).
  // All other states use baseConfig directly.
  const zeroState = engageState === 'not_started' ? getZeroStateConfig(contact) : null;
  const config = zeroState
    ? {
        ...baseConfig,
        sublabel: zeroState.sublabel,
        cta: zeroState.cta,
        ctaColor: zeroState.ctaColor
      }
    : baseConfig;

  const StateIcon = config.icon;
  const firstName = contact?.firstName || contact?.name?.split(' ')[0] || 'this contact';
  const lastActivity = formatLastActivity(lastEvents);
  const lastEventLabel = getLastEventLabel(lastEvents);

  // Channel availability
  const channelStatus = CHANNELS.map(ch => ({
    ...ch,
    available: getChannelAvailability(contact, ch.id) === 'available'
  }));

  const availableChannels = channelStatus.filter(c => c.available);
  const blockedChannels = channelStatus.filter(c => !c.available && c.id !== 'calendar');

  if (loading) {
    return (
      <div className="peb-skeleton">
        <div className="peb-skeleton-inner">
          <Loader className="peb-skeleton-icon" />
          <span>Loading engagement state...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`persistent-engage-bar peb-state-${engageState}`}
      style={{
        '--peb-color': config.color,
        '--peb-bg': config.bgColor,
        '--peb-border': config.borderColor,
        '--peb-cta': config.ctaColor
      }}
    >
      {/* ── Primary Row ── */}
      <div className="peb-primary">
        {/* Status Indicator */}
        <div className="peb-status">
          <div className="peb-status-icon-wrap">
            <StateIcon className="peb-status-icon" />
            {engageState === 'follow_up_due' && (
              <span className="peb-pulse-dot" />
            )}
          </div>
          <div className="peb-status-text">
            <span className="peb-status-label">{config.label}</span>
            <span className={`peb-status-sublabel ${zeroState?.analyzing ? 'peb-sublabel-analyzing' : ''}`}>
              {config.sublabel}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="peb-stats">
          {lastActivity && (
            <div className="peb-stat">
              <Clock className="peb-stat-icon" />
              <span className="peb-stat-label">
                {lastEventLabel ? `${lastEventLabel} · ${lastActivity}` : lastActivity}
              </span>
            </div>
          )}
          {messageCount > 0 && (
            <div className="peb-stat peb-stat-hidden-sm">
              <Send className="peb-stat-icon" />
              <span className="peb-stat-label">{messageCount} sent</span>
            </div>
          )}
          {contact?.next_step_due && (
            <div className="peb-stat peb-stat-due peb-stat-hidden-sm">
              <Clock className="peb-stat-icon" />
              <span className="peb-stat-label">
                Due {new Date(contact.next_step_due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="peb-actions">
          {/* Quick channel dots */}
          <div className="peb-channels">
            {channelStatus.slice(0, 4).map(ch => {
              const ChIcon = ch.icon;
              return (
                <div
                  key={ch.id}
                  className={`peb-channel-dot ${ch.available ? 'peb-channel-available' : 'peb-channel-blocked'}`}
                  title={ch.available ? ch.label : `${ch.label} — not connected`}
                >
                  <ChIcon className="peb-channel-icon" />
                </div>
              );
            })}
          </div>

          {/* Main CTA */}
          <button
            className="peb-cta-btn"
            onClick={() => onEngageClick && onEngageClick()}
          >
            <Zap className="peb-cta-icon" />
            <span>{config.cta}</span>
            <ArrowRight className="peb-cta-arrow" />
          </button>

          {/* Expand toggle */}
          <button
            className="peb-expand-btn"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Expanded Detail Row ── */}
      {expanded && (
        <div className="peb-expanded">
          <div className="peb-expanded-inner">

            {/* Off-platform actions — shown when awaiting reply */}
            {engageState === 'awaiting_reply' && !replyLogged && !briefSaved && (
              <div className="peb-offplatform-section">
                <span className="peb-expanded-label">Something happen outside the app?</span>

                {/* Option A: I reached out — Brief Barry */}
                {!showBriefBarry && !showLogReply && (
                  <div className="peb-offplatform-options">
                    <button
                      className="peb-offplatform-btn peb-offplatform-outreach"
                      onClick={() => setShowBriefBarry(true)}
                    >
                      <Send className="w-3.5 h-3.5" />
                      I reached out — brief Barry
                    </button>
                    <button
                      className="peb-offplatform-btn peb-offplatform-reply"
                      onClick={() => setShowLogReply(true)}
                    >
                      <Reply className="w-3.5 h-3.5" />
                      They replied — log it
                    </button>
                  </div>
                )}

                {/* Brief Barry form */}
                {showBriefBarry && (
                  <div className="peb-log-reply-form">
                    <span className="peb-log-reply-label">Which channel did you use?</span>
                    <div className="peb-reply-channels">
                      {REPLY_CHANNELS.map(ch => {
                        const ChIcon = ch.icon;
                        return (
                          <button
                            key={ch.id}
                            className={`peb-reply-ch-btn ${briefChannel === ch.id ? 'peb-reply-ch-active' : ''}`}
                            onClick={() => setBriefChannel(ch.id)}
                          >
                            <ChIcon className="w-3.5 h-3.5" />
                            {ch.label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      className="peb-reply-note"
                      placeholder="What happened? Barry will remember this. (e.g. 'Texted Rod, he seemed interested and open to a follow-up email — mentioned he's busy this week')"
                      value={briefContext}
                      onChange={e => setBriefContext(e.target.value)}
                      rows={3}
                    />
                    <div className="peb-log-reply-actions">
                      <button
                        className="peb-log-confirm-btn"
                        onClick={handleBriefBarry}
                        disabled={!briefChannel || !briefContext.trim() || briefingSaving}
                      >
                        {briefingSaving ? (
                          <><Loader className="w-3.5 h-3.5 peb-spin" /> Saving...</>
                        ) : (
                          <><CheckCircle className="w-3.5 h-3.5" /> Save &amp; Brief Barry</>
                        )}
                      </button>
                      <button
                        className="peb-log-cancel-btn"
                        onClick={() => { setShowBriefBarry(false); setBriefChannel(null); setBriefContext(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Log Reply form */}
                {showLogReply && (
                  <div className="peb-log-reply-form">
                    <span className="peb-log-reply-label">Which channel did they reply on?</span>
                    <div className="peb-reply-channels">
                      {REPLY_CHANNELS.map(ch => {
                        const ChIcon = ch.icon;
                        return (
                          <button
                            key={ch.id}
                            className={`peb-reply-ch-btn ${replyChannel === ch.id ? 'peb-reply-ch-active' : ''}`}
                            onClick={() => setReplyChannel(ch.id)}
                          >
                            <ChIcon className="w-3.5 h-3.5" />
                            {ch.label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      className="peb-reply-note"
                      placeholder="Optional note (e.g. 'He texted back, interested — wants a follow-up email')"
                      value={replyNote}
                      onChange={e => setReplyNote(e.target.value)}
                      rows={2}
                    />
                    <div className="peb-log-reply-actions">
                      <button
                        className="peb-log-confirm-btn"
                        onClick={handleLogReply}
                        disabled={!replyChannel || loggingReply}
                      >
                        {loggingReply ? (
                          <><Loader className="w-3.5 h-3.5 peb-spin" /> Logging...</>
                        ) : (
                          <><CheckCircle className="w-3.5 h-3.5" /> Log Reply &amp; Queue Email Follow-Up</>
                        )}
                      </button>
                      <button
                        className="peb-log-cancel-btn"
                        onClick={() => { setShowLogReply(false); setReplyChannel(null); setReplyNote(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {briefSaved && (
              <div className="peb-reply-logged-confirm">
                <CheckCircle className="w-4 h-4" />
                <span>Saved — Barry has your context for next time</span>
              </div>
            )}

            {replyLogged && (
              <div className="peb-reply-logged-confirm">
                <CheckCircle className="w-4 h-4" />
                <span>Reply logged — email follow-up queued for 3 days</span>
              </div>
            )}

            {/* Channel Status */}
            <div className="peb-expanded-section">
              <span className="peb-expanded-label">Channels</span>
              <div className="peb-channel-list">
                {channelStatus.map(ch => {
                  const ChIcon = ch.icon;
                  return (
                    <div
                      key={ch.id}
                      className={`peb-channel-item ${ch.available ? 'peb-ch-ok' : 'peb-ch-blocked'}`}
                    >
                      <ChIcon className="w-3.5 h-3.5" />
                      <span>{ch.label}</span>
                      {!ch.available && ch.id !== 'calendar' && (
                        <span className="peb-ch-badge">Not connected</span>
                      )}
                      {ch.available && (
                        <span className="peb-ch-badge peb-ch-badge-ok">Ready</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Engagement Context */}
            {lastEvents.length > 0 && (
              <div className="peb-expanded-section">
                <span className="peb-expanded-label">Recent Activity</span>
                <div className="peb-recent-list">
                  {lastEvents.slice(0, 3).map((ev, i) => {
                    const ts = ev.timestamp?.toDate
                      ? ev.timestamp.toDate()
                      : new Date(ev.timestamp);
                    return (
                      <div key={i} className="peb-recent-item">
                        <div className="peb-recent-dot" />
                        <span className="peb-recent-text">
                          {ev.type?.replace(/_/g, ' ')}
                        </span>
                        <span className="peb-recent-time">
                          {ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Blocked channel guidance */}
            {blockedChannels.length > 0 && (
              <div className="peb-expanded-section">
                <span className="peb-expanded-label">Pivot Options</span>
                <p className="peb-pivot-hint">
                  {blockedChannels.length} channel{blockedChannels.length > 1 ? 's' : ''} not connected.
                  Barry will automatically suggest alternatives — nothing is lost.
                </p>
              </div>
            )}

            <button
              className="peb-open-full-btn"
              onClick={() => {
                setExpanded(false);
                onEngageClick && onEngageClick();
              }}
            >
              {engageState === 'awaiting_reply' ? 'Follow Up with Barry' : 'Start Engagement with Barry'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
