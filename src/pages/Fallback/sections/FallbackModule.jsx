/**
 * FallbackModule.jsx — The Comeback Engine
 *
 * Re-engagement dashboard for archived & lost contacts.
 * Surfaces contacts worth revisiting, groups them by reason,
 * and provides one-click actions to bring them back into the pipeline.
 *
 * Data source: users/{userId}/contacts where is_archived === true
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RotateCcw, Clock, TrendingUp, Users, Building2,
  Mail, ArrowRight, Search, Filter, ChevronDown, ChevronUp,
  AlertCircle, Sparkles, RefreshCw, BarChart3,
} from 'lucide-react';
import { collection, query, where, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { PEOPLE_PATHS } from '../../../schemas/peopleSchema';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { auth } from '../../../firebase/config';
import './FallbackModule.css';

// ── Accent ──────────────────────────────────────────────────────────────────
const ACCENT = '#f97316';   // orange-500
const ACCENT_BG = (o = 0.10) => `rgba(249,115,22,${o})`;

// ── Reason labels ───────────────────────────────────────────────────────────
const REASON_LABELS = {
  not_relevant:  'Not Relevant',
  duplicate:     'Duplicate',
  spam:          'Spam',
  other:         'Other',
  lost:          'Lost Deal',
  no_response:   'No Response',
};

// ── Time helpers ────────────────────────────────────────────────────────────
function daysAgo(dateStr) {
  if (!dateStr) return Infinity;
  const d = typeof dateStr === 'object' && dateStr.toDate ? dateStr.toDate() : new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = typeof dateStr === 'object' && dateStr.toDate ? dateStr.toDate() : new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, T }) {
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 140, padding: '14px 16px',
      background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 12,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={14} color={ACCENT} />
        <span style={{ fontSize: 10, color: T.textFaint, letterSpacing: 1, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: T.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: T.textMuted }}>{sub}</div>}
    </div>
  );
}

// ── Contact Row ─────────────────────────────────────────────────────────────
function ContactRow({ person, T, onRestore }) {
  const initials = ((person.first_name?.[0] || '') + (person.last_name?.[0] || '')).toUpperCase() || '?';
  const days = daysAgo(person.archived_at);
  const reasonLabel = REASON_LABELS[person.archived_reason] || person.archived_reason || 'Unknown';

  return (
    <div className="fb-row-hover" style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      borderBottom: `1px solid ${T.border}`, transition: 'background 0.12s',
    }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: ACCENT_BG(0.15), border: `1.5px solid ${ACCENT}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: ACCENT,
        overflow: 'hidden',
      }}>
        {person.photo_url
          ? <img src={person.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initials}
      </div>

      {/* Name + company */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown'}
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[person.title, person.company].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      {/* Reason badge */}
      <div style={{
        fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
        background: ACCENT_BG(0.10), color: ACCENT, whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {reasonLabel}
      </div>

      {/* Archived date */}
      <div style={{ fontSize: 10, color: T.textFaint, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
        {days === Infinity ? '—' : `${days}d ago`}
      </div>

      {/* Restore button */}
      <div
        className="fb-btn-action"
        onClick={(e) => { e.stopPropagation(); onRestore(person); }}
        title="Restore to pipeline"
        style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: ACCENT_BG(0.12), border: `1px solid ${ACCENT}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <RotateCcw size={13} color={ACCENT} />
      </div>
    </div>
  );
}

// ── Reason Breakdown Card ───────────────────────────────────────────────────
function ReasonBreakdown({ groups, total, T }) {
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{
      background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 12,
      padding: 16, marginBottom: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <BarChart3 size={13} color={ACCENT} />
        Archive Reasons
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(([reason, count]) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={reason}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: T.textMuted }}>{REASON_LABELS[reason] || reason}</span>
                <span style={{ fontSize: 11, color: T.textFaint }}>{count} ({pct}%)</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: T.surface, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: ACCENT, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function FallbackModule() {
  const T = useT();
  const activeUser = useActiveUser();
  const uid = activeUser?.uid || auth.currentUser?.uid;

  const [contacts, setContacts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [searchQ, setSearchQ]         = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [sortBy, setSortBy]           = useState('recent');   // recent | oldest | name
  const [showFilters, setShowFilters] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  // ── Fetch archived contacts ───────────────────────────────────────────────
  const loadContacts = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const ref = collection(db, PEOPLE_PATHS.allPeople(uid));
      const q = query(ref, where('is_archived', '==', true));
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setContacts(rows);
    } catch (err) {
      console.error('[FallbackModule] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ── Restore handler ───────────────────────────────────────────────────────
  const handleRestore = useCallback(async (person) => {
    if (!uid || restoringId) return;
    setRestoringId(person.id);
    try {
      const ref = doc(db, PEOPLE_PATHS.allPeople(uid), person.id);
      await updateDoc(ref, {
        is_archived: false,
        archived_at: null,
        archived_reason: null,
        restored_at: new Date().toISOString(),
        stage: 'scout',
        stage_source: 'auto',
      });
      setContacts(prev => prev.filter(c => c.id !== person.id));
    } catch (err) {
      console.error('[FallbackModule] restore error:', err);
    } finally {
      setRestoringId(null);
    }
  }, [uid, restoringId]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const { filtered, reasonGroups, stats } = useMemo(() => {
    // Reason groups
    const rg = {};
    contacts.forEach(c => {
      const r = c.archived_reason || 'other';
      rg[r] = (rg[r] || 0) + 1;
    });

    // Filter
    let list = contacts;
    if (reasonFilter !== 'all') {
      list = list.filter(c => (c.archived_reason || 'other') === reasonFilter);
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.first_name || '').toLowerCase().includes(q) ||
        (c.last_name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortBy === 'recent') {
      list = [...list].sort((a, b) => daysAgo(a.archived_at) - daysAgo(b.archived_at));
    } else if (sortBy === 'oldest') {
      list = [...list].sort((a, b) => daysAgo(b.archived_at) - daysAgo(a.archived_at));
    } else {
      list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Stats
    const now = Date.now();
    const last30 = contacts.filter(c => daysAgo(c.archived_at) <= 30).length;
    const withEmail = contacts.filter(c => c.email).length;
    const pastCustomers = contacts.filter(c => c.person_type === 'past_customer').length;

    return {
      filtered: list,
      reasonGroups: rg,
      stats: { total: contacts.length, last30, withEmail, pastCustomers },
    };
  }, [contacts, reasonFilter, searchQ, sortBy]);

  // ── Unique reasons for filter dropdown ────────────────────────────────────
  const reasonOptions = useMemo(() => {
    const reasons = new Set(contacts.map(c => c.archived_reason || 'other'));
    return ['all', ...Array.from(reasons).sort()];
  }, [contacts]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color={ACCENT} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>Comeback Engine</h2>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: T.textMuted }}>
            Resurface archived contacts worth re-engaging
          </p>
        </div>
        <div
          onClick={loadContacts}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
            borderRadius: 8, background: ACCENT_BG(0.10), border: `1px solid ${ACCENT}30`,
            cursor: 'pointer', fontSize: 12, fontWeight: 600, color: ACCENT,
            transition: 'all 0.15s',
          }}
        >
          <RefreshCw size={13} />
          Refresh
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard icon={Users}       label="TOTAL ARCHIVED" value={stats.total} sub="all time" T={T} />
        <StatCard icon={Clock}       label="LAST 30 DAYS"   value={stats.last30} sub="recently archived" T={T} />
        <StatCard icon={Mail}        label="REACHABLE"      value={stats.withEmail} sub="have email" T={T} />
        <StatCard icon={TrendingUp}  label="PAST CUSTOMERS" value={stats.pastCustomers} sub="highest comeback potential" T={T} />
      </div>

      {/* Reason breakdown */}
      {Object.keys(reasonGroups).length > 0 && (
        <ReasonBreakdown groups={reasonGroups} total={stats.total} T={T} />
      )}

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{
          flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 8,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <Search size={13} color={T.textFaint} />
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search archived contacts…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 12, color: T.text,
            }}
          />
        </div>

        {/* Filter toggle */}
        <div
          onClick={() => setShowFilters(f => !f)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px',
            borderRadius: 8, background: T.surface, border: `1px solid ${T.border}`,
            cursor: 'pointer', fontSize: 12, color: T.textMuted, flexShrink: 0,
          }}
        >
          <Filter size={13} />
          Filters
          {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div style={{
          display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap',
          animation: 'fb-fadeUp 0.15s ease',
        }}>
          {/* Reason filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: T.textFaint }}>Reason:</span>
            <select
              value={reasonFilter}
              onChange={e => setReasonFilter(e.target.value)}
              style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 6,
                background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                outline: 'none', cursor: 'pointer',
              }}
            >
              {reasonOptions.map(r => (
                <option key={r} value={r}>{r === 'all' ? 'All reasons' : (REASON_LABELS[r] || r)}</option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: T.textFaint }}>Sort:</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 6,
                background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="recent">Most recent</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>
      )}

      {/* Contact list */}
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 12,
        overflow: 'hidden',
      }}>
        {/* List header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${T.border}`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted }}>
            {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
            {reasonFilter !== 'all' && ` · ${REASON_LABELS[reasonFilter] || reasonFilter}`}
          </span>
          {searchQ && (
            <span style={{ fontSize: 10, color: T.textFaint }}>
              Searching: "{searchQ}"
            </span>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 12 }}>
            Loading archived contacts…
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <AlertCircle size={24} color={T.textFaint} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>
              {contacts.length === 0 ? 'No archived contacts yet' : 'No contacts match your filters'}
            </div>
            <div style={{ fontSize: 11, color: T.textFaint }}>
              {contacts.length === 0
                ? 'When you archive people from Scout or other modules, they appear here.'
                : 'Try adjusting your search or filters.'}
            </div>
          </div>
        )}

        {/* Rows */}
        {!loading && filtered.map(person => (
          <ContactRow
            key={person.id}
            person={person}
            T={T}
            onRestore={handleRestore}
          />
        ))}
      </div>
    </div>
  );
}
