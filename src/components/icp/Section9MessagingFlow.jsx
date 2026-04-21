import { useState, useEffect } from 'react';
import { doc, updateDoc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import './Section9MessagingFlow.css';

const QUESTIONS = [
  {
    id: 'idealCustomer',
    label: 'Who is your ideal customer for this profile?',
    placeholder: 'e.g. VP of Sales at B2B SaaS companies with 50–500 employees who struggle with pipeline consistency',
    hint: 'Role + company type + size + the core pain they have',
  },
  {
    id: 'coreOutcome',
    label: "What's the #1 outcome your best customers get?",
    placeholder: 'e.g. They consistently book 20+ qualified meetings per month within 60 days of starting',
    hint: 'Specific and measurable is better than vague',
  },
  {
    id: 'differentiation',
    label: 'What makes you genuinely different from alternatives?',
    placeholder: "e.g. We build the system with them — not just software they figure out alone",
    hint: 'In their words, not yours. What would a customer tell a peer?',
  },
  {
    id: 'brandVoice',
    label: 'How should outreach to this audience sound?',
    placeholder: 'e.g. Confident and direct, peer-to-peer — like a trusted advisor, not a salesperson. No fluff.',
    hint: 'Tone, formality, energy level',
  },
  {
    id: 'objectionHandling',
    label: "What's their most common objection, and how do you handle it?",
    placeholder: 'e.g. "We already have a tool" → We\'re not a tool, we\'re a system built around your team',
    hint: 'The pushback they give + your response',
  },
  {
    id: 'bestCTA',
    label: 'What\'s the best ask for cold outreach to this audience?',
    placeholder: "e.g. A 15-minute call to see if there's a fit — no pitch, just questions",
    hint: 'The CTA that actually gets replies',
  },
  {
    id: 'openingLine',
    label: "Share an opening line or subject line that's worked for you.",
    placeholder: 'e.g. Subject: "saw your SDR job post" / Opener: "noticed you\'re scaling your sales team..."',
    hint: "Optional — skip if you don't have one yet",
    optional: true,
  },
];

export default function Section9MessagingFlow({ icpId, icpName, onComplete, onDismiss, existingAnswers = {} }) {
  const [step, setStep] = useState(() => {
    // Resume from the first unanswered question
    const firstUnanswered = QUESTIONS.findIndex(q => !existingAnswers[q.id]);
    return firstUnanswered >= 0 ? firstUnanswered : 0;
  });
  const [answers, setAnswers] = useState(existingAnswers);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [activating, setActivating] = useState(false);

  const question = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;
  const completedCount = QUESTIONS.filter(q => answers[q.id]).length;
  const progress = Math.round((completedCount / QUESTIONS.length) * 100);

  useEffect(() => {
    setCurrentAnswer(answers[QUESTIONS[step]?.id] || '');
  }, [step]);

  async function saveProgress(updatedAnswers, progressPct) {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid, 'icpProfiles', icpId), {
        messaging: updatedAnswers,
        messagingProgress: progressPct,
        status: progressPct >= 100 ? 'inactive' : 'pending',
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[Section9MessagingFlow] saveProgress failed:', err.message);
    }
  }

  async function handleNext() {
    if (!currentAnswer.trim() && !question.optional) return;
    setSaving(true);
    const updatedAnswers = { ...answers, [question.id]: currentAnswer.trim() };
    setAnswers(updatedAnswers);
    const newCompleted = QUESTIONS.filter(q => updatedAnswers[q.id]).length;
    const progressPct = Math.round((newCompleted / QUESTIONS.length) * 100);
    await saveProgress(updatedAnswers, isLast ? 100 : progressPct);
    setSaving(false);
    if (isLast) {
      setShowCompletion(true);
    } else {
      setStep(s => s + 1);
    }
  }

  async function handleActivateNow() {
    try {
      setActivating(true);
      const user = getEffectiveUser();
      if (!user) return;

      const allSnap = await getDocs(collection(db, 'users', user.uid, 'icpProfiles'));
      const batch = writeBatch(db);

      allSnap.docs.forEach(d => {
        const isTarget = d.id === icpId;
        batch.update(doc(db, 'users', user.uid, 'icpProfiles', d.id), {
          isActive: isTarget,
          status: isTarget ? 'active' : (d.data().status === 'active' ? 'inactive' : (d.data().status || 'inactive')),
          updatedAt: new Date().toISOString(),
        });
      });

      const targetData = allSnap.docs.find(d => d.id === icpId)?.data() || {};
      batch.set(doc(db, 'users', user.uid, 'companyProfile', 'current'), {
        ...targetData,
        messaging: answers,
        messagingProgress: 100,
        isActive: true,
        status: 'active',
        updatedAt: new Date().toISOString(),
      });

      await batch.commit();
      onComplete?.({ activated: true, icpId, answers });
    } catch (err) {
      console.error('[Section9MessagingFlow] activate failed:', err.message);
      setActivating(false);
    }
  }

  async function handleSaveForLater() {
    onComplete?.({ activated: false, icpId, answers });
  }

  async function handleDismiss() {
    if (Object.keys(answers).length > 0 || currentAnswer.trim()) {
      const updatedAnswers = currentAnswer.trim()
        ? { ...answers, [question.id]: currentAnswer.trim() }
        : answers;
      const newCompleted = QUESTIONS.filter(q => updatedAnswers[q.id]).length;
      const progressPct = Math.round((newCompleted / QUESTIONS.length) * 100);
      await saveProgress(updatedAnswers, progressPct);
    }
    onDismiss?.();
  }

  return (
    <div className="s9-overlay">
      <div className="s9-modal">
        <div className="s9-header">
          <div className="s9-barry-avatar">🐻</div>
          <div className="s9-header-text">
            <h2 className="s9-title">Messaging Profile</h2>
            <p className="s9-subtitle">{icpName || 'New ICP'} — Section 9 of RECON</p>
          </div>
          <button className="s9-close-btn" onClick={handleDismiss} aria-label="Close">×</button>
        </div>

        {!showCompletion ? (
          <>
            <div className="s9-progress-track">
              <div className="s9-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="s9-step-counter">Question {step + 1} of {QUESTIONS.length}</p>

            <div className="s9-body">
              <label className="s9-question">{question.label}</label>
              {question.hint && <p className="s9-hint">{question.hint}</p>}
              <textarea
                className="s9-textarea"
                value={currentAnswer}
                onChange={e => setCurrentAnswer(e.target.value)}
                placeholder={question.placeholder}
                rows={4}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleNext();
                }}
              />
              <p className="s9-keyboard-hint">⌘ + Enter to continue</p>
            </div>

            <div className="s9-footer">
              {step > 0 && (
                <button className="s9-back-btn" onClick={() => setStep(s => s - 1)}>
                  Back
                </button>
              )}
              <button
                className="s9-next-btn"
                onClick={handleNext}
                disabled={saving || (!currentAnswer.trim() && !question.optional)}
              >
                {saving ? 'Saving…' : isLast ? 'Finish' : 'Next →'}
              </button>
            </div>
          </>
        ) : (
          <div className="s9-completion">
            <div className="s9-completion-icon">✓</div>
            <h3 className="s9-completion-title">Messaging profile complete</h3>
            <p className="s9-completion-sub">
              Barry now has everything he needs to write outreach for{' '}
              <strong>{icpName || 'this profile'}</strong>.
            </p>
            <p className="s9-completion-question">What would you like to do?</p>
            <div className="s9-completion-actions">
              <button
                className="s9-activate-btn"
                onClick={handleActivateNow}
                disabled={activating}
              >
                {activating ? 'Activating…' : 'Set as active now'}
              </button>
              <button className="s9-later-btn" onClick={handleSaveForLater}>
                Save for later
              </button>
            </div>
            <p className="s9-completion-note">
              "Save for later" keeps this profile in a ready state — you can activate it from ICP Settings anytime.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
