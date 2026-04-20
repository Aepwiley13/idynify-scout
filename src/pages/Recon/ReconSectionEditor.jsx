/**
 * ReconSectionEditor — Redesigned with Barry guide panel.
 *
 * Layout:
 *   Desktop: [Form — 60%] | [Barry Guide — 40%]
 *   Mobile:  [Form] stacked above [Barry Guide]
 *
 * Barry panel:
 *   - Intro message on section open
 *   - Ask Barry freeform questions
 *   - Coaching response appears in panel (not below form)
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, CheckCircle2, Clock, AlertTriangle, Lock } from 'lucide-react';
import { auth } from '../../firebase/config';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';
import ReconFeedbackToast from '../../components/recon/ReconFeedbackToast';
import BarryReconGuide from '../../components/recon/BarryReconGuide';
import BarryReconCoach from '../../components/recon/BarryReconCoach';
import { getSectionData, startSection, completeSection, saveSectionData } from '../../utils/dashboardUtils';
import Section1Foundation from '../../components/recon/Section1Foundation';
import Section2ProductDeepDive from '../../components/recon/Section2ProductDeepDive';
import Section3TargetMarketFirmographics from '../../components/recon/Section3TargetMarketFirmographics';
import Section4IdealCustomerPsychographics from '../../components/recon/Section4IdealCustomerPsychographics';
import Section5PainPointsMotivations from '../../components/recon/Section5PainPointsMotivations';
import Section6BuyingBehaviorTriggers from '../../components/recon/Section6BuyingBehaviorTriggers';
import Section7DecisionProcess from '../../components/recon/Section7DecisionProcess';
import Section8CompetitiveLandscape from '../../components/recon/Section8CompetitiveLandscape';
import Section9Messaging from '../../components/recon/Section9Messaging';
import Section10BehavioralSignals from '../../components/recon/Section10BehavioralSignals';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';

// Indigo for Recon accent
const RECON_INDIGO = '#6366f1';

const SECTION_TO_MODULE = {
  1: 'icp-intelligence',
  2: 'icp-intelligence',
  3: 'icp-intelligence',
  4: 'icp-intelligence',
  5: 'objections',
  6: 'objections',
  7: 'buying-signals',
  8: 'competitive-intel',
  9: 'messaging',
  10: 'buying-signals',
};

const SECTION_COMPONENTS = {
  1: Section1Foundation,
  2: Section2ProductDeepDive,
  3: Section3TargetMarketFirmographics,
  4: Section4IdealCustomerPsychographics,
  5: Section5PainPointsMotivations,
  6: Section6BuyingBehaviorTriggers,
  7: Section7DecisionProcess,
  8: Section8CompetitiveLandscape,
  9: Section9Messaging,
  10: Section10BehavioralSignals,
};

const STATUS_CONFIG = {
  not_started: { label: 'Not started', color: '#9ca3af', Icon: Clock },
  in_progress: { label: 'In progress', color: '#f59e0b', Icon: AlertTriangle },
  completed: { label: 'Completed', color: '#10b981', Icon: CheckCircle2 },
};

const SECTION_TITLES = {
  1: 'Business Foundation',
  2: 'Product Deep Dive',
  3: 'Target Market Firmographics',
  4: 'Ideal Customer Psychographics',
  5: 'Pain Points & Motivations',
  6: 'Buying Behavior & Triggers',
  7: 'Decision Process',
  8: 'Competitive Landscape',
  9: 'Messaging & Value Proposition',
  10: 'Behavioral Signals',
};

// Why Barry needs the prerequisite section before unlocking the current one.
// Sequential model: section N unlocks when N-1 is complete.
const SECTION_PREREQ_REASONS = {
  2: 'Barry needs your Business Foundation to understand what you sell before mapping your product in detail.',
  3: 'Barry uses your product details to identify the right market segments — complete Section 2 first.',
  4: 'Barry needs your market definition to understand who you target before building a psychographic profile.',
  5: 'Barry uses the psychographic profile to understand buyer mindset before pinpointing the pain points that drive action.',
  6: 'Barry connects your pain points to the buying triggers and objections he coaches you through — complete Section 5 first.',
  7: 'Barry uses your foundation sections to understand your business context before mapping the decision process.',
  8: 'Barry needs your target market and positioning before building competitive differentiation angles.',
  9: "Barry needs your Messaging & Voice answers before coaching you through Competitive Intel — he uses your tone and positioning as the foundation for competitive differentiation.",
  10: 'Barry uses your earlier RECON data to contextualize behavioral signals and buying triggers.',
};

export default function ReconSectionEditor() {
  const T = useT();
  const navigate = useNavigate();
  const { sectionId } = useParams();

  const [section, setSection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blockedSection, setBlockedSection] = useState(null);
  const [formData, setFormData] = useState({});
  const [showToast, setShowToast] = useState(false);
  const [toastVariant, setToastVariant] = useState('save');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [coaching, setCoaching] = useState(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachUserId, setCoachUserId] = useState(null);

  // Responsive
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 900px)');
    const handler = e => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const sectionNum = parseInt(sectionId);
  const parentModule = SECTION_TO_MODULE[sectionNum];
  const SectionComponent = SECTION_COMPONENTS[sectionNum];

  useEffect(() => {
    setLoading(true);
    setCoaching(null);
    setFormData({});
    loadSection();
  }, [sectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSection = async () => {
    let navigatedAway = false;
    try {
      const user = getEffectiveUser();
      if (!user) {
        navigatedAway = true;
        navigate('/login');
        return;
      }

      const sectionData = await getSectionData(user.uid, 'recon', sectionNum);

      if (!sectionData || !sectionData.unlocked) {
        const prereqId = sectionNum - 1;
        setBlockedSection({
          lockedTitle: SECTION_TITLES[sectionNum] || `Section ${sectionNum}`,
          prereqId,
          prereqTitle: SECTION_TITLES[prereqId] || `Section ${prereqId}`,
          reason: SECTION_PREREQ_REASONS[sectionNum] || 'Complete the previous section to unlock this one.',
        });
        setLoading(false);
        return;
      }

      setSection(sectionData);
      setFormData(sectionData.data || {});
      setCoachUserId(user.uid);

      if (sectionData.status === 'not_started') {
        await startSection(user.uid, 'recon', sectionNum);
      }
    } catch (error) {
      console.error('Error loading section:', error);
    } finally {
      if (!navigatedAway) setLoading(false);
    }
  };

  const fetchCoaching = async (savedData) => {
    setCoachingLoading(true);
    setCoaching(null);
    try {
      const user = getEffectiveUser();
      if (!user) return null;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barry-coach-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          sectionId: sectionNum,
          sectionData: savedData,
        }),
      });

      if (!res.ok) throw new Error(`Coaching fetch failed: ${res.status}`);
      const { coaching: c } = await res.json();
      setCoaching(c);
      return c;
    } catch (err) {
      console.error('[ReconSectionEditor] coaching fetch error:', err);
      return null;
    } finally {
      setCoachingLoading(false);
    }
  };

  const handleSave = async (data) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const dataToSave = data || formData;
      await saveSectionData(user.uid, 'recon', sectionNum, dataToSave);

      if (data) setFormData(data);

      setIsSaving(false);
      setToastVariant('save');
      setShowToast(true);

      fetchCoaching(dataToSave);
    } catch (error) {
      console.error('Error saving:', error);
      setIsSaving(false);
      setSaveError('Save failed — check your connection and try again.');
      throw error;
    }
  };

  const handleComplete = async (data) => {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const dataToSave = data || formData;
      await completeSection(user.uid, 'recon', sectionNum, dataToSave);

      setToastVariant('complete');
      setShowToast(true);

      const coachResult = await fetchCoaching(dataToSave);

      setTimeout(() => {
        navigate(parentModule ? `/recon/${parentModule}` : '/recon');
      }, coachResult ? 3500 : 2000);
    } catch (error) {
      console.error('Error completing section:', error);
      throw error;
    }
  };

  const navigateBack = () => {
    navigate(parentModule ? `/recon/${parentModule}` : '/recon');
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '60px 24px', flexDirection: 'column', gap: 12,
        background: T.appBg, minHeight: '60vh',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: `3px solid ${RECON_INDIGO}30`,
          borderTop: `3px solid ${RECON_INDIGO}`,
          animation: 'recon-spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes recon-spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: 13, color: T.textMuted, fontWeight: 600 }}>Loading Section...</p>
      </div>
    );
  }

  if (blockedSection) {
    return (
      <div style={{
        background: T.appBg, minHeight: '100vh',
        fontFamily: 'Inter, system-ui, sans-serif', color: T.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px',
      }}>
        <div style={{
          maxWidth: 520, width: '100%',
          background: T.cardBg,
          border: `1px solid ${T.border}`,
          borderRadius: 16, padding: '36px 32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `${RECON_INDIGO}15`,
            border: `1px solid ${RECON_INDIGO}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 20,
          }}>
            <Lock size={22} color={RECON_INDIGO} />
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            {blockedSection.lockedTitle} is locked
          </h2>

          <p style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.6, margin: '0 0 24px' }}>
            {blockedSection.reason}
          </p>

          <div style={{
            background: T.isDark ? `${RECON_INDIGO}10` : `${RECON_INDIGO}07`,
            border: `1px solid ${RECON_INDIGO}25`,
            borderRadius: 10, padding: '14px 16px',
            marginBottom: 24,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: RECON_INDIGO, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Complete first
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, color: T.text, margin: 0 }}>
              Section {blockedSection.prereqId}: {blockedSection.prereqTitle}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => navigate(`/recon/section/${blockedSection.prereqId}`)}
              style={{
                flex: 1, padding: '12px 16px',
                background: RECON_INDIGO, color: '#fff',
                border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              Go to Section {blockedSection.prereqId} →
            </button>
            <button
              onClick={() => navigate(parentModule ? `/recon/${parentModule}` : '/recon')}
              style={{
                padding: '12px 16px',
                background: T.surface, color: T.textMuted,
                border: `1px solid ${T.border2}`, borderRadius: 10,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = RECON_INDIGO; e.currentTarget.style.color = RECON_INDIGO; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border2; e.currentTarget.style.color = T.textMuted; }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!section || !SectionComponent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <p style={{ color: '#dc2626', fontSize: 14, fontWeight: 600 }}>Section not found</p>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[section.status] || STATUS_CONFIG.not_started;
  const StatusIcon = statusCfg.Icon;

  return (
    <div style={{
      background: T.appBg,
      minHeight: '100%',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: T.text,
    }}>
      {/* ── Top bar ── */}
      <div style={{
        padding: isMobile ? '12px 16px 10px' : '14px 28px 12px',
        borderBottom: `1px solid ${T.border}`,
        background: T.cardBg,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        {/* Breadcrumbs */}
        <ReconBreadcrumbs sectionTitle={section?.title} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <button
            onClick={navigateBack}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              background: T.surface, border: `1px solid ${T.border2}`,
              borderRadius: 8, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: T.textMuted,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = RECON_INDIGO; e.currentTarget.style.color = RECON_INDIGO; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border2; e.currentTarget.style.color = T.textMuted; }}
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Status badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px',
              background: `${statusCfg.color}15`,
              border: `1px solid ${statusCfg.color}30`,
              borderRadius: 20,
              fontSize: 11, fontWeight: 600, color: statusCfg.color,
            }}>
              <StatusIcon size={11} />
              {statusCfg.label}
            </div>

            {/* Section number badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px',
              background: `${RECON_INDIGO}12`,
              border: `1px solid ${RECON_INDIGO}25`,
              borderRadius: 20,
              fontSize: 11, fontWeight: 700, color: RECON_INDIGO,
            }}>
              <Brain size={11} />
              Section {section.order}
            </div>

            {/* Save status indicator */}
            {isSaving && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px',
                background: '#f59e0b15', border: '1px solid #f59e0b30',
                borderRadius: 20, fontSize: 11, fontWeight: 600, color: '#f59e0b',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  border: '1.5px solid #f59e0b40', borderTop: '1.5px solid #f59e0b',
                  animation: 'recon-spin 0.7s linear infinite',
                }} />
                Saving…
              </div>
            )}
          </div>
        </div>

        {/* Save error banner */}
        {saveError && !isSaving && (
          <div style={{
            marginTop: 8, padding: '8px 12px',
            background: '#dc262610', border: '1px solid #dc262630',
            borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#dc2626',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>⚠ {saveError}</span>
            <button
              onClick={() => setSaveError(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
            >×</button>
          </div>
        )}

        {/* Title row */}
        <div style={{ marginTop: 10 }}>
          <h1 style={{
            fontSize: isMobile ? 16 : 18, fontWeight: 800,
            color: T.text, margin: '0 0 4px',
            letterSpacing: '-0.02em',
          }}>
            {section.title}
          </h1>
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
            {section.description}
          </p>
          {section.estimatedTime && (
            <p style={{ fontSize: 11, color: T.textFaint, marginTop: 3 }}>
              <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />
              {section.estimatedTime}
            </p>
          )}
        </div>
      </div>

      {/* ── Main two-column layout ── */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 0 : 0,
        minHeight: 'calc(100vh - 160px)',
      }}>
        {/* Left: Form content */}
        <div style={{
          flex: isMobile ? 'none' : '0 0 60%',
          padding: isMobile ? '20px 16px 32px' : '24px 28px 40px',
          borderRight: isMobile ? 'none' : `1px solid ${T.border}`,
          overflowY: 'auto',
        }}>
          {/* Context instruction banner */}
          <div style={{
            background: T.isDark ? `${RECON_INDIGO}10` : `${RECON_INDIGO}07`,
            border: `1px solid ${RECON_INDIGO}20`,
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 20,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <Brain size={14} color={RECON_INDIGO} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: T.textMuted, margin: 0, lineHeight: 1.55 }}>
              Your answers train Barry directly. More specific = smarter context across Scout and Hunter.
              Ask Barry on the right if you're unsure what to write.
            </p>
          </div>

          {/* The actual section form */}
          <div className="section-form">
            <SectionComponent
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          </div>
        </div>

        {/* Right: Barry Guide */}
        <div style={{
          flex: isMobile ? 'none' : '0 0 40%',
          padding: isMobile ? '16px 16px 32px' : '24px 20px 40px',
          background: T.isDark ? `${T.cardBg}80` : T.cardBg2,
          display: 'flex', flexDirection: 'column',
          minHeight: isMobile ? 400 : 'auto',
        }}>
          {/* Barry panel label + Coach CTA */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: T.textFaint,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
                flexShrink: 0,
              }} />
              Barry's Guide
            </div>
            <button
              onClick={() => setCoachOpen(true)}
              style={{
                padding: '5px 11px', borderRadius: 8,
                background: `${RECON_INDIGO}15`,
                border: `1px solid ${RECON_INDIGO}35`,
                color: RECON_INDIGO, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${RECON_INDIGO}25`; }}
              onMouseLeave={e => { e.currentTarget.style.background = `${RECON_INDIGO}15`; }}
            >
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                background: `linear-gradient(135deg,${BRAND.pink},${RECON_INDIGO})`,
              }} />
              Coach me through this
            </button>
          </div>

          <div style={{ flex: 1 }}>
            <BarryReconGuide
              sectionId={sectionNum}
              sectionTitle={section.title}
              formData={formData}
              coachingData={coaching}
              coachingLoading={coachingLoading}
            />
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      <ReconFeedbackToast
        sectionId={sectionNum}
        isVisible={showToast}
        onClose={() => setShowToast(false)}
        variant={toastVariant}
      />

      {/* Barry Conversational Coach */}
      {coachOpen && coachUserId && (
        <BarryReconCoach
          sectionId={sectionNum}
          sectionLabel={section.title}
          existingAnswers={formData}
          userId={coachUserId}
          onClose={() => setCoachOpen(false)}
          onComplete={() => setCoachOpen(false)}
        />
      )}
    </div>
  );
}
