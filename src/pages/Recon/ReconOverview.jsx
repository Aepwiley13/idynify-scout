import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { initializeDashboard } from '../../utils/dashboardUtils';
import {
  Brain,
  Target,
  MessageSquare,
  Shield,
  Swords,
  Zap,
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertCircle,
  Users,
  Mail,
  Sparkles,
  AlertTriangle,
  Clock,
  AlertOctagon,
  CheckCircle,
} from 'lucide-react';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';
import CommunicationStyleSelector from '../../components/recon/CommunicationStyleSelector';
import LiveOutputPreview from '../../components/recon/LiveOutputPreview';
import { computeReconHealth, getTrainNextRecommendation } from '../../shared/reconHealth';
import { TRAINING_DIMENSIONS, DIMENSION_MODULE_PATH } from '../../shared/reconHealthConstants';
import './ReconOverview.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// ─── RECON modules (unchanged — entry points into training workflows) ─────────
const RECON_MODULES = [
  {
    id: 'icp-intelligence',
    title: 'ICP Intelligence',
    description: 'Define your ideal customer profile — who they are, where they work, and what they look like.',
    icon: Target,
    color: 'purple',
    sections: [1, 2, 3, 4],
    sectionNames: ['Business Foundation', 'Product Deep Dive', 'Target Market', 'Customer Psychographics'],
    impactAreas: ['Scout lead scoring', 'Barry prospect matching', 'Hunter targeting'],
    path: '/recon/icp-intelligence'
  },
  {
    id: 'objections',
    title: 'Objections & Constraints',
    description: 'Map customer pain points, motivations, and buying behavior to handle objections.',
    icon: Shield,
    color: 'amber',
    sections: [5, 6],
    sectionNames: ['Pain Points & Motivations', 'Buying Behavior & Triggers'],
    impactAreas: ['Barry objection handling', 'Hunter follow-up intelligence', 'Conversation depth'],
    path: '/recon/objections'
  },
  {
    id: 'competitive-intel',
    title: 'Competitive Intel',
    description: 'Map your competitive landscape so Barry knows how to position against alternatives.',
    icon: Swords,
    color: 'red',
    sections: [8],
    sectionNames: ['Competitive Landscape'],
    impactAreas: ['Barry competitive positioning', 'Hunter differentiation', 'Prospect qualification'],
    path: '/recon/competitive-intel'
  },
  {
    id: 'buying-signals',
    title: 'Buying Signals',
    description: 'Define decision processes and behavioral triggers that indicate readiness to buy.',
    icon: Zap,
    color: 'emerald',
    sections: [7, 10],
    sectionNames: ['Decision Process', 'Behavioral & Timing Signals'],
    impactAreas: ['Scout lead prioritization', 'Hunter timing optimization', 'Barry urgency detection'],
    path: '/recon/buying-signals'
  }
];

// Platform impact mapping (unchanged)
const PLATFORM_IMPACTS = [
  {
    system: 'Scout',
    icon: Users,
    color: 'cyan',
    impacts: [
      { source: 'ICP Intelligence', effect: 'Better lead scoring — Barry matches prospects against your actual ICP' },
      { source: 'Buying Signals', effect: 'Prioritizes leads showing real purchase intent' },
      { source: 'Competitive Intel', effect: 'Filters out prospects already locked into competitors' }
    ]
  },
  {
    system: 'Hunter',
    icon: Mail,
    color: 'pink',
    impacts: [
      { source: 'Messaging & Voice', effect: 'Messages use your real value proposition, not generic templates' },
      { source: 'Objections & Constraints', effect: 'Follow-ups address actual concerns before they surface' },
      { source: 'Buying Signals', effect: 'Outreach timing matches buyer readiness signals' }
    ]
  },
  {
    system: 'Barry',
    icon: Brain,
    color: 'purple',
    impacts: [
      { source: 'All RECON Modules', effect: 'Context generation informed by your business, not just contact data' },
      { source: 'Competitive Intel', effect: 'Conversation starters reference relevant industry dynamics' },
      { source: 'ICP Intelligence', effect: 'Qualification assessment based on your actual customer patterns' }
    ]
  }
];

// ─── Tile state icon map ───────────────────────────────────────────────────────
function TileIcon({ state }) {
  if (state === 'strong')   return <CheckCircle size={18} className="km-tile-icon km-tile-icon--strong" />;
  if (state === 'weak')     return <AlertTriangle size={18} className="km-tile-icon km-tile-icon--weak" />;
  if (state === 'stale')    return <Clock size={18} className="km-tile-icon km-tile-icon--stale" />;
  if (state === 'conflict') return <AlertOctagon size={18} className="km-tile-icon km-tile-icon--conflict" />;
  return <Circle size={18} className="km-tile-icon km-tile-icon--empty" />;
}

// ─── Score color ──────────────────────────────────────────────────────────────
function scoreColorClass(score) {
  if (score >= 85) return 'score--deep-green';
  if (score >= 65) return 'score--green';
  if (score >= 40) return 'score--amber';
  return 'score--red';
}

// ─── Animated counter hook ────────────────────────────────────────────────────
function useAnimatedScore(target, duration = 400) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;

    const steps = 20;
    const interval = duration / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      setDisplay(Math.round(from + (target - from) * progress));
      if (step >= steps) clearInterval(timer);
    }, interval);

    return () => clearInterval(timer);
  }, [target, duration]);

  return display;
}

// ─── Hover tooltip content ────────────────────────────────────────────────────
function TileTooltip({ dimension, state, stalenessFlags }) {
  const staleFlag = dimension.sections.reduce((worst, sId) => {
    const f = stalenessFlags.find((x) => x.sectionId === sId);
    return f && f.daysSinceUpdate > (worst?.daysSinceUpdate || 0) ? f : worst;
  }, null);

  if (state === 'conflict') {
    return (
      <div className="recon-heatmap-tooltip-content">
        <p className="recon-heatmap-tooltip-title km-tooltip--conflict">ICP Conflict Detected</p>
        <p className="recon-heatmap-tooltip-body">
          Your ICP settings have changed since this dimension was trained.
          Barry's targeting and your Scout ICP settings no longer match.
        </p>
        <p className="recon-heatmap-tooltip-cta">Tap to reconcile →</p>
      </div>
    );
  }
  if (state === 'stale') {
    return (
      <div className="recon-heatmap-tooltip-content">
        <p className="recon-heatmap-tooltip-title">{dimension.label} — Outdated</p>
        <p className="recon-heatmap-tooltip-body">
          Last trained {staleFlag?.daysSinceUpdate || '90+'} days ago.
          Barry may be using context that no longer matches your business.
        </p>
        <p className="recon-heatmap-tooltip-cta">Tap to update →</p>
      </div>
    );
  }
  if (state === 'weak') {
    return (
      <div className="recon-heatmap-tooltip-content">
        <p className="recon-heatmap-tooltip-title">{dimension.label} — Thin data</p>
        <p className="recon-heatmap-tooltip-body km-tooltip-assumption">
          Barry's current assumption:<br />
          <em>"{dimension.fallbackAssumption}"</em>
        </p>
        <p className="recon-heatmap-tooltip-cta">Tap to update →</p>
      </div>
    );
  }
  if (state === 'strong') {
    return (
      <div className="recon-heatmap-tooltip-content">
        <p className="recon-heatmap-tooltip-title">{dimension.label} — Trained</p>
        <p className="recon-heatmap-tooltip-body">
          Barry is using your training data for this dimension.
        </p>
        <p className="recon-heatmap-tooltip-cta">Tap to review →</p>
      </div>
    );
  }
  // empty
  return (
    <div className="recon-heatmap-tooltip-content">
      <p className="recon-heatmap-tooltip-title">{dimension.label}</p>
      <p className="recon-heatmap-tooltip-body">
        Barry has no training here.<br />
        Without this: {dimension.impactWhenMissing}
      </p>
      <p className="recon-heatmap-tooltip-cta">Tap to start training →</p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReconOverview() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [currentIcp, setCurrentIcp] = useState(null);
  const [icpProfiles, setIcpProfiles] = useState([]);

  // Score delta — compare current score to last stored score in localStorage
  const [scoreDelta, setScoreDelta] = useState(null);
  const [showDelta, setShowDelta] = useState(false);

  const SCORE_KEY = 'recon_last_score';

  useEffect(() => {
    loadReconData();
  }, []);

  // Track score delta in an effect to avoid state updates during render
  useEffect(() => {
    if (dashboardData === null) return;
    const health = computeReconHealth(dashboardData, currentIcp);
    const score = health.weightedScore;
    const lastScore = parseInt(localStorage.getItem(SCORE_KEY) || '0', 10);
    if (lastScore !== score) {
      localStorage.setItem(SCORE_KEY, String(score));
      if (lastScore > 0 && Math.abs(score - lastScore) > 0) {
        setScoreDelta(score - lastScore);
        setShowDelta(true);
        const timer = setTimeout(() => setShowDelta(false), 5000);
        return () => clearTimeout(timer);
      }
    }
  }, [dashboardData, currentIcp]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReconData = async () => {
    try {
      const user = getEffectiveUser();
      if (!user) { navigate('/login'); return; }

      await initializeDashboard(user.uid);
      const [dashSnap, icpSnap, icpProfilesSnap] = await Promise.all([
        getDoc(doc(db, 'dashboards', user.uid)),
        getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current')),
        getDocs(collection(db, 'users', user.uid, 'icpProfiles')),
      ]);

      const dash = dashSnap.exists() ? dashSnap.data() : null;
      const icp  = icpSnap.exists()  ? icpSnap.data()  : null;
      const profiles = icpProfilesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      setDashboardData(dash);
      setCurrentIcp(icp);
      setIcpProfiles(profiles);
      setSections(dash?.modules?.find((m) => m.id === 'recon')?.sections || []);
    } catch (err) {
      console.error('Error loading RECON data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="recon-loading">
        <div className="loading-spinner" />
        <p className="loading-text">Loading RECON...</p>
      </div>
    );
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const health = computeReconHealth(dashboardData, currentIcp);
  const { weightedScore, completedSectionIds, stalenessFlags, dimensionStates } = health;

  const trainNext = getTrainNextRecommendation(health, TRAINING_DIMENSIONS);

  // Animated display score
  const AnimatedScore = () => {
    const displayed = useAnimatedScore(weightedScore);
    return <>{displayed}</>;
  };

  // Module helpers (unchanged)
  const getModuleStatus = (mod) => {
    const ms = mod.sections.map((id) => sections.find((s) => s.sectionId === id));
    const done = ms.filter((s) => s?.status === 'completed').length;
    if (done === ms.length) return 'complete';
    if (done > 0) return 'in-progress';
    return 'not-started';
  };

  const getModuleProgress = (mod) => {
    const ms = mod.sections.map((id) => sections.find((s) => s.sectionId === id));
    return { completed: ms.filter((s) => s?.status === 'completed').length, total: ms.length };
  };

  return (
    <div className="recon-overview">
      <ReconBreadcrumbs />

      {/* Page header */}
      <div className="recon-overview-header">
        <h1 className="recon-page-title">RECON</h1>
        <p className="recon-page-subtitle">Barry's Training Intelligence</p>
        <p className="recon-description">
          RECON is how you train Barry. Every module you complete gives Barry deeper context about your business,
          customers, and market — making Scout smarter, Hunter sharper, and every interaction more relevant.
        </p>
      </div>

      {/* ── Barry's Context Confidence score ─────────────────────────────── */}
      <div className="recon-confidence-score-block">
        <p className="recon-confidence-score-label">
          <Activity size={13} />
          Barry's Context Confidence
        </p>
        <div className="recon-confidence-score-row">
          <span className={`recon-confidence-score-number ${scoreColorClass(weightedScore)}`}>
            <AnimatedScore />
          </span>
          <span className={`recon-confidence-score-dot ${scoreColorClass(weightedScore)}`} aria-hidden="true">●</span>
          {showDelta && scoreDelta !== null && (
            <span className={`recon-confidence-score-delta ${scoreDelta > 0 ? 'delta--up' : 'delta--down'}`}>
              {scoreDelta > 0 ? `↑ +${scoreDelta}` : `↓ ${scoreDelta}`} since last update
            </span>
          )}
        </div>
        <p className="recon-confidence-score-sub">
          {completedSectionIds.length} of {sections.length || 10} sections complete
        </p>
      </div>

      {/* ── Barry's Knowledge ─────────────────────────────────────────────── */}
      <div className="recon-knowledge-map">
        <div className="recon-heatmap-header">
          <div className="recon-heatmap-title">
            <Sparkles size={16} />
            <div>
              <h2>Barry&apos;s Knowledge</h2>
              <p className="recon-section-subtitle">What Barry knows about your business — powers every response.</p>
            </div>
          </div>
          <div className="recon-heatmap-legend">
            <span className="recon-legend-item"><span className="recon-legend-dot km-state--strong" /> Trained</span>
            <span className="recon-legend-item"><span className="recon-legend-dot km-state--weak" /> Thin data</span>
            <span className="recon-legend-item"><span className="recon-legend-dot km-state--stale" /> Outdated</span>
            <span className="recon-legend-item"><span className="recon-legend-dot km-state--empty" /> Not started</span>
          </div>
        </div>

        <div className="recon-heatmap-tiles">
          {TRAINING_DIMENSIONS.map((dim) => {
            const state = dimensionStates[dim.id] || 'empty';
            return (
              <div
                key={dim.id}
                onClick={() => navigate(DIMENSION_MODULE_PATH[dim.id] || '/recon')}
                className={`recon-heatmap-tile km-tile--${state}`}
              >
                <TileIcon state={state} />
                <div className={`recon-heatmap-tile-label km-label--${state}`}>
                  {dim.label}
                </div>
                <div className="recon-heatmap-tooltip">
                  <TileTooltip
                    dimension={dim}
                    state={state}
                    stalenessFlags={stalenessFlags}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Train Next — inside Knowledge Map container */}
        <div className="recon-train-next-inline">
          {trainNext === null ? (
            <div className="recon-train-next-complete-inline">
              <CheckCircle2 size={16} className="complete-icon" />
              <div>
                <p className="train-next-complete-title">Fully Trained</p>
                <p className="train-next-complete-sub">Barry has complete knowledge of your business context.</p>
              </div>
            </div>
          ) : (
            <div className="recon-train-next-row">
              <div className="train-next-label-col">
                {trainNext.state === 'conflict' ? (
                  <AlertOctagon size={14} className="train-next-state-icon conflict" />
                ) : trainNext.state === 'stale' ? (
                  <Clock size={14} className="train-next-state-icon stale" />
                ) : trainNext.state === 'weak' ? (
                  <AlertTriangle size={14} className="train-next-state-icon weak" />
                ) : (
                  <Target size={14} className="train-next-state-icon empty" />
                )}
                <div>
                  <p className="train-next-cta-label">
                    {trainNext.state === 'conflict' ? 'Reconcile ICP Conflict' :
                     trainNext.state === 'stale'    ? 'Re-train outdated section' :
                     trainNext.state === 'weak'     ? 'Strengthen thin training' :
                                                      'Start here'}
                  </p>
                  <p className="train-next-dimension-name">{trainNext.dimension.label}</p>
                  <p className="train-next-reason">{trainNext.reason}</p>
                </div>
              </div>
              <button
                className="train-next-btn"
                onClick={() => navigate(DIMENSION_MODULE_PATH[trainNext.dimension.id] || '/recon')}
              >
                {trainNext.state === 'stale' || trainNext.state === 'weak' ? 'Update' : 'Start'}
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Live Output Preview ───────────────────────────────────────────── */}
      <LiveOutputPreview score={weightedScore} />

      {/* ── Communication Style ───────────────────────────────────────────── */}
      <div className="recon-modules-section" style={{ marginBottom: '1.5rem' }}>
        <h2 className="recon-section-title">Barry&apos;s Writing Style</h2>
        <CommunicationStyleSelector userId={auth.currentUser?.uid} />
      </div>

      {/* ── Your Training Path ────────────────────────────────────────────── */}
      <hr className="recon-section-divider" />
      <div className="recon-modules-section">
        <h2 className="recon-section-title">Your Training Path</h2>
        <p className="recon-section-subtitle">Complete these modules to give Barry full context for your market.</p>
        <p className="recon-foundation-note">Your Intelligence Foundation — shared across all ICP profiles</p>
        <div className="recon-modules-grid">
          {RECON_MODULES.map((mod) => {
            const status = getModuleStatus(mod);
            const progress = getModuleProgress(mod);
            const IconComponent = mod.icon;
            const isHighPriority = ['icp-intelligence'].includes(mod.id);
            const needsAlert = isHighPriority && status !== 'complete';

            return (
              <div
                key={mod.id}
                onClick={() => navigate(mod.path)}
                className={`recon-module-card ${status === 'complete' ? 'complete' : needsAlert ? 'alert' : ''}`}
              >
                {needsAlert && (
                  <div className="recon-module-alert-badge">
                    <AlertTriangle />
                    High Impact
                  </div>
                )}
                <div className="recon-module-header">
                  <div className={`recon-module-icon ${mod.color}`}>
                    <IconComponent />
                  </div>
                  <div>
                    {status === 'complete' ? (
                      <span className="recon-module-status-badge complete"><CheckCircle2 /> Complete</span>
                    ) : status === 'in-progress' ? (
                      <span className={`recon-module-status-badge in-progress ${mod.color}`}>
                        <Circle /> {progress.completed}/{progress.total}
                      </span>
                    ) : (
                      <span className="recon-module-status-badge not-started"><AlertCircle /> Not started</span>
                    )}
                  </div>
                </div>
                <h3 className="recon-module-title">{mod.title}</h3>
                <p className="recon-module-description">{mod.description}</p>
                <div className="recon-module-progress">
                  <div className="recon-module-progress-track">
                    <div
                      className={`recon-module-progress-fill ${status === 'complete' ? 'complete' : mod.color}`}
                      style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="recon-module-tags">
                  {mod.impactAreas.map((area) => (
                    <span key={area} className="recon-module-tag">{area}</span>
                  ))}
                </div>
                <div className="recon-module-cta">
                  <span>{status === 'complete' ? 'Review' : status === 'in-progress' ? 'Continue' : 'Start'} module</span>
                  <ArrowRight />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Messaging Profiles ────────────────────────────────────────────── */}
      <hr className="recon-section-divider" />
      <div className="recon-modules-section">
        <div className="recon-heatmap-header" style={{ marginBottom: '1rem' }}>
          <div className="recon-heatmap-title">
            <MessageSquare size={16} />
            <div>
              <h2>Messaging Profiles</h2>
              <p className="recon-section-subtitle">Section 9 of RECON — one per ICP profile, each with its own voice and value prop.</p>
            </div>
          </div>
          <button
            className="recon-messaging-manage-btn"
            onClick={() => navigate('/scout?tab=icp-settings')}
          >
            Manage profiles <ArrowRight size={12} />
          </button>
        </div>

        {icpProfiles.length === 0 ? (
          <div className="recon-messaging-empty">
            <MessageSquare size={20} className="recon-messaging-empty-icon" />
            <p>No ICP profiles yet. Create your first profile in ICP Settings.</p>
            <button className="recon-messaging-empty-btn" onClick={() => navigate('/scout?tab=icp-settings')}>
              Go to ICP Settings
            </button>
          </div>
        ) : (
          <div className="recon-messaging-grid">
            {icpProfiles.map(icp => {
              const pct = icp.messagingProgress || 0;
              const isActive = icp.isActive && icp.status === 'active';
              const isReady = icp.status === 'inactive';
              const isPending = icp.status === 'pending' || (!icp.status && pct < 100);
              return (
                <div
                  key={icp.id}
                  className={`recon-messaging-card ${isActive ? 'recon-messaging-card--active' : ''}`}
                  onClick={() => navigate('/scout?tab=icp-settings')}
                >
                  <div className="recon-messaging-card-header">
                    <span className="recon-messaging-card-name">{icp.name || 'My ICP'}</span>
                    {isActive && <span className="recon-messaging-badge recon-messaging-badge--active">Active</span>}
                    {isReady && <span className="recon-messaging-badge recon-messaging-badge--ready">Ready</span>}
                    {isPending && <span className="recon-messaging-badge recon-messaging-badge--pending">Setup needed</span>}
                  </div>
                  <div className="recon-messaging-progress-track">
                    <div
                      className={`recon-messaging-progress-fill ${isActive ? 'fill--active' : isPending ? 'fill--pending' : 'fill--ready'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="recon-messaging-pct">{pct}% complete</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Platform Impact ───────────────────────────────────────────────── */}
      <div className="recon-impact-section">
        <h2 className="recon-section-title">How RECON Improves Everything</h2>
        <div className="recon-impact-grid">
          {PLATFORM_IMPACTS.map((impact) => {
            const IconComponent = impact.icon;
            return (
              <div key={impact.system} className="recon-impact-card">
                <div className="recon-impact-card-header">
                  <div className={`recon-impact-icon ${impact.color}`}><IconComponent /></div>
                  <h3>{impact.system}</h3>
                </div>
                <div className="recon-impact-list">
                  {impact.impacts.map((item, idx) => (
                    <div key={idx} className="recon-impact-item">
                      <span className={`recon-impact-item-source ${impact.color}`}>{item.source}:</span>
                      <p className="recon-impact-item-effect">{item.effect}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
