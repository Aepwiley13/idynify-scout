import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { fetchApiLogs } from '../../utils/adminAuth';
import { ArrowLeft, Database, Filter, Calendar } from 'lucide-react';
import './ApiActivity.css';

export default function ApiActivity() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [error, setError] = useState(null);

  // Filters
  const [endpointFilter, setEndpointFilter] = useState('all');
  const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [dateRange, setDateRange] = useState('7days'); // '24hours' | '7days' | '30days' | 'all'

  useEffect(() => {
    loadApiLogs();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [logs, endpointFilter, environmentFilter, dateRange]);

  const loadApiLogs = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;

      if (!user) {
        navigate('/login');
        return;
      }

      const authToken = await user.getIdToken();

      // Calculate date filters
      let startDate = null;
      const now = new Date();

      if (dateRange === '24hours') {
        startDate = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      } else if (dateRange === '7days') {
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (dateRange === '30days') {
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const filters = {};
      if (startDate) {
        filters.startDate = startDate;
      }

      const data = await fetchApiLogs(user.uid, authToken, filters);

      setLogs(data.logs);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load API logs:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...logs];

    // Apply endpoint filter
    if (endpointFilter !== 'all') {
      filtered = filtered.filter(log => log.endpoint === endpointFilter);
    }

    // Apply environment filter
    if (environmentFilter !== 'all') {
      filtered = filtered.filter(log => log.environment === environmentFilter);
    }

    setFilteredLogs(filtered);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const getEndpointLabel = (endpoint) => {
    return endpoint.replace('APOLLO_', '');
  };

  const getUniqueEndpoints = () => {
    const endpoints = new Set(logs.map(log => log.endpoint));
    return Array.from(endpoints).sort();
  };

  const calculateStats = () => {
    const stats = {
      totalCalls: filteredLogs.length,
      successfulCalls: filteredLogs.filter(log => log.status === 'success').length,
      errorCalls: filteredLogs.filter(log => log.status === 'error').length,
      totalCredits: filteredLogs.reduce((sum, log) => sum + log.creditsUsed, 0),
      avgResponseTime: 0
    };

    if (stats.totalCalls > 0) {
      const totalResponseTime = filteredLogs.reduce((sum, log) => sum + (log.responseTime || 0), 0);
      stats.avgResponseTime = Math.round(totalResponseTime / stats.totalCalls);
    }

    return stats;
  };

  if (loading) {
    return (
      <div className="api-activity-loading">
        <div className="loading-spinner"></div>
        <p>Loading API activity...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="api-activity-error">
        <h2>Error Loading API Activity</h2>
        <p>{error}</p>
        <button onClick={loadApiLogs} className="retry-btn">Retry</button>
      </div>
    );
  }

  const stats = calculateStats();

  return (
    <div className="api-activity">
      {/* Header */}
      <div className="api-header">
        <button onClick={() => navigate('/admin')} className="back-button">
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </button>
        <div className="header-content">
          <h1 className="page-title">API Activity</h1>
          <p className="page-subtitle">Monitor Apollo API usage and performance</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="api-stats">
        <div className="stat-card">
          <div className="stat-label">Total API Calls</div>
          <div className="stat-value">{stats.totalCalls}</div>
        </div>
        <div className="stat-card stat-success">
          <div className="stat-label">Successful</div>
          <div className="stat-value">{stats.successfulCalls}</div>
          <div className="stat-detail">
            {stats.totalCalls > 0 ? Math.round((stats.successfulCalls / stats.totalCalls) * 100) : 0}% success rate
          </div>
        </div>
        <div className="stat-card stat-error">
          <div className="stat-label">Errors</div>
          <div className="stat-value">{stats.errorCalls}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Credits</div>
          <div className="stat-value">{stats.totalCredits}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Response Time</div>
          <div className="stat-value">{stats.avgResponseTime}ms</div>
        </div>
      </div>

      {/* Filters */}
      <div className="api-filters">
        <div className="filter-group">
          <Calendar className="w-4 h-4" />
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="24hours">Last 24 Hours</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>

        <div className="filter-group">
          <Filter className="w-4 h-4" />
          <select value={endpointFilter} onChange={(e) => setEndpointFilter(e.target.value)}>
            <option value="all">All Endpoints</option>
            {getUniqueEndpoints().map(endpoint => (
              <option key={endpoint} value={endpoint}>
                {getEndpointLabel(endpoint)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <Database className="w-4 h-4" />
          <select value={environmentFilter} onChange={(e) => setEnvironmentFilter(e.target.value)}>
            <option value="all">All Environments</option>
            <option value="prod">Production</option>
            <option value="dev">Development</option>
          </select>
        </div>

        <button onClick={loadApiLogs} className="refresh-btn">
          Refresh
        </button>
      </div>

      {/* API Logs Table */}
      <div className="api-logs-table-container">
        <table className="api-logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Response Time</th>
              <th>Credits</th>
              <th>Environment</th>
              <th>User ID</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map(log => (
              <tr key={log.id} className={`log-row log-${log.status}`}>
                <td className="timestamp-cell">{formatTimestamp(log.timestamp)}</td>
                <td className="endpoint-cell">{getEndpointLabel(log.endpoint)}</td>
                <td className="status-cell">
                  <span className={`status-badge status-${log.status}`}>
                    {log.status}
                  </span>
                </td>
                <td className="response-time-cell">{log.responseTime}ms</td>
                <td className="credits-cell">{log.creditsUsed}</td>
                <td className="environment-cell">
                  <span className={`env-badge env-${log.environment}`}>
                    {log.environment}
                  </span>
                </td>
                <td className="user-id-cell">{log.userId.substring(0, 8)}...</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredLogs.length === 0 && (
          <div className="no-logs">
            <p>No API logs found matching your filters.</p>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="results-count">
        Showing {filteredLogs.length} of {logs.length} API calls
      </div>
    </div>
  );
}
