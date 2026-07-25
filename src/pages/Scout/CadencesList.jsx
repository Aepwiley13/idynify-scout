import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import { RefreshCw, Plus, Users, Send, AlertTriangle, Eye } from 'lucide-react';
import BulkComposeModal from '../../components/scout/BulkComposeModal';

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function getCadenceStatus(c) {
  if (c.completedAt) return 'Completed';
  if ((c.sentCount || 0) > 0) return 'Active';
  return 'Draft';
}

const STATUS_BADGE_COLORS = {
  Completed: STATUS.green,
  Active:    '#3b82f6',
  Draft:     '#94a3b8',
};

export default function CadencesList() {
  const T = useT();
  const navigate = useNavigate();
  const user = useActiveUser();
  const [cadences, setCadences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);

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

  const totals = useMemo(() => {
    let contacts = 0, sent = 0;
    for (const c of cadences) {
      contacts += c.contactCount || 0;
      sent += c.sentCount || 0;
    }
    return { contacts, sent };
  }, [cadences]);

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

  return (
    <div style={{
      flex: 1, background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      minHeight: '100dvh', overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: 8, flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: '0 0 4px' }}>
              Cadences
            </h1>
            <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>
              Your bulk outreach history
            </p>
          </div>
          <button
            onClick={() => setShowCompose(true)}
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

        {/* Aggregate summary */}
        {cadences.length > 0 && (
          <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 20 }}>
            {cadences.length} cadence{cadences.length !== 1 ? 's' : ''}
            {' • '}
            {totals.contacts} contact{totals.contacts !== 1 ? 's' : ''} reached
            {' • '}
            {totals.sent} sent
          </div>
        )}

        {/* Empty state */}
        {cadences.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '80px 32px',
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 16, marginTop: 12,
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20,
              background: `${BRAND.pink}12`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <RefreshCw size={48} color={BRAND.pink} style={{ opacity: 0.8 }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 8 }}>
              No cadences yet
            </div>
            <div style={{ fontSize: 13, color: T.textMuted, maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
              Select contacts in Scout and click Compose Email to run your first cadence.
            </div>
          </div>
        )}

        {/* Cadence cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cadences.map(c => {
            const status = getCadenceStatus(c);
            const badgeColor = STATUS_BADGE_COLORS[status];
            return (
              <div
                key={c.id}
                onClick={() => navigate(`/scout/cadence/${c.id}`)}
                style={{
                  background: T.cardBg,
                  border: `1px solid ${T.border}`,
                  borderLeft: `4px solid ${BRAND.pink}`,
                  borderRadius: 12,
                  padding: '16px 20px',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s, transform 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                {/* Top row: name + status */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, marginBottom: 10,
                }}>
                  <div style={{
                    fontSize: 15, fontWeight: 500, color: T.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    minWidth: 0, flex: 1,
                  }}>
                    {c.name || 'Untitled Cadence'}
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '3px 10px', borderRadius: 20, flexShrink: 0,
                    background: `${badgeColor}15`, border: `1px solid ${badgeColor}30`,
                    fontSize: 11, fontWeight: 600, color: badgeColor,
                  }}>
                    {status}
                  </span>
                </div>

                {/* Bottom row: date + stats */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', gap: 8,
                }}>
                  <div style={{ fontSize: 12, color: T.textFaint }}>
                    {formatDateTime(c.completedAt || c.createdAt)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <StatPill icon={Users} value={c.contactCount || 0} label="contacts" color={T.textMuted} T={T} />
                    <StatPill icon={Send} value={c.sentCount || 0} label="sent" color={STATUS.green} T={T} />
                    {(c.failedCount || 0) > 0 && (
                      <StatPill icon={AlertTriangle} value={c.failedCount} label="failed" color={STATUS.red} T={T} />
                    )}
                    <StatPill icon={Eye} value={c.openedCount || 0} label="opened" color={BRAND.purple} T={T} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCompose && (
        <BulkComposeModal
          contacts={[]}
          onClose={() => setShowCompose(false)}
        />
      )}
    </div>
  );
}

function StatPill({ icon: Icon, value, label, color, T }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Icon size={13} color={color} />
      <span style={{ fontSize: 12, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11, color: T.textFaint }}>{label}</span>
    </div>
  );
}
