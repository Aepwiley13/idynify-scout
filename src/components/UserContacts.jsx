/**
 * User Contacts Component
 *
 * Displays a user's contacts in an admin view with filtering, search, and detail modal.
 */

import React, { useState, useEffect } from 'react';
import { auth } from '../firebase/config';
import {
  Users,
  Mail,
  Phone,
  Linkedin,
  Building2,
  Search,
  Filter,
  Eye,
  ChevronDown,
  ChevronUp,
  X,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import './UserContacts.css';

const UserContacts = ({ userId, userEmail }) => {
  const [contacts, setContacts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [seniorityFilter, setSeniorityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // UI state
  const [showFilters, setShowFilters] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Fetch contacts
  useEffect(() => {
    if (userId) {
      fetchContacts();
    }
  }, [userId, currentPage, statusFilter, seniorityFilter, searchQuery]);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      setError(null);

      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not authenticated');
      }

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/adminGetUserContacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          userId,
          pagination: {
            page: currentPage,
            pageSize: pageSize
          },
          filters: {
            status: statusFilter,
            seniority: seniorityFilter
          },
          search: searchQuery || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch contacts');
      }

      const data = await response.json();

      setContacts(data.data.contacts);
      setStats(data.data.stats);
      setCurrentPage(data.data.pagination.page);
      setTotalPages(data.data.pagination.totalPages);
      setTotalCount(data.data.pagination.totalCount);

    } catch (err) {
      console.error('Error fetching contacts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // View contact detail
  const handleViewDetail = async (contactId) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/adminGetContactDetail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          authToken,
          userId,
          contactId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch contact detail');
      }

      const data = await response.json();
      setSelectedContact(data.data);
      setShowDetailModal(true);

    } catch (err) {
      console.error('Error fetching contact detail:', err);
      alert('Failed to load contact details');
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <div className="user-contacts-section">
      <div className="contacts-header">
        <div>
          <h2>Contacts ({totalCount})</h2>
          <p>All contacts added by {userEmail}</p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="contacts-stats">
          <div className="stat-item">
            <Users className="w-4 h-4" />
            <span className="stat-label">Total:</span>
            <span className="stat-value">{stats.totalContacts}</span>
          </div>
          <div className="stat-item">
            <Mail className="w-4 h-4" />
            <span className="stat-label">With Email:</span>
            <span className="stat-value">{stats.withEmail}</span>
          </div>
          <div className="stat-item">
            <Linkedin className="w-4 h-4" />
            <span className="stat-label">With LinkedIn:</span>
            <span className="stat-value">{stats.withLinkedIn}</span>
          </div>
          <div className="stat-item">
            <Phone className="w-4 h-4" />
            <span className="stat-label">With Phone:</span>
            <span className="stat-value">{stats.withPhone}</span>
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="contacts-controls">
        <div className="search-bar">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search contacts..."
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
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}>
              <option value="all">All Contacts</option>
              <option value="has_email">Has Email</option>
              <option value="no_email">No Email</option>
              <option value="enriched">Enriched</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Seniority</label>
            <select value={seniorityFilter} onChange={(e) => {
              setSeniorityFilter(e.target.value);
              setCurrentPage(1);
            }}>
              <option value="all">All Levels</option>
              <option value="entry">Entry</option>
              <option value="senior">Senior</option>
              <option value="manager">Manager</option>
              <option value="director">Director</option>
              <option value="vp">VP</option>
              <option value="c_suite">C-Suite</option>
            </select>
          </div>
        </div>
      )}

      {/* Contacts Table */}
      <div className="contacts-table-container">
        {loading ? (
          <div className="loading-state">
            <RefreshCw className="loading-spinner" />
            <p>Loading contacts...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <AlertCircle className="w-12 h-12" />
            <p>{error}</p>
            <button onClick={fetchContacts} className="btn-primary">
              Retry
            </button>
          </div>
        ) : contacts.length === 0 ? (
          <div className="empty-state">
            <Users className="w-12 h-12" />
            <p>No contacts found</p>
          </div>
        ) : (
          <>
            <table className="contacts-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Seniority</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(contact => (
                  <tr key={contact.contactId}>
                    <td>
                      <div className="contact-name-cell">
                        {contact.photo_url ? (
                          <img src={contact.photo_url} alt={contact.name} className="contact-avatar" />
                        ) : (
                          <div className="contact-avatar-placeholder">
                            <Users className="w-4 h-4" />
                          </div>
                        )}
                        <span>{contact.name || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="title-cell">{contact.title || '-'}</td>
                    <td className="company-cell">{contact.organization_name || '-'}</td>
                    <td className="email-cell">
                      {contact.email ? (
                        <span className="has-email">{contact.email}</span>
                      ) : (
                        <span className="no-email">No email</span>
                      )}
                    </td>
                    <td>
                      {contact.phone_numbers && contact.phone_numbers.length > 0 ? (
                        <span>{contact.phone_numbers.length}</span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>
                      {contact.seniority ? (
                        <span className="seniority-badge">{contact.seniority}</span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="date-cell">{formatTimestamp(contact.addedAt)}</td>
                    <td>
                      <button
                        onClick={() => handleViewDetail(contact.contactId)}
                        className="btn-icon"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="pagination">
              <div className="pagination-info">
                Showing {contacts.length} of {totalCount} contacts
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

      {/* Contact Detail Modal */}
      {showDetailModal && selectedContact && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content contact-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Contact Details</h2>
              <button onClick={() => setShowDetailModal(false)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body">
              {/* Contact Info */}
              <div className="contact-detail-section">
                <div className="contact-header-info">
                  {selectedContact.contact.photo_url ? (
                    <img src={selectedContact.contact.photo_url} alt={selectedContact.contact.name} className="contact-avatar-large" />
                  ) : (
                    <div className="contact-avatar-large-placeholder">
                      <Users className="w-8 h-8" />
                    </div>
                  )}
                  <div>
                    <h3>{selectedContact.contact.name || 'Unknown'}</h3>
                    <p className="contact-title">{selectedContact.contact.title || 'No title'}</p>
                    {selectedContact.company && (
                      <p className="contact-company">
                        <Building2 className="w-4 h-4" />
                        {selectedContact.company.name}
                      </p>
                    )}
                  </div>
                </div>

                <div className="contact-detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Email:</span>
                    <span className="detail-value">{selectedContact.contact.email || 'Not available'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">LinkedIn:</span>
                    <span className="detail-value">
                      {selectedContact.contact.linkedin_url ? (
                        <a href={selectedContact.contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                          View Profile
                        </a>
                      ) : (
                        'Not available'
                      )}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Phone Numbers:</span>
                    <span className="detail-value">
                      {selectedContact.contact.phone_numbers && selectedContact.contact.phone_numbers.length > 0 ? (
                        selectedContact.contact.phone_numbers.join(', ')
                      ) : (
                        'Not available'
                      )}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Seniority:</span>
                    <span className="detail-value">{selectedContact.contact.seniority || 'Not specified'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Departments:</span>
                    <span className="detail-value">
                      {selectedContact.contact.departments && selectedContact.contact.departments.length > 0 ? (
                        selectedContact.contact.departments.join(', ')
                      ) : (
                        'Not specified'
                      )}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Added:</span>
                    <span className="detail-value">{formatTimestamp(selectedContact.contact.addedAt)}</span>
                  </div>
                  {selectedContact.contact.lastEnrichedAt && (
                    <div className="detail-item">
                      <span className="detail-label">Last Enriched:</span>
                      <span className="detail-value">{formatTimestamp(selectedContact.contact.lastEnrichedAt)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Company Info */}
              {selectedContact.company && (
                <div className="contact-detail-section">
                  <h4>Company Information</h4>
                  <div className="contact-detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">Company Name:</span>
                      <span className="detail-value">{selectedContact.company.name}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Domain:</span>
                      <span className="detail-value">{selectedContact.company.domain || 'Not available'}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Industry:</span>
                      <span className="detail-value">{selectedContact.company.industry || 'Not available'}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Employee Count:</span>
                      <span className="detail-value">{selectedContact.company.employeeCount || 'Not available'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
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

export default UserContacts;
