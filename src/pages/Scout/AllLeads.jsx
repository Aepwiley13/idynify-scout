import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import { Users, Building2, Mail, Linkedin, Search, Download, ChevronRight, UserCircle, Calendar, Phone, X, Smartphone } from 'lucide-react';
import ContactSnapshot from '../../components/contacts/ContactSnapshot';
import { downloadVCard } from '../../utils/vcard';
import './AllLeads.css';

export default function AllLeads() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedContactIds, setSelectedContactIds] = useState([]);

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

  function handleContactUpdate(updatedContact) {
    // Update the contact in the local state
    setContacts(prevContacts =>
      prevContacts.map(contact =>
        contact.id === updatedContact.id ? { ...contact, ...updatedContact } : contact
      )
    );
    // Close the modal
    setSelectedContact(null);
  }

  function toggleContactSelection(contactId, event) {
    event.stopPropagation(); // Prevent row click
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  }

  function toggleSelectAll() {
    if (selectedContactIds.length === sortedAndFilteredContacts.length) {
      setSelectedContactIds([]);
    } else {
      setSelectedContactIds(sortedAndFilteredContacts.map(c => c.id));
    }
  }

  function handleBulkStartCampaign() {
    // Navigate to Hunter with selected contacts (Phase 1)
    navigate(`/hunter/create?contactIds=${selectedContactIds.join(',')}`);
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

      {/* Bulk Actions */}
      {selectedContactIds.length > 0 && (
        <div style={{
          padding: '1rem',
          background: 'linear-gradient(to right, rgba(236, 72, 153, 0.1), rgba(168, 85, 247, 0.1))',
          border: '2px solid rgba(236, 72, 153, 0.3)',
          borderRadius: '0.75rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: '600', color: '#ec4899' }}>
              {selectedContactIds.length} contact{selectedContactIds.length > 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedContactIds([])}
              style={{
                padding: '0.25rem 0.75rem',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '0.5rem',
                color: '#94a3b8',
                fontSize: '0.875rem',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
          <button
            onClick={handleBulkStartCampaign}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(to right, #ec4899, #a855f7)',
              color: 'white',
              border: 'none',
              borderRadius: '0.75rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Mail className="w-5 h-5" />
            Start Campaign ({selectedContactIds.length})
          </button>
        </div>
      )}

      {/* Results Count */}
      <div className="results-count">
        Showing {sortedAndFilteredContacts.length} of {totalContacts} contacts
        {searchTerm && ` matching "${searchTerm}"`}
      </div>

      {/* Contacts Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        {sortedAndFilteredContacts.map(contact => {
          const company = companies[contact.company_id];
          const isSelected = selectedContactIds.includes(contact.id);
          const backgroundImage = contact.photo_url || '/barry.png';

          return (
            <div key={contact.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Photo Background Card */}
              <div
                onClick={() => setSelectedContact(contact)}
                style={{
                  backgroundImage: `url(${backgroundImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  borderRadius: '16px',
                  height: '280px',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  overflow: 'hidden',
                  border: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = '#3b82f6';
                    e.currentTarget.style.boxShadow = '0 12px 32px rgba(59, 130, 246, 0.2)';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
              >
                {/* Selection Checkbox - Top Right */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleContactSelection(contact.id, e);
                  }}
                  style={{
                    position: 'absolute',
                    top: '1rem',
                    right: '1rem',
                    zIndex: 10
                  }}
                >
                  <div style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    border: '2px solid rgba(255, 255, 255, 0.9)',
                    background: isSelected ? '#3b82f6' : 'rgba(0, 0, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    backdropFilter: 'blur(8px)'
                  }}>
                    {isSelected && <CheckCircle className="w-5 h-5" style={{ color: '#ffffff' }} />}
                  </div>
                </div>

                {/* Source Badge - Top Left */}
                <div style={{
                  position: 'absolute',
                  top: '1rem',
                  left: '1rem',
                  padding: '0.25rem 0.625rem',
                  borderRadius: '6px',
                  fontSize: '0.625rem',
                  fontWeight: '600',
                  backgroundColor: contact.source === 'manual' ? '#eff6ff' : contact.source === 'networking' ? '#faf5ff' : contact.source === 'LinkedIn Link' ? '#dbeafe' : '#f0fdf4',
                  color: contact.source === 'manual' ? '#1e40af' : contact.source === 'networking' ? '#7e22ce' : contact.source === 'LinkedIn Link' ? '#1e40af' : '#15803d',
                  border: `1px solid ${contact.source === 'manual' ? '#3b82f6' : contact.source === 'networking' ? '#a855f7' : contact.source === 'LinkedIn Link' ? '#3b82f6' : '#22c55e'}`,
                  backdropFilter: 'blur(8px)',
                  zIndex: 10
                }}>
                  {contact.source === 'manual' ? '✍️ Manual' :
                   contact.source === 'networking' ? '🤝 Network' :
                   contact.source === 'LinkedIn Link' ? '🔗 LinkedIn' : '🔍 Search'}
                </div>

                {/* Gradient Overlay */}
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '50%',
                  background: 'linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 40%, rgba(0, 0, 0, 0.3) 70%, transparent 100%)',
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: '1.25rem'
                }}>
                  <div style={{ width: '100%' }}>
                    {/* Name */}
                    <p style={{
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      color: '#ffffff',
                      margin: '0 0 0.25rem 0',
                      lineHeight: 1.2,
                      textShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                    }}>
                      {contact.name || 'Unknown'}
                    </p>

                    {/* Title */}
                    <p style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: 'rgba(255, 255, 255, 0.95)',
                      margin: '0 0 0.375rem 0',
                      lineHeight: 1.3,
                      textShadow: '0 1px 4px rgba(0, 0, 0, 0.3)'
                    }}>
                      {contact.title || 'Title not available'}
                    </p>

                    {/* Company Badge */}
                    {company?.name && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.25rem 0.625rem',
                        background: 'rgba(255, 255, 255, 0.25)',
                        backdropFilter: 'blur(8px)',
                        color: '#ffffff',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '6px',
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)'
                      }}>
                        {company.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Info Below Card */}
              <div style={{
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                {/* Email */}
                {contact.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Mail className="w-4 h-4" style={{ color: '#6b7280', flexShrink: 0 }} />
                    <a
                      href={`mailto:${contact.email}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: '0.875rem',
                        color: '#3b82f6',
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {contact.email}
                    </a>
                    {contact.email_status === 'verified' && (
                      <span style={{
                        color: '#10b981',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>✓</span>
                    )}
                  </div>
                )}

                {/* Phone */}
                {(contact.phone_mobile || contact.phone_direct || contact.phone) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Phone className="w-4 h-4" style={{ color: '#6b7280', flexShrink: 0 }} />
                    <a
                      href={`tel:${contact.phone_mobile || contact.phone_direct || contact.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: '0.875rem',
                        color: '#3b82f6',
                        textDecoration: 'none'
                      }}
                    >
                      {contact.phone_mobile ? `M: ${contact.phone_mobile}` :
                       contact.phone_direct ? `D: ${contact.phone_direct}` :
                       contact.phone}
                    </a>
                  </div>
                )}

                {/* Added Date */}
                {contact.addedAt && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Calendar className="w-4 h-4" style={{ color: '#6b7280', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                      Added {new Date(contact.addedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {contact.linkedin_url && (
                  <a
                    href={contact.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      padding: '0.625rem 1rem',
                      background: 'rgba(59, 130, 246, 0.08)',
                      border: '1.5px solid rgba(59, 130, 246, 0.25)',
                      color: '#60a5fa',
                      borderRadius: '10px',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      textDecoration: 'none'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                      e.currentTarget.style.borderColor = '#3b82f6';
                      e.currentTarget.style.color = '#3b82f6';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.25)';
                      e.currentTarget.style.color = '#60a5fa';
                    }}
                  >
                    <Linkedin className="w-4 h-4" />
                    <span>LinkedIn</span>
                  </a>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadVCard(contact);
                  }}
                  style={{
                    flex: contact.linkedin_url ? 0 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.625rem 1rem',
                    background: 'rgba(139, 92, 246, 0.08)',
                    border: '1.5px solid rgba(139, 92, 246, 0.25)',
                    color: '#a78bfa',
                    borderRadius: '10px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                    e.currentTarget.style.borderColor = '#a78bfa';
                    e.currentTarget.style.color = '#8b5cf6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(139, 92, 246, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)';
                    e.currentTarget.style.color = '#a78bfa';
                  }}
                >
                  <Smartphone className="w-4 h-4" />
                  {!contact.linkedin_url && <span>Save vCard</span>}
                </button>
              </div>
            </div>
          );
        })}
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

      {/* Contact Snapshot */}
      {selectedContact && (
        <ContactSnapshot
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdate={handleContactUpdate}
          context="leads"
        />
      )}
    </div>
  );
}
