import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { initializeDashboard } from '../../utils/dashboardUtils';
import { useT } from '../../theme/ThemeContext';
import { useMissionControlTheme } from '../../theme/useMissionControlTheme';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import { getActiveUserId } from '../../context/ImpersonationContext';
import { calculateICPScore, DEFAULT_WEIGHTS, generateMatchReasons } from '../../utils/icpScoring';
import useOnboardingState from '../../hooks/useOnboardingState';
import GmailConnectButton from '../../components/hunter/GmailConnectButton';
import { ArrowRight, Check, Globe, Loader, SkipForward, MessageCircle } from 'lucide-react';
import AnimatedCounter from '../../components/AnimatedCounter';

// ─── Progress Bar ────────────────────────────────────────────────────────────
function ProgressDots({ step, total = 6, T }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 32 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i + 1 === step ? 28 : 8,
          height: 8,
          borderRadius: 4,
          background: i + 1 <= step ? T.accent : T.border2,
          transition: 'all 0.4s ease',
        }} />
      ))}
    </div>
  );
}

// ─── Barry Avatar (matches BarryChat.jsx pattern) ───────────────────────────
function BarryAvatar({ size = 96, T }) {
  const color = T.cyan || BRAND.cyan;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${color})`,
      border: `2px solid ${color}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
      boxShadow: `0 0 ${size * 0.5}px ${color}50`,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

// ─── Speech Bubble ───────────────────────────────────────────────────────────
function BarrySays({ text, T }) {
  return (
    <div style={{
      background: T.cardBg,
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      padding: '16px 20px',
      fontSize: 15,
      lineHeight: 1.6,
      color: T.text,
      maxWidth: 440,
      textAlign: 'center',
    }}>
      {text}
    </div>
  );
}

// ─── CTA Button ──────────────────────────────────────────────────────────────
function CtaButton({ children, onClick, disabled, variant = 'primary', T }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '14px 32px',
        borderRadius: 12,
        border: isPrimary ? 'none' : `1.5px solid ${T.border2}`,
        background: isPrimary
          ? `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.purple})`
          : 'transparent',
        color: isPrimary ? '#fff' : T.textMuted,
        fontSize: 15,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition: 'all 0.2s',
        minWidth: 180,
      }}
    >
      {children}
    </button>
  );
}

// ─── Analysis Progress Steps ─────────────────────────────────────────────────
const ANALYSIS_STEPS = [
  'Analyzing website',
  'Identifying products',
  'Understanding your ICP',
  'Finding target industries',
  'Researching competitors',
  'Crafting your value props',
];

function AnalysisProgress({ activeIndex, T }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
      {ANALYSIS_STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            opacity: i > activeIndex ? 0.3 : 1,
            transition: 'opacity 0.3s',
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: done ? STATUS.green : active ? `${T.accent}20` : T.surface,
              border: `1.5px solid ${done ? STATUS.green : active ? T.accent : T.border}`,
              transition: 'all 0.3s',
            }}>
              {done ? <Check size={14} color="#fff" /> :
               active ? <Loader size={14} color={T.accent} className="animate-spin" /> : null}
            </div>
            <span style={{
              fontSize: 14,
              color: done ? STATUS.green : active ? T.text : T.textFaint,
              fontWeight: done || active ? 600 : 400,
            }}>
              {label}{done ? ' ✓' : active ? '...' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Question Card ───────────────────────────────────────────────────────────
function QuestionCard({ question, answer, onAnswer, index, T }) {
  const [expanded, setExpanded] = useState(false);
  const [localValue, setLocalValue] = useState(answer || '');

  return (
    <div style={{
      background: T.cardBg,
      border: `1.5px solid ${answer ? STATUS.green + '50' : T.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '14px 18px',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: answer ? `${STATUS.green}20` : `${T.accent}15`,
          border: `1.5px solid ${answer ? STATUS.green : T.accent}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, flexShrink: 0,
          color: answer ? STATUS.green : T.accent,
        }}>
          {answer ? <Check size={14} /> : index + 1}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: T.text, flex: 1 }}>
          {question}
        </span>
        <span style={{ color: T.textFaint, fontSize: 18, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
          ›
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8 }}>
          <textarea
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder="Type your answer..."
            rows={2}
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              border: `1.5px solid ${T.border2}`, background: T.input,
              color: T.text, fontSize: 13, resize: 'none',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            onClick={() => { onAnswer(localValue); setExpanded(false); }}
            disabled={!localValue.trim()}
            style={{
              padding: '10px 16px', borderRadius: 10, border: 'none',
              background: localValue.trim() ? T.accent : T.surface,
              color: localValue.trim() ? '#fff' : T.textFaint,
              fontWeight: 600, fontSize: 12, cursor: localValue.trim() ? 'pointer' : 'default',
              alignSelf: 'flex-end',
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Fit Score Badge ─────────────────────────────────────────────────────────
function FitBadge({ score, T }) {
  const color = score >= 90 ? STATUS.green : score >= 70 ? STATUS.amber : T.textFaint;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '3px 10px', borderRadius: 20,
      background: `${color}18`, border: `1px solid ${color}40`,
      fontSize: 13, fontWeight: 700, color,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {score}
    </span>
  );
}

// ─── Company Card (Step 6) ───────────────────────────────────────────────────
function ProspectCard({ company, T }) {
  const name = company.name || company.company_name || 'Unknown Company';
  const industry = company.industry || '';
  const size = company.employee_count || company.employeeCount || '';
  const score = company.fit_score || 0;
  // Specific reasons from the shared scorer; never a generic industry template.
  const reasonList = company.fit_reasons || company.matchReasons || company.match_reasons || [];
  const reason = reasonList.length > 0
    ? reasonList.slice(0, 2).join(' • ')
    : (company.matchReason || company.match_reason || 'Matches your ideal customer profile');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 18px',
      background: T.cardBg,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: `${T.accent}15`, border: `1px solid ${T.accent}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700, color: T.accent, flexShrink: 0,
      }}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{name}</div>
        <div style={{ fontSize: 12, color: T.textMuted }}>
          {[industry, size && `${size} employees`].filter(Boolean).join(' · ')}
        </div>
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{reason}</div>
      </div>
      <FitBadge score={Math.round(score)} T={T} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function OnboardingFlow() {
  useMissionControlTheme();
  const T = useT();
  const navigate = useNavigate();
  const onboarding = useOnboardingState();

  const [step, setStep] = useState(1);
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(-1);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [answers, setAnswers] = useState({});
  const [buildingList, setBuildingList] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [topCompanies, setTopCompanies] = useState([]);
  const [firstName, setFirstName] = useState('');
  const [stillWorking, setStillWorking] = useState(false);

  const hasCheckedOnboardingRef = useRef(false);

  useEffect(() => {
    if (onboarding.loading || hasCheckedOnboardingRef.current) return;
    hasCheckedOnboardingRef.current = true;

    if (onboarding.isComplete) {
      navigate('/mission-control-v2', { replace: true });
      return;
    }
    if (onboarding.flags.started) {
      setStep(onboarding.currentStep);
    }
  }, [onboarding.loading]);

  useEffect(() => {
    const loadUser = async () => {
      const userId = getActiveUserId();
      if (!userId) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          const data = userDoc.data();
          const name = data.firstName || data.displayName || data.name || '';
          setFirstName(name.split(' ')[0] || '');
        }
      } catch { /* ignore */ }
    };
    loadUser();
  }, []);

  // ── Step 1: Meet Barry ──────────────────────────────────────────────────────
  const handleStart = async () => {
    await onboarding.markStep('started');
    setStep(2);
  };

  // ── Step 2: Analyze Website ─────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setAnalyzing(true);
    setAnalysisStep(0);

    // Animate through steps
    const stepTimer = setInterval(() => {
      setAnalysisStep(prev => {
        if (prev >= ANALYSIS_STEPS.length - 1) {
          clearInterval(stepTimer);
          return prev;
        }
        return prev + 1;
      });
    }, 500);

    try {
      const user = auth.currentUser;
      if (!user) return;
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/analyze-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), userId: user.uid, authToken }),
      });

      clearInterval(stepTimer);

      if (response.ok) {
        const data = await response.json();
        if (data.success !== false) {
          setAnalysisStep(ANALYSIS_STEPS.length);
          await onboarding.markStep('websiteAnalyzed');
          setTimeout(() => setStep(3), 1200);
          return;
        }
      }
      // Analysis failed or returned success: false
      setAnalysisFailed(true);
      setAnalysisStep(ANALYSIS_STEPS.length);
      await onboarding.markStep('websiteAnalyzed');
      setTimeout(() => setStep(3), 1500);
    } catch {
      clearInterval(stepTimer);
      setAnalysisFailed(true);
      setAnalysisStep(ANALYSIS_STEPS.length);
      await onboarding.markStep('websiteAnalyzed');
      setTimeout(() => setStep(3), 1500);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSkipWebsite = async () => {
    await onboarding.markStep('websiteAnalyzed');
    setStep(3);
  };

  // ── Step 3: Smart Questions ─────────────────────────────────────────────────
  const QUESTIONS = [
    { key: 'fastestClose', label: 'Which customers close the fastest?', reconField: 'idealCustomerTypes' },
    { key: 'avoidIndustries', label: 'Which industries should I avoid?', reconField: 'excludedIndustries' },
    { key: 'differentiator', label: 'What makes you different?', reconField: 'valueProposition' },
    { key: 'perfectCustomer', label: 'If I had to find one perfect customer, who would it be?', reconField: 'perfectCustomer' },
  ];

  const handleAnswer = (key, value) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const handleFinishQuestions = async () => {
    const userId = getActiveUserId();
    if (!userId) return;

    // Save answers to RECON / dashboard
    // [B1 fix] initializeDashboard ensures dashboards/{uid} exists before writing.
    // Previous code used updateDoc on a non-existent doc — Firestore threw and
    // .catch(() => {}) silently lost every user's Step 3 answers.
    // Temporary compatibility behavior — future onboarding will use the
    // Intelligence Contract storage model, not raw dashboard fields.
    try {
      const reconFields = {};
      QUESTIONS.forEach(q => {
        if (answers[q.key]) reconFields[q.reconField] = answers[q.key];
      });
      if (Object.keys(reconFields).length > 0) {
        await initializeDashboard(userId);
        await updateDoc(doc(db, 'dashboards', userId), reconFields);
      }
    } catch (err) {
      console.error('OnboardingFlow: failed to save ICP answers to dashboard', err);
    }

    // [B2 fix] Trigger company discovery — mirrors BarryOnboarding.jsx:370.
    // Temporary compatibility behavior — future onboarding will not assume
    // company discovery always follows Step 3.
    try {
      const user = auth.currentUser;
      if (user) {
        const authToken = await user.getIdToken();
        const profileDoc = await getDoc(doc(db, 'users', userId, 'companyProfile', 'current'));
        const companyProfile = profileDoc.exists() ? profileDoc.data() : {};

        await setDoc(
          doc(db, 'users', userId),
          { barryState: 'SEARCHING', companiesFoundCount: 0 },
          { merge: true }
        );

        fetch('/.netlify/functions/search-companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, authToken, companyProfile }),
        }).catch(err => console.error('OnboardingFlow: background search failed', err));
      }
    } catch (err) {
      console.error('OnboardingFlow: failed to trigger company discovery', err);
    }

    await onboarding.markStep('smartQuestionsAnswered');
    setStep(4);
  };

  // ── Step 4: Gmail ───────────────────────────────────────────────────────────
  const handleSkipGmail = () => {
    setStep(5);
  };

  const handleGmailSuccess = async () => {
    setStep(5);
  };

  // ── Step 5: Build List (with <24h freshness check) ──────────────────────────
  useEffect(() => {
    if (step !== 5) return;
    setBuildingList(true);
    setStillWorking(false);

    const stillWorkingTimer = setTimeout(() => setStillWorking(true), 10000);
    const DAY_MS = 24 * 60 * 60 * 1000;

    const loadCompanies = async () => {
      const userId = getActiveUserId();
      if (!userId) return;
      try {
        // Load ICP profile
        const profileDoc = await getDoc(doc(db, 'users', userId, 'companyProfile', 'current'));
        const icpProfile = profileDoc.exists() ? profileDoc.data() : null;

        // Load all companies (pending + accepted)
        const companiesRef = collection(db, 'users', userId, 'companies');
        const snapshot = await getDocs(companiesRef);
        const allCompanies = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Check freshness — if any company was discovered/created <24h ago, use existing scores
        const now = Date.now();
        const hasFreshData = allCompanies.length > 0 && allCompanies.some(c => {
          const ts = c.discoveredAt || c.createdAt || c.addedAt;
          if (!ts) return false;
          const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
          return (now - ms) < DAY_MS;
        });

        let scored;
        if (hasFreshData) {
          scored = allCompanies.map(c => ({
            ...c,
            fit_score: c.fit_score || c.icpScore || 50,
          }));
        } else {
          scored = allCompanies.map(c => ({
            ...c,
            fit_score: icpProfile
              ? calculateICPScore(c, icpProfile, icpProfile.scoringWeights || DEFAULT_WEIGHTS)
              : (c.fit_score || c.icpScore || 50),
            fit_reasons: icpProfile
              ? generateMatchReasons(c, icpProfile)
              : (c.fit_reasons || []),
          }));
        }
        scored.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

        setMatchCount(scored.length);
        setTopCompanies(scored.slice(0, 5));

        await onboarding.markStep('completed');
        // [B3 fix] Write the four fields Mission Control's FirstRunView gate expects.
        // Temporary compatibility behavior — the existing onboarding state schema
        // is not the future intelligence model.
        await setDoc(
          doc(db, 'users', userId),
          {
            onboardingComplete: true,
            onboardingSource: 'onboarding_flow',
            hasSeenMCWelcome: false,
            companiesFoundCount: scored.length,
          },
          { merge: true }
        );
        setBuildingList(false);
        clearTimeout(stillWorkingTimer);

        setTimeout(() => setStep(6), 2000);
      } catch (err) {
        console.error('OnboardingFlow: error loading companies', err);
        setMatchCount(0);
        setTopCompanies([]);
        setBuildingList(false);
        clearTimeout(stillWorkingTimer);
        await onboarding.markStep('completed');
        // [B3 fix] Same handoff fields on the error path
        try {
          await setDoc(
            doc(db, 'users', userId),
            {
              onboardingComplete: true,
              onboardingSource: 'onboarding_flow',
              hasSeenMCWelcome: false,
              companiesFoundCount: 0,
            },
            { merge: true }
          );
        } catch { /* best effort — primary markStep already succeeded */ }
        setTimeout(() => setStep(6), 1500);
      }
    };

    loadCompanies();
    return () => clearTimeout(stillWorkingTimer);
  }, [step]);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (onboarding.loading) {
    return (
      <div style={{
        minHeight: '100vh', background: T.appBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Loader size={32} color={T.accent} className="animate-spin" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: T.appBg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      position: 'relative',
    }}>
      <ProgressDots step={step} T={T} />

      {/* ── STEP 1: Meet Barry ─────────────────────────────────────────── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, animation: 'fadeIn 0.5s ease' }}>
          <BarryAvatar size={120} T={T} />
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: T.text, margin: '0 0 12px' }}>
              Hi{firstName ? ` ${firstName}` : ''}, I'm Barry.
            </h1>
            <p style={{ fontSize: 16, color: T.textMuted, lineHeight: 1.6, margin: 0 }}>
              Give me about 3 minutes and I'll have your first matches ready.
              I just need a little context about your business.
            </p>
          </div>
          <CtaButton onClick={handleStart} T={T}>
            Let's do it <ArrowRight size={18} />
          </CtaButton>
        </div>
      )}

      {/* ── STEP 2: Barry Learns Your Business ─────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 480, animation: 'fadeIn 0.5s ease' }}>
          <BarryAvatar size={80} T={T} />
          <BarrySays text="What's your website?" T={T} />

          {analysisStep < 0 ? (
            <>
              <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 400 }}>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="yourcompany.com"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: 12,
                    border: `1.5px solid ${T.border2}`, background: T.input,
                    color: T.text, fontSize: 15, fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <CtaButton onClick={handleAnalyze} disabled={!url.trim() || analyzing} T={T}>
                  <ArrowRight size={18} />
                </CtaButton>
              </div>
              <button
                onClick={handleSkipWebsite}
                style={{
                  background: 'transparent', border: 'none',
                  color: T.textMuted, fontSize: 13, cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                No website? No problem.
              </button>
            </>
          ) : analysisStep < ANALYSIS_STEPS.length ? (
            <AnalysisProgress activeIndex={analysisStep} T={T} />
          ) : (
            <div style={{ textAlign: 'center' }}>
              {analysisFailed ? (
                <BarrySays text="I couldn't read your website automatically. No worries — let me ask you a few questions instead." T={T} />
              ) : (
                <BarrySays text="Perfect. I'm analyzing your company now..." T={T} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Smart Questions ────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%', maxWidth: 480, animation: 'fadeIn 0.5s ease' }}>
          <BarryAvatar size={72} T={T} />
          <BarrySays text="I think I understand your business pretty well. I just have a few questions that only you can answer." T={T} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            {QUESTIONS.map((q, i) => (
              <QuestionCard
                key={q.key}
                question={q.label}
                answer={answers[q.key]}
                onAnswer={(val) => handleAnswer(q.key, val)}
                index={i}
                T={T}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <CtaButton onClick={handleFinishQuestions} T={T}>
              Continue <ArrowRight size={18} />
            </CtaButton>
          </div>

          {Object.keys(answers).length === 0 && (
            <p style={{ fontSize: 12, color: T.textFaint, textAlign: 'center' }}>
              The more you tell me, the better I'll get at finding your perfect customers.
            </p>
          )}
        </div>
      )}

      {/* ── STEP 4: Connect Gmail ──────────────────────────────────────── */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, maxWidth: 440, animation: 'fadeIn 0.5s ease' }}>
          <BarryAvatar size={80} T={T} />
          <BarrySays text="Great! Now I have what I need. I can write personalized outreach and send it from your inbox. To do that, I just need permission." T={T} />

          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 16, padding: 24,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}>
            <div style={{ fontSize: 48 }}>📧</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Connect your Gmail</h3>
            <p style={{ fontSize: 13, color: T.textMuted, textAlign: 'center', margin: 0 }}>
              Secure. Private. We'll never send without your approval.
            </p>
            <GmailConnectButton onSuccess={handleGmailSuccess} />
          </div>

          <button
            onClick={handleSkipGmail}
            style={{
              background: 'transparent', border: 'none',
              color: T.textMuted, fontSize: 13, cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Skip for now
          </button>
        </div>
      )}

      {/* ── STEP 5: Scout Builds Your List ─────────────────────────────── */}
      {step === 5 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, animation: 'fadeIn 0.5s ease' }}>
          <BarryAvatar size={80} T={T} />
          <BarrySays text="Give me a second... Finding companies that match your ideal customer profile." T={T} />

          <div style={{
            textAlign: 'center', padding: '32px 24px',
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 20, minWidth: 280,
          }}>
            <div style={{ fontSize: 14, color: T.textMuted, marginBottom: 8 }}>I found</div>
            <div style={{
              fontSize: 72, fontWeight: 800, color: T.accent,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>
              {buildingList ? <AnimatedCounter target={matchCount || 0} duration={2500} /> : matchCount}
            </div>
            <div style={{ fontSize: 16, color: T.text, marginTop: 8, fontWeight: 600 }}>
              companies that match your ICP
            </div>
          </div>

          {stillWorking && buildingList && (
            <p style={{ fontSize: 12, color: T.textFaint, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Loader size={14} className="animate-spin" /> Still working...
            </p>
          )}
        </div>
      )}

      {/* ── STEP 6: Your First Prospects ───────────────────────────────── */}
      {step === 6 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%', maxWidth: 520, animation: 'fadeIn 0.5s ease' }}>
          <BarryAvatar size={72} T={T} />
          <BarrySays text="Here are your top matches. I've ranked them based on how well they fit your ICP." T={T} />

          {topCompanies.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
              {topCompanies.map((company, i) => (
                <ProspectCard key={company.id || i} company={company} T={T} />
              ))}
            </div>
          ) : (
            <div style={{
              padding: 24, background: T.cardBg, border: `1px solid ${T.border}`,
              borderRadius: 14, textAlign: 'center', width: '100%',
            }}>
              <p style={{ fontSize: 14, color: T.textMuted }}>
                No companies matched yet. Head to Mission Control and Barry will help you find prospects.
              </p>
            </div>
          )}

          <CtaButton onClick={() => navigate('/mission-control-v2')} T={T}>
            Go to Mission Control <ArrowRight size={18} />
          </CtaButton>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
