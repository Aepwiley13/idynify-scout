/**
 * HunterMicroIntake — 3-question first-contact context overlay.
 *
 * Appears in Active Missions AFTER rocket launch, NOT before.
 * Launch always happens first. Barry collects context after.
 *
 * Queue pattern: one at a time. Badge count shows how many are waiting.
 * Users can skip (Barry works with partial context, marks intake as skipped).
 *
 * The 3 questions (per spec):
 *   1. Primary reason for reaching out (outcome category dropdown)
 *   2. How they know this person (free text, one line)
 *   3. What success looks like from this first message (free text or dropdown)
 *
 * Saves to: contact.hunter_intake = { completed_at, reason, how_know, success_looks_like, skipped }
 */

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './HunterMicroIntake.css';

const REASON_OPTIONS = [
  { id: 'reconnect', label: 'Reconnect with someone I know' },
  { id: 'first_contact', label: 'First time reaching out' },
  { id: 'follow_up', label: 'Follow up on a previous conversation' },
  { id: 'introduce_offer', label: 'Introduce what I do / my offer' },
  { id: 'get_intro', label: 'Ask for an introduction or referral' },
  { id: 'build_relationship', label: 'Build a longer-term relationship' },
  { id: 'explore_opportunity', label: 'Explore a potential opportunity' },
  { id: 'gather_feedback', label: 'Get feedback or market intelligence' }
];

const SUCCESS_OPTIONS = [
  { id: 'reply', label: 'They reply — any reply' },
  { id: 'positive_reply', label: 'They express interest' },
  { id: 'meeting_booked', label: 'We book a meeting' },
  { id: 'intro_made', label: 'They make an introduction' },
  { id: 'referral', label: 'They give me a referral' },
  { id: 'conversation_started', label: 'A real conversation starts' }
];

export default function HunterMicroIntake({
  contact,
  totalPending,
  onComplete,
  onSkip
}) {
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState('');
  const [howKnow, setHowKnow] = useState('');
  const [successLike, setSuccessLike] = useState('');
  const [saving, setSaving] = useState(false);

  const name = contact?.name || contact?.first_name || 'this contact';
  const firstName = contact?.first_name || name.split(' ')[0];

  async function handleComplete() {
    if (saving) return;
    setSaving(true);

    try {
      const user = auth.currentUser;
      if (user && contact?.id) {
        await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
          hunter_intake: {
            completed_at: new Date().toISOString(),
            reason,
            how_know: howKnow,
            success_looks_like: successLike,
            skipped: false
          },
          updated_at: new Date().toISOString()
        });
      }
      onComplete({ reason, howKnow, successLike });
    } catch (err) {
      console.error('[MicroIntake] Save error:', err);
      onComplete({ reason, howKnow, successLike }); // proceed anyway
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    try {
      const user = auth.currentUser;
      if (user && contact?.id) {
        await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
          hunter_intake: {
            skipped: true,
            skipped_at: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        });
      }
    } catch (_) {}
    onSkip();
  }

  return (
    <div className="hmi-overlay">
      <div className="hmi-panel">
        {/* Header */}
        <div className="hmi-header">
          <div className="hmi-header-top">
            <span className="hmi-barry-label">Barry</span>
            {totalPending > 1 && (
              <span className="hmi-queue-badge">{totalPending} contacts need context</span>
            )}
          </div>
          <h2 className="hmi-title">Give me 30 seconds on {firstName}.</h2>
          <p className="hmi-sub">
            The more context you give me, the sharper this mission gets.
          </p>
        </div>

        {/* Step indicator */}
        <div className="hmi-steps">
          {[1, 2, 3].map(n => (
            <div
              key={n}
              className={`hmi-step-dot ${step >= n ? 'hmi-step-dot--done' : ''} ${step === n ? 'hmi-step-dot--active' : ''}`}
            />
          ))}
        </div>

        {/* Question 1 */}
        {step === 1 && (
          <div className="hmi-question">
            <p className="hmi-question-label">What's your primary reason for reaching out?</p>
            <div className="hmi-reason-grid">
              {REASON_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  className={`hmi-reason-btn ${reason === opt.id ? 'hmi-reason-btn--active' : ''}`}
                  onClick={() => setReason(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="hmi-question-actions">
              <button className="hmi-skip-link" onClick={handleSkip}>Skip for now</button>
              <button
                className="hmi-next-btn"
                disabled={!reason}
                onClick={() => setStep(2)}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Question 2 */}
        {step === 2 && (
          <div className="hmi-question">
            <p className="hmi-question-label">How do you know {firstName}?</p>
            <input
              type="text"
              className="hmi-text-input"
              placeholder="e.g. Met at SaaStr, mutual connection via Tom, cold prospect"
              value={howKnow}
              onChange={e => setHowKnow(e.target.value)}
              autoFocus
              maxLength={120}
            />
            <div className="hmi-question-actions">
              <button className="hmi-back-link" onClick={() => setStep(1)}>← Back</button>
              <div style={{ display: 'flex', gap: '0.625rem' }}>
                <button className="hmi-skip-link" onClick={handleSkip}>Skip for now</button>
                <button
                  className="hmi-next-btn"
                  onClick={() => setStep(3)}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Question 3 */}
        {step === 3 && (
          <div className="hmi-question">
            <p className="hmi-question-label">What would success look like from this first message?</p>
            <div className="hmi-reason-grid">
              {SUCCESS_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  className={`hmi-reason-btn ${successLike === opt.id ? 'hmi-reason-btn--active' : ''}`}
                  onClick={() => setSuccessLike(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="hmi-question-actions">
              <button className="hmi-back-link" onClick={() => setStep(2)}>← Back</button>
              <div style={{ display: 'flex', gap: '0.625rem' }}>
                <button className="hmi-skip-link" onClick={handleSkip}>Skip for now</button>
                <button
                  className="hmi-next-btn hmi-next-btn--launch"
                  disabled={!successLike || saving}
                  onClick={handleComplete}
                >
                  {saving ? 'Saving...' : 'Give Barry the context →'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
