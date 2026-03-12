/**
 * Tenant Health Dashboard
 *
 * Comprehensive view of a specific tenant account:
 * - Account details & status
 * - Data counts (companies, contacts, leads, missions)
 * - Integration status
 * - Recent events & admin actions
 * - Impersonation history
 * - Entry point for Support Mode & Repair Tools
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import {
  ArrowLeft, Shield, User, Building2, Users, Target, Activity,
  Zap, RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock,
  Eye, Wrench, ChevronRight
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE;

async function getTenantHealth(tenantUserId, authToken) {
  const res = await fetch(`${API_BASE}/superAdminGetTenantHealth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ tenantUserId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

async function startSupportSession(tenantUserId, reason, authToken) {
  const res = await fetch(`${API_BASE}/superAdminStartImpersonation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ targetUserId: tenantUserId, reason })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

export default function TenantHealth() {
  const { tenantUserId } = useParams();
  const navigate = useNavigate();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [startingSession, setStartingSession] = useState(false);
  const [sessionMsg, setSessionMsg] = useState(null);

  useEffect(() => {
    loadHealth();
  }, [tenantUserId]);

  const loadHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = auth.currentUser;
      const authToken = await currentUser.getIdToken();
      const data = await getTenantHealth(tenantUserId, authToken);
      setHealth(data.health);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSupportSession = async () => {
    if (!window.confirm(`Start a 15-minute support session for ${health?.tenant?.email}?`)) return;
    setStartingSession(true);
    setSessionMsg(null);
    try {
      const currentUser = auth.currentUser;
      const authToken = await currentUser.getIdToken();
      await startSupportSession(tenantUserId, 'Support session from super admin console', authToken);
      setSessionMsg({ type: 'success', text: 'Support session started. The impersonation banner will appear. You now see the platform as this user.' });
      // Reload page so banner appears
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setSessionMsg({ type: 'error', text: err.message });
    } finally {
      setStartingSession(false);
    }
  };

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen error={error} onBack={() => navigate('/super-admin')} />;
  if (!health) return null;

  const { tenant, account, data, integrations, recentEvents, recentAdminActions, impersonationHistory, hasActiveImpersonation } = health;

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/super-admin')} style={ghostBtnStyle}>
          <ArrowLeft size={16} /> Back
        </button>
        <Shield size={20} color="#f59e0b" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tenant.email}
          </h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>Account ID: {tenant.uid}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={loadHealth} style={ghostBtnStyle}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => navigate(`/super-admin/repair/${tenantUserId}`)} style={ghostBtnStyle}>
            <Wrench size={14} /> Repair Tools
          </button>
          {hasActiveImpersonation ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.875rem', background: '#451a03', border: '1px solid #f59e0b', borderRadius: 7, color: '#fbbf24', fontSize: '0.8rem' }}>
              <Eye size={14} /> Session Active
            </div>
          ) : (
            <button onClick={handleStartSupportSession} disabled={startingSession} style={supportBtnStyle}>
              <Eye size={14} /> {startingSession ? 'Starting...' : 'Enter Support Mode'}
            </button>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 2rem' }}>

        {/* Session message */}
        {sessionMsg && (
          <div style={{ background: sessionMsg.type === 'success' ? '#052e16' : '#450a0a', border: `1px solid ${sessionMsg.type === 'success' ? '#22c55e' : '#ef4444'}`, borderRadius: 8, padding: '0.875rem 1rem', marginBottom: '1.5rem', color: sessionMsg.type === 'success' ? '#86efac' : '#fca5a5', fontSize: '0.875rem' }}>
            {sessionMsg.text}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>

          {/* Account Info */}
          <Section title="Account" icon={<User size={15} color="#f59e0b" />}>
            <Row label="Email" value={tenant.email} />
            <Row label="Status" value={
              <StatusPill value={account.status} map={{ active: 'green', suspended: 'red' }} />
            } />
            <Row label="Subscription" value={account.subscriptionTier || '—'} />
            <Row label="Payment" value={account.hasCompletedPayment ? <Chip color="green" label="Paid" /> : <Chip color="red" label="Unpaid" />} />
            <Row label="Credits" value={account.credits != null ? account.credits : '—'} />
            <Row label="Role" value={account.role || 'user'} />
            <Row label="Verified" value={tenant.emailVerified ? <CheckCircle size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />} />
            <Row label="Disabled" value={tenant.disabled ? <Chip color="red" label="Yes" /> : <Chip color="green" label="No" />} />
            <Row label="Created" value={fmt(tenant.createdAt)} />
            <Row label="Last Sign-in" value={fmt(tenant.lastSignIn)} />
          </Section>

          {/* Data Summary */}
          <div>
            <Section title="Data" icon={<Building2 size={15} color="#f59e0b" />}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '0.25rem 0' }}>
                <StatBox label="Companies" value={data.companies} icon={<Building2 size={16} />} />
                <StatBox label="Contacts" value={data.contacts} icon={<Users size={16} />} />
                <StatBox label="Leads" value={data.leads} icon={<Target size={16} />} />
                <StatBox label="Missions" value={data.missions} icon={<Zap size={16} />} />
              </div>
            </Section>

            {/* Integrations */}
            <Section title="Integrations" icon={<Activity size={15} color="#f59e0b" />} style={{ marginTop: '1rem' }}>
              <Row label="Gmail" value={<IntegrationStatus connected={integrations.gmail} />} />
              <Row label="Calendar" value={<IntegrationStatus connected={integrations.calendar} />} />
              <Row label="CRM" value={<IntegrationStatus connected={integrations.crm} />} />
            </Section>
          </div>
        </div>

        {/* Recent Events */}
        <Section title="Recent Events" icon={<Clock size={15} color="#f59e0b" />} style={{ marginBottom: '1.25rem' }}>
          {recentEvents.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.25rem 0' }}>No recent events.</p>
          ) : recentEvents.map(ev => (
            <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #1e293b', fontSize: '0.8rem' }}>
              <span style={{ color: '#94a3b8' }}>{ev.type}</span>
              <span style={{ color: '#64748b' }}>{fmt(ev.timestamp)}</span>
            </div>
          ))}
        </Section>

        {/* Recent Admin Actions */}
        <Section title="Recent Admin Actions" icon={<Shield size={15} color="#f59e0b" />} style={{ marginBottom: '1.25rem' }}>
          {recentAdminActions.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.25rem 0' }}>No admin actions on record.</p>
          ) : recentAdminActions.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e293b', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: '#f1f5f9' }}>{a.action}</span>
                <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>by {a.actorEmail}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <StatusPill value={a.status} map={{ success: 'green', failed: 'red', partial: 'yellow' }} small />
                <span style={{ color: '#64748b' }}>{fmt(a.timestamp)}</span>
              </div>
            </div>
          ))}
        </Section>

        {/* Impersonation History */}
        <Section title="Support Session History" icon={<Eye size={15} color="#f59e0b" />}>
          {impersonationHistory.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.25rem 0' }}>No previous support sessions.</p>
          ) : impersonationHistory.map(s => (
            <div key={s.sessionId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e293b', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: '#94a3b8' }}>Admin: {s.adminUserId}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <StatusPill value={s.status} map={{ active: 'green', ended: 'gray' }} small />
                <span style={{ color: '#64748b' }}>{fmt(s.startedAt)}</span>
              </div>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}

// Helper components
function Section({ title, icon, children, style = {} }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '1.25rem', ...style }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {icon}{title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #0f172a', fontSize: '0.8rem' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: '#f1f5f9', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function StatBox({ label, value, icon }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: '0.875rem', textAlign: 'center' }}>
      <div style={{ color: '#64748b', marginBottom: '0.25rem' }}>{icon}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{label}</div>
    </div>
  );
}

function Chip({ color, label }) {
  const colors = { green: { bg: '#052e16', text: '#22c55e' }, red: { bg: '#450a0a', text: '#ef4444' }, yellow: { bg: '#422006', text: '#f59e0b' } };
  const c = colors[color] || colors.yellow;
  return <span style={{ background: c.bg, color: c.text, padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>;
}

function StatusPill({ value, map, small }) {
  const colorKey = map[value] || 'gray';
  const colors = { green: '#22c55e', red: '#ef4444', yellow: '#f59e0b', gray: '#64748b' };
  const color = colors[colorKey];
  return <span style={{ fontSize: small ? '0.7rem' : '0.8rem', color, fontWeight: 600 }}>{value}</span>;
}

function IntegrationStatus({ connected }) {
  return connected
    ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#22c55e', fontSize: '0.8rem' }}><CheckCircle size={13} />Connected</span>
    : <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#64748b', fontSize: '0.8rem' }}><XCircle size={13} />Not connected</span>;
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #1e293b', borderTop: '3px solid #f59e0b', borderRadius: '50%', margin: '0 auto 1rem', animation: 'spin 1s linear infinite' }} />
        <p>Loading tenant health...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onBack }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a', color: '#f1f5f9' }}>
      <div style={{ textAlign: 'center' }}>
        <AlertTriangle size={40} color="#ef4444" style={{ marginBottom: '1rem' }} />
        <h2 style={{ marginBottom: '0.5rem' }}>Failed to load tenant</h2>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>{error}</p>
        <button onClick={onBack} style={ghostBtnStyle}>Go Back</button>
      </div>
    </div>
  );
}

const ghostBtnStyle = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.5rem 0.875rem', background: '#1e293b', border: '1px solid #334155',
  borderRadius: 7, color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer'
};

const supportBtnStyle = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.5rem 1rem', background: '#f59e0b', border: 'none',
  borderRadius: 7, color: '#0f172a', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
};
