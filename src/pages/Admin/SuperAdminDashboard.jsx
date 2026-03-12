/**
 * Super Admin Dashboard
 *
 * Main hub for super admin operations:
 * - Tenant search (by email or account ID)
 * - Quick navigation to tenant health, audit logs, repair tools
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import {
  Shield, Search, Activity, Wrench, FileText,
  ChevronRight, User, Mail, Hash, CheckCircle, XCircle, AlertCircle
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE;

async function searchTenants(query, searchType, authToken) {
  const res = await fetch(`${API_BASE}/superAdminSearchTenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ query, searchType })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('all');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() || query.trim().length < 2) return;

    setSearching(true);
    setError(null);

    try {
      const currentUser = auth.currentUser;
      const authToken = await currentUser.getIdToken();
      const data = await searchTenants(query.trim(), searchType, authToken);
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const statusBadge = (tenant) => {
    if (!tenant.hasCompletedPayment) return { label: 'No Payment', color: '#ef4444', Icon: XCircle };
    if (tenant.status === 'active') return { label: 'Active', color: '#22c55e', Icon: CheckCircle };
    return { label: tenant.status || 'Unknown', color: '#f59e0b', Icon: AlertCircle };
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '1.5rem 2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Shield size={24} color="#f59e0b" />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f1f5f9' }}>Super Admin Console</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Customer Access &amp; Support Operations</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem' }}>
          <NavButton icon={<FileText size={14} />} label="Audit Logs" onClick={() => navigate('/super-admin/audit-logs')} />
          <NavButton icon={<Activity size={14} />} label="Back to Admin" onClick={() => navigate('/admin')} />
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem' }}>

        {/* Search Panel */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '1.5rem', marginBottom: '2rem', border: '1px solid #334155' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Search size={16} color="#f59e0b" /> Search Customer Accounts
          </h2>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              value={searchType}
              onChange={e => setSearchType(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All Fields</option>
              <option value="email">By Email</option>
              <option value="accountId">By Account ID</option>
            </select>

            <input
              type="text"
              placeholder={searchType === 'accountId' ? 'Enter account ID...' : 'Search by email...'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            />

            <button type="submit" disabled={searching || query.trim().length < 2} style={primaryBtnStyle}>
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, padding: '0.875rem 1rem', marginBottom: '1.5rem', color: '#fca5a5', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        {/* Results */}
        {searched && (
          <div>
            <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: '#64748b' }}>
              {results.length === 0 ? 'No accounts found.' : `${results.length} account(s) found`}
            </div>

            {results.map(tenant => {
              const badge = statusBadge(tenant);
              return (
                <div
                  key={tenant.uid}
                  style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '0.75rem', cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onClick={() => navigate(`/super-admin/tenant/${tenant.uid}`)}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#f59e0b'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#334155'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 38, height: 38, background: '#0f172a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <User size={18} color="#94a3b8" />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Mail size={12} color="#94a3b8" />
                        {tenant.email || '(no email)'}
                        {tenant.role === 'super_admin' && <span style={{ fontSize: '0.7rem', background: '#f59e0b', color: '#0f172a', padding: '0 0.4rem', borderRadius: 4, fontWeight: 700 }}>SUPER ADMIN</span>}
                        {tenant.role === 'admin' && <span style={{ fontSize: '0.7rem', background: '#3b82f6', color: '#fff', padding: '0 0.4rem', borderRadius: 4 }}>Admin</span>}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.25rem' }}>
                        <Hash size={11} />{tenant.uid}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>{tenant.companiesCount ?? '—'}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Companies</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>{tenant.contactsCount ?? '—'}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Contacts</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <badge.Icon size={14} color={badge.color} />
                        <span style={{ fontSize: '0.8rem', color: badge.color }}>{badge.label}</span>
                      </div>
                      <ChevronRight size={16} color="#475569" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Links */}
        {!searched && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
            <QuickLink
              icon={<FileText size={20} color="#f59e0b" />}
              title="Audit Log Viewer"
              desc="Browse all super admin actions"
              onClick={() => navigate('/super-admin/audit-logs')}
            />
            <QuickLink
              icon={<Wrench size={20} color="#f59e0b" />}
              title="Repair Tools"
              desc="Re-index, resync, reset across accounts"
              onClick={() => navigate('/admin')}
            />
            <QuickLink
              icon={<Activity size={20} color="#f59e0b" />}
              title="Standard Admin"
              desc="User management dashboard"
              onClick={() => navigate('/admin')}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NavButton({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.875rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 7, color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' }}>
      {icon}{label}
    </button>
  );
}

function QuickLink({ icon, title, desc, onClick }) {
  return (
    <div onClick={onClick} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '1.25rem', cursor: 'pointer', transition: 'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#f59e0b'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#334155'}
    >
      <div style={{ marginBottom: '0.75rem' }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f1f5f9', marginBottom: '0.25rem' }}>{title}</div>
      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{desc}</div>
    </div>
  );
}

const inputStyle = {
  background: '#0f172a', border: '1px solid #334155', borderRadius: 7,
  padding: '0.6rem 0.875rem', color: '#f1f5f9', fontSize: '0.875rem', outline: 'none'
};

const selectStyle = {
  ...inputStyle, cursor: 'pointer', minWidth: 130
};

const primaryBtnStyle = {
  padding: '0.6rem 1.25rem', background: '#f59e0b', color: '#0f172a',
  border: 'none', borderRadius: 7, fontWeight: 600, fontSize: '0.875rem',
  cursor: 'pointer', whiteSpace: 'nowrap'
};
