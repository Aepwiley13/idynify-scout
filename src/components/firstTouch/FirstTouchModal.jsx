/**
 * FirstTouchModal — Barry's pre-engagement context-gathering flow.
 *
 * Collects three answers before handing off to InlineEngagementSection:
 *   Q1: Relationship (maps to engagementIntent)
 *   Q2: Intent / why they should respond (maps to userIntent)
 *   Q3: Tone preference (optional, appended to userIntent)
 *
 * Calls onComplete({ engagementIntent, userIntent, toneContext }) — no API calls here.
 */

import { useState } from 'react';
import './FirstTouchModal.css';

const Q1_OPTIONS = [
  { label: 'Yes — we have met in person', intent: 'warm' },
  { label: 'We have connected online or at an event', intent: 'warm' },
  { label: 'No — this is cold outreach', intent: 'prospect' },
];

const Q2_OPTIONS = [
  'I can solve a specific problem they have',
  'I have something relevant to share',
  'We have a mutual connection or context',
  'I want to start a conversation and learn more',
];

export default function FirstTouchModal({ contact, onDismiss, onComplete }) {
  const [step, setStep] = useState(1);
  const [engagementIntent, setEngagementIntent] = useState(null);
  const [q2Choice, setQ2Choice] = useState(null);
  const [q2Custom, setQ2Custom] = useState('');
  const [q3Tone, setQ3Tone] = useState('');

  const name = contact.name || contact.first_name || 'this contact';
  const firstName = name.split(' ')[0];

  function handleQ1Select(option) {
    setEngagementIntent(option.intent);
    setStep(2);
  }

  function handleQ2Next() {
    setStep(3);
  }

  function handleComplete() {
    const userIntent = q2Custom.trim() || q2Choice || '';
    onComplete({ engagementIntent, userIntent, toneContext: q3Tone.trim() });
  }

  const q2Value = q2Custom.trim() || q2Choice;

  return (
    <div className="ft-overlay">
      <div className="ft-modal">
        <div className="ft-header">
          <div className="ft-barry-avatar">🐻</div>
          <div className="ft-header-text">
            <h2 className="ft-title">First Touch — {firstName}</h2>
            <p className="ft-subtitle">Three quick answers. Then Barry writes your message.</p>
          </div>
          <button className="ft-close-btn" onClick={onDismiss} aria-label="Close">×</button>
        </div>

        <div className="ft-steps">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`ft-step-dot${n < step ? ' ft-step-dot--done' : ''}${n === step ? ' ft-step-dot--active' : ''}`}
            />
          ))}
        </div>

        {/* Step 1 — Relationship */}
        {step === 1 && (
          <div className="ft-body">
            <p className="ft-section-label">DO YOU KNOW THIS PERSON?</p>
            <div className="ft-option-list">
              {Q1_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className="ft-option-card"
                  onClick={() => handleQ1Select(opt)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Intent */}
        {step === 2 && (
          <div className="ft-body">
            <p className="ft-section-label">WHY SHOULD THEY RESPOND?</p>
            <div className="ft-option-list">
              {Q2_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`ft-option-card${q2Choice === opt && !q2Custom.trim() ? ' ft-option-card--selected' : ''}`}
                  onClick={() => { setQ2Choice(opt); setQ2Custom(''); }}
                >
                  {opt}
                </button>
              ))}
            </div>
            <textarea
              className="ft-textarea"
              value={q2Custom}
              onChange={(e) => { setQ2Custom(e.target.value.slice(0, 180)); }}
              placeholder="Or type your own reason… (optional override)"
              rows={2}
            />
            {q2Custom && <p className="ft-char-count">{q2Custom.length}/180</p>}
            <div className="ft-footer">
              <button className="ft-back-btn" onClick={() => setStep(1)}>Back</button>
              <button
                className="ft-next-btn"
                onClick={handleQ2Next}
                disabled={!q2Value}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Tone (optional) */}
        {step === 3 && (
          <div className="ft-body">
            <p className="ft-section-label">WHAT SHOULD THE MESSAGE SOUND LIKE?</p>
            <p className="ft-hint">Optional — Barry calibrates tone from your RECON preferences by default.</p>
            <textarea
              className="ft-textarea"
              value={q3Tone}
              onChange={(e) => setQ3Tone(e.target.value.slice(0, 200))}
              placeholder="e.g. Casual and curious, Direct and confident, Warm and personal"
              rows={3}
              autoFocus
            />
            <p className="ft-char-count">{q3Tone.length}/200</p>
            <div className="ft-footer">
              <button className="ft-back-btn" onClick={() => setStep(2)}>Back</button>
              <button
                className="ft-generate-btn"
                onClick={handleComplete}
                disabled={!q2Value}
              >
                Get my messages →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
