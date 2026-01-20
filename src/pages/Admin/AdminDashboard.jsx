import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { fetchAllUsers } from '../../utils/adminAuth';
import { Users, TrendingUp, Database, Building2, Filter, Search, FileText } from 'lucide-react';
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
          aVal = a.credits.total;
          bVal = b.credits.total;
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
                  </div>
                </td>
                <td>
                  <div className="scout-metrics">
                    <p className="metric-main">{user.scout.companiesTotal} companies</p>
                    <p className="metric-detail">
                      {user.scout.companiesAccepted} accepted, {user.scout.contactsTotal} contacts
                    </p>
                    {user.scout.icpConfigured && (
                      <span className="badge badge-success">ICP ✓</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="recon-metrics">
                    <p className="metric-main">{user.recon.leadsTotal} leads</p>
                    {user.recon.icpBriefGenerated && (
                      <span className="badge badge-info">ICP Brief ✓</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="credits-metrics">
                    <p className="metric-main">{user.credits.total}</p>
                    {user.credits.total > 0 && (
                      <p className="metric-detail">
                        {user.credits.searchCompanies}s · {user.credits.enrichContact}e
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
