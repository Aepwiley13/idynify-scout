import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import {
  RefreshCw, Plus, Users, Send, AlertTriangle, Eye,
  Inbox, CheckCircle, FileText, MessageSquare,
  Search, SlidersHorizontal, ChevronDown, MoreHorizontal,
  TrendingUp, BarChart3, Clock, Folder, Calendar,
  Copy, Archive,
} from 'lucide-react';
import KpiCard from '../../components/cadences/KpiCard';
import useCadenceStats from '../../hooks/useCadenceStats';
import BulkComposeModal from '../../components/scout/BulkComposeModal';
import { getCadenceStatus } from './CadenceDetail';

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatShortDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const STATUS_BADGE_COLORS = {
  Completed: STATUS.green,
  Active: '#3b82f6',
  Draft: '#94a3b8',
};

function getOwnerInitials(email) {
  if (!email) return '—';
  const name = email.split('@')[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const TEMPLATES = [
  { name: 'Prospecting Templates', count: 12,
    subject: 'Introduction — exploring a potential fit',
    body: 'Hi {{first_name}},\n\nI came across {{company}} and was impressed by your work in the space. I believe there may be a strong fit between what we do and the goals your team is working toward.\n\nWould you be open to a brief conversation this week?\n\nBest regards' },
  { name: 'Partnership Outreach', count: 8,
    subject: 'Partnership opportunity — {{company}}',
    body: 'Hi {{first_name}},\n\nI wanted to reach out about a potential partnership between our organizations. We share a similar audience and I think there could be meaningful ways to collaborate.\n\nI would love to set up a quick call to explore this. What does your availability look like?\n\nBest regards' },
  { name: 'Event Follow-up', count: 6,
    subject: 'Great meeting you at the event',
    body: 'Hi {{first_name}},\n\nIt was great connecting with you at the event. I enjoyed our conversation about {{company}} and the work your team is doing.\n\nI would love to continue the conversation. Would you have time for a brief call this week?\n\nBest regards' },
  { name: 'Referral & Introduction', count: 5,
    subject: 'Introduction from a mutual connection',
    body: 'Hi {{first_name}},\n\nI was referred to you by a mutual connection who thought we should connect. I work with organizations like {{company}} and help them achieve their outreach goals.\n\nWould you be open to a brief introductory call?\n\nBest regards' },
  { name: 'Customer Check-in', count: 4,
    subject: 'Checking in — how can we help?',
    body: 'Hi {{first_name}},\n\nI wanted to check in and see how things are going at {{company}}. We value our relationship and want to make sure you are getting the most from our partnership.\n\nIs there anything we can help with? I would love to hear how things are progressing.\n\nBest regards' },
];

export default function CadencesList() {
  const T = useT();
  const navigate = useNavigate();
  const user = useActiveUser();
  const kpi = useCadenceStats();
  const [cadences, setCadences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composeState, setComposeState] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'users', user.uid, 'cadences'),
      orderBy('completedAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setCadences(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user?.uid]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const filtered = useMemo(() => {
    let list = cadences;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.subject || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'All') {
      list = list.filter(c => getCadenceStatus(c) === statusFilter);
    }
    return list;
  }, [cadences, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const ownerInitials = getOwnerInitials(user?.email);

  // Loading
  if (loading && kpi.loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100dvh',
      }}>
        <RefreshCw size={24} color={T.textFaint} style={{ animation: 'spin 1.5s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      minHeight: '100dvh', overflowY: 'auto',
    }}>
      <style>{`
        .cd-kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
        .cd-mid-3col { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 16px; }
        .cd-bottom-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 1024px) {
          .cd-mid-3col { grid-template-columns: 1fr; }
          .cd-bottom-2col { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
          .cd-kpi-row { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 48px' }}>

        {/* ═══ SECTION 1 — Page header ═══ */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: 20, flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: '0 0 4px' }}>
              Cadences Dashboard
            </h1>
            <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>
              Overview of your bulk outreach cadences and performance.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10,
              background: T.cardBg, border: `1px solid ${T.border}`,
            }}>
              <Search size={14} color={T.textFaint} />
              <input
                placeholder="Search cadences..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                style={{
                  border: 'none', background: 'none', outline: 'none',
                  fontSize: 13, color: T.text, width: 160, fontFamily: 'inherit',
                }}
              />
              <span style={{
                fontSize: 10, color: T.textFaint, padding: '2px 6px',
                borderRadius: 4, border: `1px solid ${T.border}`, fontWeight: 600,
              }}>
                &#8984;K
              </span>
            </div>
            <button
              onClick={() => setComposeState({ subject: '', body: '' })}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 10,
                background: `linear-gradient(135deg, ${BRAND.pink}, #c41568)`,
                color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                boxShadow: '0 2px 8px rgba(232,25,125,0.25)',
              }}
            >
              <Plus size={15} />
              + New Cadence
            </button>
          </div>
        </div>

        {/* ═══ SECTION 2 — KPI cards row ═══ */}
        <div className="cd-kpi-row" style={{ marginBottom: 20 }}>
          <KpiCard icon={Inbox} label="Active Cadences" value={kpi.activeCadences} color={BRAND.purple} />
          <KpiCard icon={CheckCircle} label="Completed Cadences" value={kpi.completedCadences} color={STATUS.green} />
          <KpiCard icon={FileText} label="Drafts" value={kpi.draftCadences} color="#94a3b8" />
          <KpiCard icon={Users} label="Total Contacts Reached" value={kpi.totalContactsReached} color="#3b82f6" />
          <KpiCard icon={MessageSquare} label="Reply Rate (Avg)" value={kpi.replyRate} color={STATUS.amber} />
          <KpiCard icon={Calendar} label="Meetings Booked" value="Coming soon" color={BRAND.pink} />
        </div>

        {/* ═══ SECTION 3 — Three column middle ═══ */}
        <div className="cd-mid-3col" style={{ marginBottom: 20 }}>

          {/* Cadence Performance */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Cadence Performance</span>
              <span style={{ fontSize: 11, color: T.textFaint }}>(Last 7 days)</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {['CADENCE', 'CONTACTS', 'SENT', 'OPEN RATE', 'REPLY RATE', 'MEETINGS'].map(h => (
                      <th key={h} style={{
                        padding: '6px 8px', textAlign: h === 'CADENCE' ? 'left' : 'right',
                        fontSize: 10, fontWeight: 600, color: T.textFaint,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cadences.slice(0, 5).map(c => (
                    <tr key={c.id} style={{ borderBottom: `1px solid ${T.border}08` }}>
                      <td style={{ padding: '8px 8px', color: T.text, fontWeight: 500, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name || 'Untitled'}
                      </td>
                      <td style={{ padding: '8px 8px', color: T.textMuted, textAlign: 'right' }}>{c.contactCount || 0}</td>
                      <td style={{ padding: '8px 8px', color: T.textMuted, textAlign: 'right' }}>{c.sentCount || 0}</td>
                      <td style={{ padding: '8px 8px', color: T.textFaint, textAlign: 'right' }}>
                        {(c.openedCount && c.sentCount) ? `${Math.round((c.openedCount / c.sentCount) * 100)}%` : '—'}
                      </td>
                      <td style={{ padding: '8px 8px', color: c.repliedCount ? STATUS.green : T.textFaint, textAlign: 'right', fontWeight: c.repliedCount ? 600 : 400 }}>
                        {(c.repliedCount && c.sentCount) ? `${Math.round((c.repliedCount / c.sentCount) * 100)}%` : '—'}
                      </td>
                      <td style={{ padding: '8px 8px', color: T.textFaint, textAlign: 'right' }}>—</td>
                    </tr>
                  ))}
                  {cadences.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '20px 8px', textAlign: 'center', color: T.textFaint, fontSize: 12 }}>
                      No cadences yet
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => {}}
              style={{
                display: 'block', width: '100%', textAlign: 'center',
                padding: '10px 0 2px', background: 'none', border: 'none',
                color: BRAND.pink, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              View all performance
            </button>
          </div>

          {/* Barry AI Insights */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 20px',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Barry AI Insights</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: BRAND.purple,
                padding: '2px 8px', borderRadius: 10,
                background: `${BRAND.purple}12`, border: `1px solid ${BRAND.purple}30`,
              }}>BETA</span>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '12px 0' }}>
              <img
                src={ASSETS.barryAvatar}
                alt="Barry AI"
                style={{ width: 48, height: 48, borderRadius: '50%', marginBottom: 12, opacity: 0.7 }}
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
              <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, maxWidth: 220 }}>
                As your cadences collect data, Barry will surface insights and recommend next actions.
              </div>
            </div>
            <button
              disabled
              style={{
                display: 'block', width: '100%', textAlign: 'center',
                padding: '10px 0 2px', background: 'none', border: 'none',
                color: T.textFaint, fontSize: 12, fontWeight: 600,
                cursor: 'default', opacity: 0.5,
              }}
            >
              View all insights
            </button>
          </div>

          {/* Activity Over Time */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 20px',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Activity Over Time</span>
              <select
                disabled
                style={{
                  padding: '4px 8px', borderRadius: 6,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: T.textMuted, fontSize: 11, fontFamily: 'inherit',
                }}
              >
                <option>Last 30 days</option>
              </select>
            </div>
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center',
              padding: '20px 0', minHeight: 120,
            }}>
              <BarChart3 size={32} color={T.textFaint} style={{ marginBottom: 10, opacity: 0.5 }} />
              <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, maxWidth: 200 }}>
                Activity tracking coming soon. Data will appear here as your cadences run.
              </div>
            </div>
            <button
              disabled
              style={{
                display: 'block', width: '100%', textAlign: 'center',
                padding: '10px 0 2px', background: 'none', border: 'none',
                color: T.textFaint, fontSize: 12, fontWeight: 600,
                cursor: 'default', opacity: 0.5,
              }}
            >
              View full analytics
            </button>
          </div>
        </div>

        {/* ═══ SECTION 4 — Cadence table ═══ */}
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border}`,
          borderRadius: 12, overflow: 'hidden', marginBottom: 20,
        }}>
          {/* Table header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderBottom: `1px solid ${T.border}`,
            flexWrap: 'wrap', gap: 10,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
              All Cadences ({filtered.length})
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                background: T.input || T.surface, border: `1px solid ${T.border}`,
              }}>
                <Search size={13} color={T.textFaint} />
                <input
                  placeholder="Search cadences..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  style={{
                    border: 'none', background: 'none', outline: 'none',
                    fontSize: 12, color: T.text, width: 130, fontFamily: 'inherit',
                  }}
                />
              </div>
              <FilterDropdown label="Status" value={statusFilter} options={['All', 'Active', 'Completed', 'Draft']} onChange={v => { setStatusFilter(v); setCurrentPage(1); }} T={T} />
              <FilterDropdown label="Owner" value="All" options={['All']} onChange={() => {}} T={T} />
              <FilterDropdown label="Last run" value="All" options={['All']} onChange={() => {}} T={T} />
              <button
                onClick={() => showToast('Advanced filters coming soon')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 12px', borderRadius: 8,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: T.textMuted, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                }}
              >
                <SlidersHorizontal size={12} />
                Filters
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['CADENCE', 'TYPE', 'AUDIENCE', 'CONTACTS', 'SENT', 'OPEN RATE', 'REPLY RATE', 'MEETINGS', 'STATUS', 'LAST RUN', 'OWNER', ''].map(h => (
                    <th key={h} style={{
                      padding: '10px 10px', textAlign: 'left',
                      fontSize: 10, fontWeight: 600, color: T.textFaint,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{
                      padding: '48px 20px', textAlign: 'center', color: T.textFaint, fontSize: 13,
                    }}>
                      {searchQuery || statusFilter !== 'All' ? 'No cadences match your filters' : 'No cadences yet. Create your first cadence to get started.'}
                    </td>
                  </tr>
                )}
                {paginated.map((c, i) => {
                  const status = getCadenceStatus(c);
                  const badgeColor = STATUS_BADGE_COLORS[status];
                  const contactCount = c.contactCount || 0;
                  const sentCount = c.sentCount || 0;
                  const sentPct = contactCount > 0 ? Math.round((sentCount / contactCount) * 100) : 0;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/scout/cadence/${c.id}`)}
                      style={{
                        borderBottom: i < paginated.length - 1 ? `1px solid ${T.border}` : 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Cadence name + subtitle */}
                      <td style={{ padding: '12px 10px', minWidth: 180 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 8,
                            background: `${BRAND.purple}12`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <Send size={12} color={BRAND.purple} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 500, color: T.text,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {c.name || 'Untitled Cadence'}
                            </div>
                            {c.subject && (
                              <div style={{
                                fontSize: 11, color: T.textFaint, marginTop: 1,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                maxWidth: 200,
                              }}>
                                {c.subject}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 10px', color: T.textMuted, whiteSpace: 'nowrap' }}>
                        {c.type || 'Outreach'}
                      </td>
                      <td style={{ padding: '12px 10px', color: T.textMuted, whiteSpace: 'nowrap' }}>
                        {c.audience || '—'}
                      </td>
                      <td style={{ padding: '12px 10px', color: T.textMuted, textAlign: 'center' }}>
                        {contactCount}
                      </td>
                      {/* Sent with progress bar */}
                      <td style={{ padding: '12px 10px', minWidth: 90 }}>
                        <div style={{ fontSize: 12, color: T.text, fontWeight: 500, marginBottom: 4 }}>
                          {sentCount} ({sentPct}%)
                        </div>
                        <div style={{
                          width: '100%', height: 4, borderRadius: 2,
                          background: T.surface || `${STATUS.green}15`,
                        }}>
                          <div style={{
                            width: `${sentPct}%`, height: '100%', borderRadius: 2,
                            background: STATUS.green,
                          }} />
                        </div>
                      </td>
                      <td style={{ padding: '12px 10px', color: T.textFaint, textAlign: 'center' }}>
                        {(c.openedCount && sentCount) ? `${Math.round((c.openedCount / sentCount) * 100)}%` : '—'}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'center', color: c.repliedCount ? STATUS.green : T.textFaint, fontWeight: c.repliedCount ? 600 : 400 }}>
                        {(c.repliedCount && sentCount) ? `${Math.round((c.repliedCount / sentCount) * 100)}%` : '—'}
                      </td>
                      <td style={{ padding: '12px 10px', color: T.textFaint, textAlign: 'center' }}>—</td>
                      {/* Status badge */}
                      <td style={{ padding: '12px 10px' }}>
                        <span style={{
                          display: 'inline-flex', padding: '3px 10px', borderRadius: 20,
                          background: `${badgeColor}15`, border: `1px solid ${badgeColor}30`,
                          fontSize: 11, fontWeight: 600, color: badgeColor, whiteSpace: 'nowrap',
                        }}>
                          {status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px', color: T.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {formatShortDate(c.completedAt || c.createdAt)}
                      </td>
                      <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, borderRadius: '50%',
                          background: `${BRAND.purple}12`, color: BRAND.purple,
                          fontSize: 10, fontWeight: 700,
                        }}>
                          {ownerInitials}
                        </span>
                      </td>
                      <td style={{ padding: '12px 10px' }}>
                        <RowActions c={c} T={T} showToast={showToast} navigate={navigate} setComposeState={setComposeState} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            padding: '10px 20px', borderTop: `1px solid ${T.border}`,
            gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: T.textFaint }}>Rows per page:</span>
              <select
                value={rowsPerPage}
                onChange={e => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                style={{
                  padding: '3px 6px', borderRadius: 6,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: T.text, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {[5, 10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span style={{ fontSize: 12, color: T.textMuted }}>
              {Math.min((currentPage - 1) * rowsPerPage + 1, filtered.length)}-{Math.min(currentPage * rowsPerPage, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                style={{
                  padding: '4px 8px', borderRadius: 6,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: currentPage <= 1 ? T.textFaint : T.text,
                  cursor: currentPage <= 1 ? 'default' : 'pointer', fontSize: 12,
                }}
              >&lt;</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: p === currentPage ? BRAND.pink : T.cardBg,
                    color: p === currentPage ? '#fff' : T.text,
                    border: p === currentPage ? 'none' : `1px solid ${T.border}`,
                    cursor: 'pointer',
                  }}
                >{p}</button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                style={{
                  padding: '4px 8px', borderRadius: 6,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: currentPage >= totalPages ? T.textFaint : T.text,
                  cursor: currentPage >= totalPages ? 'default' : 'pointer', fontSize: 12,
                }}
              >&gt;</button>
            </div>
          </div>
        </div>

        {/* ═══ SECTION 5 — Two column bottom ═══ */}
        <div className="cd-bottom-2col">

          {/* Upcoming Cadences */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Upcoming Cadences</span>
              <span style={{ fontSize: 12, color: T.textFaint, cursor: 'default' }}>View all</span>
            </div>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', padding: '28px 0', minHeight: 120,
            }}>
              <Clock size={28} color={T.textFaint} style={{ marginBottom: 10, opacity: 0.5 }} />
              <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, maxWidth: 240 }}>
                Scheduled cadences will appear here. Scheduled sending coming soon.
              </div>
            </div>
          </div>

          {/* Cadence Library */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Cadence Library</span>
              <span style={{ fontSize: 12, color: BRAND.pink, cursor: 'pointer', fontWeight: 500 }}>View all</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TEMPLATES.map(t => (
                <button
                  key={t.name}
                  onClick={() => setComposeState({ subject: t.subject, body: t.body })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8,
                    background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `${BRAND.purple}10`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Folder size={14} color={BRAND.purple} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: T.textFaint }}>{t.count} templates</div>
                  </div>
                  <ChevronDown size={14} color={T.textFaint} style={{ transform: 'rotate(-90deg)' }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 9999,
          padding: '10px 18px', borderRadius: 10,
          background: T.cardBg, border: `1px solid ${T.border}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          fontSize: 13, fontWeight: 500, color: T.text,
          animation: 'cdSlideIn 0.2s ease',
        }}>
          {toast}
          <style>{`@keyframes cdSlideIn { from { opacity:0; transform:translateY(-10px) } to { opacity:1; transform:translateY(0) } }`}</style>
        </div>
      )}

      {/* Compose modal */}
      {composeState && (
        <BulkComposeModal
          contacts={[]}
          initialSubject={composeState.subject || ''}
          initialBody={composeState.body || ''}
          onClose={() => setComposeState(null)}
        />
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function FilterDropdown({ label, value, options, onChange, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 10px', borderRadius: 8,
      background: T.cardBg, border: `1px solid ${T.border}`,
    }}>
      <span style={{ fontSize: 11, color: T.textFaint }}>{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          border: 'none', background: 'none', outline: 'none',
          color: T.text, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          fontWeight: 500,
        }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function RowActions({ c, T, showToast, navigate, setComposeState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 4, borderRadius: 6, color: T.textFaint, display: 'flex',
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: T.cardBg, border: `1px solid ${T.border}`,
          borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          minWidth: 140, zIndex: 50, overflow: 'hidden',
        }}>
          {[
            { label: 'View', icon: Eye, action: () => navigate(`/scout/cadence/${c.id}`) },
            { label: 'Duplicate', icon: Copy, action: () => setComposeState({ subject: c.subject || '', body: c.body || '' }) },
            { label: 'Archive', icon: Archive, action: () => showToast('Archive coming soon') },
          ].map(item => (
            <button
              key={item.label}
              onClick={e => { e.stopPropagation(); setOpen(false); item.action(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '8px 14px', border: 'none',
                background: 'none', color: T.text, cursor: 'pointer',
                fontSize: 12, textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <item.icon size={13} color={T.textMuted} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
