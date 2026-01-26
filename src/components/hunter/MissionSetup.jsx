import React from 'react';
import EngagementIntentSelector from './EngagementIntentSelector';
import './MissionSetup.css';

export default function MissionSetup({ intent, onIntentChange, contacts }) {
  return (
    <div className="mission-setup">
      <div className="mission-header">
        <h2>Mission Setup</h2>
        <p>You're about to engage {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}</p>
      </div>

      <div className="contact-preview">
        <h4>Target Contacts</h4>
        <ul className="contact-list">
          {contacts.slice(0, 5).map(contact => (
            <li key={contact.id}>
              <strong>{contact.name}</strong> — {contact.title} at {contact.company_name}
            </li>
          ))}
          {contacts.length > 5 && (
            <li className="more-contacts">+ {contacts.length - 5} more</li>
          )}
        </ul>
      </div>

      <EngagementIntentSelector
        value={intent}
        onChange={onIntentChange}
      />

      <div className="mission-footer">
        <p className="guidance-text">
          💡 <strong>Hunter Tip:</strong> Your selection helps Barry craft messages with the right tone.
          You'll review everything before sending.
        </p>
      </div>
    </div>
  );
}
