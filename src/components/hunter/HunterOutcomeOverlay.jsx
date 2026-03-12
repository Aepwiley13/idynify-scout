/**
 * HunterOutcomeOverlay — 6-option outcome recording after a mission step is sent.
 *
 * One tap → outcome logged → relationship_state auto-updates → next step CTA changes.
 * The spec says this appears "immediately after Send."
 *
 * Auto relationship_state transitions (conservative):
 *   positive_reply + unaware  → aware
 *   positive_reply + aware    → engaged
 *   positive_reply + dormant  → aware
 *   scheduled + any           → engaged (minimum — they agreed to meet)
 *   other outcomes            → no change (don't hurt state from one interaction)
 *
 * Saves to: contact timeline + contact.relationship_state (if transitioning)
 */

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Sparkles } from 'lucide-react';
import { getStateTransition } from '../../utils/hunterOutcomeLogic';
import './HunterOutcomeOverlay.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

const OUTCOME_OPTIONS = [
  { id: 'no_reply',        label: 'No reply yet',      emoji: '⏳', color: '#9ca3af', description: 'Still waiting — normal' },
  { id: 'positive_reply',  label: 'Positive reply',    emoji: '✅', color: '#34d399', description: 'They responded well' },
  { id: 'neutral_reply',   label: 'Neutral reply',     emoji: '↔️', color: '#60a5fa', description: 'Response but non-committal' },
  { id: 'negative_reply',  label: 'Negative reply',    emoji: '✕',  color: '#f87171', description: 'Not interested right now' },
  { id: 'scheduled',       label: 'Scheduled ✓',       emoji: '📅', color: '#a78bfa', description: 'Meeting or call booked' },
  { id: 'not_interested',  label: 'Not interested',    emoji: '🚫', color: '#6b7280', description: 'Closed for now' }
];

export default function HunterOutcomeOverlay({
  contact,
  stepDescription,
  onOutcomeRecorded
}) {
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  const name = contact?.first_name || contact?.name?.split(' ')[0] || 'them';

  async function handleSelect(outcomeId) {
    if (saving) return;
    setSelected(outcomeId);
    setSaving(true);

    try {
      const user = getEffectiveUser();
      if (!user || !contact?.id) {
        onOutcomeRecorded(outcomeId, null);
        return;
      }

      const transition = getStateTransition(outcomeId, contact.relationship_state);
      const updates = {
        last_outcome: outcomeId,
        last_outcome_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (transition) {
        updates.relationship_state = transition;
        // Invalidate barry hunter read so it regenerates with new state
        updates.barry_hunter_read_state = null;
      }

      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), updates);

      onOutcomeRecorded(outcomeId, transition);
    } catch (err) {
      console.error('[HunterOutcomeOverlay] Save error:', err);
      onOutcomeRecorded(outcomeId, null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hoo-overlay">
      <div className="hoo-panel">
        <div className="hoo-header">
          <Sparkles className="w-4 h-4 hoo-sparkle" />
          <span className="hoo-barry-label">Barry</span>
        </div>

        <h2 className="hoo-title">What happened?</h2>
        {stepDescription && (
          <p className="hoo-context">{stepDescription}</p>
        )}

        <div className="hoo-options">
          {OUTCOME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className={`hoo-option ${selected === opt.id ? 'hoo-option--selected' : ''}`}
              onClick={() => handleSelect(opt.id)}
              disabled={saving && selected !== opt.id}
              style={{ '--option-color': opt.color }}
            >
              <span className="hoo-option-emoji">{opt.emoji}</span>
              <div className="hoo-option-text">
                <span className="hoo-option-label">{opt.label}</span>
                <span className="hoo-option-desc">{opt.description}</span>
              </div>
              {saving && selected === opt.id && (
                <span className="hoo-option-saving">Saving...</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
