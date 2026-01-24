import React from 'react';
import { useNavigate } from 'react-router-dom';
import './MeetSection.css';

export default function MeetSection({ barryContext, contact }) {
  const navigate = useNavigate();

  if (!barryContext) {
    return null;
  }

  // Extract first name from full name
  const firstName = contact.name ? contact.name.split(' ')[0] : 'This Contact';

  // Handle conversation starter click - draft email via Hunter
  const handleDraftEmail = (starter) => {
    // Navigate to Hunter campaign with pre-filled conversation starter
    navigate('/hunter/campaign/new', {
      state: {
        contactIds: [contact.id],
        conversationStarter: starter,
        contact: contact
      }
    });
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
            <div
              key={index}
              className="conversation-option"
              onClick={() => handleDraftEmail(starter)}
            >
              {starter}
            </div>
          ))}
        </div>
      )}

      {/* Engagement Helper */}
      {barryContext.conversationStarters && barryContext.conversationStarters.length > 0 && (
        <div className="engagement-helper">
          <span>💬</span>
          <span>Click any option above to draft an email via Hunter</span>
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
