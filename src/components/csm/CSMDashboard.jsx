/**
 * CSMDashboard.jsx — Customer Success dashboard with KPI strip and card grid.
 *
 * Spec ref: v1.2 Section 3 — CSM Dashboard View
 *
 * Features:
 *   - KPI strip: total customers, avg health, at-risk count, overdue check-ins
 *   - Filter bar: health bucket + search
 *   - Card grid: CSMCard for each customer
 *   - Success Wizard launcher (if no plan configured)
 *   - Snooze sheet (inline)
 *
 * Props:
 *   userId — current user ID
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  HeartPulse, Users, AlertTriangle, Clock, Search,
  Filter, Sparkles, RefreshCw, Plus, Settings,
} from 'lucide-react';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useT } from '../../theme/ThemeContext';
import { computeHealthScore, batchUpdateHealthScores } from '../../services/healthScore';
import { filterOutSnoozed } from '../../services/snoozeManager';
import { snoozeContact, SNOOZE_PRESETS, SNOOZE_REASONS } from '../../services/snoozeManager';
import CSMCard from './CSMCard';
import SuccessWizard from './SuccessWizard';

const GREEN = '#22c55e';
const TEAL  = '#14b8a6';

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ value, label, icon: Icon, color, T }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: '12px 14px',
      background: T.cardBg, border: `1px solid ${T.border}`,
      borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `${color}15`, border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={15} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Snooze Sheet ─────────────────────────────────────────────────────────────
function SnoozeSheet({ contact, userId, onClose, T }) {
  const [preset, setPreset] = useState('1w');
  const [reason, setReason] = useState('vacation');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSnooze() {
    const days = SNOOZE_PRESETS.find(p => p.id === preset)?.days || 7;
    setSaving(true);
    try {
      await snoozeContact(userId, contact.id, { days, reason, note });
      onClose();
    } catch (err) {
      console.error('[CSMDashboard] snooze failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: T.cardBg,
        borderRadius: 14, border: `1px solid ${T.border}`,
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)', padding: 20,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          Snooze {contact.name}
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
          Temporarily hide from attention queues.
        </div>

        {/* Duration */}
        <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 6 }}>Duration</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
          {SNOOZE_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                background: preset === p.id ? `${TEAL}15` : T.surface,
                border: `1px solid ${preset === p.id ? TEAL : T.border}`,
                color: preset === p.id ? TEAL : T.textMuted,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Reason */}
        <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 6 }}>Reason</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
          {SNOOZE_REASONS.map(r => (
            <button
              key={r.id}
              onClick={() => setReason(r.id)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                background: reason === r.id ? `${TEAL}15` : T.surface,
                border: `1px solid ${reason === r.id ? TEAL : T.border}`,
                color: reason === r.id ? TEAL : T.textMuted,
                cursor: 'pointer',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Note */}
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional note..."
          rows={2}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 8,
            border: `1px solid ${T.border}`, background: T.surface,
            color: T.text, fontSize: 12, resize: 'none', marginBottom: 14,
          }}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', borderRadius: 7, fontSize: 12,
              background: 'none', border: `1px solid ${T.border}`,
              color: T.textMuted, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSnooze}
            disabled={saving}
            style={{
              padding: '7px 18px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: TEAL, border: 'none', color: '#fff',
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Snoozing...' : 'Snooze'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSMDashboard ─────────────────────────────────────────────────────────────
export default function CSMDashboard({ userId }) {
  const T = useT();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasSuccessPlan, setHasSuccessPlan] = useState(null); // null = loading
  const [showWizard, setShowWizard] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [bucketFilter, setBucketFilter] = useState('all'); // 'all' | 'at_risk' | 'neutral' | 'healthy'
  const [refreshing, setRefreshing] = useState(false);

  // Load contacts (customers only)
  useEffect(() => {
    if (!userId) return;
    const ref = collection(db, 'users', userId, 'contacts');
    const unsub = onSnapshot(ref, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const customers = all.filter(c =>
        !c.archived &&
        (c.brigade === 'customers' || c.person_type === 'customer' ||
         c.contact_status === 'customer' || c.contact_status === 'Active Customer')
      );
      setContacts(customers);
      setLoading(false);
    });
    return unsub;
  }, [userId]);

  // Check if success plan exists
  useEffect(() => {
    if (!userId) return;
    getDoc(doc(db, 'users', userId, 'successPlan', 'config')).then(snap => {
      setHasSuccessPlan(snap.exists());
    }).catch(() => setHasSuccessPlan(false));
  }, [userId]);

  // Compute health scores for all contacts
  const healthMap = useMemo(() => {
    const map = new Map();
    contacts.forEach(c => {
      map.set(c.id, computeHealthScore(c));
    });
    return map;
  }, [contacts]);

  // KPIs
  const kpis = useMemo(() => {
    const scores = [...healthMap.values()];
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((s, h) => s + h.score, 0) / scores.length)
      : 0;
    const atRisk = scores.filter(h => h.bucket === 'at_risk').length;
    const overdue = contacts.filter(c => {
      const last = c.engagement_summary?.last_contact_at;
      if (!last) return true;
      return (Date.now() - new Date(last).getTime()) > 14 * 86400_000;
    }).length;
    return { total: contacts.length, avgScore, atRisk, overdue };
  }, [contacts, healthMap]);

  // Filtered + sorted contacts
  const displayed = useMemo(() => {
    let list = filterOutSnoozed(contacts);
    if (bucketFilter !== 'all') {
      list = list.filter(c => healthMap.get(c.id)?.bucket === bucketFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q)
      );
    }
    // Sort: at_risk first, then neutral, then healthy
    const bucketOrder = { at_risk: 0, neutral: 1, healthy: 2 };
    list.sort((a, b) => {
      const ha = healthMap.get(a.id)?.bucket || 'neutral';
      const hb = healthMap.get(b.id)?.bucket || 'neutral';
      return (bucketOrder[ha] ?? 1) - (bucketOrder[hb] ?? 1);
    });
    return list;
  }, [contacts, healthMap, bucketFilter, search]);

  async function handleRefreshScores() {
    if (!userId || refreshing) return;
    setRefreshing(true);
    try {
      await batchUpdateHealthScores(userId);
    } catch (err) {
      console.error('[CSMDashboard] refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }

  // Show wizard prompt if no success plan
  if (hasSuccessPlan === false && !showWizard) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', padding: 40, textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: `${GREEN}15`, border: `1px solid ${GREEN}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <Sparkles size={28} color={GREEN} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
          Set Up Customer Success
        </div>
        <div style={{ fontSize: 13, color: T.textMuted, maxWidth: 360, lineHeight: 1.6, marginBottom: 20 }}>
          Configure your CSM module to start tracking customer health, milestones, and check-in cadence.
        </div>
        <button
          onClick={() => setShowWizard(true)}
          style={{
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: `linear-gradient(135deg,${GREEN},${TEAL})`,
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Launch Setup Wizard
        </button>
      </div>
    );
  }

  if (showWizard) {
    return (
      <SuccessWizard
        contacts={contacts}
        userId={userId}
        onComplete={() => { setShowWizard(false); setHasSuccessPlan(true); }}
        onClose={() => setShowWizard(false)}
      />
    );
  }

  return (
    <div style={{ padding: 20, height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <HeartPulse size={18} color={GREEN} />
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Customer Success</span>
          <span style={{ fontSize: 11, color: T.textFaint, padding: '1px 6px', borderRadius: 8, background: T.surface }}>
            {contacts.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleRefreshScores}
            disabled={refreshing}
            title="Refresh health scores"
            style={{
              width: 30, height: 30, borderRadius: 7, border: `1px solid ${T.border}`,
              background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: refreshing ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={13} color={T.textFaint} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button
            onClick={() => setShowWizard(true)}
            title="CSM Settings"
            style={{
              width: 30, height: 30, borderRadius: 7, border: `1px solid ${T.border}`,
              background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Settings size={13} color={T.textFaint} />
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard value={kpis.total} label="Customers" icon={Users} color={GREEN} T={T} />
        <KPICard value={kpis.avgScore} label="Avg Health" icon={HeartPulse} color={kpis.avgScore >= 70 ? GREEN : kpis.avgScore >= 40 ? '#f59e0b' : '#dc2626'} T={T} />
        <KPICard value={kpis.atRisk} label="At Risk" icon={AlertTriangle} color="#dc2626" T={T} />
        <KPICard value={kpis.overdue} label="Overdue" icon={Clock} color="#f59e0b" T={T} />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={13} color={T.textFaint} style={{ position: 'absolute', left: 9, top: 8 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customers..."
            style={{
              width: '100%', padding: '7px 10px 7px 28px', borderRadius: 7,
              border: `1px solid ${T.border}`, background: T.surface,
              color: T.text, fontSize: 12,
            }}
          />
        </div>
        {['all', 'at_risk', 'neutral', 'healthy'].map(b => {
          const active = bucketFilter === b;
          const labels = { all: 'All', at_risk: 'At Risk', neutral: 'Neutral', healthy: 'Healthy' };
          const colors = { all: T.textMuted, at_risk: '#dc2626', neutral: '#f59e0b', healthy: '#22c55e' };
          return (
            <button
              key={b}
              onClick={() => setBucketFilter(b)}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: active ? 600 : 400,
                background: active ? `${colors[b]}15` : 'transparent',
                border: `1px solid ${active ? colors[b] : T.border}`,
                color: active ? colors[b] : T.textFaint,
                cursor: 'pointer',
              }}
            >
              {labels[b]}
            </button>
          );
        })}
      </div>

      {/* Card Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: T.textFaint }}>Loading customers...</div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: T.textFaint }}>
          {search || bucketFilter !== 'all' ? 'No customers match your filters' : 'No customers found'}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}>
          {displayed.map(c => (
            <CSMCard
              key={c.id}
              contact={c}
              healthResult={healthMap.get(c.id)}
              onClick={() => {/* TODO: open contact profile */}}
              onCheckIn={() => {/* TODO: open engage drawer */}}
              onSnooze={() => setSnoozeTarget(c)}
            />
          ))}
        </div>
      )}

      {/* Snooze Sheet */}
      {snoozeTarget && (
        <SnoozeSheet
          contact={snoozeTarget}
          userId={userId}
          onClose={() => setSnoozeTarget(null)}
          T={T}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
