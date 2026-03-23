import React, { useState } from 'react';
import './MeetSection.css';

const EMAIL_TYPES_INTRO = [
  { label: 'Introduction', intent: 'prospect' },
  { label: 'Follow-up', intent: 'warm' },
  { label: 'Check-in', intent: 'warm' },
];

const EMAIL_TYPES_ENGAGED = [
  { label: 'Follow-up', intent: 'warm' },
  { label: 'Thank You', intent: 'hot' },
  { label: 'Next Steps', intent: 'hot' },
  { label: 'Check-in', intent: 'warm' },
];

// Statuses that indicate an active/established relationship
const ENGAGED_STATUSES = [
  'awaiting_reply', 'awaiting reply',
  'engaged', 'in_pipeline', 'in pipeline',
  'meeting_booked', 'meeting booked',
  'active', 'replied',
];

function isEngaged(contact) {
  if (!contact) return false;
  const status = (contact.contact_status || '').toLowerCase().replace(/\s+/g, '_');
  if (ENGAGED_STATUSES.includes(status)) return true;
  // Also check relationship_state
  const relState = (contact.relationship_state || '').toLowerCase();
  if (['engaged', 'warm', 'trusted', 'advocate', 'strategic_partner'].includes(relState)) return true;
  // Check if there have been sent messages
  if (contact.messages_sent > 0 || contact.last_message_at) return true;
  return false;
}

export default function MeetSection({ barryContext, contact, onStarterDraft }) {
  const [selectedIndex, setSelectedIndex] = useState(null);

  if (!barryContext) {
    return null;
  }

  const firstName = contact.name ? contact.name.split(' ')[0] : 'This Contact';
  const engaged = isEngaged(contact);
  const emailTypes = engaged ? EMAIL_TYPES_ENGAGED : EMAIL_TYPES_INTRO;

  // Determine the section heading based on engagement state
  const heading = engaged ? `Continue with ${firstName}` : `Meet ${firstName}`;

  // Determine the sub-heading for the role section
  const roleHeading = engaged
    ? 'What matters to them'
    : 'What This Role Usually Cares About';

  // Determine the conversation starters heading
  const starterHeading = engaged
    ? 'Next conversation moves'
    : 'Ways a conversation could naturally begin';

  const handleStarterClick = (index) => {
    setSelectedIndex(selectedIndex === index ? null : index);
  };

  const handleDraftEmail = (starter, intentId) => {
    if (onStarterDraft) {
      onStarterDraft(starter, intentId);
      setSelectedIndex(null);
    }
  };

  return (
    <div className="meet-section">
      <h2>{heading}</h2>

      {/* Engagement status context */}
      {engaged && (
        <div className="engagement-status-context">
          <span className="engagement-status-dot" />
          <span>
            You're actively engaged with {firstName}
            {contact.contact_status && ` — ${contact.contact_status.replace(/_/g, ' ')}`}
          </span>
        </div>
      )}

      {/* Barry's Summary */}
      {barryContext.whoYoureMeeting && (
        <div className="barry-summary">
          {barryContext.whoYoureMeeting}
        </div>
      )}

      {/* What This Role Usually Cares About / What matters to them */}
      {barryContext.whatRoleCaresAbout && barryContext.whatRoleCaresAbout.length > 0 && (
        <div className="role-priorities">
          <h3>{roleHeading}</h3>
          <ul>
            {barryContext.whatRoleCaresAbout.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Conversation Starters / Next moves */}
      {barryContext.conversationStarters && barryContext.conversationStarters.length > 0 && (
        <div className="conversation-starters">
          <h3>{starterHeading}</h3>
          {barryContext.conversationStarters.map((starter, index) => (
            <div key={index} className="conversation-option-wrapper">
              <div
                className={`conversation-option${selectedIndex === index ? ' conversation-option--active' : ''}`}
                onClick={() => handleStarterClick(index)}
              >
                {starter}
              </div>
              {selectedIndex === index && (
                <div className="email-type-picker">
                  <span className="email-type-label">Draft as:</span>
                  {emailTypes.map(({ label, intent }) => (
                    <button
                      key={label}
                      className="email-type-btn"
                      onClick={() => handleDraftEmail(starter, intent)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Engagement Helper */}
      {barryContext.conversationStarters && barryContext.conversationStarters.length > 0 && (
        <div className="engagement-helper">
          <span>{engaged ? '🎯' : '💬'}</span>
          <span>
            {selectedIndex !== null
              ? 'Choose a message type — Barry will generate it below'
              : engaged
                ? 'Click a next move above to draft your message'
                : 'Click any starter above to begin drafting a message'}
          </span>
        </div>
      )}

      {/* Calm Reframe (if exists) */}
      {barryContext.calmReframe && (
        <div className="calm-reframe">
          <p>{barryContext.calmReframe}</p>
        </div>
      )}
    </div>
  );
}
