/**
 * Email Insights
 *
 * Admin page for viewing email delivery metrics, logs, and insights.
 * Features: stats dashboard, filtering, search, email detail modal, retry functionality, export
 */

import React, { useState, useEffect } from 'react';
import { auth } from '../../firebase/config';
import {
  Mail,
  Send,
  CheckCircle,
  Eye,
  MousePointer,
  AlertCircle,
  XCircle,
  Download,
  RefreshCw,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Calendar,
  X
} from 'lucide-react';
import './EmailInsights.css';

const EmailInsights = () => {
  const [emailLogs, setEmailLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [emailTypeFilter, setEmailTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRangeFilter, setDateRangeFilter] = useState('last_7_days');
  const [searchQuery, setSearchQuery] = useState('');

  // UI state
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [retryingEmailId, setRetryingEmailId] = useState(null);

  // Fetch email logs
  useEffect(() => {
    fetchEmailLogs();
  }, [currentPage, pageSize, emailTypeFilter, statusFilter, dateRangeFilter, searchQuery]);

  const fetchEmailLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not authenticated');
      }

      const authToken = await user.getIdToken();

      // Build date range
      const dateRange = getDateRange(dateRangeFilter);

      const response = await fetch('/.netlify/functions/adminGetEmailLogs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          pagination: {
            page: currentPage,
            pageSize: pageSize
          },
          filters: {
            emailType: emailTypeFilter,
            status: statusFilter,
            dateRange: dateRange
          },
          search: searchQuery || null,
          sort: {
            field: 'queuedAt',
            direction: 'desc'
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch email logs');
      }

      const data = await response.json();

      setEmailLogs(data.data.logs);
      setStats(data.data.stats);
      setCurrentPage(data.data.pagination.page);
      setTotalPages(data.data.pagination.totalPages);
      setTotalCount(data.data.pagination.totalCount);

    } catch (err) {
      console.error('Error fetching email logs:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Get date range based on filter
  const getDateRange = (filter) => {
    const now = new Date();
    let start, end;

    switch (filter) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case 'last_7_days':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'last_30_days':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'last_90_days':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      default:
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
    }

    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  };

  // View email detail
  const handleViewDetail = async (emailId) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/adminGetEmailDetail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          emailId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch email detail');
      }

      const data = await response.json();
      setSelectedEmail(data.data);
      setShowDetailModal(true);

    } catch (err) {
      console.error('Error fetching email detail:', err);
      alert('Failed to load email details');
    }
  };

  // Retry email send
  const handleRetryEmail = async (emailId) => {
    if (!confirm('Are you sure you want to retry sending this email?')) {
      return;
    }

    try {
      setRetryingEmailId(emailId);

      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/adminRetryEmailSend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          emailId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to retry email');
      }

      alert('Email retry sent successfully!');
      fetchEmailLogs(); // Refresh logs

    } catch (err) {
      console.error('Error retrying email:', err);
      alert(`Failed to retry email: ${err.message}`);
    } finally {
      setRetryingEmailId(null);
    }
  };

  // Export logs
  const handleExport = async (format) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();
      const dateRange = getDateRange(dateRangeFilter);

      const response = await fetch('/.netlify/functions/adminExportEmailLogs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          format: format,
          dateRange: dateRange,
          filters: {
            emailType: emailTypeFilter,
            status: statusFilter
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to export email logs');
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `email_logs_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

    } catch (err) {
      console.error('Error exporting logs:', err);
      alert('Failed to export logs');
    }
  };

  // Get status badge
  const getStatusBadge = (status) => {
    const badges = {
      queued: { icon: <Mail className="w-3 h-3" />, class: 'status-queued', label: 'Queued' },
      sent: { icon: <Send className="w-3 h-3" />, class: 'status-sent', label: 'Sent' },
      delivered: { icon: <CheckCircle className="w-3 h-3" />, class: 'status-delivered', label: 'Delivered' },
      opened: { icon: <Eye className="w-3 h-3" />, class: 'status-opened', label: 'Opened' },
      clicked: { icon: <MousePointer className="w-3 h-3" />, class: 'status-clicked', label: 'Clicked' },
      bounced: { icon: <AlertCircle className="w-3 h-3" />, class: 'status-bounced', label: 'Bounced' },
      failed: { icon: <XCircle className="w-3 h-3" />, class: 'status-failed', label: 'Failed' },
      complained: { icon: <XCircle className="w-3 h-3" />, class: 'status-complained', label: 'Spam' }
    };

    const badge = badges[status] || badges.queued;

    return (
      <span className={`status-badge ${badge.class}`}>
        {badge.icon}
        {badge.label}
      </span>
    );
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Format email type
  const formatEmailType = (type) => {
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <div className="email-insights-page">
      <div className="email-insights-header">
        <div>
          <h1>Email Insights</h1>
          <p>Monitor email delivery, opens, clicks, and failures</p>
        </div>
        <div className="header-actions">
          <button onClick={() => handleExport('csv')} className="btn-secondary">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button onClick={() => handleExport('json')} className="btn-secondary">
            <Download className="w-4 h-4" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon stat-icon-blue">
              <Mail className="w-5 h-5" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Total Emails</div>
              <div className="stat-value">{stats.totalEmails.toLocaleString()}</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-green">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Delivery Rate</div>
              <div className="stat-value">{stats.deliveryRate}%</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-purple">
              <Eye className="w-5 h-5" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Open Rate</div>
              <div className="stat-value">{stats.openRate}%</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-orange">
              <MousePointer className="w-5 h-5" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Click Rate</div>
              <div className="stat-value">{stats.clickRate}%</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-red">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Bounce Rate</div>
              <div className="stat-value">{stats.bounceRate}%</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon stat-icon-gray">
              <XCircle className="w-5 h-5" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Failed</div>
              <div className="stat-value">{stats.totalFailed}</div>
            </div>
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="email-controls">
        <div className="search-bar">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search by recipient email or subject..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary filter-toggle"
        >
          <Filter className="w-4 h-4" />
          Filters
          {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="filter-panel">
          <div className="filter-group">
            <label>Email Type</label>
            <select value={emailTypeFilter} onChange={(e) => {
              setEmailTypeFilter(e.target.value);
              setCurrentPage(1);
            }}>
              <option value="all">All Types</option>
              <option value="welcome_email">Welcome Email</option>
              <option value="password_reset">Password Reset</option>
              <option value="account_suspended">Account Suspended</option>
              <option value="account_reactivated">Account Reactivated</option>
              <option value="payment_receipt">Payment Receipt</option>
              <option value="subscription_expiring">Subscription Expiring</option>
              <option value="support_reply">Support Reply</option>
              <option value="general">General</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}>
              <option value="all">All Status</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="opened">Opened</option>
              <option value="clicked">Clicked</option>
              <option value="bounced">Bounced</option>
              <option value="failed">Failed</option>
              <option value="complained">Spam Complaint</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Date Range</label>
            <select value={dateRangeFilter} onChange={(e) => {
              setDateRangeFilter(e.target.value);
              setCurrentPage(1);
            }}>
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="last_90_days">Last 90 Days</option>
            </select>
          </div>
        </div>
      )}

      {/* Email Logs Table */}
      <div className="email-table-container">
        {loading ? (
          <div className="loading-state">
            <RefreshCw className="loading-spinner" />
            <p>Loading email logs...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <AlertCircle className="w-12 h-12" />
            <p>{error}</p>
            <button onClick={fetchEmailLogs} className="btn-primary">
              Retry
            </button>
          </div>
        ) : emailLogs.length === 0 ? (
          <div className="empty-state">
            <Mail className="w-12 h-12" />
            <p>No email logs found</p>
          </div>
        ) : (
          <>
            <table className="email-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Opens</th>
                  <th>Clicks</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {emailLogs.map(email => (
                  <tr key={email.emailId}>
                    <td>{formatTimestamp(email.queuedAt)}</td>
                    <td>{formatEmailType(email.type)}</td>
                    <td className="recipient-cell">{email.recipient}</td>
                    <td className="subject-cell">{email.subject}</td>
                    <td>{getStatusBadge(email.status)}</td>
                    <td>{email.openCount || 0}</td>
                    <td>{email.clickCount || 0}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          onClick={() => handleViewDetail(email.emailId)}
                          className="btn-icon"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {(email.status === 'bounced' || email.status === 'failed') && (
                          <button
                            onClick={() => handleRetryEmail(email.emailId)}
                            className="btn-icon"
                            title="Retry Send"
                            disabled={retryingEmailId === email.emailId}
                          >
                            <RefreshCw className={`w-4 h-4 ${retryingEmailId === email.emailId ? 'loading-spinner' : ''}`} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="pagination">
              <div className="pagination-info">
                Showing {emailLogs.length} of {totalCount.toLocaleString()} emails
              </div>
              <div className="pagination-controls">
                <button
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  disabled={currentPage === 1}
                  className="btn-secondary"
                >
                  Previous
                </button>
                <span className="page-indicator">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  disabled={currentPage === totalPages}
                  className="btn-secondary"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Email Detail Modal */}
      {showDetailModal && selectedEmail && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content email-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Email Details</h2>
              <button onClick={() => setShowDetailModal(false)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body">
              {/* Email Info */}
              <div className="email-detail-section">
                <h3>Email Information</h3>
                <div className="email-detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Type:</span>
                    <span className="detail-value">{formatEmailType(selectedEmail.email.type)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Status:</span>
                    <span className="detail-value">{getStatusBadge(selectedEmail.email.status)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Recipient:</span>
                    <span className="detail-value">{selectedEmail.email.recipient}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Subject:</span>
                    <span className="detail-value">{selectedEmail.email.subject}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">From:</span>
                    <span className="detail-value">{selectedEmail.email.fromName} &lt;{selectedEmail.email.from}&gt;</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Queued At:</span>
                    <span className="detail-value">{formatTimestamp(selectedEmail.email.queuedAt)}</span>
                  </div>
                  {selectedEmail.email.sentAt && (
                    <div className="detail-item">
                      <span className="detail-label">Sent At:</span>
                      <span className="detail-value">{formatTimestamp(selectedEmail.email.sentAt)}</span>
                    </div>
                  )}
                  {selectedEmail.email.deliveredAt && (
                    <div className="detail-item">
                      <span className="detail-label">Delivered At:</span>
                      <span className="detail-value">{formatTimestamp(selectedEmail.email.deliveredAt)}</span>
                    </div>
                  )}
                  {selectedEmail.email.openedAt && (
                    <div className="detail-item">
                      <span className="detail-label">First Opened:</span>
                      <span className="detail-value">{formatTimestamp(selectedEmail.email.openedAt)}</span>
                    </div>
                  )}
                  {selectedEmail.email.openCount > 0 && (
                    <div className="detail-item">
                      <span className="detail-label">Open Count:</span>
                      <span className="detail-value">{selectedEmail.email.openCount}</span>
                    </div>
                  )}
                  {selectedEmail.email.clickCount > 0 && (
                    <div className="detail-item">
                      <span className="detail-label">Click Count:</span>
                      <span className="detail-value">{selectedEmail.email.clickCount}</span>
                    </div>
                  )}
                  {selectedEmail.email.failureReason && (
                    <div className="detail-item full-width">
                      <span className="detail-label">Failure Reason:</span>
                      <span className="detail-value error-text">{selectedEmail.email.failureReason}</span>
                    </div>
                  )}
                  {selectedEmail.email.bounceType && (
                    <div className="detail-item">
                      <span className="detail-label">Bounce Type:</span>
                      <span className="detail-value">{selectedEmail.email.bounceType}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Retry Attempts */}
              {selectedEmail.retryAttempts && selectedEmail.retryAttempts.length > 0 && (
                <div className="email-detail-section">
                  <h3>Retry Attempts ({selectedEmail.retryAttempts.length})</h3>
                  <div className="retry-attempts-list">
                    {selectedEmail.retryAttempts.map((retry, index) => (
                      <div key={retry.emailId} className="retry-attempt-item">
                        <div className="retry-number">Retry {index + 1}</div>
                        <div className="retry-details">
                          <span>{getStatusBadge(retry.status)}</span>
                          <span>{formatTimestamp(retry.queuedAt)}</span>
                          {retry.failureReason && (
                            <span className="error-text">{retry.failureReason}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Email Content Preview */}
              {selectedEmail.email.htmlContent && (
                <div className="email-detail-section">
                  <h3>Email Content</h3>
                  <div className="email-content-preview">
                    <iframe
                      srcDoc={selectedEmail.email.htmlContent}
                      title="Email Preview"
                      sandbox="allow-same-origin"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              {(selectedEmail.email.status === 'bounced' || selectedEmail.email.status === 'failed') && (
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    handleRetryEmail(selectedEmail.email.emailId);
                  }}
                  className="btn-primary"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry Send
                </button>
              )}
              <button onClick={() => setShowDetailModal(false)} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailInsights;
