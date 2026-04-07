import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { fetchAllUsers } from '../../utils/adminAuth';
import { ArrowLeft, User, Building2, Target, Database, Calendar, TrendingUp, Eye, KeyRound, Ban, CheckCircle, Settings, Copy } from 'lucide-react';
import UserContacts from '../../components/UserContacts';
import BarryConversationsView from '../../components/admin/BarryConversationsView';
import './UserDetail.css';

export default function UserDetail() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [startingImpersonation, setStartingImpersonation] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [suspendingAccount, setSuspendingAccount] = useState(false);
  const [reactivatingAccount, setReactivatingAccount] = useState(false);
  const [modal, setModal] = useState(null);
  const [modalInput, setModalInput] = useState('');
  const [uidCopied, setUidCopied] = useState(false);

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

  const handleStartImpersonation = () => {
    setModalInput('');
    setModal({
      type: 'reason',
      title: 'Start View as User Session',
      message: `Enter a reason for viewing as ${user.email}:`,
      placeholder: 'e.g., "User reported bug with XYZ feature"',
      onSubmit: (reason) => {
        setModal({
          type: 'confirm',
          title: 'Confirm View as User',
          message: `Start session for ${user.email}?\n\nReason: ${reason}\n\nThis session will last 30 minutes and all actions will be logged.`,
          onConfirm: () => executeImpersonation(reason),
        });
      },
    });
  };

  const executeImpersonation = async (reason) => {
    setModal(null);
    try {
      setStartingImpersonation(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const authToken = await currentUser.getIdToken();
      const response = await fetch('/.netlify/functions/adminStartImpersonation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken, targetUserId: uid, reason }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start impersonation');
      }
      setModal({
        type: 'alert',
        title: 'Session Started',
        message: `Viewing as: ${user.email}\nExpires in: 30 minutes\n\nYou will be redirected to the main dashboard.`,
        onOk: () => { window.location.href = '/'; },
      });
    } catch (error) {
      console.error('Error starting impersonation:', error);
      setModal({
        type: 'alert',
        title: 'Error',
        message: `Failed to start impersonation: ${error.message}`,
        onOk: () => setModal(null),
      });
    } finally {
      setStartingImpersonation(false);
    }
  };

  const handleResetPassword = () => {
    setModalInput('');
    setModal({
      type: 'reason',
      title: 'Reset Password',
      message: `Enter a reason for resetting ${user.email}'s password:`,
      placeholder: 'e.g., "User locked out of account"',
      onSubmit: (reason) => {
        setModal({
          type: 'confirm',
          title: 'Confirm Password Reset',
          message: `Send password reset email to ${user.email}?\n\nReason: ${reason}\n\nThe user will receive an email with instructions to reset their password.`,
          onConfirm: () => executeResetPassword(reason),
        });
      },
    });
  };

  const executeResetPassword = async (reason) => {
    setModal(null);
    try {
      setResettingPassword(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const authToken = await currentUser.getIdToken();
      const response = await fetch('/.netlify/functions/adminResetUserPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken, targetUserId: uid, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send password reset email');
      setModal({
        type: 'alert',
        title: 'Password Reset Sent',
        message: `Password reset email sent successfully to ${user.email}!\n\nThe user will receive instructions to reset their password.`,
        onOk: () => setModal(null),
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      setModal({
        type: 'alert',
        title: 'Error',
        message: `Failed to send password reset email: ${error.message}`,
        onOk: () => setModal(null),
      });
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSuspendAccount = () => {
    setModalInput('');
    setModal({
      type: 'reason',
      title: 'Suspend Account',
      message: `Enter a reason for suspending ${user.email}'s account:`,
      placeholder: 'e.g., "Violation of terms of service"',
      onSubmit: (reason) => {
        setModal({
          type: 'confirm',
          title: 'Confirm Suspend Account',
          message: `Suspend account for ${user.email}?\n\nReason: ${reason}\n\nThis will:\n- Immediately revoke all active sessions\n- Disable login access\n- Require admin reactivation\n\nThis action will be logged.`,
          onConfirm: () => executeSuspendAccount(reason),
          danger: true,
        });
      },
    });
  };

  const executeSuspendAccount = async (reason) => {
    setModal(null);
    try {
      setSuspendingAccount(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const authToken = await currentUser.getIdToken();
      const response = await fetch('/.netlify/functions/adminSuspendAccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken, targetUserId: uid, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to suspend account');
      setModal({
        type: 'alert',
        title: 'Account Suspended',
        message: `Account suspended successfully!\n\nUser: ${user.email}\nAll active sessions have been revoked.`,
        onOk: () => { setModal(null); window.location.reload(); },
      });
    } catch (error) {
      console.error('Error suspending account:', error);
      setModal({
        type: 'alert',
        title: 'Error',
        message: `Failed to suspend account: ${error.message}`,
        onOk: () => setModal(null),
      });
    } finally {
      setSuspendingAccount(false);
    }
  };

  const handleReactivateAccount = () => {
    setModalInput('');
    setModal({
      type: 'reason',
      title: 'Reactivate Account',
      message: `Enter a reason for reactivating ${user.email}'s account:`,
      placeholder: 'e.g., "Issue resolved, restoring access"',
      onSubmit: (reason) => {
        setModal({
          type: 'confirm',
          title: 'Confirm Reactivate Account',
          message: `Reactivate account for ${user.email}?\n\nReason: ${reason}\n\nThis will restore full access to the account. This action will be logged.`,
          onConfirm: () => executeReactivateAccount(reason),
        });
      },
    });
  };

  const executeReactivateAccount = async (reason) => {
    setModal(null);
    try {
      setReactivatingAccount(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const authToken = await currentUser.getIdToken();
      const response = await fetch('/.netlify/functions/adminReactivateAccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken, targetUserId: uid, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to reactivate account');
      setModal({
        type: 'alert',
        title: 'Account Reactivated',
        message: `Account reactivated successfully!\n\nUser: ${user.email}\nThe user can now log in again.`,
        onOk: () => { setModal(null); window.location.reload(); },
      });
    } catch (error) {
      console.error('Error reactivating account:', error);
      setModal({
        type: 'alert',
        title: 'Error',
        message: `Failed to reactivate account: ${error.message}`,
        onOk: () => setModal(null),
      });
    } finally {
      setReactivatingAccount(false);
    }
  };

  const handleCopyUid = () => {
    navigator.clipboard.writeText(user.uid).then(() => {
      setUidCopied(true);
      setTimeout(() => setUidCopied(false), 2000);
    });
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
      {/* Admin Action Modal */}
      {modal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <h3 className="admin-modal-title">{modal.title}</h3>
            <p className="admin-modal-message">{modal.message}</p>
            {modal.type === 'reason' && (
              <textarea
                className="admin-modal-input"
                placeholder={modal.placeholder}
                value={modalInput}
                onChange={e => setModalInput(e.target.value)}
                rows={3}
                autoFocus
              />
            )}
            <div className="admin-modal-actions">
              {modal.type === 'reason' && (
                <>
                  <button className="admin-modal-btn-cancel" onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="admin-modal-btn-confirm"
                    onClick={() => { if (modalInput.trim()) modal.onSubmit(modalInput.trim()); }}
                    disabled={!modalInput.trim()}
                  >
                    Continue
                  </button>
                </>
              )}
              {modal.type === 'confirm' && (
                <>
                  <button className="admin-modal-btn-cancel" onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className={`admin-modal-btn-confirm${modal.danger ? ' danger' : ''}`}
                    onClick={modal.onConfirm}
                  >
                    Confirm
                  </button>
                </>
              )}
              {modal.type === 'alert' && (
                <button className="admin-modal-btn-confirm" onClick={modal.onOk}>OK</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header with Back Button */}
      <div className="detail-header">
        <button onClick={() => navigate('/admin')} className="back-button">
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </button>
        <div className="header-actions">
          {user.accountStatus === 'suspended' ? (
            <button
              onClick={handleReactivateAccount}
              disabled={reactivatingAccount}
              className="reactivate-button"
              title="Reactivate this user's account"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{reactivatingAccount ? 'Reactivating...' : 'Reactivate Account'}</span>
            </button>
          ) : (
            <button
              onClick={handleSuspendAccount}
              disabled={suspendingAccount}
              className="suspend-button"
              title="Suspend this user's account"
            >
              <Ban className="w-4 h-4" />
              <span>{suspendingAccount ? 'Suspending...' : 'Suspend Account'}</span>
            </button>
          )}
          <button
            onClick={handleResetPassword}
            disabled={resettingPassword || user.accountStatus === 'suspended'}
            className="reset-password-button"
            title="Send password reset email to this user"
          >
            <KeyRound className="w-4 h-4" />
            <span>{resettingPassword ? 'Sending...' : 'Reset Password'}</span>
          </button>
          <button
            onClick={() => navigate(`/admin/user/${uid}/icp`)}
            className="impersonate-button"
            title="Edit this user's ICP settings"
            style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1.5px solid var(--border)' }}
          >
            <Settings className="w-4 h-4" />
            <span>Edit ICP</span>
          </button>
          <button
            onClick={handleStartImpersonation}
            disabled={startingImpersonation || user.accountStatus === 'suspended'}
            className="impersonate-button"
            title="View the platform as this user for troubleshooting"
          >
            <Eye className="w-4 h-4" />
            <span>{startingImpersonation ? 'Starting...' : 'View as User'}</span>
          </button>
        </div>
      </div>

      {/* User Overview */}
      <div className="user-overview-card">
        <div className="user-avatar">
          <User className="w-12 h-12" />
        </div>
        <div className="user-header-info">
          <div className="user-name-row">
            <h1 className="user-name">{user.email || 'No email'}</h1>
            {user.accountStatus === 'suspended' && (
              <span className="account-status-badge suspended">
                <Ban className="w-3 h-3" />
                Suspended
              </span>
            )}
          </div>
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
              <div className="info-value-row">
                <p className="info-value info-value-mono">{user.uid}</p>
                <button className="copy-uid-btn" onClick={handleCopyUid} title="Copy UID">
                  <Copy className="w-3 h-3" />
                  {uidCopied ? 'Copied!' : ''}
                </button>
              </div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>ICP Configuration</h3>
              <button
                onClick={() => navigate(`/admin/user/${uid}/icp`)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                  padding: '0.35rem 0.75rem',
                  background: '#eff6ff', color: '#1d4ed8',
                  border: '1.5px solid #bfdbfe', borderRadius: 6,
                  fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer'
                }}
                title="Edit this user's ICP settings"
              >
                <Settings style={{ width: 14, height: 14 }} />
                Edit ICP Settings
              </button>
            </div>
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

      {/* Barry Conversations */}
      <BarryConversationsView userId={uid} userEmail={user.email} />

      {/* User Contacts */}
      <UserContacts userId={uid} userEmail={user.email} />
    </div>
  );
}
