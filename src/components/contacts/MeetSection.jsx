import React, { useState } from 'react';
import './MeetSection.css';

const EMAIL_TYPES = [
  { label: 'Introduction', intent: 'prospect' },
  { label: 'Follow-up', intent: 'warm' },
  { label: 'Check-in', intent: 'warm' },
];

export default function MeetSection({ barryContext, contact, onStarterDraft }) {
  const [selectedIndex, setSelectedIndex] = useState(null);

  if (!barryContext) {
    return null;
  }

  const firstName = contact.name ? contact.name.split(' ')[0] : 'This Contact';

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
      <h2>Meet {firstName}</h2>

      {/* Barry's Summary */}
      {barryContext.whoYoureMeeting && (
        <div className="barry-summary">
          {barryContext.whoYoureMeeting}
        </div>
      )}

      {/* What This Role Usually Cares About */}
      {barryContext.whatRoleCaresAbout && barryContext.whatRoleCaresAbout.length > 0 && (
        <div className="role-priorities">
          <h3>What This Role Usually Cares About</h3>
          <ul>
            {barryContext.whatRoleCaresAbout.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Ways a Conversation Could Naturally Begin */}
      {barryContext.conversationStarters && barryContext.conversationStarters.length > 0 && (
        <div className="conversation-starters">
          <h3>Ways a conversation could naturally begin</h3>
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
                  {EMAIL_TYPES.map(({ label, intent }) => (
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
          <span>💬</span>
          <span>
            {selectedIndex !== null
              ? 'Choose a message type — Barry will generate it below'
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
