import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  Clock,
  Sparkles,
  Send,
  Target,
  Megaphone,
  ArrowRightLeft,
  Loader,
  GitBranch,
  ListChecks,
  CheckCircle,
  PlayCircle,
  SkipForward,
  Flag
} from 'lucide-react';
import './EngagementTimeline.css';

/**
 * ENGAGEMENT TIMELINE
 *
 * Unified, structured chronological log of all engagement events for a contact.
 * Reads from the timeline subcollection: users/{userId}/contacts/{contactId}/timeline
 *
 * Replaces both the old ActivityHistory component and ContactHunterActivity section.
 * One system. One truth.
 */

const EVENT_CONFIG = {
  message_generated: {
    icon: Sparkles,
    label: 'Message Generated',
    color: '#a855f7',
    bgColor: 'rgba(168, 85, 247, 0.1)',
    actorLabel: 'Barry'
  },
  message_sent: {
    icon: Send,
    label: 'Message Sent',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
    actorLabel: null
  },
  mission_assigned: {
    icon: Target,
    label: 'Mission Assigned',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    actorLabel: null
  },
  campaign_assigned: {
    icon: Megaphone,
    label: 'Campaign Assigned',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)',
    actorLabel: null
  },
  lead_status_changed: {
    icon: ArrowRightLeft,
    label: 'Status Changed',
    color: '#6366f1',
    bgColor: 'rgba(99, 102, 241, 0.1)',
    actorLabel: null
  },
  contact_status_changed: {
    icon: GitBranch,
    label: 'Contact Status',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
    actorLabel: 'System'
  },
  // Step 5: Sequence events
  sequence_step_proposed: {
    icon: ListChecks,
    label: 'Step Proposed',
    color: '#a855f7',
    bgColor: 'rgba(168, 85, 247, 0.1)',
    actorLabel: 'Barry'
  },
  sequence_step_approved: {
    icon: CheckCircle,
    label: 'Step Approved',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    actorLabel: null
  },
  sequence_step_sent: {
    icon: PlayCircle,
    label: 'Step Sent',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
    actorLabel: null
  },
  sequence_step_skipped: {
    icon: SkipForward,
    label: 'Step Skipped',
    color: '#94a3b8',
    bgColor: 'rgba(148, 163, 184, 0.1)',
    actorLabel: null
  },
  sequence_completed: {
    icon: Flag,
    label: 'Sequence Complete',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
    actorLabel: 'System'
  }
};

const CHANNEL_LABELS = {
  email: 'Email',
  text: 'Text',
  call: 'Call',
  linkedin: 'LinkedIn',
  calendar: 'Calendar'
};

const SEND_RESULT_BADGES = {
  sent: { label: 'Sent', className: 'badge-sent' },
  opened: { label: 'Opened', className: 'badge-opened' },
  prepared: { label: 'Prepared', className: 'badge-prepared' },
  failed: { label: 'Failed', className: 'badge-failed' }
};

function formatTimestamp(timestamp) {
  if (!timestamp) return '';

  // Handle Firestore Timestamp objects
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relative;
  if (diffMins < 1) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else if (diffDays < 7) relative = `${diffDays}d ago`;
  else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}w ago`;
  else relative = `${Math.floor(diffDays / 30)}mo ago`;

  const absolute = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit'
  });

  return { relative, absolute };
}

function getPreviewText(event) {
  if (event.preview) return event.preview;

  const meta = event.metadata || {};

  switch (event.type) {
    case 'message_generated':
      return meta.engagementIntent
        ? `${meta.strategyCount || 3} strategies generated`
        : 'Strategies generated';
    case 'message_sent':
      return meta.channel ? `via ${CHANNEL_LABELS[meta.channel] || meta.channel}` : null;
    case 'mission_assigned':
      return meta.missionName || null;
    case 'campaign_assigned':
      return meta.campaignName || null;
    case 'lead_status_changed':
      return meta.statusFrom && meta.statusTo
        ? `${meta.statusFrom} → ${meta.statusTo}`
        : null;
    // Step 5: Sequence events
    case 'sequence_step_proposed':
    case 'sequence_step_approved':
    case 'sequence_step_sent':
    case 'sequence_step_skipped':
      return meta.stepIndex != null
        ? `Step ${meta.stepIndex + 1}${meta.stepType ? ` — ${meta.stepType}` : ''}`
        : null;
    case 'sequence_completed':
      return 'All steps finished';
    default:
      return null;
  }
}

function getStatusBadge(event) {
  if (event.type === 'message_sent' && event.metadata?.sendResult) {
    return SEND_RESULT_BADGES[event.metadata.sendResult] || null;
  }
  if (event.type === 'message_sent' && event.metadata?.channel) {
    return { label: CHANNEL_LABELS[event.metadata.channel] || event.metadata.channel, className: 'badge-channel' };
  }
  if (event.type === 'lead_status_changed' && event.metadata?.statusTo) {
    return { label: event.metadata.statusTo, className: `badge-status-${event.metadata.statusTo}` };
  }
  return null;
}

export default function EngagementTimeline({ contactId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !contactId) {
      setLoading(false);
      return;
    }

    const timelineRef = collection(
      db, 'users', user.uid, 'contacts', contactId, 'timeline'
    );
    const q = query(timelineRef, orderBy('createdAt', 'desc'), limit(50));

    // Real-time listener — timeline updates instantly when events are written
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const timelineEvents = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setEvents(timelineEvents);
      setLoading(false);
    }, (error) => {
      console.error('[Timeline] Listener error:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [contactId]);

  if (loading) {
    return (
      <div className="engagement-timeline">
        <div className="timeline-header">
          <Clock className="w-5 h-5" />
          <h3>Engagement Timeline</h3>
        </div>
        <div className="timeline-loading">
          <Loader className="w-5 h-5 timeline-spinner" />
          <span>Loading timeline...</span>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="engagement-timeline">
        <div className="timeline-header">
          <Clock className="w-5 h-5" />
          <h3>Engagement Timeline</h3>
        </div>
        <div className="timeline-empty">
          <Clock className="w-10 h-10" />
          <p className="timeline-empty-title">No engagement yet</p>
          <p className="timeline-empty-desc">
            Actions you take with this contact will appear here — messages, missions, campaigns, and status changes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="engagement-timeline">
      <div className="timeline-header">
        <Clock className="w-5 h-5" />
        <h3>Engagement Timeline</h3>
        <span className="timeline-count">{events.length} event{events.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="timeline-list">
        {events.map((event, index) => {
          const config = EVENT_CONFIG[event.type] || {
            icon: Clock,
            label: event.type,
            color: '#9ca3af',
            bgColor: 'rgba(156, 163, 175, 0.1)'
          };
          const Icon = config.icon;
          const time = formatTimestamp(event.createdAt);
          const preview = getPreviewText(event);
          const badge = getStatusBadge(event);
          const isLast = index === events.length - 1;

          return (
            <div key={event.id} className="timeline-event">
              {/* Vertical connector line */}
              <div className="timeline-track">
                <div
                  className="timeline-dot"
                  style={{ backgroundColor: config.bgColor, borderColor: config.color }}
                >
                  <Icon
                    className="timeline-dot-icon"
                    style={{ color: config.color }}
                  />
                </div>
                {!isLast && <div className="timeline-connector" />}
              </div>

              {/* Event content */}
              <div className="timeline-event-content">
                <div className="timeline-event-top">
                  <span className="timeline-event-label" style={{ color: config.color }}>
                    {config.label}
                  </span>
                  {config.actorLabel && (
                    <span className="timeline-actor-badge">{config.actorLabel}</span>
                  )}
                  {badge && (
                    <span className={`timeline-badge ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  {time && (
                    <span className="timeline-event-time" title={time.absolute}>
                      {time.relative}
                    </span>
                  )}
                </div>
                {preview && (
                  <p className="timeline-event-preview">{preview}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
