import { useState } from 'react';
import { doc, collection, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import './ServiceProfileSetup.css';

const QUESTIONS = [
  {
    id: 'name',
    label: 'What do you call this service?',
    placeholder: 'e.g. Website Design & Development',
    hint: 'Keep it short — this is what Barry shows when selecting a service angle.',
  },
  {
    id: 'description',
    label: 'One sentence: what does this service do?',
    placeholder: 'e.g. We design and build custom websites for service businesses that need to convert visitors into leads',
    hint: 'Think outcome: what does the buyer get?',
  },
  {
    id: 'painPoints',
    label: 'What are the top 2–3 problems this service solves?',
    placeholder: 'Outdated website that doesn\'t generate leads\nNo mobile-optimized presence\nLooks less credible than competitors',
    hint: 'One problem per line. Be specific about what keeps buyers up at night.',
    multiline: true,
  },
  {
    id: 'primaryBuyer',
    label: 'Who typically buys this service?',
    placeholder: 'e.g. Small business owners with 1–10 employees in service industries who need a professional web presence',
    hint: 'Role, company type, or situation. Who is this for?',
  },
  {
    id: 'positioningNote',
    label: 'How should Barry position this in outreach? (optional)',
    placeholder: 'e.g. Lead with ROI — "most clients pay for the site in the first new customer it brings in"',
    hint: '200 characters max. Skip if Barry should figure it out from RECON context.',
    optional: true,
    maxLength: 200,
  },
];

export default function ServiceProfileSetup({ onComplete, onDismiss }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [savedProfileId, setSavedProfileId] = useState(null);

  const question = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;
  const progress = Math.round((step / QUESTIONS.length) * 100);

  async function handleNext() {
    if (!currentAnswer.trim() && !question.optional) return;
    setSaving(true);

    const value = question.id === 'painPoints'
      ? currentAnswer.trim().split('\n').map(s => s.trim()).filter(Boolean)
      : question.maxLength
      ? currentAnswer.trim().slice(0, question.maxLength)
      : currentAnswer.trim();

    const updatedAnswers = { ...answers, [question.id]: value };
    setAnswers(updatedAnswers);

    if (isLast) {
      await saveProfile(updatedAnswers);
    } else {
      setSaving(false);
      setStep(s => s + 1);
      setCurrentAnswer('');
    }
  }

  async function saveProfile(finalAnswers) {
    try {
      const user = getEffectiveUser();
      if (!user) { setSaving(false); return; }

      const profileData = {
        name: finalAnswers.name || '',
        description: finalAnswers.description || '',
        painPoints: finalAnswers.painPoints || [],
        primaryBuyer: finalAnswers.primaryBuyer || '',
        positioningNote: finalAnswers.positioningNote || '',
        isDefault: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(
        collection(db, 'users', user.uid, 'serviceProfiles'),
        profileData
      );

      setSavedProfileId(docRef.id);
      setShowCompletion(true);
    } catch (err) {
      console.error('[ServiceProfileSetup] save failed:', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault() {
    if (!savedProfileId) return;
    try {
      const user = getEffectiveUser();
      if (!user) return;
      await updateDoc(
        doc(db, 'users', user.uid, 'serviceProfiles', savedProfileId),
        { isDefault: true, updatedAt: serverTimestamp() }
      );
    } catch (err) {
      console.warn('[ServiceProfileSetup] set default failed:', err.message);
    }
    onComplete?.({ profileId: savedProfileId, isDefault: true, answers });
  }

  function handleDone() {
    onComplete?.({ profileId: savedProfileId, isDefault: false, answers });
  }

  return (
    <div className="sps-overlay">
      <div className="sps-modal">
        <div className="sps-header">
          <div className="sps-barry-avatar">🐻</div>
          <div className="sps-header-text">
            <h2 className="sps-title">New Service Profile</h2>
            <p className="sps-subtitle">5 questions — under 10 minutes</p>
          </div>
          <button className="sps-close-btn" onClick={onDismiss} aria-label="Close">×</button>
        </div>

        {!showCompletion ? (
          <>
            <div className="sps-progress-track">
              <div className="sps-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="sps-step-counter">Question {step + 1} of {QUESTIONS.length}</p>

            <div className="sps-body">
              <label className="sps-question">{question.label}</label>
              {question.hint && <p className="sps-hint">{question.hint}</p>}
              <textarea
                className="sps-textarea"
                value={currentAnswer}
                onChange={e => {
                  const val = question.maxLength
                    ? e.target.value.slice(0, question.maxLength)
                    : e.target.value;
                  setCurrentAnswer(val);
                }}
                placeholder={question.placeholder}
                rows={question.multiline ? 5 : 3}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleNext();
                }}
              />
              {question.maxLength && (
                <p className="sps-char-count">{currentAnswer.length}/{question.maxLength}</p>
              )}
              <p className="sps-keyboard-hint">⌘ + Enter to continue</p>
            </div>

            <div className="sps-footer">
              {step > 0 && (
                <button className="sps-back-btn" onClick={() => { setStep(s => s - 1); setCurrentAnswer(answers[QUESTIONS[step - 1]?.id] || ''); }}>
                  Back
                </button>
              )}
              <button
                className="sps-next-btn"
                onClick={handleNext}
                disabled={saving || (!currentAnswer.trim() && !question.optional)}
              >
                {saving ? 'Saving…' : isLast ? 'Save Profile' : 'Next →'}
              </button>
            </div>
          </>
        ) : (
          <div className="sps-completion">
            <div className="sps-completion-icon">✓</div>
            <h3 className="sps-completion-title">Service profile saved</h3>
            <p className="sps-completion-sub">
              Barry now knows about <strong>{answers.name || 'this service'}</strong> and can use it when crafting outreach.
            </p>
            <p className="sps-completion-question">Set this as Barry's default service?</p>
            <div className="sps-completion-actions">
              <button className="sps-default-btn" onClick={handleSetDefault}>
                Set as default
              </button>
              <button className="sps-done-btn" onClick={handleDone}>
                Save without default
              </button>
            </div>
            <p className="sps-completion-note">
              The default is what Barry reaches for when no specific service is selected. You can change it anytime from Your Services.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
