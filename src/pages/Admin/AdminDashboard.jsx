import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { fetchAllUsers } from '../../utils/adminAuth';
import { Users, TrendingUp, Database, Building2, Filter, Search, FileText, Mail, LayoutDashboard, Phone } from 'lucide-react';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [platformStats, setPlatformStats] = useState(null);
  const [error, setError] = useState(null);

  // Filters and search
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState('all'); // 'all' | 'last30days'
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [sortBy, setSortBy] = useState('lastLogin'); // 'lastLogin' | 'totalCredits' | 'signupDate' | 'email'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'

  // Account management: per-user loading states and inline feedback
  const [tierPending, setTierPending] = useState({}); // { [uid]: true }
  const [phonePending, setPhonePending] = useState({}); // { [uid]: true }
  const [actionFeedback, setActionFeedback] = useState({}); // { [uid]: { message, type } }

  useEffect(() => {
    loadAllUsers();
  }, []);

  useEffect(() => {
    applyFiltersAndSort();
  }, [users, searchTerm, timeFilter, activeFilter, sortBy, sortOrder]);

  const loadAllUsers = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;

      if (!user) {
        navigate('/login');
        return;
      }

      const authToken = await user.getIdToken();
      const data = await fetchAllUsers(user.uid, authToken);

      setUsers(data.users);
      setPlatformStats(data.platformStats);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load users:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...users];

    // Apply search filter (email or UID)
    if (searchTerm) {
      filtered = filtered.filter(user =>
        user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.uid?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply time filter
    if (timeFilter === 'last30days') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(user => {
        if (!user.lastLogin) return false;
        return new Date(user.lastLogin) >= thirtyDaysAgo;
      });
    }

    // Apply active/inactive filter
    if (activeFilter !== 'all') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(user => {
        const isActive = user.lastLogin && new Date(user.lastLogin) >= sevenDaysAgo;
        return activeFilter === 'active' ? isActive : !isActive;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'email':
          aVal = a.email || '';
          bVal = b.email || '';
          break;
        case 'signupDate':
          aVal = a.signupDate ? new Date(a.signupDate).getTime() : 0;
          bVal = b.signupDate ? new Date(b.signupDate).getTime() : 0;
          break;
        case 'lastLogin':
          aVal = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
          bVal = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
          break;
        case 'totalCredits':
          aVal = a.credits?.total ?? 0;
          bVal = b.credits?.total ?? 0;
          break;
        default:
          aVal = 0;
          bVal = 0;
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    setFilteredUsers(filtered);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

    return date.toLocaleDateString();
  };

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const showFeedback = (uid, message, type = 'success') => {
    setActionFeedback(prev => ({ ...prev, [uid]: { message, type } }));
    setTimeout(() => setActionFeedback(prev => {
      const next = { ...prev };
      delete next[uid];
      return next;
    }), 3000);
  };

  const adminFetch = async (fnName, body) => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');
    const authToken = await currentUser.getIdToken();
    const response = await fetch(`/.netlify/functions/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify(body)
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || `${fnName} failed`);
    return json;
  };

  const handleTierChange = async (uid, newTier) => {
    const currentTier = users.find(u => u.uid === uid)?.subscriptionTier;
    if (tierPending[uid] || currentTier === newTier) return;
    setTierPending(prev => ({ ...prev, [uid]: true }));
    try {
      await adminFetch('adminUpdateUserTier', { targetUserId: uid, newTier });
      const hadPhoneAccess = users.find(u => u.uid === uid)?.phoneAccess;
      const wasStarter = currentTier === 'starter';
      setUsers(prev => prev.map(u => u.uid === uid
        ? { ...u, subscriptionTier: newTier, phoneAccess: newTier === 'pro' }
        : u
      ));
      // If upgrading a Starter user who had manual phone grant, remove from count
      if (wasStarter && hadPhoneAccess && platformStats) {
        setPlatformStats(prev => ({ ...prev, phoneAccessGrantedCount: Math.max(0, prev.phoneAccessGrantedCount - 1) }));
      }
      showFeedback(uid, `Tier updated to ${newTier}`);
    } catch (err) {
      showFeedback(uid, err.message || 'Failed to update tier', 'error');
    } finally {
      setTierPending(prev => ({ ...prev, [uid]: false }));
    }
  };

  const handleTogglePhoneAccess = async (uid, grant) => {
    if (phonePending[uid]) return;
    setPhonePending(prev => ({ ...prev, [uid]: true }));
    try {
      const result = await adminFetch('adminTogglePhoneAccess', { targetUserId: uid, grant });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, phoneAccess: grant } : u));
      if (platformStats) {
        setPlatformStats(prev => ({ ...prev, phoneAccessGrantedCount: result.data?.grantedCount ?? prev.phoneAccessGrantedCount }));
      }
      showFeedback(uid, grant ? 'Phone access granted' : 'Phone access revoked');
    } catch (err) {
      showFeedback(uid, err.message || 'Failed to toggle phone access', 'error');
    } finally {
      setPhonePending(prev => ({ ...prev, [uid]: false }));
    }
  };

  if (loading) {
    return (
      <div className="admin-dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading admin dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard-error">
        <h2>Error Loading Dashboard</h2>
        <p>{error}</p>
        <button onClick={loadAllUsers} className="retry-btn">Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      {/* Header */}
      <div className="admin-header">
        <div className="header-content">
          <h1 className="page-title">🔧 Admin Dashboard</h1>
          <p className="page-subtitle">Platform-wide user management and monitoring</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => navigate('/mission-control-v2')}
            className="api-activity-btn mission-control-btn"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Mission Control</span>
          </button>
          <button
            onClick={() => navigate('/admin/api-activity')}
            className="api-activity-btn"
          >
            <Database className="w-4 h-4" />
            <span>API Activity</span>
          </button>
          <button
            onClick={() => navigate('/admin/audit-logs')}
            className="api-activity-btn"
          >
            <FileText className="w-4 h-4" />
            <span>Audit Logs</span>
          </button>
          <button
            onClick={() => navigate('/admin/email-insights')}
            className="api-activity-btn"
          >
            <Mail className="w-4 h-4" />
            <span>Email Insights</span>
          </button>
        </div>
      </div>

      {/* Platform Overview Metrics */}
      {platformStats && (
        <div className="platform-stats">
          <div className="stat-card">
            <div className="stat-icon">
              <Users className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <p className="stat-label">Total Users</p>
              <p className="stat-value">{platformStats.totalUsers}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-success">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <p className="stat-label">Active Users (7d)</p>
              <p className="stat-value">{platformStats.activeUsers}</p>
              <p className="stat-detail">
                {platformStats.totalUsers > 0
                  ? Math.round((platformStats.activeUsers / platformStats.totalUsers) * 100)
                  : 0}% of total
              </p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-warning">
              <Database className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <p className="stat-label">Total API Credits Used</p>
              <p className="stat-value">{platformStats.totalCredits.toLocaleString()}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-info">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <p className="stat-label">Companies in Scout</p>
              <p className="stat-value">{platformStats.totalCompanies.toLocaleString()}</p>
              <p className="stat-detail">{platformStats.totalContacts.toLocaleString()} contacts</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
              <Phone className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <p className="stat-label">Phone Access (Starter)</p>
              <p className="stat-value">
                {platformStats.phoneAccessGrantedCount ?? 0}
                <span style={{ fontSize: '0.55em', color: '#6b7280', fontWeight: 400 }}> / {platformStats.maxPhoneGrants ?? 25}</span>
              </p>
              <p className="stat-detail">manual grants remaining: {(platformStats.maxPhoneGrants ?? 25) - (platformStats.phoneAccessGrantedCount ?? 0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="filters-section">
        <div className="search-box">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search by email or UID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-controls">
          <div className="filter-group">
            <Filter className="w-4 h-4" />
            <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
              <option value="all">All Time</option>
              <option value="last30days">Last 30 Days</option>
            </select>
          </div>

          <div className="filter-group">
            <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="all">All Users</option>
              <option value="active">Active (7d)</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {/* User List Table */}
      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('email')} className="sortable">
                User {sortBy === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th>Tier / Phone</th>
              <th>Scout</th>
              <th>Recon</th>
              <th onClick={() => toggleSort('totalCredits')} className="sortable">
                Credits {sortBy === 'totalCredits' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => toggleSort('lastLogin')} className="sortable">
                Last Active {sortBy === 'lastLogin' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.uid} className="user-row">
                <td className="user-cell">
                  <div className="user-info">
                    <p className="user-email">{user.email || 'No email'}</p>
                    <p className="user-uid">{user.uid}</p>
                    {actionFeedback[user.uid] && (
                      <p style={{ fontSize: 11, marginTop: 3, color: actionFeedback[user.uid].type === 'error' ? '#f87171' : '#4ade80' }}>
                        {actionFeedback[user.uid].message}
                      </p>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
                    {/* Tier badge + change control */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`badge ${user.subscriptionTier === 'pro' ? 'badge-success' : 'badge-info'}`}>
                        {user.subscriptionTier === 'pro' ? 'Pro' : 'Starter'}
                      </span>
                      <select
                        value={user.subscriptionTier || 'starter'}
                        disabled={tierPending[user.uid]}
                        onChange={(e) => handleTierChange(user.uid, e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px', background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 4, cursor: 'pointer' }}
                      >
                        <option value="starter">→ Starter</option>
                        <option value="pro">→ Pro</option>
                      </select>
                      {tierPending[user.uid] && <span style={{ fontSize: 10, color: '#9ca3af' }}>...</span>}
                    </div>

                    {/* Phone access toggle (only meaningful for Starter users) */}
                    {user.subscriptionTier !== 'pro' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Phone size={11} style={{ color: user.phoneAccess ? '#22c55e' : '#6b7280' }} />
                        <span style={{ fontSize: 11, color: user.phoneAccess ? '#22c55e' : '#6b7280' }}>
                          {user.phoneAccess ? 'Phone on' : 'Phone off'}
                        </span>
                        <button
                          disabled={phonePending[user.uid] || (!user.phoneAccess && (platformStats?.phoneAccessGrantedCount ?? 0) >= (platformStats?.maxPhoneGrants ?? 25))}
                          onClick={() => handleTogglePhoneAccess(user.uid, !user.phoneAccess)}
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: 'none',
                            cursor: 'pointer',
                            background: user.phoneAccess ? '#7f1d1d' : '#14532d',
                            color: user.phoneAccess ? '#fca5a5' : '#86efac',
                            opacity: phonePending[user.uid] ? 0.5 : 1
                          }}
                        >
                          {phonePending[user.uid] ? '...' : user.phoneAccess ? 'Revoke' : 'Grant'}
                        </button>
                      </div>
                    )}
                    {user.subscriptionTier === 'pro' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Phone size={11} style={{ color: '#22c55e' }} />
                        <span style={{ fontSize: 11, color: '#22c55e' }}>Phone included</span>
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <div className="scout-metrics">
                    <p className="metric-main">{user.scout?.companiesTotal ?? 0} companies</p>
                    <p className="metric-detail">
                      {user.scout?.companiesAccepted ?? 0} accepted, {user.scout?.contactsTotal ?? 0} contacts
                    </p>
                    {user.scout?.icpConfigured && (
                      <span className="badge badge-success">ICP ✓</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="recon-metrics">
                    <p className="metric-main">{user.recon?.leadsTotal ?? 0} leads</p>
                    {user.recon?.icpBriefGenerated && (
                      <span className="badge badge-info">ICP Brief ✓</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="credits-metrics">
                    <p className="metric-main">{user.credits?.total ?? 0}</p>
                    {(user.credits?.total ?? 0) > 0 && (
                      <p className="metric-detail">
                        {user.credits?.searchCompanies ?? 0}s · {user.credits?.enrichContact ?? 0}e
                      </p>
                    )}
                  </div>
                </td>
                <td>
                  <p className="last-login">{formatDate(user.lastLogin)}</p>
                  {user.signupDate && (
                    <p className="signup-date">Joined {formatDate(user.signupDate)}</p>
                  )}
                </td>
                <td>
                  <button
                    onClick={() => navigate(`/admin/user/${user.uid}`)}
                    className="view-btn"
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div className="no-results">
            <p>No users found matching your filters.</p>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="results-count">
        Showing {filteredUsers.length} of {users.length} users
      </div>
    </div>
  );
}
