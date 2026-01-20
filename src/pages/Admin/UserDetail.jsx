import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { fetchAllUsers } from '../../utils/adminAuth';
import { ArrowLeft, User, Building2, Target, Database, Calendar, TrendingUp, Eye } from 'lucide-react';
import './UserDetail.css';

export default function UserDetail() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [startingImpersonation, setStartingImpersonation] = useState(false);

  useEffect(() => {
    loadUserDetail();
  }, [uid]);

  const loadUserDetail = async () => {
    try {
      setLoading(true);
      const currentUser = auth.currentUser;

      if (!currentUser) {
        navigate('/login');
        return;
      }

      const authToken = await currentUser.getIdToken();
      const data = await fetchAllUsers(currentUser.uid, authToken);

      // Find the specific user
      const foundUser = data.users.find(u => u.uid === uid);

      if (!foundUser) {
        setError('User not found');
        setLoading(false);
        return;
      }

      setUser(foundUser);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load user:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const formatDateRelative = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  const handleStartImpersonation = async () => {
    const reason = prompt('Please provide a reason for impersonation (e.g., "User reported bug with XYZ feature"):');

    if (!reason || reason.trim() === '') {
      alert('A reason is required to start impersonation');
      return;
    }

    if (!confirm(`Start impersonation session for ${user.email}?\n\nReason: ${reason}\n\nThis session will last 30 minutes and all actions will be logged.`)) {
      return;
    }

    try {
      setStartingImpersonation(true);

      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Not authenticated');
      }

      const authToken = await currentUser.getIdToken();

      const response = await fetch('/.netlify/functions/adminStartImpersonation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          targetUserId: uid,
          reason: reason.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start impersonation');
      }

      const data = await response.json();

      alert(`Impersonation session started successfully!\n\nViewing as: ${user.email}\nExpires in: 30 minutes\n\nYou will be redirected to the main dashboard.`);

      // Redirect to main dashboard as the impersonated user
      window.location.href = '/';

    } catch (error) {
      console.error('Error starting impersonation:', error);
      alert(`Failed to start impersonation: ${error.message}`);
    } finally {
      setStartingImpersonation(false);
    }
  };

  if (loading) {
    return (
      <div className="user-detail-loading">
        <div className="loading-spinner"></div>
        <p>Loading user details...</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="user-detail-error">
        <h2>Error</h2>
        <p>{error || 'User not found'}</p>
        <button onClick={() => navigate('/admin')} className="back-btn">
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="user-detail">
      {/* Header with Back Button */}
      <div className="detail-header">
        <button onClick={() => navigate('/admin')} className="back-button">
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </button>
        <button
          onClick={handleStartImpersonation}
          disabled={startingImpersonation}
          className="impersonate-button"
          title="View the platform as this user for troubleshooting"
        >
          <Eye className="w-4 h-4" />
          <span>{startingImpersonation ? 'Starting...' : 'View as User'}</span>
        </button>
      </div>

      {/* User Overview */}
      <div className="user-overview-card">
        <div className="user-avatar">
          <User className="w-12 h-12" />
        </div>
        <div className="user-header-info">
          <h1 className="user-name">{user.email || 'No email'}</h1>
          <p className="user-id">UID: {user.uid}</p>
          <div className="user-meta">
            <span className="meta-item">
              <Calendar className="w-4 h-4" />
              Joined {formatDateRelative(user.signupDate)}
            </span>
            <span className="meta-item">
              <TrendingUp className="w-4 h-4" />
              Last login: {formatDateRelative(user.lastLogin)}
            </span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        {/* Account Information */}
        <div className="detail-section">
          <div className="section-header">
            <User className="section-icon" />
            <h2>Account Information</h2>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <p className="info-label">Email</p>
              <p className="info-value">{user.email || 'Not provided'}</p>
            </div>
            <div className="info-item">
              <p className="info-label">User ID</p>
              <p className="info-value info-value-mono">{user.uid}</p>
            </div>
            <div className="info-item">
              <p className="info-label">Signup Date</p>
              <p className="info-value">{formatDate(user.signupDate)}</p>
            </div>
            <div className="info-item">
              <p className="info-label">Last Login</p>
              <p className="info-value">{formatDate(user.lastLogin)}</p>
            </div>
          </div>
        </div>

        {/* Scout Progress */}
        <div className="detail-section">
          <div className="section-header">
            <Building2 className="section-icon" />
            <h2>Scout Progress</h2>
          </div>

          <div className="metrics-grid">
            <div className="metric-card">
              <p className="metric-label">Total Companies</p>
              <p className="metric-value">{user.scout.companiesTotal}</p>
              <div className="metric-breakdown">
                <span className="breakdown-item breakdown-success">
                  {user.scout.companiesAccepted} accepted
                </span>
                <span className="breakdown-item breakdown-neutral">
                  {user.scout.companiesPending} pending
                </span>
                <span className="breakdown-item breakdown-danger">
                  {user.scout.companiesRejected} rejected
                </span>
              </div>
            </div>

            <div className="metric-card">
              <p className="metric-label">Contacts</p>
              <p className="metric-value">{user.scout.contactsTotal}</p>
            </div>

            <div className="metric-card">
              <p className="metric-label">Daily Swipes</p>
              <p className="metric-value">
                {user.scout.dailySwipeCount}/{user.scout.dailySwipeLimit}
              </p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${(user.scout.dailySwipeCount / user.scout.dailySwipeLimit) * 100}%`
                  }}
                ></div>
              </div>
            </div>
          </div>

          <div className="icp-info">
            <h3>ICP Configuration</h3>
            <div className="icp-grid">
              <div className="icp-item">
                <p className="icp-label">Industries</p>
                <p className="icp-value">{user.scout.icpIndustries}</p>
              </div>
              <div className="icp-item">
                <p className="icp-label">Company Sizes</p>
                <p className="icp-value">{user.scout.icpCompanySizes}</p>
              </div>
              <div className="icp-item">
                <p className="icp-label">Locations</p>
                <p className="icp-value">
                  {user.scout.icpLocations === 0 ? 'Not set' : user.scout.icpLocations}
                </p>
              </div>
              <div className="icp-item">
                <p className="icp-label">Target Titles</p>
                <p className="icp-value">{user.scout.targetTitles}</p>
              </div>
            </div>
            {user.scout.icpConfigured ? (
              <span className="status-badge status-success">ICP Configured ✓</span>
            ) : (
              <span className="status-badge status-warning">ICP Not Configured</span>
            )}
          </div>

          {user.scout.lastActivity && (
            <p className="last-activity">
              Last Scout activity: {formatDate(user.scout.lastActivity)}
            </p>
          )}
        </div>

        {/* Recon Progress */}
        <div className="detail-section">
          <div className="section-header">
            <Target className="section-icon" />
            <h2>Recon Progress</h2>
          </div>

          <div className="metrics-grid">
            <div className="metric-card">
              <p className="metric-label">Total Leads</p>
              <p className="metric-value">{user.recon.leadsTotal}</p>
            </div>

            <div className="metric-card">
              <p className="metric-label">ICP Brief</p>
              <p className="metric-value">
                {user.recon.icpBriefGenerated ? (
                  <span className="status-badge status-success">Generated ✓</span>
                ) : (
                  <span className="status-badge status-neutral">Not Generated</span>
                )}
              </p>
            </div>
          </div>

          {user.recon.lastActivity && (
            <p className="last-activity">
              Last Recon activity: {formatDate(user.recon.lastActivity)}
            </p>
          )}
        </div>

        {/* API Credits Usage */}
        <div className="detail-section detail-section-full">
          <div className="section-header">
            <Database className="section-icon" />
            <h2>API Credits Usage</h2>
          </div>

          <div className="credits-overview">
            <div className="total-credits">
              <p className="credits-label">Total Credits Used</p>
              <p className="credits-value">{user.credits.total.toLocaleString()}</p>
            </div>
          </div>

          <div className="credits-breakdown">
            <div className="credit-item">
              <p className="credit-label">Company Search</p>
              <div className="credit-bar-container">
                <div
                  className="credit-bar"
                  style={{
                    width: user.credits.total > 0
                      ? `${(user.credits.searchCompanies / user.credits.total) * 100}%`
                      : '0%'
                  }}
                ></div>
              </div>
              <p className="credit-count">{user.credits.searchCompanies}</p>
            </div>

            <div className="credit-item">
              <p className="credit-label">Contact Enrichment</p>
              <div className="credit-bar-container">
                <div
                  className="credit-bar"
                  style={{
                    width: user.credits.total > 0
                      ? `${(user.credits.enrichContact / user.credits.total) * 100}%`
                      : '0%'
                  }}
                ></div>
              </div>
              <p className="credit-count">{user.credits.enrichContact}</p>
            </div>

            <div className="credit-item">
              <p className="credit-label">Company Enrichment</p>
              <div className="credit-bar-container">
                <div
                  className="credit-bar"
                  style={{
                    width: user.credits.total > 0
                      ? `${(user.credits.enrichCompany / user.credits.total) * 100}%`
                      : '0%'
                  }}
                ></div>
              </div>
              <p className="credit-count">{user.credits.enrichCompany}</p>
            </div>

            <div className="credit-item">
              <p className="credit-label">Person Search</p>
              <div className="credit-bar-container">
                <div
                  className="credit-bar"
                  style={{
                    width: user.credits.total > 0
                      ? `${(user.credits.searchPeople / user.credits.total) * 100}%`
                      : '0%'
                  }}
                ></div>
              </div>
              <p className="credit-count">{user.credits.searchPeople}</p>
            </div>
          </div>

          {user.credits.lastUsed && (
            <p className="last-activity">
              Last API usage: {formatDate(user.credits.lastUsed)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
