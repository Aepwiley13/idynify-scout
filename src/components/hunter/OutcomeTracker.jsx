import React, { useState } from 'react';
import { trackOutcome } from '../../services/hunterService';
import './OutcomeTracker.css';

const OUTCOME_OPTIONS = [
  { value: 'replied', label: '✉️ Replied', color: '#3b82f6', terminal: false },
  { value: 'meeting_booked', label: '📅 Meeting Booked', color: '#10b981', terminal: true },
  { value: 'opportunity_created', label: '💰 Opportunity Created', color: '#8b5cf6', terminal: true },
  { value: 'no_response', label: '⏳ No Response', color: '#6b7280', terminal: false },
  { value: 'unsubscribed', label: '🚫 Unsubscribed', color: '#ef4444', terminal: false }
];

export default function OutcomeTracker({ contact, campaignId, onOutcomeUpdate }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showNoResponseModal, setShowNoResponseModal] = useState(false);

  const handleOutcomeChange = async (outcome) => {
    // GUARDRAIL: Soft check for "no_response"
    if (outcome === 'no_response') {
      const daysSinceSent = contact.sentAt
        ? Math.floor((Date.now() - contact.sentAt.toDate()) / (1000 * 60 * 60 * 24))
        : 0;

      if (daysSinceSent < 3) {
        setShowNoResponseModal(true);
        return;
      }
    }

    await saveOutcome(outcome);
  };

  const saveOutcome = async (outcome) => {
    setSaving(true);
    setError(null);

    try {
      await trackOutcome({
        campaignId,
        contactId: contact.contactId,
        outcome
      });

      // Check if this is a terminal outcome
      const isTerminal = OUTCOME_OPTIONS.find(opt => opt.value === outcome)?.terminal;

      onOutcomeUpdate(contact.contactId, outcome, isTerminal);

      setShowNoResponseModal(false);
    } catch (err) {
      console.error('Error tracking outcome:', err);
      setError('Failed to track outcome. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const currentOutcome = OUTCOME_OPTIONS.find(opt => opt.value === contact.outcome);

  // GUARDRAIL: Lock after terminal outcomes
  const isLocked = contact.outcomeLocked || false;

  return (
    <div className="outcome-tracker">
      {isLocked ? (
        <div className="outcome-locked">
          <span className="outcome-label" style={{ color: currentOutcome?.color }}>
            {currentOutcome?.label}
          </span>
          <span className="locked-icon">🔒</span>
        </div>
      ) : (
        <select
          value={contact.outcome || ''}
          onChange={(e) => handleOutcomeChange(e.target.value)}
          disabled={saving}
          className="outcome-select"
          style={{
            borderColor: currentOutcome?.color || '#d1d5db',
            color: currentOutcome?.color || '#374151'
          }}
        >
          <option value="">-- Mark Outcome --</option>
          {OUTCOME_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {contact.outcome && contact.outcomeMarkedAt && (
        <span className="outcome-timestamp">
          Marked {new Date(contact.outcomeMarkedAt.toDate()).toLocaleDateString()}
        </span>
      )}

      {error && <span className="outcome-error">{error}</span>}

      {/* GUARDRAIL: No Response Confirmation Modal */}
      {showNoResponseModal && (
        <div className="modal-overlay" onClick={() => setShowNoResponseModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Mark as No Response?</h3>
            <p>It's been less than 3 days since you sent this message.</p>
            <p>Many replies come 3-7 days after initial send.</p>
            <p>Are you sure you want to mark this as no response now?</p>

            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowNoResponseModal(false)}
              >
                Wait Longer
              </button>
              <button
                className="btn-primary"
                onClick={() => saveOutcome('no_response')}
                disabled={saving}
              >
                Yes, Mark No Response
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
