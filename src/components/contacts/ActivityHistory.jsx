import React from 'react';
import {
  Clock,
  StickyNote,
  Sparkles,
  Eye,
  Mail,
  Send,
  Edit,
  Trash2,
  UserCheck
} from 'lucide-react';
import './ActivityHistory.css';

export default function ActivityHistory({ contact }) {
  const activityLog = contact.activity_log || [];

  // Sort activities by timestamp (most recent first)
  const sortedActivities = [...activityLog].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  ).slice(0, 50); // Show last 50 activities

  // Get icon and label for activity type
  const getActivityIcon = (type) => {
    switch (type) {
      case 'note_added':
        return <StickyNote className="activity-icon note" />;
      case 'note_edited':
        return <Edit className="activity-icon edit" />;
      case 'note_deleted':
        return <Trash2 className="activity-icon delete" />;
      case 'enriched':
        return <Sparkles className="activity-icon enriched" />;
      case 'profile_viewed':
        return <Eye className="activity-icon viewed" />;
      case 'email_drafted':
        return <Mail className="activity-icon email" />;
      case 'email_sent':
        return <Send className="activity-icon sent" />;
      case 'contact_created':
        return <UserCheck className="activity-icon created" />;
      default:
        return <Clock className="activity-icon default" />;
    }
  };

  const getActivityLabel = (type) => {
    switch (type) {
      case 'note_added':
        return 'Note added';
      case 'note_edited':
        return 'Note edited';
      case 'note_deleted':
        return 'Note deleted';
      case 'enriched':
        return 'Contact enriched';
      case 'profile_viewed':
        return 'Profile viewed';
      case 'email_drafted':
        return 'Email drafted';
      case 'email_sent':
        return 'Email sent via Hunter';
      case 'contact_created':
        return 'Contact created';
      default:
        return 'Activity';
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);

    // If within last 24 hours, show relative time
    if (diffInHours < 24) {
      if (diffInHours < 1) {
        const minutes = Math.floor(diffInHours * 60);
        return minutes <= 1 ? 'Just now' : `${minutes} minutes ago`;
      }
      const hours = Math.floor(diffInHours);
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }

    // Otherwise show date and time
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  if (sortedActivities.length === 0) {
    return (
      <div className="activity-history-section">
        <h3 className="activity-header">
          <Clock className="w-4 h-4" />
          History
        </h3>
        <div className="no-activity">
          <Clock className="w-12 h-12" />
          <p>No activity yet. Interactions with this contact will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-history-section">
      <h3 className="activity-header">
        <Clock className="w-4 h-4" />
        History
      </h3>
      <div className="activity-timeline">
        {sortedActivities.map((activity, index) => (
          <div key={index} className="activity-item">
            <div className="activity-icon-wrapper">
              {getActivityIcon(activity.type)}
            </div>
            <div className="activity-content">
              <div className="activity-label">
                {getActivityLabel(activity.type)}
              </div>
              {activity.details && (
                <div className="activity-details">
                  {activity.details}
                </div>
              )}
              <div className="activity-timestamp">
                {formatTimestamp(activity.timestamp)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
