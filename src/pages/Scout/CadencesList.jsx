import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import { RefreshCw, ArrowLeft, Plus, Users, Send, AlertTriangle, Eye } from 'lucide-react';
import BulkComposeModal from '../../components/scout/BulkComposeModal';

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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

  if (loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <RefreshCw size={20} color={BRAND.pink} />
              <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0 }}>Cadences</h1>
            </div>
            <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Bulk outreach history</p>
          </div>
          <button
            onClick={() => setShowCompose(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 10,
              background: BRAND.pink, color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <Plus size={16} />
            New Cadence
          </button>
        </div>

        {/* Empty state */}
        {cadences.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '80px 32px',
            background: T.cardBg, border: `1px solid ${T.border}`,
            borderRadius: 16,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: `${BRAND.pink}15`, border: `1px solid ${BRAND.pink}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <RefreshCw size={24} color={BRAND.pink} />
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
          {cadences.map(c => (
            <div
              key={c.id}
              onClick={() => navigate(`/scout/cadence/${c.id}`)}
              style={{
                background: T.cardBg, border: `1px solid ${T.border}`,
                borderRadius: 14, padding: '18px 22px',
                cursor: 'pointer', transition: 'all 0.12s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = T.border2 || T.border;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.transform = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 4 }}>
                    {c.name || 'Untitled Cadence'}
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted }}>
                    {formatDate(c.completedAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                  <StatPill icon={Users} value={c.contactCount || 0} label="contacts" color={T.textMuted} T={T} />
                  <StatPill icon={Send} value={c.sentCount || 0} label="sent" color={STATUS.green} T={T} />
                  {(c.failedCount || 0) > 0 && (
                    <StatPill icon={AlertTriangle} value={c.failedCount} label="failed" color={STATUS.red} T={T} />
                  )}
                  {(c.openedCount || 0) > 0 && (
                    <StatPill icon={Eye} value={c.openedCount} label="opened" color={BRAND.cyan} T={T} />
                  )}
                </div>
              </div>
            </div>
          ))}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <Icon size={13} color={color} />
      <span style={{ fontSize: 13, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11, color: T.textFaint }}>{label}</span>
    </div>
  );
}
