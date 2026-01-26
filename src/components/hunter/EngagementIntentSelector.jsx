import React from 'react';
import './EngagementIntentSelector.css';

const INTENT_OPTIONS = [
  {
    value: 'cold',
    label: 'Cold',
    icon: '❄️',
    description: 'Never met this person',
    tone: 'professional, value-driven, establish credibility',
    example: 'Focus on their pain points and your unique value'
  },
  {
    value: 'warm',
    label: 'Warm',
    icon: '🤝',
    description: 'Some shared context or connection',
    tone: 'friendly, reference common ground, build on familiarity',
    example: 'Reference mutual connections, shared interests, or past interactions'
  },
  {
    value: 'hot',
    label: 'Hot',
    icon: '🔥',
    description: 'Active conversation or relationship',
    tone: 'direct, conversational, assume rapport',
    example: 'Get straight to the point, no need for lengthy intros'
  },
  {
    value: 'followup',
    label: 'Follow-up',
    icon: '🔁',
    description: "We've engaged before",
    tone: 'persistent but helpful, reference prior engagement',
    example: 'Acknowledge previous touch, add new value or perspective'
  }
];

export default function EngagementIntentSelector({ value, onChange, disabled = false }) {
  return (
    <div className="engagement-intent-selector">
      <h3>How do you know these people?</h3>
      <p className="intent-subtitle">This helps Barry craft the right tone</p>

      <div className="intent-options">
        {INTENT_OPTIONS.map(option => (
          <label
            key={option.value}
            className={`intent-option ${value === option.value ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
          >
            <input
              type="radio"
              name="engagementIntent"
              value={option.value}
              checked={value === option.value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
            />

            <div className="option-content">
              <div className="option-header">
                <span className="option-icon">{option.icon}</span>
                <span className="option-label">{option.label}</span>
              </div>

              <p className="option-description">{option.description}</p>

              {value === option.value && (
                <div className="option-guidance">
                  <strong>Tone:</strong> {option.tone}
                  <br />
                  <strong>Example:</strong> {option.example}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
