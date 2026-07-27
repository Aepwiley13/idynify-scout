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
import { calculateICPScore, DEFAULT_WEIGHTS } from '../../utils/icpScoring';
import useOnboardingState from '../../hooks/useOnboardingState';
import BottomNav from '../../components/layout/BottomNav';
import MoreSheet from '../../components/layout/MoreSheet';
import {
  Search, Filter, ChevronLeft, ChevronRight, ExternalLink,
  Linkedin, Users, Target, TrendingUp, Calendar, X,
  Loader, ArrowRight, Star, Mail, UserPlus, RefreshCw,
  BarChart3, Building2, Check,
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
  const color = score >= 90 ? STATUS.green : score >= 70 ? STATUS.amber : '#888';
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
  const reasons = company.matchReasons || company.match_reasons || [];
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
            {(reasons.length > 0 ? reasons : matchReason ? [matchReason] : ['Matches your ICP criteria']).map((r, i) => (
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

// ─── Barry Panel ─────────────────────────────────────────────────────────────
function BarryPanel({ companies, T, navigate }) {
  const highFit = companies.filter(c => (c.fit_score || 0) >= 90).length;
  const topIndustry = (() => {
    const counts = {};
    companies.forEach(c => {
      const ind = c.industry || 'Unknown';
      counts[ind] = (counts[ind] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  })();

  const take = companies.length > 0
    ? `These are the best companies for you right now. ${highFit} have a fit score above 90%.${topIndustry ? ` I'm seeing a strong pattern in ${topIndustry}.` : ''} Want me to adjust anything or find more in a different industry?`
    : 'No matches yet. Complete your ICP in RECON and I\'ll start finding companies for you.';

  return (
    <div style={{
      background: T.cardBg, border: `1px solid ${T.border}`,
      borderRadius: 16, padding: 20, height: 'fit-content',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', overflow: 'hidden',
          background: `linear-gradient(135deg,${BRAND.pink},${T.cyan || BRAND.cyan})`,
          border: `2px solid ${(T.cyan || BRAND.cyan)}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: `0 0 20px ${(T.cyan || BRAND.cyan)}50`,
        }}>
          <img src={ASSETS.barryAvatar} alt="Barry" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
               onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Barry is with you</div>
          <div style={{ fontSize: 11, color: T.textFaint }}>AI SDR</div>
        </div>
      </div>

      {/* Barry's Take */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 6 }}>Barry's Take</div>
        <p style={{ fontSize: 13, color: T.text, lineHeight: 1.55, margin: 0 }}>{take}</p>
      </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8 }}>Quick Actions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Build a Cadence', icon: Mail, path: '/scout/cadences' },
            { label: 'View My Outreach', icon: TrendingUp, path: '/hunter' },
            { label: 'Import More Contacts', icon: UserPlus, path: '/scout?tab=company-search' },
            { label: 'Schedule a Meeting', icon: Calendar, path: null },
          ].map(({ label, icon: Icon, path }) => (
            <button
              key={label}
              onClick={() => path && navigate(path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.text, fontSize: 12, fontWeight: 500,
                cursor: path ? 'pointer' : 'default',
                opacity: path ? 1 : 0.5,
                textAlign: 'left', width: '100%',
              }}
            >
              <Icon size={14} color={T.textMuted} />
              {label}
              {!path && <span style={{ marginLeft: 'auto', fontSize: 10, color: T.textFaint }}>Soon</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Find More */}
      <button
        onClick={() => navigate('/scout?tab=daily-leads')}
        style={{
          width: '100%', padding: '12px 16px', borderRadius: 10,
          background: `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.purple})`,
          color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <RefreshCw size={14} /> Find More Companies
      </button>

      {/* Quote */}
      <div style={{
        marginTop: 16, padding: '12px 16px',
        background: T.surface, borderRadius: 10,
        borderLeft: `3px solid ${T.accent}`,
      }}>
        <p style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>
          "You focus on relationships. I'll handle the prospecting. Let's get you more customers."
        </p>
        <p style={{ fontSize: 11, color: T.textFaint, margin: '4px 0 0', textAlign: 'right' }}>— Barry</p>
      </div>
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
  const [cadenceReplies, setCadenceReplies] = useState(0);

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
      loadCompanies();
      loadCadenceReplies();
    }
  }, [activeUserId]);

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

      // Score and sort
      const scored = filtered.map(c => ({
        ...c,
        fit_score: activeProfile
          ? calculateICPScore(c, activeProfile, activeProfile.scoringWeights || DEFAULT_WEIGHTS)
          : (c.fit_score || c.icpScore || 0),
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
  const highFit = companies.filter(c => (c.fit_score || 0) >= 90).length;
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

  // ── Resume Banner ──────────────────────────────────────────────────────────
  const showResumeBanner = !onboarding.loading && onboarding.started && !onboarding.completed;

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

  return (
    <div style={{ minHeight: '100vh', background: T.appBg, paddingBottom: 80 }}>
      {/* Resume Onboarding Banner */}
      {showResumeBanner && (
        <div style={{
          padding: '12px 24px',
          background: `linear-gradient(135deg, ${BRAND.pink}18, ${BRAND.purple}18)`,
          borderBottom: `1px solid ${BRAND.pink}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 13, color: T.text }}>
            You haven't finished setting up. Barry can help you get more out of Scout.
          </span>
          <button
            onClick={() => navigate('/onboarding/flow')}
            style={{
              padding: '6px 16px', borderRadius: 8, border: 'none',
              background: BRAND.pink, color: '#fff', fontSize: 12,
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            Resume setup
          </button>
        </div>
      )}

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

      {/* Main Layout */}
      <div className="mc2-layout" style={{
        maxWidth: 1400, margin: '0 auto', padding: '24px 32px',
        display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24,
      }}>
        {/* Left Column: KPIs + Table */}
        <div style={{ minWidth: 0 }}>
          {/* KPI Row */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
            <KpiCard icon={Target} label="Total Matches" value={totalMatches} color={BRAND.pink} T={T} />
            <KpiCard icon={Star} label="High Fit (90%+)" value={highFit} color={STATUS.green} T={T} />
            <KpiCard icon={Mail} label="Replied This Week" value={repliedThisWeek} color={BRAND.cyan} subtitle="From cadences" T={T} />
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
                const reason = company.matchReason || company.match_reason || (industry ? `${industry} company matching your ICP` : '—');
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

        {/* Right Column: Barry Panel */}
        <BarryPanel companies={companies} T={T} navigate={navigate} />
      </div>

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
          .mc2-layout { grid-template-columns: 1fr !important; }
          .mc2-table-header, .mc2-table-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
