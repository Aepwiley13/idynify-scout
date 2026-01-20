import { useState, useEffect } from 'react';
import { auth } from '../../firebase/config';
import {
  FileText,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  Eye,
  RefreshCw,
  Key,
  Ban,
  Unlock,
  Mail,
  LogIn,
  LogOut,
  XCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  Search,
  X
} from 'lucide-react';
import './AuditLogs.css';

export default function AuditLogs() {
  const [activeTab, setActiveTab] = useState('all');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [actionTypes, setActionTypes] = useState([]);
  const [actorUserId, setActorUserId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [dateRange, setDateRange] = useState('last_7_days');
  const [status, setStatus] = useState('all');
  const [ipAddress, setIpAddress] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Expandable rows
  const [expandedRows, setExpandedRows] = useState(new Set());

  // Load logs
  useEffect(() => {
    loadAuditLogs();
  }, [activeTab, page, pageSize, actionTypes, actorUserId, targetUserId, dateRange, status, ipAddress]);

  async function loadAuditLogs() {
    try {
      setLoading(true);
      setError(null);

      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not authenticated');
      }

      const authToken = await user.getIdToken();

      // Calculate date range
      const now = new Date();
      let startDate, endDate;

      switch (dateRange) {
        case 'last_hour':
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_24_hours':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_7_days':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_30_days':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_90_days':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          endDate = now;
      }

      const response = await fetch('/.netlify/functions/adminGetAuditLogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken,
          pagination: { page, pageSize },
          filters: {
            logType: activeTab === 'all' ? null : activeTab,
            actionTypes: actionTypes.length > 0 ? actionTypes : null,
            actorUserId: actorUserId || null,
            targetUserId: targetUserId || null,
            dateRange: {
              start: startDate.toISOString(),
              end: endDate.toISOString()
            },
            status: status === 'all' ? null : status,
            ipAddress: ipAddress || null
          },
          search: search || null,
          sort: { field: 'timestamp', direction: 'desc' }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch audit logs');
      }

      const data = await response.json();

      if (data.success) {
        setLogs(data.data.logs);
        setTotalCount(data.data.pagination.totalCount);
        setTotalPages(data.data.pagination.totalPages);
      } else {
        throw new Error(data.error || 'Failed to fetch logs');
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading audit logs:', err);
      setError(err.message);
      setLoading(false);
    }
  }

  function clearFilters() {
    setSearch('');
    setActionTypes([]);
    setActorUserId('');
    setTargetUserId('');
    setDateRange('last_7_days');
    setStatus('all');
    setIpAddress('');
    setPage(1);
  }

  function toggleExpandRow(logId) {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedRows(newExpanded);
  }

  function getActionIcon(action) {
    if (action.includes('view')) return <Eye className="w-4 h-4" />;
    if (action.includes('impersonation')) return <RefreshCw className="w-4 h-4" />;
    if (action.includes('password')) return <Key className="w-4 h-4" />;
    if (action.includes('suspended')) return <Ban className="w-4 h-4" />;
    if (action.includes('reactivated')) return <Unlock className="w-4 h-4" />;
    if (action.includes('email')) return <Mail className="w-4 h-4" />;
    if (action.includes('login') && !action.includes('failed')) return <LogIn className="w-4 h-4" />;
    if (action.includes('logout')) return <LogOut className="w-4 h-4" />;
    if (action.includes('failed')) return <XCircle className="w-4 h-4" />;
    return <CheckCircle className="w-4 h-4" />;
  }

  function getActionLabel(action) {
    // Convert snake_case to Title Case
    return action.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'success':
        return <span className="status-badge success">Success</span>;
      case 'failed':
        return <span className="status-badge failed">Failed</span>;
      case 'partial':
        return <span className="status-badge partial">Partial</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  async function handleExport(format) {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      // Calculate date range
      const now = new Date();
      let startDate, endDate;

      switch (dateRange) {
        case 'last_hour':
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_24_hours':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_7_days':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_30_days':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'last_90_days':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          endDate = now;
      }

      const response = await fetch('/.netlify/functions/adminExportAuditLogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken,
          format,
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          filters: {
            logType: activeTab === 'all' ? null : activeTab,
            actionTypes: actionTypes.length > 0 ? actionTypes : null,
            actorUserId: actorUserId || null,
            targetUserId: targetUserId || null,
            status: status === 'all' ? null : status
          },
          includeMetadata: true
        })
      });

      if (!response.ok) {
        throw new Error('Failed to export audit logs');
      }

      // Trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_logs_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

    } catch (err) {
      console.error('Error exporting logs:', err);
      alert('Failed to export logs: ' + err.message);
    }
  }

  if (loading && logs.length === 0) {
    return (
      <div className="audit-logs-page">
        <div className="page-header">
          <h1>Audit Logs</h1>
        </div>
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading audit logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="audit-logs-page">
      <div className="page-header">
        <div className="header-left">
          <FileText className="w-8 h-8" />
          <h1>Audit Logs</h1>
        </div>
        <div className="header-right">
          <button className="btn-export" onClick={() => handleExport('csv')}>
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button className="btn-export secondary" onClick={() => handleExport('json')}>
            <Download className="w-4 h-4" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'admin_action' ? 'active' : ''}`}
          onClick={() => { setActiveTab('admin_action'); setPage(1); }}
        >
          Admin Actions
        </button>
        <button
          className={`tab ${activeTab === 'user_action' ? 'active' : ''}`}
          onClick={() => { setActiveTab('user_action'); setPage(1); }}
        >
          User Actions
        </button>
        <button
          className={`tab ${activeTab === 'system_event' ? 'active' : ''}`}
          onClick={() => { setActiveTab('system_event'); setPage(1); }}
        >
          System Events
        </button>
        <button
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => { setActiveTab('all'); setPage(1); }}
        >
          All Logs
        </button>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-group">
          <Search className="w-4 h-4 search-icon" />
          <input
            type="text"
            placeholder="Search by email or user ID"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="search-input"
          />
        </div>

        <select
          value={dateRange}
          onChange={(e) => { setDateRange(e.target.value); setPage(1); }}
          className="filter-select"
        >
          <option value="last_hour">Last Hour</option>
          <option value="last_24_hours">Last 24 Hours</option>
          <option value="last_7_days">Last 7 Days</option>
          <option value="last_30_days">Last 30 Days</option>
          <option value="last_90_days">Last 90 Days</option>
        </select>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="filter-select"
        >
          <option value="all">All Statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="partial">Partial</option>
        </select>

        {(search || actionTypes.length > 0 || actorUserId || targetUserId || ipAddress || dateRange !== 'last_7_days' || status !== 'all') && (
          <button className="btn-clear-filters" onClick={clearFilters}>
            <X className="w-4 h-4" />
            Clear Filters
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={loadAuditLogs}>Retry</button>
        </div>
      )}

      {/* Logs Table */}
      <div className="logs-table-container">
        <table className="logs-table">
          <thead>
            <tr>
              <th style={{ width: '180px' }}>Timestamp</th>
              <th style={{ width: '200px' }}>Action</th>
              <th style={{ width: '200px' }}>Actor</th>
              <th style={{ width: '200px' }}>Target</th>
              <th style={{ width: '150px' }}>IP Address</th>
              <th style={{ width: '100px' }}>Status</th>
              <th style={{ width: '80px' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  <FileText className="w-12 h-12" />
                  <p>No audit logs found</p>
                  <span>Try adjusting your filters or date range</span>
                </td>
              </tr>
            ) : (
              logs.map(log => (
                <>
                  <tr key={log.logId} className="log-row">
                    <td className="timestamp-cell">{formatTimestamp(log.timestamp)}</td>
                    <td className="action-cell">
                      {getActionIcon(log.action)}
                      <span>{getActionLabel(log.action)}</span>
                    </td>
                    <td className="actor-cell">{log.actorEmail || log.actorUserId || 'System'}</td>
                    <td className="target-cell">{log.targetUserEmail || log.targetUserId || log.targetResource || '-'}</td>
                    <td className="ip-cell">{log.ipAddress || '-'}</td>
                    <td className="status-cell">{getStatusBadge(log.status)}</td>
                    <td className="actions-cell">
                      <button
                        className="btn-expand"
                        onClick={() => toggleExpandRow(log.logId)}
                      >
                        {expandedRows.has(log.logId) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedRows.has(log.logId) && (
                    <tr className="expanded-row">
                      <td colSpan="7">
                        <div className="expanded-content">
                          <div className="expanded-section">
                            <h4>Event Details</h4>
                            <div className="detail-grid">
                              <div className="detail-item">
                                <span className="detail-label">Log ID:</span>
                                <span className="detail-value monospace">{log.logId}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Action Type:</span>
                                <span className="detail-value">{log.action}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Log Type:</span>
                                <span className="detail-value">{log.logType}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Resource:</span>
                                <span className="detail-value">{log.targetResource || 'N/A'}</span>
                              </div>
                              {log.resourceId && (
                                <div className="detail-item">
                                  <span className="detail-label">Resource ID:</span>
                                  <span className="detail-value monospace">{log.resourceId}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {(log.actorUserId || log.actorEmail) && (
                            <div className="expanded-section">
                              <h4>Actor Information</h4>
                              <div className="detail-grid">
                                {log.actorEmail && (
                                  <div className="detail-item">
                                    <span className="detail-label">Email:</span>
                                    <span className="detail-value">{log.actorEmail}</span>
                                  </div>
                                )}
                                {log.actorUserId && (
                                  <div className="detail-item">
                                    <span className="detail-label">User ID:</span>
                                    <span className="detail-value monospace">{log.actorUserId}</span>
                                  </div>
                                )}
                                {log.ipAddress && (
                                  <div className="detail-item">
                                    <span className="detail-label">IP Address:</span>
                                    <span className="detail-value">{log.ipAddress}</span>
                                  </div>
                                )}
                                {log.userAgent && (
                                  <div className="detail-item full-width">
                                    <span className="detail-label">User Agent:</span>
                                    <span className="detail-value small">{log.userAgent}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {(log.targetUserId || log.targetUserEmail) && (
                            <div className="expanded-section">
                              <h4>Target Information</h4>
                              <div className="detail-grid">
                                {log.targetUserEmail && (
                                  <div className="detail-item">
                                    <span className="detail-label">Email:</span>
                                    <span className="detail-value">{log.targetUserEmail}</span>
                                  </div>
                                )}
                                {log.targetUserId && (
                                  <div className="detail-item">
                                    <span className="detail-label">User ID:</span>
                                    <span className="detail-value monospace">{log.targetUserId}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <div className="expanded-section">
                              <h4>Action Metadata</h4>
                              <pre className="metadata-json">{JSON.stringify(log.metadata, null, 2)}</pre>
                            </div>
                          )}

                          {log.errorMessage && (
                            <div className="expanded-section error-section">
                              <h4>Error Details</h4>
                              <p className="error-message">{log.errorMessage}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span className="pagination-info">
            Page {page} of {totalPages} ({totalCount} total logs)
          </span>
          <button
            className="pagination-btn"
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
