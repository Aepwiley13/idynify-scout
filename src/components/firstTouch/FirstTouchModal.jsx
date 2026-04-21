/**
 * FirstTouchModal — 3-step Barry-guided modal for Scout-to-Hunter engagement.
 *
 * Step 1: Contact context (read-only, Barry signal annotation)
 * Step 2: Service angle selection (skipped if 0 or 1 profile)
 * Step 3: Optional personal context (300 char)
 * → Generate → draft view → "Send to Hunter" or "Edit more"
 */

import { useState, useEffect } from 'react';
import { auth } from '../../firebase/config';
import { loadIntoHunter } from '../../utils/loadIntoHunter';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { DEFAULT_SERVICE_ID } from '../../utils/reconSectionMap';
import './FirstTouchModal.css';

function getSignalAnnotations(contact) {
  const lines = [];
  if (contact.num_employees && Number(contact.num_employees) < 10) {
    lines.push('Small team — likely a generalist buyer, value speed and simplicity.');
  }
  if (contact.job_start_date) {
    const days = (Date.now() - new Date(contact.job_start_date).getTime()) / (1000 * 60 * 60 * 24);
    if (days >= 0 && days < 180) lines.push('Recently started this role — high receptivity to new solutions.');
  }
  if (contact.relationship_state && contact.relationship_state !== 'unaware') {
    lines.push(`Relationship state: ${contact.relationship_state} — not a cold start.`);
  }
  return lines;
}

export default function FirstTouchModal({
  contact,
  serviceProfiles = [],
  initialServiceId = null,
  onDismiss,
  onSentToHunter,
}) {
  const [step, setStep] = useState(1);
  const [selectedServiceId, setSelectedServiceId] = useState(
    initialServiceId ||
    (serviceProfiles.length === 1 ? serviceProfiles[0].id : DEFAULT_SERVICE_ID)
  );
  const [personalContext, setPersonalContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState(null);
  const [editSubject, setEditSubject] = useState('');
  const [editParagraph, setEditParagraph] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const skipServiceStep = serviceProfiles.length <= 1;
  const totalSteps = skipServiceStep ? 2 : 3;

  // Map step numbers when service step is skipped
  function getEffectiveStep() {
    if (skipServiceStep && step >= 2) return step + 1;
    return step;
  }

  const signals = getSignalAnnotations(contact);
  const selectedProfile = serviceProfiles.find(p => p.id === selectedServiceId) || null;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryFirstTouch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id,
          serviceProfileId: selectedServiceId || DEFAULT_SERVICE_ID,
          userContext: personalContext.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed');

      setDraft(data);
      setEditSubject(data.subjectLine);
      setEditParagraph(data.openingParagraph);
      setStep(skipServiceStep ? 4 : 4);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSendToHunter() {
    setSending(true);
    setError(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const result = await loadIntoHunter({
        contactId: contact.id,
        subject: editSubject,
        message: editParagraph,
        angleId: 'first_touch',
        userId: user.uid,
      });

      if (!result.success) throw new Error(result.error || 'Failed to create mission');

      onSentToHunter?.({
        missionId: result.missionId,
        contactId: contact.id,
        serviceProfileId: selectedServiceId,
        contactName: contact.name,
      });
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  }

  const name = contact.name || contact.first_name || 'this contact';
  const firstName = name.split(' ')[0];

  return (
    <div className="ft-overlay">
      <div className="ft-modal">
        <div className="ft-header">
          <div className="ft-barry-avatar">🐻</div>
          <div className="ft-header-text">
            <h2 className="ft-title">First Touch — {firstName}</h2>
            <p className="ft-subtitle">Barry-guided outreach in under 2 minutes</p>
          </div>
          <button className="ft-close-btn" onClick={onDismiss} aria-label="Close">×</button>
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <div className="ft-steps">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`ft-step-dot${i + 1 < step ? ' ft-step-dot--done' : ''}${i + 1 === step ? ' ft-step-dot--active' : ''}`}
              />
            ))}
          </div>
        )}

        {/* Step 1 — Contact context */}
        {step === 1 && (
          <div className="ft-body">
            <p className="ft-section-label">WHO YOU'RE REACHING</p>
            <div className="ft-contact-card">
              <div className="ft-contact-name">{contact.name || 'Unknown'}</div>
              {contact.title && <div className="ft-contact-title">{contact.title}</div>}
              {contact.company_name && (
                <div className="ft-contact-company">{contact.company_name}</div>
              )}
              {contact.industry && (
                <div className="ft-contact-meta">{contact.industry}{contact.location ? ` · ${contact.location}` : ''}</div>
              )}
            </div>

            {signals.length > 0 && (
              <div className="ft-signals">
                <p className="ft-signals-label">⚡ Barry notices</p>
                {signals.map((s, i) => (
                  <div key={i} className="ft-signal-line">{s}</div>
                ))}
              </div>
            )}

            {signals.length === 0 && (
              <div className="ft-signals ft-signals--neutral">
                <p className="ft-signals-label">Barry will use RECON context to craft a relevant opening.</p>
              </div>
            )}

            <div className="ft-footer">
              <button className="ft-next-btn" onClick={() => setStep(skipServiceStep ? 3 : 2)}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Service angle (only if > 1 profile) */}
        {step === 2 && !skipServiceStep && (
          <div className="ft-body">
            <p className="ft-section-label">WHICH SERVICE MAKES SENSE HERE?</p>

            <div className="ft-service-list">
              {serviceProfiles.map(profile => (
                <button
                  key={profile.id}
                  className={`ft-service-card${selectedServiceId === profile.id ? ' ft-service-card--selected' : ''}`}
                  onClick={() => setSelectedServiceId(profile.id)}
                >
                  <div className="ft-service-name">{profile.name}</div>
                  {profile.description && (
                    <div className="ft-service-desc">{profile.description}</div>
                  )}
                  {profile.isDefault && <span className="ft-service-default">Default</span>}
                </button>
              ))}
              <button
                className={`ft-service-card ft-service-card--general${selectedServiceId === DEFAULT_SERVICE_ID ? ' ft-service-card--selected' : ''}`}
                onClick={() => setSelectedServiceId(DEFAULT_SERVICE_ID)}
              >
                <div className="ft-service-name">General / No specific service</div>
                <div className="ft-service-desc">Barry uses your RECON context for positioning.</div>
              </button>
            </div>

            <div className="ft-footer">
              <button className="ft-back-btn" onClick={() => setStep(1)}>Back</button>
              <button className="ft-next-btn" onClick={() => setStep(3)}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Optional personal context */}
        {step === 3 && (
          <div className="ft-body">
            <p className="ft-section-label">ANYTHING BARRY SHOULD KNOW?</p>
            <p className="ft-hint">Optional — but Barry gets meaningfully better when you add context.</p>
            <textarea
              className="ft-textarea"
              value={personalContext}
              onChange={e => setPersonalContext(e.target.value.slice(0, 300))}
              placeholder="e.g. Met briefly at a conference last year. She mentioned struggling with pipeline consistency."
              rows={4}
              autoFocus
            />
            <p className="ft-char-count">{personalContext.length}/300</p>

            {error && <p className="ft-error">{error}</p>}

            <div className="ft-footer">
              <button className="ft-back-btn" onClick={() => setStep(skipServiceStep ? 1 : 2)}>Back</button>
              <button
                className="ft-generate-btn"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'Barry is writing…' : '⚡ Generate message'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Draft review */}
        {step === 4 && draft && (
          <div className="ft-body">
            <p className="ft-section-label">BARRY'S FIRST TOUCH DRAFT</p>

            <div className="ft-draft-field">
              <label className="ft-draft-label">Subject line</label>
              <input
                className="ft-draft-input"
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
              />
            </div>

            <div className="ft-draft-field">
              <label className="ft-draft-label">Opening paragraph</label>
              <textarea
                className="ft-draft-textarea"
                value={editParagraph}
                onChange={e => setEditParagraph(e.target.value)}
                rows={6}
              />
            </div>

            {draft.signalsUsed?.length > 0 && (
              <p className="ft-draft-signals">
                Based on: {draft.signalsUsed.join(', ')}
                {selectedProfile ? ` · ${selectedProfile.name}` : ''}
              </p>
            )}

            {error && <p className="ft-error">{error}</p>}

            <div className="ft-footer">
              <button className="ft-back-btn" onClick={() => setStep(3)} disabled={sending}>
                Edit more
              </button>
              <button
                className="ft-send-btn"
                onClick={handleSendToHunter}
                disabled={sending || !editSubject.trim() || !editParagraph.trim()}
              >
                {sending ? 'Sending to Hunter…' : 'Send to Hunter →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
