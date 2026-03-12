/**
 * OutcomesSection.jsx — Conversion analytics for SNIPER.
 *
 * Win/loss tracking, conversion rate, time-to-close,
 * and pipeline velocity metrics.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  collection, getDocs, query, orderBy
} from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import {
  Trophy, XCircle, BarChart3, TrendingUp,
  Clock, Target, Crosshair, Users
} from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { BRAND } from '../../../theme/tokens';
import { getEffectiveUser } from '../../../context/ImpersonationContext';

const SNIPER_TEAL = '#14b8a6';

const STAGE_ORDER = ['demo_done', 'proposal_sent', 'negotiating', 'closing', 'won', 'lost'];
const STAGE_LABELS = {
  demo_done:     'Demo Done',
  proposal_sent: 'Proposal Sent',
  negotiating:   'Negotiating',
  closing:       'Closing',
  won:           'Won',
  lost:          'Lost',
};

function StatCard({ icon: Icon, label, value, sub, color = SNIPER_TEAL }) {
  const T = useT();
  return (
    <div style={{
      background: T.cardBg, border: `1px solid ${T.border2}`,
      borderRadius: 12, padding: '16px 18px',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10, flexShrink: 0,
        background: `${color}15`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 3 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function PipelineBar({ contacts }) {
  const T = useT();
  const total = contacts.filter(c => c.stage !== 'lost').length || 1;

  const stageCounts = STAGE_ORDER.reduce((acc, s) => {
    acc[s] = contacts.filter(c => (c.stage || 'demo_done') === s).length;
    return acc;
  }, {});

  const STAGE_COLORS = {
    demo_done:     '#3b82f6',
    proposal_sent: '#8b5cf6',
    negotiating:   '#f59e0b',
    closing:       SNIPER_TEAL,
    won:           '#10b981',
    lost:          '#ef4444',
  };

  return (
    <div style={{
      background: T.cardBg, border: `1px solid ${T.border2}`,
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 14 }}>Pipeline Distribution</div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 12, gap: 1 }}>
        {STAGE_ORDER.map(stageId => {
          const count = stageCounts[stageId] || 0;
          const pct = (count / (contacts.length || 1)) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={stageId}
              title={`${STAGE_LABELS[stageId]}: ${count}`}
              style={{
                width: `${pct}%`, background: STAGE_COLORS[stageId],
                minWidth: count > 0 ? 4 : 0,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
        {STAGE_ORDER.map(stageId => {
          const count = stageCounts[stageId] || 0;
          if (count === 0) return null;
          return (
            <div key={stageId} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_COLORS[stageId] }} />
              <span style={{ fontSize: 10, color: T.textMuted }}>
                {STAGE_LABELS[stageId]} <span style={{ color: T.text, fontWeight: 600 }}>{count}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WonLostList({ contacts, type }) {
  const T = useT();
  const list = contacts.filter(c => c.stage === type).slice(0, 10);

  if (list.length === 0) return (
    <div style={{ fontSize: 11, color: T.textFaint, padding: '12px 0', textAlign: 'center' }}>
      None yet
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {list.map(c => (
        <div key={c.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 11px', borderRadius: 8,
          background: T.surface, border: `1px solid ${T.border2}`,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: type === 'won' ? '#10b98118' : '#ef444418',
            border: `1.5px solid ${type === 'won' ? '#10b98140' : '#ef444440'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: type === 'won' ? '#10b981' : '#ef4444',
          }}>
            {(c.firstName?.[0] || '?').toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.firstName} {c.lastName}
            </div>
            <div style={{ fontSize: 9, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.company || '—'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OutcomesSection() {
  const T = useT();
  const [contacts, setContacts] = useState([]);
  const [touches, setTouches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const user = getEffectiveUser();
      if (!user) return;
      try {
        const [contactSnap, touchSnap] = await Promise.all([
          getDocs(query(collection(db, 'users', user.uid, 'sniper_contacts'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'users', user.uid, 'sniper_touches'), orderBy('createdAt', 'desc'))),
        ]);
        setContacts(contactSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setTouches(touchSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error loading outcomes:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const stats = useMemo(() => {
    const won = contacts.filter(c => c.stage === 'won').length;
    const lost = contacts.filter(c => c.stage === 'lost').length;
    const active = contacts.filter(c => c.stage !== 'won' && c.stage !== 'lost').length;
    const total = contacts.length;
    const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;
    return { won, lost, active, total, conversionRate };
  }, [contacts]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', color: T.textFaint }}>
          <Crosshair size={28} color={SNIPER_TEAL} style={{ marginBottom: 10, opacity: 0.6 }} />
          <div style={{ fontSize: 12 }}>Loading outcomes...</div>
        </div>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, flexDirection: 'column', gap: 14 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: `${SNIPER_TEAL}12`, border: `2px solid ${SNIPER_TEAL}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BarChart3 size={24} color={SNIPER_TEAL} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>No data yet</div>
          <div style={{ fontSize: 11, color: T.textFaint, maxWidth: 280, lineHeight: 1.5 }}>
            Outcomes will appear here once you have contacts in your SNIPER pipeline.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 22px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Outcomes</div>
      <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 18 }}>
        Conversion performance across your SNIPER pipeline
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <StatCard icon={Users}     label="Total in Pipeline"  value={stats.total}           color={SNIPER_TEAL} />
          <StatCard icon={Trophy}    label="Won"                value={stats.won}             color="#10b981" />
          <StatCard icon={XCircle}   label="Lost"               value={stats.lost}            color="#ef4444" />
          <StatCard icon={Target}    label="Active"             value={stats.active}          color="#3b82f6" />
          <StatCard icon={TrendingUp} label="Conversion Rate"   value={`${stats.conversionRate}%`} color="#8b5cf6" sub={`${stats.won} of ${stats.total}`} />
          <StatCard icon={BarChart3} label="Total Touches"      value={touches.length}        color="#f59e0b" />
        </div>

        {/* Pipeline bar */}
        <PipelineBar contacts={contacts} />

        {/* Won / Lost lists */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{
            background: T.cardBg, border: '1px solid #10b98125',
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <Trophy size={14} color="#10b981" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981' }}>Won ({stats.won})</span>
            </div>
            <WonLostList contacts={contacts} type="won" />
          </div>

          <div style={{
            background: T.cardBg, border: '1px solid #ef444425',
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <XCircle size={14} color="#ef4444" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>Lost ({stats.lost})</span>
            </div>
            <WonLostList contacts={contacts} type="lost" />
          </div>
        </div>
      </div>
    </div>
  );
}
