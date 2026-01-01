import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import { Users, Building2, Mail, Linkedin, Search, Download, ChevronRight, UserCircle, Calendar, Phone, X } from 'lucide-react';
import './AllLeads.css';

export default function AllLeads() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    loadAllContacts();
  }, []);

  async function loadAllContacts() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;
      console.log('🔍 Loading all contacts for user:', userId);

      // Load all companies first to get company names
      const companiesSnapshot = await getDocs(
        collection(db, 'users', userId, 'companies')
      );

      const companiesMap = {};
      companiesSnapshot.docs.forEach(doc => {
        companiesMap[doc.id] = doc.data();
      });
      setCompanies(companiesMap);

      console.log('📦 Loaded companies:', Object.keys(companiesMap).length);

      // Load all contacts
      const contactsSnapshot = await getDocs(
        collection(db, 'users', userId, 'contacts')
      );

      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('✅ Loaded contacts:', contactsList.length);

      setContacts(contactsList);
      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to load contacts:', error);
      setLoading(false);
    }
  }

  function exportToCSV() {
    if (sortedAndFilteredContacts.length === 0) {
      alert('No contacts to export!');
      return;
    }

    // CSV headers - Export-ready with all enriched fields
    const headers = [
      'Name',
      'Title',
      'Company',
      'Email',
      'Email Status',
      'Email Confidence',
      'Mobile Phone',
      'Direct Line',
      'Work Phone',
      'LinkedIn',
      'Seniority',
      'Department',
      'Lead Status',
      'Added Date',
      'Last Enriched'
    ];

    // CSV rows - CRM-ready lead export
    const rows = sortedAndFilteredContacts.map(contact => {
      const company = companies[contact.company_id];
      return [
        contact.name || '',
        contact.title || '',
        company?.name || 'Unknown Company',
        contact.email || '',
        contact.email_status || '',
        contact.email_confidence || '',
        contact.phone_mobile || '',
        contact.phone_direct || '',
        contact.phone_work || '',
        contact.linkedin_url || '',
        contact.seniority || '',
        contact.departments?.[0] || contact.department || '',
        contact.lead_status || 'saved',
        contact.saved_at ? new Date(contact.saved_at).toLocaleDateString() : '',
        contact.last_enriched_at ? new Date(contact.last_enriched_at).toLocaleDateString() : ''
      ].map(field => `"${field}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scout-leads-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    console.log('📥 Exported', sortedAndFilteredContacts.length, 'CRM-ready leads to CSV');
  }

  // Filter contacts based on search term
  const filteredContacts = contacts.filter(contact => {
    if (!searchTerm) return true;

    const company = companies[contact.company_id];
    const searchLower = searchTerm.toLowerCase();

    return (
      (contact.name || '').toLowerCase().includes(searchLower) ||
      (contact.title || '').toLowerCase().includes(searchLower) ||
      (company?.name || '').toLowerCase().includes(searchLower) ||
      (contact.email || '').toLowerCase().includes(searchLower)
    );
  });

  // Sort contacts
  const sortedAndFilteredContacts = [...filteredContacts].sort((a, b) => {
    let comparison = 0;

    if (sortBy === 'name') {
      comparison = (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'company') {
      const companyA = companies[a.company_id]?.name || '';
      const companyB = companies[b.company_id]?.name || '';
      comparison = companyA.localeCompare(companyB);
    } else if (sortBy === 'date') {
      const dateA = a.addedAt || 0;
      const dateB = b.addedAt || 0;
      comparison = dateA - dateB;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // Calculate KPIs
  const totalContacts = contacts.length;
  const uniqueCompanies = new Set(contacts.map(c => c.company_id)).size;
  const contactsWithEmail = contacts.filter(c => c.email).length;
  const verifiedEmails = contacts.filter(c => c.email_status === 'verified').length;
  const contactsWithPhone = contacts.filter(c => c.phone_mobile || c.phone_direct || c.phone).length;
  const contactsWithLinkedIn = contacts.filter(c => c.linkedin_url).length;
  const emailRate = totalContacts > 0 ? Math.round((contactsWithEmail / totalContacts) * 100) : 0;
  const phoneRate = totalContacts > 0 ? Math.round((contactsWithPhone / totalContacts) * 100) : 0;

  if (loading) {
    return (
      <div className="all-leads-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading all contacts...</p>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Users className="w-16 h-16 text-gray-400" />
        </div>
        <h2>No Contacts Yet</h2>
        <p>Contacts you select from companies will appear here</p>
        <p className="empty-hint">Go to Matched Companies and select contacts from your interested companies!</p>
        <button
          onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
          className="empty-action-btn"
        >
          <Building2 className="w-5 h-5" />
          <span>View Matched Companies</span>
        </button>
      </div>
    );
  }

  return (
    <div className="all-leads">
      {/* Enterprise Header */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">All Leads</h1>
          <p className="page-subtitle">Complete database of your contact pipeline</p>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="kpi-summary">
        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <Users className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Total Contacts</p>
            <p className="kpi-value">{totalContacts}</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <Building2 className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Companies</p>
            <p className="kpi-value">{uniqueCompanies}</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <Mail className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Email Coverage</p>
            <p className="kpi-value">{emailRate}%</p>
            <p className="kpi-detail">{verifiedEmails} verified</p>
            <div className="kpi-progress-bar">
              <div
                className="kpi-progress-fill"
                style={{ width: `${emailRate}%` }}
              />
            </div>
          </div>
        </div>

        <div className="kpi-card highlight">
          <div className="kpi-icon-wrapper">
            <Phone className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Phone Coverage</p>
            <p className="kpi-value">{phoneRate}%</p>
            <p className="kpi-detail">{contactsWithPhone} contacts</p>
            <div className="kpi-progress-bar">
              <div
                className="kpi-progress-fill"
                style={{ width: `${phoneRate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Controls Section */}
      <div className="controls-section">
        {/* Search Bar */}
        <div className="search-input-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by name, title, company, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              className="clear-search-btn"
              onClick={() => setSearchTerm('')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sort Controls */}
        <div className="sort-controls">
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="date">Sort by Date Added</option>
            <option value="name">Sort by Name</option>
            <option value="company">Sort by Company</option>
          </select>

          <button
            className="sort-order-btn"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>

          <button className="export-btn" onClick={exportToCSV}>
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Results Count */}
      <div className="results-count">
        Showing {sortedAndFilteredContacts.length} of {totalContacts} contacts
        {searchTerm && ` matching "${searchTerm}"`}
      </div>

      {/* Contacts Table */}
      <div className="table-container">
        <table className="contacts-table">
          <thead>
            <tr>
              <th>
                <div className="th-content">
                  <UserCircle className="w-4 h-4" />
                  <span>Contact</span>
                </div>
              </th>
              <th>
                <div className="th-content">
                  <Building2 className="w-4 h-4" />
                  <span>Title</span>
                </div>
              </th>
              <th>
                <div className="th-content">
                  <Building2 className="w-4 h-4" />
                  <span>Company</span>
                </div>
              </th>
              <th>
                <div className="th-content">
                  <Mail className="w-4 h-4" />
                  <span>Email</span>
                </div>
              </th>
              <th>
                <div className="th-content">
                  <Phone className="w-4 h-4" />
                  <span>Phone</span>
                </div>
              </th>
              <th>
                <div className="th-content">
                  <Calendar className="w-4 h-4" />
                  <span>Added</span>
                </div>
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedAndFilteredContacts.map(contact => {
              const company = companies[contact.company_id];
              return (
                <tr key={contact.id}>
                  <td className="contact-cell" data-label="Contact">
                    <div className="contact-info">
                      <div className="avatar">
                        {contact.name ? contact.name.charAt(0).toUpperCase() : '?'}
                      </div>
                      <div>
                        <span className="contact-name">
                          {contact.name || 'Unknown'}
                        </span>
                        {/* Source Badge */}
                        <div style={{
                          display: 'inline-block',
                          marginLeft: '0.5rem',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.625rem',
                          fontWeight: '600',
                          backgroundColor: contact.source === 'manual' ? '#eff6ff' : contact.source === 'networking' ? '#faf5ff' : '#f0fdf4',
                          color: contact.source === 'manual' ? '#1e40af' : contact.source === 'networking' ? '#7e22ce' : '#15803d',
                          border: `1px solid ${contact.source === 'manual' ? '#3b82f6' : contact.source === 'networking' ? '#a855f7' : '#22c55e'}`
                        }}>
                          {contact.source === 'manual' ? '✍️ Manual' : contact.source === 'networking' ? '🤝 Networking' : '🔍 Apollo'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="title-cell" data-label="Title">{contact.title || '—'}</td>
                  <td className="company-cell" data-label="Company">{company?.name || 'Unknown Company'}</td>
                  <td className="email-cell" data-label="Email">
                    {contact.email ? (
                      <div className="email-with-status">
                        <a
                          href={`mailto:${contact.email}`}
                          className="email-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {contact.email}
                        </a>
                        {contact.email_status === 'verified' && (
                          <span className="verified-badge-table" title="Verified Email">✓</span>
                        )}
                      </div>
                    ) : (
                      <span className="empty-value">—</span>
                    )}
                  </td>
                  <td className="phone-cell" data-label="Phone">
                    {contact.phone_mobile || contact.phone_direct || contact.phone ? (
                      <div className="phone-with-type">
                        {contact.phone_mobile && (
                          <div className="phone-item">
                            <span className="phone-type-label">M:</span>
                            <a href={`tel:${contact.phone_mobile}`}>{contact.phone_mobile}</a>
                          </div>
                        )}
                        {contact.phone_direct && (
                          <div className="phone-item">
                            <span className="phone-type-label">D:</span>
                            <a href={`tel:${contact.phone_direct}`}>{contact.phone_direct}</a>
                          </div>
                        )}
                        {!contact.phone_mobile && !contact.phone_direct && contact.phone && (
                          <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                        )}
                      </div>
                    ) : (
                      <span className="empty-value">—</span>
                    )}
                  </td>
                  <td className="date-cell" data-label="Added">
                    {contact.addedAt ? new Date(contact.addedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="actions-cell" data-label="Actions">
                    <div className="action-links">
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="action-link"
                          onClick={(e) => e.stopPropagation()}
                          title="View LinkedIn Profile"
                        >
                          <Linkedin className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        className="action-link"
                        onClick={() => navigate(`/scout/contact/${contact.id}`)}
                        title="View Contact Details"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* No Search Results */}
      {sortedAndFilteredContacts.length === 0 && searchTerm && (
        <div className="no-results">
          <Search className="w-12 h-12 text-gray-400 mb-4" />
          <h3>No contacts found</h3>
          <p>No contacts match your search for "{searchTerm}"</p>
          <button className="clear-btn" onClick={() => setSearchTerm('')}>
            Clear Search
          </button>
        </div>
      )}
    </div>
  );
}
