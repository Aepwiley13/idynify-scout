/**
 * Super Admin Audit Log Viewer
 *
 * Full audit trail with filtering by:
 * - Tenant (targetUserId / email)
 * - Actor (admin who performed action)
 * - Action type
 * - Log type (admin_action | user_action | system_event)
 * - Date range
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { ArrowLeft, Shield, Search, Filter, Clock, User, Activity, ChevronDown, ChevronUp } from 'lucide-react';

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE;

async function fetchAuditLogs(filters, authToken) {
  const res = await fetch(`${API_BASE}/superAdminGetAuditLogs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify(filters)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

const ACTION_LABEL_MAP = {
  super_admin_search_tenants: 'Searched Tenants',
  super_admin_view_tenant_health: 'Viewed Tenant Health',
  super_admin_start_support_session: 'Started Support Session',
  super_admin_end_support_session: 'Ended Support Session',
  super_admin_repair_reindex_companies: 'Repair: Re-indexed Companies',
  super_admin_repair_resync_crm: 'Repair: Resynced CRM',
  super_admin_repair_reset_permissions: 'Repair: Reset Permissions',
  super_admin_repair_flush_cache: 'Repair: Flushed Cache',
  super_admin_view_audit_logs: 'Viewed Audit Logs',
  start_impersonation: 'Started Impersonation',
  end_impersonation: 'Ended Impersonation',
  view_user_detail: 'Viewed User',
  account_suspended: 'Suspended Account',
  account_reactivated: 'Reactivated Account',
  password_reset_triggered: 'Reset Password'
};

const STATUS_COLORS = {
  success: { color: '#22c55e', bg: '#052e16' },
  failed: { color: '#ef4444', bg: '#450a0a' },
  partial: { color: '#f59e0b', bg: '#422006' }
};

const LOG_TYPE_COLORS = {
  admin_action: '#3b82f6',
  user_action: '#a855f7',
  system_event: '#06b6d4'
};

export default function SuperAdminAuditLogs() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTenant = searchParams.get('tenant') || '';

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Filters
  const [tenantFilter, setTenantFilter] = useState(defaultTenant);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [logTypeFilter, setLogTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState(100);

  // Auto-load if tenant passed via URL
  useEffect(() => {
    if (defaultTenant) {
      loadLogs();
    }
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = auth.currentUser;
      const authToken = await currentUser.getIdToken();
      const data = await fetchAuditLogs({
        tenantUserId: tenantFilter || undefined,
        actorUserId: actorFilter || undefined,
        action: actionFilter || undefined,
        logType: logTypeFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit
      }, authToken);
      setLogs(data.logs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    loadLogs();
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  };

  const getActionLabel = (action) => ACTION_LABEL_MAP[action] || action;

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate('/super-admin')} style={ghostBtnStyle}>
          <ArrowLeft size={16} /> Back
        </button>
        <Shield size={20} color="#f59e0b" />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Audit Log Viewer</h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>Full super admin action trail</p>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 2rem' }}>

        {/* Filters */}
        <form onSubmit={handleSubmit} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8' }}>
            <Filter size={14} /> Filters
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <FilterInput label="Tenant User ID" value={tenantFilter} onChange={setTenantFilter} placeholder="uid..." />
            <FilterInput label="Actor User ID" value={actorFilter} onChange={setActorFilter} placeholder="uid..." />
            <FilterInput label="Action contains" value={actionFilter} onChange={setActionFilter} placeholder="e.g. impersonation" />
            <div>
              <label style={labelStyle}>Log Type</label>
              <select value={logTypeFilter} onChange={e => setLogTypeFilter(e.target.value)} style={inputStyle}>
                <option value="">All types</option>
                <option value="admin_action">Admin Action</option>
                <option value="user_action">User Action</option>
                <option value="system_event">System Event</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Start Date</label>
              <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>End Date</label>
              <input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Limit</label>
              <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={inputStyle}>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            <Search size={14} /> {loading ? 'Loading...' : 'Load Logs'}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, padding: '0.875rem 1rem', marginBottom: '1.5rem', color: '#fca5a5', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        {/* Results */}
        {logs.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
              {logs.length} log entries
            </div>

            {logs.map(log => {
              const statusStyle = STATUS_COLORS[log.status] || STATUS_COLORS.success;
              const ltColor = LOG_TYPE_COLORS[log.logType] || '#94a3b8';
              const isExpanded = expandedId === log.id;

              return (
                <div key={log.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, marginBottom: '0.5rem', overflow: 'hidden' }}>
                  {/* Row */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer' }}
                  >
                    {/* Log type tag */}
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: ltColor, background: '#0f172a', padding: '0.15rem 0.4rem', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {log.logType?.replace('_', ' ').toUpperCase()}
                    </span>

                    {/* Action */}
                    <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getActionLabel(log.action)}
                    </span>

                    {/* Actor */}
                    <span style={{ fontSize: '0.75rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {log.actorEmail || log.actorUserId || '—'}
                    </span>

                    {/* Status */}
                    <span style={{ fontSize: '0.75rem', color: statusStyle.color, fontWeight: 600, flexShrink: 0 }}>
                      {log.status}
                    </span>

                    {/* Timestamp */}
                    <span style={{ fontSize: '0.75rem', color: '#475569', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {fmt(log.timestamp)}
                    </span>

                    {isExpanded ? <ChevronUp size={14} color="#475569" /> : <ChevronDown size={14} color="#475569" />}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #0f172a', padding: '1rem', background: '#0f172a', fontSize: '0.8rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 2rem' }}>
                        <DetailRow label="Log ID" value={log.id} mono />
                        <DetailRow label="Action" value={log.action} mono />
                        <DetailRow label="Actor ID" value={log.actorUserId} mono />
                        <DetailRow label="Actor Email" value={log.actorEmail} />
                        <DetailRow label="Target User ID" value={log.targetUserId} mono />
                        <DetailRow label="Target Email" value={log.targetUserEmail} />
                        <DetailRow label="Resource" value={log.targetResource} />
                        <DetailRow label="Resource ID" value={log.resourceId} mono />
                        <DetailRow label="IP Address" value={log.ipAddress} mono />
                        <DetailRow label="Timestamp" value={fmt(log.timestamp)} />
                        {log.errorMessage && <DetailRow label="Error" value={log.errorMessage} span />}
                      </div>
                      {log.metadata && (
                        <div style={{ marginTop: '0.75rem' }}>
                          <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metadata</div>
                          <pre style={{ background: '#1e293b', padding: '0.75rem', borderRadius: 6, color: '#94a3b8', fontSize: '0.75rem', margin: 0, overflow: 'auto' }}>
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
            No log entries. Apply filters and click "Load Logs".
          </div>
        )}
      </div>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

function DetailRow({ label, value, mono, span }) {
  if (!value) return null;
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <span style={{ color: '#64748b' }}>{label}: </span>
      <span style={{ color: '#f1f5f9', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? '0.75rem' : 'inherit' }}>{value}</span>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.3rem' };

const inputStyle = {
  width: '100%', background: '#0f172a', border: '1px solid #334155',
  borderRadius: 6, padding: '0.5rem 0.75rem', color: '#f1f5f9',
  fontSize: '0.8rem', boxSizing: 'border-box'
};

const ghostBtnStyle = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.5rem 0.875rem', background: '#1e293b', border: '1px solid #334155',
  borderRadius: 7, color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer'
};

const primaryBtnStyle = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.55rem 1.25rem', background: '#f59e0b', border: 'none',
  borderRadius: 7, color: '#0f172a', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
};
