/**
 * Repair Tools Panel
 *
 * Allows super admins to run targeted repair operations on a tenant account
 * without needing an engineering deploy.
 *
 * Operations:
 *   - Re-index companies
 *   - Resync CRM connections
 *   - Reset user permissions / force reauthentication
 *   - Flush cache / rebuild search indexes
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { ArrowLeft, Wrench, RefreshCw, Shield, Database, Zap, CheckCircle, AlertTriangle, Clock } from 'lucide-react';

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE;

const TOOLS = [
  {
    id: 'reindex_companies',
    icon: <Building2Icon />,
    label: 'Re-index Companies',
    desc: 'Queues all company records for re-indexing. Use when company search results are stale or missing.',
    risk: 'low',
    confirmMsg: 'Re-index all companies for this tenant?'
  },
  {
    id: 'resync_crm',
    icon: <RefreshCw size={20} color="#f59e0b" />,
    label: 'Resync CRM Connection',
    desc: 'Clears CRM OAuth tokens so the user is prompted to reconnect their CRM (HubSpot, Salesforce).',
    risk: 'medium',
    confirmMsg: 'This will disconnect their CRM — they must reconnect manually. Continue?'
  },
  {
    id: 'reset_permissions',
    icon: <Shield size={20} color="#ef4444" />,
    label: 'Reset Permissions & Force Re-auth',
    desc: 'Revokes all Firebase refresh tokens and clears permission overrides. User must sign in again immediately.',
    risk: 'high',
    confirmMsg: 'This will immediately log out this user across all devices. Are you sure?'
  },
  {
    id: 'flush_cache',
    icon: <Database size={20} color="#f59e0b" />,
    label: 'Flush Cache & Rebuild Indexes',
    desc: 'Clears all cached/denormalized data and queues contacts for search index rebuild.',
    risk: 'low',
    confirmMsg: 'Flush cache and rebuild search indexes for this tenant?'
  }
];

async function runRepair(tenantUserId, operation, reason, authToken) {
  const res = await fetch(`${API_BASE}/superAdminRepairTools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ tenantUserId, operation, reason })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

function Building2Icon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

export default function RepairTools() {
  const { tenantUserId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState({});
  const [running, setRunning] = useState({});
  const [reason, setReason] = useState('');

  const handleRun = async (tool) => {
    if (!window.confirm(tool.confirmMsg)) return;

    const operationReason = reason.trim() || `Super admin repair: ${tool.label}`;

    setRunning(prev => ({ ...prev, [tool.id]: true }));
    setResults(prev => ({ ...prev, [tool.id]: null }));

    try {
      const currentUser = auth.currentUser;
      const authToken = await currentUser.getIdToken();
      const data = await runRepair(tenantUserId, tool.id, operationReason, authToken);
      setResults(prev => ({
        ...prev,
        [tool.id]: { type: 'success', message: data.result?.message || 'Operation completed successfully', details: data.result }
      }));
    } catch (err) {
      setResults(prev => ({
        ...prev,
        [tool.id]: { type: 'error', message: err.message }
      }));
    } finally {
      setRunning(prev => ({ ...prev, [tool.id]: false }));
    }
  };

  const riskColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  const riskLabel = { low: 'Low Risk', medium: 'Medium Risk', high: 'High Risk' };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => navigate(`/super-admin/tenant/${tenantUserId}`)} style={ghostBtnStyle}>
          <ArrowLeft size={16} /> Back to Tenant
        </button>
        <Wrench size={20} color="#f59e0b" />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Repair Tools</h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>Tenant: {tenantUserId}</p>
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem' }}>

        {/* Security warning */}
        <div style={{ background: '#422006', border: '1px solid #f59e0b', borderRadius: 8, padding: '0.875rem 1rem', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.85rem', color: '#fbbf24' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          <div>
            <strong>All repair operations are logged.</strong> Every action is recorded in the audit log with your admin ID, the target tenant, timestamp, and IP address.
          </div>
        </div>

        {/* Reason field */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
            Reason / ticket reference (optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Support ticket #1234 — customer reports stale data"
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 7, padding: '0.6rem 0.875rem', color: '#f1f5f9', fontSize: '0.875rem', boxSizing: 'border-box' }}
          />
        </div>

        {/* Tool cards */}
        {TOOLS.map(tool => {
          const result = results[tool.id];
          const isRunning = running[tool.id];

          return (
            <div key={tool.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '1.25rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.875rem', flex: 1, minWidth: 0 }}>
                  <div style={{ flexShrink: 0, marginTop: '0.1rem' }}>{tool.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {tool.label}
                      <span style={{ fontSize: '0.7rem', color: riskColor[tool.risk], fontWeight: 500 }}>
                        {riskLabel[tool.risk]}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{tool.desc}</div>
                  </div>
                </div>
                <button
                  onClick={() => handleRun(tool)}
                  disabled={isRunning}
                  style={{
                    padding: '0.5rem 1rem', flexShrink: 0,
                    background: tool.risk === 'high' ? '#450a0a' : '#1e3a5f',
                    border: `1px solid ${tool.risk === 'high' ? '#ef4444' : '#3b82f6'}`,
                    borderRadius: 7,
                    color: tool.risk === 'high' ? '#fca5a5' : '#93c5fd',
                    fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                  }}
                >
                  {isRunning ? <><Clock size={13} /> Running...</> : <><Zap size={13} /> Run</>}
                </button>
              </div>

              {/* Result */}
              {result && (
                <div style={{
                  marginTop: '0.875rem',
                  padding: '0.75rem',
                  background: result.type === 'success' ? '#052e16' : '#450a0a',
                  border: `1px solid ${result.type === 'success' ? '#22c55e' : '#ef4444'}`,
                  borderRadius: 6,
                  display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                  fontSize: '0.8rem', color: result.type === 'success' ? '#86efac' : '#fca5a5'
                }}>
                  {result.type === 'success' ? <CheckCircle size={14} style={{ flexShrink: 0 }} /> : <AlertTriangle size={14} style={{ flexShrink: 0 }} />}
                  <div>
                    <div>{result.message}</div>
                    {result.details && result.type === 'success' && (
                      <div style={{ marginTop: '0.25rem', color: '#4ade80', opacity: 0.8 }}>
                        {JSON.stringify(result.details, null, 2).split('\n').slice(1, -1).join(' | ').replace(/["{},]/g, '').trim()}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ghostBtnStyle = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.5rem 0.875rem', background: '#1e293b', border: '1px solid #334155',
  borderRadius: 7, color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer'
};
