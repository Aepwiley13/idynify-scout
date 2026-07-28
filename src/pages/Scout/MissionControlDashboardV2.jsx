import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMissionControlTheme } from '../../theme/useMissionControlTheme';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import { auth, db } from '../../firebase/config';
import {
  collection, query, where, getDocs, getDoc, doc,
  updateDoc, setDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { useActiveUserId, useImpersonation } from '../../context/ImpersonationContext';
import { calculateICPScore, DEFAULT_WEIGHTS, generateMatchReasons } from '../../utils/icpScoring';
import useOnboardingState from '../../hooks/useOnboardingState';
import AnimatedCounter from '../../components/AnimatedCounter';
import BarryChatPanel from '../../components/dashboard/BarryChatPanel';
import TodaysPriorities from '../../components/mission-control/TodaysPriorities';
import RecentOutreachActivity from '../../components/mission-control/RecentOutreachActivity';
import HunterReadinessBanner from '../../components/mission-control/HunterReadinessBanner';
import useRecommendations from '../../hooks/useRecommendations';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';
import {
  Search, Filter, ChevronLeft, ChevronRight, ExternalLink,
  Linkedin, Users, Target, Calendar, X,
  Loader, ArrowRight, Star, Mail, UserPlus,
  BarChart3, Building2, Check, AlertCircle,
} from 'lucide-react';

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color, subtitle, T }) {
  const accent = color || T.textMuted;
  return (
    <div style={{
      padding: '18px 20px', background: T.cardBg,
      border: `1px solid ${T.border}`, borderRadius: 14,
      flex: '1 1 0', minWidth: 140,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {Icon && (
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: `${accent}12`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={18} color={accent} />
          </div>
        )}
      </div>
      <div style={{
        fontSize: 30, fontWeight: 700, color: T.text,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

// ─── Fit Score Badge ─────────────────────────────────────────────────────────
function FitBadge({ score }) {
  const color = score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : '#888';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '4px 12px', borderRadius: 20, minWidth: 42,
      background: `${color}18`, border: `1px solid ${color}40`,
      fontSize: 13, fontWeight: 700, color,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {Math.round(score)}
    </span>
  );
}

// ─── Company Detail Panel ────────────────────────────────────────────────────
function CompanyDetailPanel({ company, onClose, onApprove, T }) {
  const [outreach, setOutreach] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [approved, setApproved] = useState(false);

  const name = company.name || company.company_name || 'Unknown';
  const industry = company.industry || '';
  const size = company.employee_count || company.employeeCount || '';
  const location = company.location || company.city || '';
  const website = company.website || company.url || '';
  const score = company.fit_score || 0;
  const reasons = company.fit_reasons || company.matchReasons || company.match_reasons || [];
  const matchReason = company.matchReason || company.match_reason || '';
  const contact = company.recommendedContact || company.recommended_contact || null;

  useEffect(() => {
    generateOutreach();
  }, [company.id]);

  const generateOutreach = async () => {
    setGenerating(true);
    setOutreach(null);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/generate-engagement-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactName: contact?.name || '',
          contactTitle: contact?.title || '',
          companyName: name,
          companyIndustry: industry,
          intent: 'prospect',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const strategy = data.strategies?.[0] || data;
        setOutreach({
          subject: strategy.subject || data.subject || '',
          body: strategy.body || data.body || data.message || '',
        });
      }
    } catch (err) {
      console.error('Failed to generate outreach:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleApprove = async () => {
    await onApprove(company);
    setApproved(true);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: '100%', maxWidth: 480, zIndex: 100,
      background: T.cardBg, borderLeft: `1px solid ${T.border}`,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      display: 'flex', flexDirection: 'column',
      animation: 'slideInRight 0.25s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>{name}</h2>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
        }}>
          <X size={20} color={T.textMuted} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* Company Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `${T.accent}15`, border: `1px solid ${T.accent}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, color: T.accent,
          }}>
            {name.charAt(0)}
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textMuted }}>
              {[industry, size && `${size} employees`, location].filter(Boolean).join(' · ')}
            </div>
            <div style={{ marginTop: 4 }}><FitBadge score={Math.round(score)} /></div>
          </div>
        </div>

        {/* Match Reasons */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10 }}>
            Why {name} is a great match
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(reasons.length > 0 ? reasons : matchReason ? [matchReason] : ['Matches your ICP profile']).map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 13, color: T.text,
              }}>
                <Check size={14} color={STATUS.green} />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Contact */}
        {contact && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10 }}>
              Recommended Contact
            </h3>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 14, background: T.surface, borderRadius: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: `${BRAND.purple}20`, border: `1px solid ${BRAND.purple}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: BRAND.purple,
              }}>
                {(contact.name || '?').charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{contact.name}</div>
                <div style={{ fontSize: 12, color: T.textMuted }}>{contact.title}</div>
              </div>
              {contact.linkedin && (
                <a href={contact.linkedin} target="_blank" rel="noopener noreferrer"
                   style={{ color: '#0a66c2' }}>
                  <Linkedin size={20} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Barry's Suggested Outreach */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10 }}>
            Barry's Suggested Outreach
          </h3>
          {generating ? (
            <div style={{
              padding: 20, textAlign: 'center', background: T.surface,
              borderRadius: 12, color: T.textMuted, fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Loader size={16} className="animate-spin" /> Barry is writing...
            </div>
          ) : outreach ? (
            <div style={{
              padding: 16, background: T.surface, borderRadius: 12,
              border: `1px solid ${T.border}`,
            }}>
              {outreach.subject && (
                <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 6 }}>
                  Subject: <strong style={{ color: T.text }}>{outreach.subject}</strong>
                </div>
              )}
              <div style={{
                fontSize: 13, color: T.text, lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>
                {outreach.body}
              </div>
            </div>
          ) : (
            <div style={{
              padding: 16, background: T.surface, borderRadius: 12,
              textAlign: 'center', color: T.textFaint, fontSize: 13,
            }}>
              Outreach unavailable
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div style={{
        padding: '16px 24px', borderTop: `1px solid ${T.border}`,
        display: 'flex', gap: 10,
      }}>
        {approved ? (
          <div style={{
            flex: 1, padding: 14, borderRadius: 12, textAlign: 'center',
            background: `${STATUS.green}15`, color: STATUS.green,
            fontSize: 14, fontWeight: 700,
          }}>
            <Check size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Approved
          </div>
        ) : (
          <button onClick={handleApprove} style={{
            flex: 1, padding: 14, borderRadius: 12, border: 'none',
            background: `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.purple})`,
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <UserPlus size={16} /> Approve & Add to Leads
          </button>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Barry Narration Messages ───────────────────────────────────────────────
const BARRY_NARRATIONS = [
  'Finding companies similar to your best customers...',
  'Filtering out poor matches...',
  'Ranking your top opportunities...',
  'Preparing your workspace...',
];

// ─── First-Run View ─────────────────────────────────────────────────────────
function FirstRunView({ barryState, companiesFoundCount, companies, T, navigate }) {
  const [ctaDisabled, setCtaDisabled] = useState(false);
  const [ctaError, setCtaError] = useState(null);
  const [narrationIndex, setNarrationIndex] = useState(0);

  const isSearching = barryState === 'SEARCHING' || barryState === null;
  const isReady = barryState === 'READY';
  const isError = barryState === 'ERROR';

  useEffect(() => {
    if (!isSearching) return;
    const timer = setInterval(() => {
      setNarrationIndex(prev => (prev + 1) % BARRY_NARRATIONS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [isSearching]);

  const handleSeenMC = async () => {
    setCtaDisabled(true);
    setCtaError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');
      await setDoc(doc(db, 'users', user.uid), { hasSeenMCWelcome: true }, { merge: true });
      navigate('/scout', { state: { activeTab: 'daily-leads' } });
    } catch {
      setCtaDisabled(false);
      setCtaError('Something went wrong. Try again.');
    }
  };

  const handleRetry = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      await setDoc(doc(db, 'users', user.uid), {
        barryState: 'SEARCHING',
        companiesFoundCount: 0,
      }, { merge: true });
      const authToken = await user.getIdToken();
      const profileDoc = await getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'));
      const companyProfile = profileDoc.exists() ? profileDoc.data() : {};
      fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, companyProfile }),
      }).catch(() => {});
    } catch { /* best effort */ }
  };

  const topThree = companies.slice(0, 3);
  const counterTarget = companiesFoundCount > 0 ? companiesFoundCount : companies.length;

  const progressItems = [
    { label: 'Business Understood', done: true },
    { label: 'Ideal Customer Profile Created', done: true },
    {
      label: isSearching ? 'Finding and ranking companies...'
        : isReady ? 'Prospect list ready'
        : 'Search failed',
      done: isReady,
      active: isSearching,
      error: isError,
    },
    { label: 'Available after you review your first matches', done: false, greyed: true },
  ];

  return (
    <div style={{
      maxWidth: 1200, margin: '0 auto', padding: '48px 32px',
      display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 48,
      minHeight: 'calc(100vh - 120px)', alignContent: 'start',
    }}>
      {/* Left Column — Barry */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Barry Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', overflow: 'hidden',
            background: `linear-gradient(135deg,${BRAND.pink},${T.cyan || BRAND.cyan})`,
            border: `2px solid ${(T.cyan || BRAND.cyan)}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: `0 0 24px ${(T.cyan || BRAND.cyan)}40`,
          }}>
            <img src={ASSETS.barryAvatar} alt="Barry" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                 onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Barry</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '2px 10px', borderRadius: 20,
              background: `${STATUS.green}18`, fontSize: 11, fontWeight: 600,
              color: STATUS.green,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS.green }} />
              AI SDR &bull; Online
            </div>
          </div>
        </div>

        {/* Heading */}
        <h1 style={{ fontSize: 28, fontWeight: 800, color: T.text, margin: 0, lineHeight: 1.3 }}>
          {isSearching && 'Barry is building your sales engine'}
          {isReady && 'Barry found your first matches'}
          {isError && 'Barry ran into a problem'}
        </h1>

        {/* Progress List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {progressItems.map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              opacity: item.greyed ? 0.4 : 1,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: item.done ? `${STATUS.green}18`
                  : item.error ? `${STATUS.red || '#ef4444'}18`
                  : item.active ? `${T.accent}18`
                  : `${T.textFaint}12`,
                border: `1.5px solid ${
                  item.done ? `${STATUS.green}40`
                  : item.error ? `${STATUS.red || '#ef4444'}40`
                  : item.active ? `${T.accent}40`
                  : `${T.textFaint}25`
                }`,
              }}>
                {item.done && <Check size={13} color={STATUS.green} />}
                {item.active && <Loader size={13} color={T.accent} className="animate-spin" />}
                {item.error && <X size={13} color={STATUS.red || '#ef4444'} />}
              </div>
              <span style={{
                fontSize: 14, fontWeight: item.done || item.active ? 600 : 400,
                color: item.greyed ? T.textFaint : item.error ? (STATUS.red || '#ef4444') : T.text,
              }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* Narration (searching only) */}
        {isSearching && (
          <p style={{
            fontSize: 13, color: T.textMuted, fontStyle: 'italic', margin: 0,
            padding: '12px 16px', background: T.surface, borderRadius: 10,
            borderLeft: `3px solid ${T.accent}`,
            transition: 'opacity 0.3s',
          }}>
            "{BARRY_NARRATIONS[narrationIndex]}"
          </p>
        )}
      </div>

      {/* Right Column — Matches */}
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border}`,
        borderRadius: 16, padding: 24, height: 'fit-content',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: T.textMuted, margin: '0 0 20px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Here's a preview of what's coming
        </h3>

        {/* SEARCHING — no companies yet */}
        {isSearching && topThree.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 16, padding: '40px 0',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: `${T.accent}12`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              <Search size={24} color={T.accent} />
            </div>
            <p style={{ fontSize: 14, color: T.textMuted, textAlign: 'center', margin: 0 }}>
              Barry is building your sales engine...
            </p>
          </div>
        )}

        {/* SEARCHING — some companies found already */}
        {isSearching && topThree.length > 0 && (
          <>
            <div style={{
              textAlign: 'center', marginBottom: 20,
              fontSize: 13, color: T.textMuted,
            }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: T.accent }}>
                {companies.length}
              </span>{' '}
              found so far...
            </div>
            {topThree.map((company, i) => (
              <FirstRunCompanyCard key={company.id || i} company={company} T={T} />
            ))}
          </>
        )}

        {/* READY */}
        {isReady && (
          <>
            <div style={{
              textAlign: 'center', marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>Barry found</div>
              <div style={{ fontSize: 48, fontWeight: 800, color: T.accent, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                <AnimatedCounter target={counterTarget} duration={2500} />
              </div>
              <div style={{ fontSize: 14, color: T.text, marginTop: 6, fontWeight: 600 }}>
                companies that match your ICP
              </div>
            </div>
            {topThree.map((company, i) => (
              <FirstRunCompanyCard key={company.id || i} company={company} T={T} />
            ))}
          </>
        )}

        {/* ERROR */}
        {isError && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 16, padding: '32px 0',
          }}>
            <AlertCircle size={32} color={STATUS.red || '#ef4444'} />
            <p style={{ fontSize: 14, color: T.text, textAlign: 'center', margin: 0 }}>
              Barry ran into a problem building your first list.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleRetry}
                style={{
                  padding: '10px 20px', borderRadius: 10,
                  background: T.accent, color: '#fff', border: 'none',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Try Again
              </button>
              <button
                onClick={() => navigate('/onboarding/barry')}
                style={{
                  padding: '10px 20px', borderRadius: 10,
                  background: T.surface, border: `1px solid ${T.border}`,
                  color: T.text, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Review ICP with Barry
              </button>
            </div>
          </div>
        )}

        {/* CTA */}
        {companies.length > 0 && !isError && (
          <div style={{ marginTop: 20 }}>
            <button
              onClick={handleSeenMC}
              disabled={ctaDisabled}
              style={{
                width: '100%', padding: '14px 20px', borderRadius: 12,
                background: ctaDisabled
                  ? T.textFaint
                  : `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.purple})`,
                color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
                cursor: ctaDisabled ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: ctaDisabled ? 0.6 : 1,
              }}
            >
              See all matches <ArrowRight size={16} />
            </button>
            {ctaError && (
              <p style={{ fontSize: 12, color: STATUS.red || '#ef4444', textAlign: 'center', marginTop: 8 }}>
                {ctaError}
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        @media (max-width: 900px) {
          div[style*="gridTemplateColumns: 3fr 2fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function FirstRunCompanyCard({ company, T }) {
  const name = company.name || company.company_name || 'Unknown';
  const industry = company.industry || '';
  const score = Math.round(company.fit_score || 0);
  const reasons = company.fit_reasons || company.matchReasons || company.match_reasons || [];
  const topReason = reasons[0] || 'Matches your ICP profile';
  const color = score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : '#888';

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: T.surface, border: `1px solid ${T.border}`,
      marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${T.accent}12`, border: `1px solid ${T.accent}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: T.accent, flexShrink: 0,
      }}>
        {name.charAt(0)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{name}</div>
        <div style={{ fontSize: 11, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {industry ? `${industry} — ` : ''}{topReason}
        </div>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px 10px', borderRadius: 16, minWidth: 36,
        background: `${color}18`, border: `1px solid ${color}40`,
        fontSize: 12, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums',
      }}>
        {score}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function MissionControlDashboardV2() {
  useMissionControlTheme();
  const T = useT();
  const navigate = useNavigate();
  const activeUserId = useActiveUserId();
  const { isReadOnly } = useImpersonation();
  const onboarding = useOnboardingState();
  const {
    onboardingComplete: obComplete,
    onboardingSource,
    hasSeenMCWelcome,
    barryState,
    companiesFoundCount,
  } = onboarding;
  const [cadenceReplies, setCadenceReplies] = useState(0);
  const [kpisLoaded, setKpisLoaded] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState(null);
  const [acceptedCompanies, setAcceptedCompanies] = useState(0);
  const [cadencesSent, setCadencesSent] = useState(0);
  const { recommendations, loading: recsLoading } = useRecommendations(activeUserId);

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const PER_PAGE = 10;

  useEffect(() => {
    if (activeUserId) {
      Promise.allSettled([loadCompanies(), loadCadenceReplies()])
        .then(() => setKpisLoaded(true));
      loadHunterReadinessData();
    }
  }, [activeUserId]);

  const loadHunterReadinessData = async () => {
    try {
      const userId = activeUserId || auth.currentUser?.uid;
      if (!userId) return;
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) setSubscriptionTier(userDoc.data().subscriptionTier || 'starter');
      const companiesSnap = await getDocs(
        query(collection(db, 'users', userId, 'companies'), where('status', '==', 'accepted'))
      );
      setAcceptedCompanies(companiesSnap.size);
      const cadencesSnap = await getDocs(collection(db, 'users', userId, 'cadences'));
      let sent = 0;
      cadencesSnap.forEach(d => { sent += d.data().sentCount || 0; });
      setCadencesSent(sent);
    } catch { /* best effort */ }
  };

  const loadCadenceReplies = async () => {
    try {
      const userId = activeUserId || auth.currentUser?.uid;
      if (!userId) return;
      const snap = await getDocs(collection(db, 'users', userId, 'cadences'));
      let replies = 0;
      snap.forEach(d => { replies += d.data().repliedCount || 0; });
      setCadenceReplies(replies);
    } catch { /* best effort */ }
  };

  const loadCompanies = async () => {
    try {
      const userId = activeUserId || auth.currentUser?.uid;
      if (!userId) return;

      // Load ICP profiles from icpProfiles subcollection (matches DailyLeads pattern)
      const icpProfilesSnap = await getDocs(collection(db, 'users', userId, 'icpProfiles'));
      let icps = icpProfilesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      icps.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

      // Fallback to legacy companyProfile/current
      const profileDoc = await getDoc(doc(db, 'users', userId, 'companyProfile', 'current'));
      let activeProfile = profileDoc.exists() ? profileDoc.data() : null;
      let activeICPId = null;

      if (icps.length > 0) {
        const firstICP = icps.find(i => i.isActive && i.status === 'active') || icps[0];
        activeICPId = firstICP.id;
        activeProfile = firstICP;
      }

      // Load companies (accepted + pending)
      const companiesRef = collection(db, 'users', userId, 'companies');
      const snapshot = await getDocs(companiesRef);
      const allCompanies = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Filter by active ICP (legacy companies with no icpId show for all)
      const filtered = activeICPId
        ? allCompanies.filter(c => !c.icpId || c.icpId === activeICPId)
        : allCompanies;

      // Score and sort. Reasons come from the SAME shared scorer that produces
      // the score, so the "why it's a match" text is specific per company.
      const scored = filtered.map(c => ({
        ...c,
        fit_score: activeProfile
          ? calculateICPScore(c, activeProfile, activeProfile.scoringWeights || DEFAULT_WEIGHTS)
          : (c.fit_score || c.icpScore || 0),
        fit_reasons: activeProfile
          ? generateMatchReasons(c, activeProfile)
          : (c.fit_reasons || c.matchReasons || c.match_reasons || []),
      }));
      scored.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

      // Try loading recommended contacts from contacts subcollection
      for (const company of scored.slice(0, 20)) {
        try {
          const contactsSnap = await getDocs(collection(db, 'users', userId, 'contacts'));
          const companyContacts = contactsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(c => {
              const cName = (c.company || c.companyName || '').toLowerCase();
              const coName = (company.name || company.company_name || '').toLowerCase();
              return cName === coName;
            });
          if (companyContacts.length > 0) {
            company.recommendedContact = {
              name: companyContacts[0].name || companyContacts[0].fullName || '',
              title: companyContacts[0].title || companyContacts[0].jobTitle || '',
              linkedin: companyContacts[0].linkedin || companyContacts[0].linkedinUrl || '',
            };
          }
        } catch { /* best effort */ }
      }

      setCompanies(scored);
      setLoading(false);
    } catch (err) {
      console.error('MissionControl: error loading companies', err);
      setLoading(false);
    }
  };

  // ── Filtering ──────────────────────────────────────────────────────────────
  const industries = [...new Set(companies.map(c => c.industry).filter(Boolean))].sort();

  const filtered = companies.filter(c => {
    const name = (c.name || c.company_name || '').toLowerCase();
    if (searchTerm && !name.includes(searchTerm.toLowerCase())) return false;
    if (industryFilter && c.industry !== industryFilter) return false;
    if (scoreFilter === '90+' && (c.fit_score || 0) < 90) return false;
    if (scoreFilter === '70-89' && ((c.fit_score || 0) < 70 || (c.fit_score || 0) >= 90)) return false;
    if (scoreFilter === '<70' && (c.fit_score || 0) >= 70) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const pageCompanies = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const totalMatches = companies.length;
  const highFit = companies.filter(c => (c.fit_score || 0) >= 75).length;
  const repliedThisWeek = cadenceReplies;

  // ── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = async (company) => {
    if (isReadOnly) return;
    const userId = activeUserId || auth.currentUser?.uid;
    if (!userId) return;
    try {
      await updateDoc(doc(db, 'users', userId, 'companies', company.id), {
        status: 'accepted',
        approvedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to approve company:', err);
    }
  };

  // ── First-Run Gate ─────────────────────────────────────────────────────────
  const isFirstRun =
    obComplete === true &&
    onboardingSource === 'barry_onboarding' &&
    hasSeenMCWelcome === false;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: T.appBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: T.accent }}>
          <Loader size={24} className="animate-spin" />
          <span style={{ fontSize: 16, fontWeight: 600 }}>Loading Mission Control...</span>
        </div>
      </div>
    );
  }

  // ── First-Run View ────────────────────────────────────────────────────────
  if (isFirstRun) {
    return (
      <div style={{ minHeight: '100vh', background: T.appBg, paddingBottom: 80 }}>
        <FirstRunView
          barryState={barryState}
          companiesFoundCount={companiesFoundCount}
          companies={companies}
          T={T}
          navigate={navigate}
        />
        <BottomNav onOpenMore={() => setMoreSheetOpen(true)} />
        <MoreSheet isOpen={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} />
        <style>{`
          .animate-spin { animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: T.appBg, paddingBottom: 80 }}>
      {/* Header */}
      <header style={{
        padding: '24px 32px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `${T.accent}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart3 size={20} color={T.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: 0 }}>Mission Control</h1>
            <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>Your top recommended companies</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/scout')} style={{
            padding: '8px 16px', borderRadius: 8,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            New Search +
          </button>
        </div>
      </header>

      {/* Barry Chat Panel — full width above the grid */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px 24px' }}>
        <BarryChatPanel
          userId={activeUserId || auth.currentUser?.uid}
          kpiContext={{
            totalMatches,
            highFit,
            totalReplies: cadenceReplies,
            topPriority: recommendations[0] ? {
              title: recommendations[0].title,
              reason: recommendations[0].reason,
              urgency: recommendations[0].urgency,
            } : null,
          }}
          kpiContextReady={kpisLoaded}
          T={T}
        />
      </div>

      {/* Today's Priorities */}
      <TodaysPriorities recommendations={recommendations} loading={recsLoading} T={T} />

      {/* Main Layout */}
      <div className="mc2-layout" style={{
        maxWidth: 1400, margin: '0 auto', padding: '24px 32px',
      }}>
        {/* Left Column: KPIs + Table */}
        <div style={{ minWidth: 0 }}>
          {/* KPI Row */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
            <KpiCard icon={Target} label="Total Matches" value={totalMatches} color={BRAND.pink} T={T} />
            <KpiCard icon={Star} label="Good Fit (75%+)" value={highFit} color={STATUS.green} T={T} />
            <KpiCard icon={Mail} label="Total Replies" value={repliedThisWeek} color={BRAND.cyan} subtitle="All time" T={T} />
            <KpiCard icon={Calendar} label="Meetings Booked" value="—" color={T.textFaint} subtitle="Coming soon" T={T} />
          </div>

          {/* Search & Filter */}
          <div style={{
            display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div style={{ position: 'relative', flex: '1 1 200px' }}>
              <Search size={16} color={T.textFaint} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
                placeholder="Search companies..."
                style={{
                  width: '100%', padding: '10px 12px 10px 36px', borderRadius: 10,
                  border: `1.5px solid ${T.border2}`, background: T.input,
                  color: T.text, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <select
              value={industryFilter}
              onChange={(e) => { setIndustryFilter(e.target.value); setPage(0); }}
              style={{
                padding: '10px 12px', borderRadius: 10,
                border: `1.5px solid ${T.border2}`, background: T.input,
                color: T.text, fontSize: 13, cursor: 'pointer',
              }}
            >
              <option value="">All Industries</option>
              {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
            <select
              value={scoreFilter}
              onChange={(e) => { setScoreFilter(e.target.value); setPage(0); }}
              style={{
                padding: '10px 12px', borderRadius: 10,
                border: `1.5px solid ${T.border2}`, background: T.input,
                color: T.text, fontSize: 13, cursor: 'pointer',
              }}
            >
              <option value="all">All Scores</option>
              <option value="90+">90+ (High Fit)</option>
              <option value="70-89">70-89 (Good Fit)</option>
              <option value="<70">Below 70</option>
            </select>
          </div>

          {/* Company Table */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 14, overflow: 'hidden',
          }}>
            {/* Table Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 80px 1.5fr 120px',
              padding: '12px 18px',
              background: T.surface,
              borderBottom: `1px solid ${T.border}`,
              fontSize: 11, fontWeight: 700, color: T.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <div>Company</div>
              <div>Why it's a match</div>
              <div style={{ textAlign: 'center' }}>Fit Score</div>
              <div>Recommended Contact</div>
              <div style={{ textAlign: 'center' }}>Next Step</div>
            </div>

            {/* Table Rows */}
            {pageCompanies.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 14 }}>
                {searchTerm || industryFilter || scoreFilter !== 'all'
                  ? 'No companies match your filters.'
                  : 'No companies yet. Head to Scout to start finding prospects.'}
              </div>
            ) : (
              pageCompanies.map((company, i) => {
                const name = company.name || company.company_name || 'Unknown';
                const industry = company.industry || '';
                const size = company.employee_count || company.employeeCount || '';
                // "Why it's a match" — first 2-3 specific reasons from the shared
                // scorer, never a generic template.
                const reasonList = company.fit_reasons || company.matchReasons || company.match_reasons || [];
                const reason = reasonList.length > 0
                  ? reasonList.slice(0, 3).join(' • ')
                  : 'Matches your ICP profile';
                const contact = company.recommendedContact;

                return (
                  <div
                    key={company.id || i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 2fr 80px 1.5fr 120px',
                      padding: '14px 18px',
                      borderBottom: `1px solid ${T.border}`,
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.rowHov}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Company */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: `${T.accent}12`, border: `1px solid ${T.accent}25`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: T.accent, flexShrink: 0,
                      }}>
                        {name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{name}</div>
                        <div style={{ fontSize: 11, color: T.textFaint }}>
                          {[industry, size && `${size}`].filter(Boolean).join(', ')}
                        </div>
                      </div>
                    </div>

                    {/* Match Reason */}
                    <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.4 }}>
                      {reason}
                    </div>

                    {/* Fit Score */}
                    <div style={{ textAlign: 'center' }}>
                      <FitBadge score={Math.round(company.fit_score || 0)} />
                    </div>

                    {/* Recommended Contact */}
                    <div>
                      {contact ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: '50%',
                            background: `${BRAND.purple}15`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, color: BRAND.purple, flexShrink: 0,
                          }}>
                            {(contact.name || '?').charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{contact.name}</div>
                            <div style={{ fontSize: 10, color: T.textFaint }}>{contact.title}</div>
                          </div>
                          {contact.linkedin && (
                            <a href={contact.linkedin} target="_blank" rel="noopener noreferrer"
                               onClick={(e) => e.stopPropagation()}
                               style={{ color: '#0a66c2', flexShrink: 0 }}>
                              <Linkedin size={14} />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: T.textFaint }}>—</span>
                      )}
                    </div>

                    {/* Next Step */}
                    <div style={{ textAlign: 'center' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedCompany(company); }}
                        style={{
                          padding: '6px 14px', borderRadius: 8,
                          background: `${T.accent}15`, border: `1px solid ${T.accent}30`,
                          color: T.accent, fontSize: 11, fontWeight: 700,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        View & Approve
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
                padding: '14px 18px', borderTop: `1px solid ${T.border}`,
              }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{
                    padding: '6px 12px', borderRadius: 8,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: page === 0 ? T.textFaint : T.text,
                    cursor: page === 0 ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span style={{ fontSize: 12, color: T.textMuted }}>
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={{
                    padding: '6px 12px', borderRadius: 8,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: page >= totalPages - 1 ? T.textFaint : T.text,
                    cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Recent Outreach Activity */}
      <RecentOutreachActivity userId={activeUserId || auth.currentUser?.uid} T={T} />

      {/* Hunter Readiness Banner */}
      <HunterReadinessBanner
        acceptedCompanies={acceptedCompanies}
        totalReplies={cadenceReplies}
        cadencesSent={cadencesSent}
        subscriptionTier={subscriptionTier}
        T={T}
      />

      {/* Company Detail Panel */}
      {selectedCompany && (
        <>
          <div
            onClick={() => setSelectedCompany(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
              zIndex: 99,
            }}
          />
          <CompanyDetailPanel
            company={selectedCompany}
            onClose={() => setSelectedCompany(null)}
            onApprove={handleApprove}
            T={T}
          />
        </>
      )}

      {/* Mobile Bottom Nav */}
      <BottomNav onOpenMore={() => setMoreSheetOpen(true)} />
      <MoreSheet isOpen={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} />

      <style>{`
        .animate-spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @media (max-width: 900px) {
          .mc2-table-header, .mc2-table-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
