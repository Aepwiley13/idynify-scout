/**
 * AlignmentBrief.jsx — RECON module page.
 *
 * A read-only "briefing document" that consolidates what Barry knows
 * about the user's business, ICP, and sales motion into a single view.
 *
 * Designed to answer: "Is Barry aligned well enough to generate quality output?"
 *
 * Route: /recon/alignment-brief
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import {
  FileText,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Clock,
  Circle,
  ChevronRight,
  Target,
  Brain,
  Zap,
  ArrowRight,
  Shield,
  Swords,
  MessageSquare,
  TrendingUp,
  User,
} from 'lucide-react';
import { initializeDashboard } from '../../utils/dashboardUtils';
import { computeReconHealth } from '../../shared/reconHealth';
import { TRAINING_DIMENSIONS, DIMENSION_MODULE_PATH } from '../../shared/reconHealthConstants';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';

const RECON_INDIGO = '#6366f1';
const RECON_INDIGO_DIM = '#4f46e5';

// ─── Dimension icon map ───────────────────────────────────────────────────────
const DIM_ICONS = {
  identity:      Brain,
  icp:           Target,
  'pain-points': Shield,
  decisions:     Zap,
  competitive:   Swords,
  messaging:     MessageSquare,
  signals:       TrendingUp,
};

// ─── State icon ───────────────────────────────────────────────────────────────
function StateIcon({ state, size = 16 }) {
  if (state === 'strong')   return <CheckCircle size={size} style={{ color: '#10b981' }} />;
  if (state === 'weak')     return <AlertTriangle size={size} style={{ color: '#f59e0b' }} />;
  if (state === 'stale')    return <Clock size={size} style={{ color: '#6b7280' }} />;
  if (state === 'conflict') return <AlertOctagon size={size} style={{ color: '#ef4444' }} />;
  return <Circle size={size} style={{ color: '#374151' }} />;
}

// ─── State label / color ──────────────────────────────────────────────────────
const STATE_META = {
  strong:   { label: 'Aligned',   color: '#10b981', bg: '#10b98115' },
  weak:     { label: 'Thin',      color: '#f59e0b', bg: '#f59e0b15' },
  stale:    { label: 'Stale',     color: '#6b7280', bg: '#6b728015' },
  conflict: { label: 'Conflict',  color: '#ef4444', bg: '#ef444415' },
  empty:    { label: 'Missing',   color: '#374151', bg: '#37415110' },
};

// ─── Brief score color ────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 80) return '#10b981';
  if (score >= 55) return '#f59e0b';
  if (score >= 30) return '#f97316';
  return '#ef4444';
}

// ─── Extract readable facts from section data ─────────────────────────────────
function extractFacts(sections) {
  const facts = [];
  const find = (id) => sections.find((s) => s.sectionId === id);

  const s1 = find(1);
  if (s1?.data) {
    const d = s1.data;
    if (d.companyName) facts.push({ label: 'Company', value: d.companyName });
    if (d.industry)    facts.push({ label: 'Industry', value: d.industry });
    if (d.stage)       facts.push({ label: 'Stage', value: d.stage });
    if (d.role)        facts.push({ label: 'Your role', value: d.role });
    if (d.whatYouDo)   facts.push({ label: 'What you do', value: d.whatYouDo });
  }

  const s2 = find(2);
  if (s2?.data) {
    const d = s2.data;
    if (d.mainProduct)   facts.push({ label: 'Primary product', value: d.mainProduct });
    if (d.problemSolved) facts.push({ label: 'Problem solved', value: d.problemSolved });
  }

  const s3 = find(3);
  if (s3?.data) {
    const d = s3.data;
    const icpParts = [];
    if (d.targetIndustries?.length)  icpParts.push(d.targetIndustries.join(', '));
    if (d.companySizes?.length)      icpParts.push(d.companySizes.join(', '));
    if (d.locations?.length)         icpParts.push(d.locations.join(', '));
    if (icpParts.length)             facts.push({ label: 'Target market', value: icpParts.join(' · ') });
    if (d.targetTitles?.length)      facts.push({ label: 'Target titles', value: d.targetTitles.join(', ') });
  }

  const s5 = find(5);
  if (s5?.data) {
    const d = s5.data;
    if (d.mainPainPoints?.length)
      facts.push({ label: 'Key pain points', value: d.mainPainPoints.join('; ') });
    else if (d.painPoints)
      facts.push({ label: 'Key pain points', value: d.painPoints });
  }

  const s9 = find(9);
  if (s9?.data) {
    const d = s9.data;
    if (d.valueProp || d.valueProposition)
      facts.push({ label: 'Value proposition', value: d.valueProp || d.valueProposition });
    if (d.tone) facts.push({ label: 'Brand tone', value: d.tone });
    if (d.differentiator || d.primaryDifferentiator)
      facts.push({ label: 'Differentiator', value: d.differentiator || d.primaryDifferentiator });
  }

  return facts;
}

// ─── Dimension card ───────────────────────────────────────────────────────────
function DimensionCard({ dim, state, onTrain, T }) {
  const meta  = STATE_META[state] || STATE_META.empty;
  const Icon  = DIM_ICONS[dim.id] || Brain;
  const path  = DIMENSION_MODULE_PATH[dim.id];

  return (
    <div
      style={{
        background: T.cardBg,
        border: `1.5px solid ${state === 'conflict' ? '#ef444430' : state === 'strong' ? '#10b98120' : T.border2}`,
        borderRadius: 12,
        padding: '1rem 1.1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: state !== 'strong' ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onClick={state !== 'strong' ? () => onTrain(path) : undefined}
      onMouseEnter={(e) => {
        if (state !== 'strong') {
          e.currentTarget.style.background = T.surface;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = T.cardBg;
      }}
    >
      {/* Icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: `${RECON_INDIGO}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={17} color={RECON_INDIGO} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{dim.label}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            color: meta.color, background: meta.bg,
            padding: '2px 7px', borderRadius: 20,
          }}>
            {meta.label.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.5 }}>
          {state === 'empty' || !state
            ? dim.impactWhenMissing
            : state === 'conflict'
            ? 'ICP settings conflict with your RECON training — Barry may use outdated criteria.'
            : state === 'stale'
            ? 'Training data is older than 90 days — consider refreshing.'
            : state === 'weak'
            ? 'Answers were thin. More detail will improve Barry\'s output quality.'
            : 'Barry is well-informed on this dimension.'}
        </div>
      </div>

      {/* CTA arrow */}
      {state !== 'strong' && (
        <ChevronRight size={16} color={T.textFaint} style={{ flexShrink: 0, marginTop: 2 }} />
      )}
    </div>
  );
}

// ─── AlignmentBrief ───────────────────────────────────────────────────────────
export default function AlignmentBrief() {
  const T = useT();
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(true);
  const [sections, setSections] = useState([]);
  const [health, setHealth]     = useState(null);
  const [facts, setFacts]       = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const user = getEffectiveUser();
      if (!user) { navigate('/login'); return; }

      await initializeDashboard(user.uid);
      const [dashSnap, icpSnap] = await Promise.all([
        getDoc(doc(db, 'dashboards', user.uid)),
        getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current')),
      ]);

      const dash = dashSnap.exists() ? dashSnap.data() : null;
      const icp  = icpSnap.exists()  ? icpSnap.data()  : null;

      const secs = dash?.modules?.find((m) => m.id === 'recon')?.sections || [];
      setSections(secs);
      setHealth(computeReconHealth(dash, icp));
      setFacts(extractFacts(secs));
    } catch (err) {
      console.error('[AlignmentBrief] load error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260, color: T.textFaint, fontSize: 14 }}>
        Loading brief…
      </div>
    );
  }

  const score = health?.weightedScore ?? 0;
  const { dimensionStates = {}, criticalGapFlags = [], scoutConflictFlags = [] } = health || {};

  const completedDims   = TRAINING_DIMENSIONS.filter((d) => dimensionStates[d.id] === 'strong');
  const missingDims     = TRAINING_DIMENSIONS.filter((d) => !dimensionStates[d.id] || dimensionStates[d.id] === 'empty');
  const conflictDims    = TRAINING_DIMENSIONS.filter((d) => dimensionStates[d.id] === 'conflict');
  const hasIssues       = missingDims.length > 0 || conflictDims.length > 0;

  const sc = scoreColor(score);

  return (
    <div style={{
      maxWidth: 900,
      margin: '0 auto',
      padding: '1.5rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      color: T.text,
    }}>
      <ReconBreadcrumbs sectionTitle="Alignment Brief" />

      {/* ── Page header ── */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: `${RECON_INDIGO}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={17} color={RECON_INDIGO} />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
            Alignment Brief
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: T.textFaint, maxWidth: 560 }}>
          A snapshot of what Barry knows — and where gaps may reduce the quality of context generation,
          outreach sequencing, and lead scoring.
        </p>
      </div>

      {/* ── Score card ── */}
      <div style={{
        background: T.cardBg,
        border: `1.5px solid ${T.border2}`,
        borderRadius: 14,
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}>
        {/* Big score */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <span style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, color: sc }}>{score}</span>
          <span style={{ fontSize: 18, fontWeight: 600, color: T.textFaint, marginBottom: 6 }}>/100</span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 56, background: T.border2, flexShrink: 0 }} />

        {/* Score meta */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>
            Barry Alignment Score
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.6 }}>
            {score >= 80
              ? 'Barry is well-trained. Output quality across Scout, Hunter, and Sniper should be high.'
              : score >= 55
              ? 'Barry has partial context. Some outputs may be generic where training is thin.'
              : score >= 30
              ? 'Barry has limited context. Most outputs will fall back to generic assumptions.'
              : 'Barry has minimal context. Complete critical sections to unlock personalized output.'}
          </div>
          {/* Progress bar */}
          <div style={{
            height: 6, background: T.border2, borderRadius: 99,
            marginTop: 10, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${score}%`,
              background: sc, borderRadius: 99,
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#10b981' }}>{completedDims.length}</div>
            <div style={{ fontSize: 11, color: T.textFaint }}>Aligned</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.textFaint }}>{missingDims.length}</div>
            <div style={{ fontSize: 11, color: T.textFaint }}>Missing</div>
          </div>
          {conflictDims.length > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{conflictDims.length}</div>
              <div style={{ fontSize: 11, color: T.textFaint }}>Conflict</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Critical gap alert ── */}
      {criticalGapFlags.length > 0 && (
        <div style={{
          background: '#ef444410',
          border: '1.5px solid #ef444430',
          borderRadius: 12,
          padding: '0.9rem 1.1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <AlertOctagon size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 3 }}>
              Critical gaps detected
            </div>
            <div style={{ fontSize: 12, color: T.textFaint }}>
              Barry is missing foundational training that affects every output.
              Complete Business Identity (Sections 1–2) and Target Market (Section 3) to unlock meaningful personalization.
            </div>
          </div>
        </div>
      )}

      {/* ── ICP conflict alert ── */}
      {scoutConflictFlags.length > 0 && (
        <div style={{
          background: '#f59e0b10',
          border: '1.5px solid #f59e0b30',
          borderRadius: 12,
          padding: '0.9rem 1.1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 3 }}>
              Scout ICP drift detected
            </div>
            <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 8 }}>
              Your ICP settings in Scout no longer match your RECON training.
              Barry may score leads using outdated criteria.
            </div>
            <button
              onClick={() => navigate('/scout?tab=icp-settings')}
              style={{
                fontSize: 12, fontWeight: 600, color: '#f59e0b',
                background: 'transparent', border: '1px solid #f59e0b50',
                borderRadius: 8, padding: '4px 12px', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              Review ICP settings <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ── Dimension grid ── */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          color: T.textFaint, marginBottom: 10,
          textTransform: 'uppercase',
        }}>
          Training Dimensions
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 10,
        }}>
          {TRAINING_DIMENSIONS.map((dim) => (
            <DimensionCard
              key={dim.id}
              dim={dim}
              state={dimensionStates[dim.id] || 'empty'}
              onTrain={(path) => navigate(path)}
              T={T}
            />
          ))}
        </div>
      </div>

      {/* ── Key facts ── */}
      {facts.length > 0 && (
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            color: T.textFaint, marginBottom: 10,
            textTransform: 'uppercase',
          }}>
            What Barry Knows
          </div>
          <div style={{
            background: T.cardBg,
            border: `1.5px solid ${T.border2}`,
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            {facts.map((fact, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '0.75rem 1.1rem',
                  borderBottom: i < facts.length - 1 ? `1px solid ${T.border2}` : 'none',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 700, color: RECON_INDIGO,
                  width: 130, flexShrink: 0, paddingTop: 1,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {fact.label}
                </span>
                <span style={{ fontSize: 13, color: T.text, lineHeight: 1.55, flex: 1 }}>
                  {fact.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── No facts state ── */}
      {facts.length === 0 && (
        <div style={{
          background: T.cardBg,
          border: `1.5px solid ${T.border2}`,
          borderRadius: 14,
          padding: '2.5rem',
          textAlign: 'center',
          marginBottom: '1.75rem',
        }}>
          <Brain size={32} color={RECON_INDIGO} style={{ opacity: 0.4, marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: T.textFaint, marginBottom: 6 }}>
            Barry hasn't been trained yet
          </div>
          <div style={{ fontSize: 13, color: T.textFaint, marginBottom: 16 }}>
            Complete RECON sections to build Barry's knowledge base.
          </div>
          <button
            onClick={() => navigate('/recon/icp-intelligence')}
            style={{
              fontSize: 13, fontWeight: 600,
              background: RECON_INDIGO, color: '#fff',
              border: 'none', borderRadius: 9,
              padding: '8px 20px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            Start with ICP Intelligence <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* ── Actions ── */}
      {hasIssues && (
        <div style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          {missingDims.length > 0 && (
            <button
              onClick={() => navigate(DIMENSION_MODULE_PATH[missingDims[0].id])}
              style={{
                fontSize: 13, fontWeight: 600,
                background: RECON_INDIGO, color: '#fff',
                border: 'none', borderRadius: 9,
                padding: '9px 20px', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              Train next: {missingDims[0].label} <ArrowRight size={14} />
            </button>
          )}
          <button
            onClick={() => navigate('/recon')}
            style={{
              fontSize: 13, fontWeight: 600,
              background: 'transparent', color: T.textFaint,
              border: `1.5px solid ${T.border2}`, borderRadius: 9,
              padding: '9px 20px', cursor: 'pointer',
            }}
          >
            View RECON overview
          </button>
        </div>
      )}
    </div>
  );
}
