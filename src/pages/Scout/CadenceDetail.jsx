import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import {
  ArrowLeft, RefreshCw, Send, AlertTriangle, Eye, Users,
  UserPlus, Copy, ChevronDown, ChevronUp,
} from 'lucide-react';
import BulkComposeModal from '../../components/scout/BulkComposeModal';

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusColor(status) {
  if (status === 'sent') return STATUS.green;
  if (status === 'opened') return '#3b82f6';
  if (status === 'failed') return STATUS.red;
  return '#94a3b8';
}

function statusLabel(status) {
  if (status === 'sent') return 'Sent';
  if (status === 'opened') return 'Opened';
  if (status === 'failed') return 'Failed';
  return status || '—';
}

export default function CadenceDetail() {
  const T = useT();
  const navigate = useNavigate();
  const { cadenceId } = useParams();
  const user = useActiveUser();
  const [cadence, setCadence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [composeMode, setComposeMode] = useState(null); // null | 'add' | 'duplicate'

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

  if (!cadence) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
        background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
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

  const bodyPreview = cadence.body?.length > 200 && !bodyExpanded
    ? cadence.body.slice(0, 200) + '…'
    : cadence.body;

  const contacts = cadence.contacts || [];

  return (
    <div style={{
      flex: 1, background: T.appBg, fontFamily: 'Inter, system-ui, sans-serif',
      minHeight: '100dvh', overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Back button */}
        <button
          onClick={() => navigate('/scout/cadences')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.textMuted, fontSize: 13, padding: 0, marginBottom: 20,
          }}
        >
          <ArrowLeft size={16} />
          Back to Cadences
        </button>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: 24, flexWrap: 'wrap', gap: 16,
        }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: '0 0 4px' }}>
              {cadence.name || 'Untitled Cadence'}
            </h1>
            <div style={{ fontSize: 13, color: T.textMuted }}>{formatDate(cadence.completedAt)}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <ActionButton
              icon={UserPlus}
              label="Add more contacts"
              onClick={() => setComposeMode('add')}
              T={T}
              primary
            />
            <ActionButton
              icon={Copy}
              label="Duplicate cadence"
              onClick={() => setComposeMode('duplicate')}
              T={T}
            />
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <StatCard icon={Users} value={cadence.contactCount || 0} label="Contacts" color={T.textMuted} T={T} />
          <StatCard icon={Send} value={cadence.sentCount || 0} label="Sent" color={STATUS.green} T={T} />
          <StatCard icon={AlertTriangle} value={cadence.failedCount || 0} label="Failed" color={STATUS.red} T={T} />
          <StatCard icon={Eye} value={cadence.openedCount || 0} label="Opened" color={BRAND.cyan} T={T} />
        </div>

        {/* Subject & body */}
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: '18px 22px', marginBottom: 24,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Subject
          </div>
          <div style={{ fontSize: 14, color: T.text, marginBottom: 16 }}>
            {cadence.subject || '—'}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Body
          </div>
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {bodyPreview || '—'}
          </div>
          {cadence.body?.length > 200 && (
            <button
              onClick={() => setBodyExpanded(!bodyExpanded)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                color: BRAND.pink, fontSize: 12, fontWeight: 600,
                padding: '8px 0 0', marginTop: 4,
              }}
            >
              {bodyExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {bodyExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>

        {/* Contact table */}
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border}`,
          borderRadius: 14, overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 22px', borderBottom: `1px solid ${T.border}`,
            fontSize: 13, fontWeight: 600, color: T.text,
          }}>
            Contacts ({contacts.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <Th T={T}>Name</Th>
                  <Th T={T}>Email</Th>
                  <Th T={T}>Status</Th>
                  <Th T={T}>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '32px 22px', textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
                      No contact data available
                    </td>
                  </tr>
                )}
                {contacts.map((ct, i) => (
                  <tr
                    key={ct.contactId || i}
                    style={{ borderBottom: i < contacts.length - 1 ? `1px solid ${T.border}` : 'none' }}
                  >
                    <td style={{ padding: '12px 22px', color: T.text, fontWeight: 500 }}>
                      {ct.name || '—'}
                    </td>
                    <td style={{ padding: '12px 22px', color: T.textMuted }}>
                      {ct.email || '—'}
                    </td>
                    <td style={{ padding: '12px 22px' }}>
                      <StatusBadge status={ct.status} T={T} />
                    </td>
                    <td style={{ padding: '12px 22px', color: T.textMuted, fontSize: 12 }}>
                      {ct.reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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

function StatCard({ icon: Icon, value, label, color, T }) {
  return (
    <div style={{
      flex: 1, minWidth: 100, padding: '14px 18px',
      background: T.cardBg, border: `1px solid ${T.border}`,
      borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon size={14} color={color} />
        <span style={{ fontSize: 11, color: T.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, T, primary }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '9px 16px', borderRadius: 10,
        background: primary ? BRAND.pink : T.cardBg,
        color: primary ? '#fff' : T.text,
        border: primary ? 'none' : `1px solid ${T.border}`,
        cursor: 'pointer', fontSize: 13, fontWeight: 600,
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function StatusBadge({ status, T }) {
  const color = statusColor(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      background: `${color}15`, border: `1px solid ${color}30`,
      fontSize: 12, fontWeight: 600, color,
    }}>
      {statusLabel(status)}
    </span>
  );
}

function Th({ children, T }) {
  return (
    <th style={{
      padding: '10px 22px', textAlign: 'left',
      fontSize: 11, fontWeight: 600, color: T.textFaint,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {children}
    </th>
  );
}
