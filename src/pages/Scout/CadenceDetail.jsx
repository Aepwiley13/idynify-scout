import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import {
  ArrowLeft, RefreshCw, Send, AlertTriangle, Eye, Users,
  UserPlus, Copy, MoreHorizontal, Pencil, Check,
  Search, SlidersHorizontal, Download, ChevronDown, ChevronUp,
  Archive, Settings,
} from 'lucide-react';
import BulkComposeModal from '../../components/scout/BulkComposeModal';

const AVATAR_COLORS = [
  '#e8197d', '#7c3aed', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#14b8a6', '#8b5cf6', '#ec4899', '#06b6d4',
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatShortTime(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getCadenceStatus(cadence) {
  if (cadence.completedAt) return 'Completed';
  if ((cadence.sentCount || 0) > 0) return 'Active';
  return 'Draft';
}

const STATUS_BADGE_COLORS = {
  Completed: STATUS.green,
  Active:    '#3b82f6',
  Draft:     '#94a3b8',
};

const CONTACT_STATUS_COLORS = {
  sent:    '#3b82f6',
  opened:  STATUS.green,
  failed:  STATUS.red,
  pending: '#94a3b8',
};

function contactStatusLabel(status) {
  if (status === 'sent') return 'Sent';
  if (status === 'opened') return 'Opened';
  if (status === 'failed') return 'Failed';
  if (status === 'pending') return 'Pending';
  return status || 'Pending';
}

export default function CadenceDetail() {
  const T = useT();
  const navigate = useNavigate();
  const { cadenceId } = useParams();
  const user = useActiveUser();
  const [cadence, setCadence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [composeMode, setComposeMode] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContacts, setSelectedContacts] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const moreRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!user?.uid || !cadenceId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'cadences', cadenceId));
        if (snap.exists()) setCadence({ id: snap.id, ...snap.data() });
      } catch {
        // read failure
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.uid, cadenceId]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleNameSave = useCallback(async () => {
    if (!editName.trim() || editName.trim() === cadence?.name) {
      setEditingName(false);
      return;
    }
    try {
      await updateDoc(doc(db, 'users', user.uid, 'cadences', cadenceId), { name: editName.trim() });
      setCadence(prev => ({ ...prev, name: editName.trim() }));
    } catch {
      showToast('Failed to update name');
    }
    setEditingName(false);
  }, [editName, cadence?.name, user?.uid, cadenceId, showToast]);

  const startEditing = useCallback(() => {
    setEditName(cadence?.name || '');
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [cadence?.name]);

  const contacts = cadence?.contacts || [];
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(ct =>
      (ct.name || '').toLowerCase().includes(q) ||
      (ct.email || '').toLowerCase().includes(q) ||
      (ct.company || '').toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / rowsPerPage));
  const paginatedContacts = filteredContacts.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const allOnPageSelected = paginatedContacts.length > 0 &&
    paginatedContacts.every(ct => selectedContacts.has(ct.contactId || ct.email));

  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(paginatedContacts.map(ct => ct.contactId || ct.email)));
    }
  };

  const toggleContact = (id) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Loading
  if (loading) {
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

  // Not found
  if (!cadence) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
        background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100dvh',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Cadence not found</div>
        <button
          onClick={() => navigate('/scout/cadences')}
          style={{
            padding: '8px 16px', borderRadius: 8,
            background: T.cardBg, border: `1px solid ${T.border}`,
            color: T.text, cursor: 'pointer', fontSize: 13,
          }}
        >
          Back to Cadences
        </button>
      </div>
    );
  }

  const cadenceStatus = getCadenceStatus(cadence);
  const statusColor = STATUS_BADGE_COLORS[cadenceStatus];
  const totalContacts = cadence.contactCount || contacts.length || 0;
  const sentCount = cadence.sentCount || 0;
  const failedCount = cadence.failedCount || 0;
  const openedCount = cadence.openedCount || 0;
  const sentPct = totalContacts > 0 ? Math.round((sentCount / totalContacts) * 100) : 0;
  const failedPct = totalContacts > 0 ? Math.round((failedCount / totalContacts) * 100) : 0;
  const openedPct = totalContacts > 0 ? Math.round((openedCount / totalContacts) * 100) : 0;
  const progressPct = totalContacts > 0
    ? Math.round(((sentCount + failedCount) / totalContacts) * 100) : 0;
  const progressText = progressPct >= 100
    ? 'All contacts sent successfully'
    : `${totalContacts - sentCount - failedCount} contacts pending`;

  const bodyLines = cadence.body?.split('\n') || [];
  const previewBody = bodyExpanded
    ? cadence.body
    : bodyLines.slice(0, 3).join('\n') + (bodyLines.length > 3 ? '...' : '');
  const canExpandBody = bodyLines.length > 3 || (cadence.body?.length || 0) > 200;

  return (
    <div style={{
      flex: 1, background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      minHeight: '100dvh', overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 48px' }}>

        {/* Back button */}
        <button
          onClick={() => navigate('/scout/cadences')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.textMuted, fontSize: 13, padding: 0, marginBottom: 16,
          }}
        >
          <ArrowLeft size={16} />
          Back to Cadences
        </button>

        {/* ═══ ZONE 1 — Header ═══ */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: 20, flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {editingName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <input
                    ref={nameInputRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={handleNameSave}
                    onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
                    style={{
                      fontSize: 24, fontWeight: 700, color: T.text,
                      background: T.input || T.cardBg, border: `2px solid ${BRAND.pink}`,
                      borderRadius: 8, padding: '4px 10px', outline: 'none',
                      fontFamily: 'inherit', width: '100%', maxWidth: 500,
                    }}
                  />
                </div>
              ) : (
                <>
                  <h1
                    title={cadence.name || 'Untitled Cadence'}
                    style={{
                      fontSize: 24, fontWeight: 700, color: T.text, margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      maxWidth: 'calc(100% - 40px)',
                    }}
                  >
                    {cadence.name || 'Untitled Cadence'}
                  </h1>
                  <button
                    onClick={startEditing}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: 4, borderRadius: 6, display: 'flex',
                      color: T.textFaint,
                    }}
                    title="Edit cadence name"
                  >
                    <Pencil size={16} />
                  </button>
                </>
              )}
            </div>
            <div style={{ fontSize: 13, color: T.textMuted }}>
              Cadence &bull; Created {formatDateTime(cadence.createdAt || cadence.completedAt)}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setComposeMode('add')}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 10,
                background: `linear-gradient(135deg, ${BRAND.pink}, #c41568)`,
                color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                boxShadow: '0 2px 8px rgba(232,25,125,0.25)',
              }}
            >
              <UserPlus size={15} />
              + Add more contacts
            </button>
            <button
              onClick={() => setComposeMode('duplicate')}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 10,
                background: T.cardBg, color: T.text,
                border: `1px solid ${T.border}`,
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              <Copy size={15} />
              Duplicate cadence
            </button>
            <div ref={moreRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '9px 14px', borderRadius: 10,
                  background: T.cardBg, color: T.text,
                  border: `1px solid ${T.border}`,
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                <MoreHorizontal size={16} />
                More
              </button>
              {moreOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  minWidth: 170, zIndex: 50, overflow: 'hidden',
                }}>
                  <button
                    onClick={() => { setMoreOpen(false); showToast('Archive coming soon'); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '10px 16px', border: 'none',
                      background: 'none', color: T.text, cursor: 'pointer',
                      fontSize: 13, textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <Archive size={14} color={T.textMuted} />
                    Archive
                  </button>
                  <button
                    onClick={() => { setMoreOpen(false); startEditing(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '10px 16px', border: 'none',
                      background: 'none', color: T.text, cursor: 'pointer',
                      fontSize: 13, textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <Settings size={14} color={T.textMuted} />
                    Edit
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ ZONE 2 — Stats row ═══ */}
        <style>{`
          .cd-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
          .cd-content { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; }
          @media (max-width: 768px) {
            .cd-stats { grid-template-columns: repeat(2, 1fr); }
            .cd-stats .cd-progress { grid-column: span 2; }
            .cd-content { grid-template-columns: 1fr; }
          }
        `}</style>
        <div className="cd-stats" style={{ marginBottom: 20 }}>
          <StatCard
            icon={Users} label="Total Contacts" value={totalContacts}
            color={T.textMuted} bgTint={T.textMuted} T={T}
          />
          <StatCard
            icon={Send} label="Sent" value={sentCount}
            pct={`${sentPct}%`}
            color={STATUS.green} bgTint={STATUS.green} T={T}
          />
          <StatCard
            icon={AlertTriangle} label="Failed" value={failedCount}
            pct={`${failedPct}%`}
            color={STATUS.red} bgTint={failedCount > 0 ? STATUS.red : T.textMuted}
            danger={failedCount > 0} T={T}
          />
          <StatCard
            icon={Eye} label="Opened" value={openedCount}
            pct={`${openedPct}%`}
            color={BRAND.purple} bgTint={BRAND.purple} T={T}
          />
          <div className="cd-progress" style={{
            padding: '16px 20px',
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textMuted }}>Progress</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: STATUS.green, fontVariantNumeric: 'tabular-nums' }}>
                {progressPct}%
              </span>
            </div>
            <div style={{
              width: '100%', height: 8, borderRadius: 4,
              background: T.surface || `${STATUS.green}15`,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progressPct}%`, height: '100%', borderRadius: 4,
                background: `linear-gradient(90deg, ${STATUS.green}, #34d399)`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>
              {progressText}
            </div>
          </div>
        </div>

        {/* ═══ ZONE 3 — Content section (two columns) ═══ */}
        <div className="cd-content" style={{ marginBottom: 20 }}>

          {/* Message preview card */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 22px',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: T.textFaint,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
            }}>
              Subject
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: T.text, marginBottom: 14 }}>
              {cadence.subject || '—'}
            </div>
            <div style={{ height: 1, background: T.border, marginBottom: 14 }} />
            <div style={{
              fontSize: 10, fontWeight: 700, color: T.textFaint,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
            }}>
              Message Preview
            </div>
            <div style={{
              fontSize: 13, color: T.textMuted, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            }}>
              {previewBody || '—'}
            </div>
            {canExpandBody && (
              <button
                onClick={() => setBodyExpanded(!bodyExpanded)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: BRAND.pink, fontSize: 12, fontWeight: 600,
                  padding: '8px 0 0', marginTop: 4,
                }}
              >
                {bodyExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {bodyExpanded ? 'Show less' : 'Show full message'}
              </button>
            )}
          </div>

          {/* Cadence details card */}
          <div style={{
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '18px 22px',
          }}>
            <DetailRow label="Created" value={formatDateTime(cadence.createdAt || cadence.completedAt)} T={T} />
            <DetailRow label="Last updated" value={formatDateTime(cadence.completedAt || cadence.createdAt)} T={T} />
            <DetailRow label="Created by" value={user?.displayName || user?.email || '—'} T={T} />
            <DetailRow label="Cadence type" value="Outreach" T={T} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
              <span style={{ fontSize: 13, color: T.textMuted }}>Status</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 12px', borderRadius: 20,
                background: `${statusColor}15`, border: `1px solid ${statusColor}30`,
                fontSize: 12, fontWeight: 600, color: statusColor,
              }}>
                {cadenceStatus}
              </span>
            </div>
          </div>
        </div>

        {/* ═══ ZONE 4 — Contact table ═══ */}
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border}`,
          borderRadius: 12, overflow: 'hidden',
        }}>
          {/* Table header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderBottom: `1px solid ${T.border}`,
            flexWrap: 'wrap', gap: 10,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
              Contacts ({filteredContacts.length})
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Search */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                background: T.input || T.surface,
                border: `1px solid ${T.border}`,
              }}>
                <Search size={14} color={T.textFaint} />
                <input
                  placeholder="Search contacts..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  style={{
                    border: 'none', background: 'none', outline: 'none',
                    fontSize: 12, color: T.text, width: 140,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              {/* Filter button */}
              <button
                onClick={() => showToast('Filters coming soon')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '7px 12px', borderRadius: 8,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: T.textMuted, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                }}
              >
                <SlidersHorizontal size={13} />
                Filter
              </button>
              {/* Export button */}
              <button
                onClick={() => showToast('Export coming soon')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '7px 12px', borderRadius: 8,
                  background: T.cardBg, border: `1px solid ${T.border}`,
                  color: T.textMuted, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                }}
              >
                <Download size={13} />
                Export
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={{ padding: '10px 10px 10px 20px', width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer', accentColor: BRAND.pink }}
                    />
                  </th>
                  <ThCell T={T}>Contact</ThCell>
                  <ThCell T={T}>Email</ThCell>
                  <ThCell T={T}>Status</ThCell>
                  <ThCell T={T}>Sent</ThCell>
                  <ThCell T={T}>Reason</ThCell>
                  <th style={{ padding: '10px 20px 10px 10px', width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {paginatedContacts.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{
                      padding: '48px 20px', textAlign: 'center',
                      color: T.textFaint, fontSize: 13,
                    }}>
                      <div style={{ marginBottom: 4 }}>
                        {searchQuery ? 'No contacts match your search' : 'No contacts in this cadence'}
                      </div>
                      {!searchQuery && (
                        <button
                          onClick={() => setComposeMode('add')}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: BRAND.pink, fontSize: 13, fontWeight: 600,
                          }}
                        >
                          + Add contacts
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {paginatedContacts.map((ct, i) => {
                  const ctId = ct.contactId || ct.email || i;
                  const isSelected = selectedContacts.has(ctId);
                  const avatarColor = getAvatarColor(ct.name);
                  return (
                    <tr
                      key={ctId}
                      style={{
                        borderBottom: i < paginatedContacts.length - 1 ? `1px solid ${T.border}` : 'none',
                        background: isSelected ? (T.rowSel || `${BRAND.pink}06`) : 'transparent',
                      }}
                    >
                      <td style={{ padding: '10px 10px 10px 20px' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleContact(ctId)}
                          style={{ cursor: 'pointer', accentColor: BRAND.pink }}
                        />
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: `${avatarColor}18`,
                            color: avatarColor, fontSize: 12, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            {getInitials(ct.name)}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>
                              {ct.name || '—'}
                            </div>
                            {ct.company && (
                              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1 }}>
                                {ct.company}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: T.textMuted, fontSize: 13 }}>
                        {ct.email || '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ContactBadge status={ct.status} />
                      </td>
                      <td style={{ padding: '10px 14px', color: T.textMuted, fontSize: 12 }}>
                        {ct.sentAt ? formatShortTime(ct.sentAt) :
                          (ct.status === 'sent' || ct.status === 'opened')
                            ? formatShortTime(cadence.completedAt)
                            : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: T.textMuted, fontSize: 12 }}>
                        {ct.reason || '—'}
                      </td>
                      <td style={{ padding: '10px 20px 10px 10px' }}>
                        <ContactActions T={T} showToast={showToast} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination + bulk actions */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 20px', borderTop: `1px solid ${T.border}`,
            flexWrap: 'wrap', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedContacts.size > 0 && (
                <>
                  <span style={{ fontSize: 12, color: T.textMuted }}>
                    All {selectedContacts.size} selected
                  </span>
                  <button
                    onClick={() => showToast('Bulk actions coming soon')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '5px 12px', borderRadius: 6,
                      background: T.surface, border: `1px solid ${T.border}`,
                      color: T.textMuted, cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    Bulk actions
                    <ChevronDown size={12} />
                  </button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.textFaint }}>Rows per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={e => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  style={{
                    padding: '3px 6px', borderRadius: 6,
                    background: T.cardBg, border: `1px solid ${T.border}`,
                    color: T.text, fontSize: 12, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
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
                >
                  &lt;
                </button>
                <span style={{
                  padding: '4px 12px', borderRadius: 6,
                  background: BRAND.pink, color: '#fff',
                  fontSize: 12, fontWeight: 600, minWidth: 28, textAlign: 'center',
                }}>
                  {currentPage}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  style={{
                    padding: '4px 8px', borderRadius: 6,
                    background: T.cardBg, border: `1px solid ${T.border}`,
                    color: currentPage >= totalPages ? T.textFaint : T.text,
                    cursor: currentPage >= totalPages ? 'default' : 'pointer', fontSize: 12,
                  }}
                >
                  &gt;
                </button>
              </div>
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
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideIn 0.2s ease',
        }}>
          <Check size={14} color={STATUS.green} />
          {toast}
          <style>{`@keyframes slideIn { from { opacity:0; transform:translateY(-10px) } to { opacity:1; transform:translateY(0) } }`}</style>
        </div>
      )}

      {/* Compose modal */}
      {composeMode && (
        <BulkComposeModal
          contacts={[]}
          initialSubject={cadence.subject || ''}
          initialBody={cadence.body || ''}
          initialPath={cadence.path || 'write_your_own'}
          initialCc={cadence.cc || ''}
          initialPersonalize={cadence.personalizedWithBarry !== false}
          onClose={() => setComposeMode(null)}
        />
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function StatCard({ icon: Icon, label, value, pct, color, bgTint, danger, T }) {
  return (
    <div style={{
      padding: '16px 20px',
      background: danger ? `${STATUS.red}08` : T.cardBg,
      border: `1px solid ${danger ? `${STATUS.red}25` : T.border}`,
      borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${bgTint}12`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} color={color} />
        </div>
      </div>
      <div style={{
        fontSize: 26, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>{label}</div>
      {pct !== undefined && (
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{pct}</div>
      )}
    </div>
  );
}

function DetailRow({ label, value, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0',
      borderBottom: `1px solid ${T.border}08`,
    }}>
      <span style={{ fontSize: 13, color: T.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, color: T.text, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ContactBadge({ status }) {
  const color = CONTACT_STATUS_COLORS[status] || CONTACT_STATUS_COLORS.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 20,
      background: `${color}15`, border: `1px solid ${color}30`,
      fontSize: 12, fontWeight: 600, color,
    }}>
      {contactStatusLabel(status)}
    </span>
  );
}

function ContactActions({ T, showToast }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 4, borderRadius: 6, color: T.textFaint,
          display: 'flex',
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
          <button
            onClick={() => { setOpen(false); showToast('Contact actions coming soon'); }}
            style={{
              display: 'block', width: '100%', padding: '8px 14px',
              border: 'none', background: 'none', color: T.text,
              cursor: 'pointer', fontSize: 12, textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            View contact
          </button>
          <button
            onClick={() => { setOpen(false); showToast('Resend coming soon'); }}
            style={{
              display: 'block', width: '100%', padding: '8px 14px',
              border: 'none', background: 'none', color: T.text,
              cursor: 'pointer', fontSize: 12, textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.rowHov || T.surface}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            Resend
          </button>
        </div>
      )}
    </div>
  );
}

function ThCell({ children, T }) {
  return (
    <th style={{
      padding: '10px 14px', textAlign: 'left',
      fontSize: 11, fontWeight: 600, color: T.textFaint,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {children}
    </th>
  );
}
