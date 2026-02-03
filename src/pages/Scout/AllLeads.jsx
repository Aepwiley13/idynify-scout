import { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, Mail, Linkedin, Search, Download,
  Phone, X, Smartphone, MoreVertical,
  Archive, Sparkles, Send, CheckCircle, Zap,
  RefreshCcw, RotateCcw, Target
} from 'lucide-react';
import ContactSnapshot from '../../components/contacts/ContactSnapshot';
import HunterContactDrawer from '../../components/hunter/HunterContactDrawer';
import { downloadVCard } from '../../utils/vcard';
import './AllLeads.css';

// ── Helpers ──────────────────────────────────────────────

function getLeadStatus(contact) {
  const s = contact.lead_status || contact.status;
  if (!s || s === 'saved' || s === 'pending_enrichment' || s === 'active' || s === 'exported') return 'active';
  if (s === 'contacted') return 'engaged';
  return s; // archived, engaged, converted
}

function getReadiness(contact) {
  const hasEmail = !!(contact.email || contact.work_email);
  const hasPhone = !!(contact.phone_mobile || contact.phone_direct || contact.phone);
  const hasLinkedIn = !!contact.linkedin_url;
  if (hasEmail && hasPhone && hasLinkedIn) return 'ready';
  if (hasEmail) return 'partial';
  return 'needs-enrichment';
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return date.toLocaleDateString();
}

function getLastTouched(contact) {
  // Check activity log for latest event
  if (contact.activity_log && contact.activity_log.length > 0) {
    const sorted = [...contact.activity_log].sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    const latest = sorted[0];
    const time = formatRelativeTime(latest.timestamp);
    if (time) {
      const labels = {
        enriched: 'Enriched',
        email_sent: 'Emailed',
        email_drafted: 'Drafted email',
        note_added: 'Note added',
        profile_viewed: 'Viewed',
        contact_created: 'Added',
        status_changed: 'Updated'
      };
      return `${labels[latest.type] || 'Activity'} ${time}`;
    }
  }
  if (contact.last_enriched_at) {
    const time = formatRelativeTime(contact.last_enriched_at);
    if (time) return `Enriched ${time}`;
  }
  const savedAt = contact.saved_at || contact.addedAt;
  if (savedAt) {
    const time = formatRelativeTime(typeof savedAt === 'object' && savedAt.toDate ? savedAt.toDate().toISOString() : savedAt);
    if (time) return `Added ${time}`;
  }
  return null;
}

// ── Component ────────────────────────────────────────────

export default function AllLeads() {
  const navigate = useNavigate();

  // Core data
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);

  // Filters & sort
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('readiness');
  const [sortOrder, setSortOrder] = useState('desc');
  const [statusFilter, setStatusFilter] = useState('active');
  const [dataFilter, setDataFilter] = useState(null);

  // Selection & interaction
  const [selectedContact, setSelectedContact] = useState(null);
  const [hunterContact, setHunterContact] = useState(null);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(null);

  // ── Data Loading ─────────────────────────────────────

  useEffect(() => { loadAllContacts(); }, []);

  // Close three-dot menu on outside click
  useEffect(() => {
    if (!menuOpenFor) return;
    function handleClick(e) {
      if (!e.target.closest('.card-menu')) setMenuOpenFor(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpenFor]);

  async function loadAllContacts() {
    try {
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }

      const userId = user.uid;
      const companiesSnapshot = await getDocs(collection(db, 'users', userId, 'companies'));
      const companiesMap = {};
      companiesSnapshot.docs.forEach(d => { companiesMap[d.id] = d.data(); });
      setCompanies(companiesMap);

      const contactsSnapshot = await getDocs(collection(db, 'users', userId, 'contacts'));
      const contactsList = contactsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setContacts(contactsList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      setLoading(false);
    }
  }

  // ── Status Management ────────────────────────────────

  async function handleStatusChange(contactId, newStatus) {
    setStatusUpdateLoading(contactId);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);
      await updateDoc(contactRef, {
        lead_status: newStatus,
        updated_at: new Date().toISOString(),
        activity_log: arrayUnion({
          type: 'status_changed',
          to: newStatus,
          timestamp: new Date().toISOString(),
          details: `Lead status changed to ${newStatus}`
        })
      });
      setContacts(prev => prev.map(c =>
        c.id === contactId ? { ...c, lead_status: newStatus } : c
      ));
      setMenuOpenFor(null);
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setStatusUpdateLoading(null);
    }
  }

  async function handleBulkStatusChange(newStatus) {
    if (selectedContactIds.length === 0) return;
    setStatusUpdateLoading('bulk');
    try {
      const user = auth.currentUser;
      if (!user) return;
      const promises = selectedContactIds.map(id => {
        const ref = doc(db, 'users', user.uid, 'contacts', id);
        return updateDoc(ref, {
          lead_status: newStatus,
          updated_at: new Date().toISOString(),
          activity_log: arrayUnion({
            type: 'status_changed',
            to: newStatus,
            timestamp: new Date().toISOString(),
            details: `Lead ${newStatus} via bulk action`
          })
        });
      });
      await Promise.all(promises);
      setContacts(prev => prev.map(c =>
        selectedContactIds.includes(c.id) ? { ...c, lead_status: newStatus } : c
      ));
      setSelectedContactIds([]);
    } catch (error) {
      console.error('Failed to bulk update status:', error);
    } finally {
      setStatusUpdateLoading(null);
    }
  }

  // ── Contact Updates ──────────────────────────────────

  function handleContactUpdate(updatedContact) {
    setContacts(prev =>
      prev.map(c => c.id === updatedContact.id ? { ...c, ...updatedContact } : c)
    );
    setSelectedContact(null);
  }

  // ── Selection ────────────────────────────────────────

  function toggleContactSelection(contactId, e) {
    e.stopPropagation();
    setSelectedContactIds(prev =>
      prev.includes(contactId) ? prev.filter(id => id !== contactId) : [...prev, contactId]
    );
  }

  function toggleSelectAll() {
    if (selectedContactIds.length === finalContacts.length) {
      setSelectedContactIds([]);
    } else {
      setSelectedContactIds(finalContacts.map(c => c.id));
    }
  }

  // ── Actions ──────────────────────────────────────────

  function handleStartMission(contactIds) {
    navigate(`/hunter/create?contactIds=${contactIds.join(',')}`);
  }

  function handleCardClick(contact) {
    setSelectedContact(contact);
  }

  function exportToCSV(contactsToExport) {
    const list = contactsToExport || finalContacts;
    if (list.length === 0) return;

    const headers = [
      'Name', 'Title', 'Company', 'Email', 'Email Status', 'Email Confidence',
      'Mobile Phone', 'Direct Line', 'Work Phone', 'LinkedIn',
      'Seniority', 'Department', 'Lead Status', 'Added Date', 'Last Enriched'
    ];

    const rows = list.map(contact => {
      const company = companies[contact.company_id];
      return [
        contact.name || '', contact.title || '', company?.name || '',
        contact.email || '', contact.email_status || '', contact.email_confidence || '',
        contact.phone_mobile || '', contact.phone_direct || '', contact.phone_work || '',
        contact.linkedin_url || '', contact.seniority || '',
        contact.departments?.[0] || contact.department || '',
        getLeadStatus(contact),
        contact.saved_at ? new Date(contact.saved_at).toLocaleDateString() : '',
        contact.last_enriched_at ? new Date(contact.last_enriched_at).toLocaleDateString() : ''
      ].map(f => `"${f}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scout-leads-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // ── Computed Data ────────────────────────────────────

  // Status counts (across ALL contacts)
  const statusCounts = contacts.reduce((acc, c) => {
    const s = getLeadStatus(c);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { active: 0, engaged: 0, archived: 0, converted: 0 });

  // Filter pipeline
  let filtered = contacts;

  // 1. Status filter
  filtered = filtered.filter(c => getLeadStatus(c) === statusFilter);

  // 2. Data filter
  if (dataFilter === 'needs-email') {
    filtered = filtered.filter(c => !(c.email || c.work_email));
  } else if (dataFilter === 'has-email') {
    filtered = filtered.filter(c => !!(c.email || c.work_email));
  } else if (dataFilter === 'needs-phone') {
    filtered = filtered.filter(c => !(c.phone_mobile || c.phone_direct || c.phone));
  }

  // 3. Search filter
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    filtered = filtered.filter(c => {
      const company = companies[c.company_id];
      return (
        (c.name || '').toLowerCase().includes(lower) ||
        (c.title || '').toLowerCase().includes(lower) ||
        (company?.name || '').toLowerCase().includes(lower) ||
        (c.email || '').toLowerCase().includes(lower)
      );
    });
  }

  // 4. Sort
  const finalContacts = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'readiness') {
      const order = { 'ready': 3, 'partial': 2, 'needs-enrichment': 1 };
      cmp = (order[getReadiness(a)] || 0) - (order[getReadiness(b)] || 0);
    } else if (sortBy === 'name') {
      cmp = (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'company') {
      cmp = (companies[a.company_id]?.name || '').localeCompare(companies[b.company_id]?.name || '');
    } else if (sortBy === 'date') {
      cmp = (a.addedAt || 0) - (b.addedAt || 0);
    } else if (sortBy === 'email-quality') {
      const order = { 'verified': 3, 'likely': 2, 'unverified': 1 };
      cmp = (order[a.email_status] || 0) - (order[b.email_status] || 0);
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  // KPIs (pipeline = non-archived)
  const pipelineContacts = contacts.filter(c => getLeadStatus(c) !== 'archived');
  const totalPipeline = pipelineContacts.length;
  const uniqueCompanies = new Set(pipelineContacts.map(c => c.company_id)).size;
  const withEmail = pipelineContacts.filter(c => c.email || c.work_email).length;
  const verifiedEmails = pipelineContacts.filter(c => c.email_status === 'verified').length;
  const withPhone = pipelineContacts.filter(c => c.phone_mobile || c.phone_direct || c.phone).length;
  const emailRate = totalPipeline > 0 ? Math.round((withEmail / totalPipeline) * 100) : 0;
  const phoneRate = totalPipeline > 0 ? Math.round((withPhone / totalPipeline) * 100) : 0;
  const needsEnrichmentCount = pipelineContacts.filter(c => !(c.email || c.work_email)).length;

  // ── Render ───────────────────────────────────────────

  if (loading) {
    return (
      <div className="all-leads-loading">
        <div className="loading-spinner" />
        <p className="loading-text">Loading your pipeline...</p>
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
      {/* ── Header ─────────────────────────────────── */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">All Leads</h1>
          <p className="page-subtitle">Your pipeline. Ready to engage.</p>
        </div>
      </div>

      {/* ── KPI Summary ────────────────────────────── */}
      <div className="kpi-summary">
        <div
          className={`kpi-card ${!dataFilter ? 'kpi-active' : ''}`}
          onClick={() => setDataFilter(null)}
          style={{ cursor: 'pointer' }}
        >
          <div className="kpi-icon-wrapper">
            <Users className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Pipeline</p>
            <p className="kpi-value">{totalPipeline}</p>
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

        <div
          className={`kpi-card ${dataFilter === 'needs-email' ? 'kpi-active' : ''}`}
          onClick={() => {
            setDataFilter(dataFilter === 'needs-email' ? null : 'needs-email');
            if (statusFilter === 'archived') setStatusFilter('active');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="kpi-icon-wrapper">
            <Mail className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Email Coverage</p>
            <p className="kpi-value">{emailRate}%</p>
            <p className="kpi-detail">{verifiedEmails} verified &middot; {needsEnrichmentCount} need email</p>
            <div className="kpi-progress-bar">
              <div className="kpi-progress-fill" style={{ width: `${emailRate}%` }} />
            </div>
          </div>
        </div>

        <div
          className={`kpi-card ${dataFilter === 'needs-phone' ? 'kpi-active' : ''}`}
          onClick={() => {
            setDataFilter(dataFilter === 'needs-phone' ? null : 'needs-phone');
            if (statusFilter === 'archived') setStatusFilter('active');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="kpi-icon-wrapper">
            <Phone className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Phone Coverage</p>
            <p className="kpi-value">{phoneRate}%</p>
            <p className="kpi-detail">{withPhone} contacts</p>
            <div className="kpi-progress-bar">
              <div className="kpi-progress-fill" style={{ width: `${phoneRate}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Status Tabs ────────────────────────────── */}
      <div className="status-tabs">
        {[
          { key: 'active', label: 'Active' },
          { key: 'engaged', label: 'Engaged' },
          { key: 'archived', label: 'Archived' },
          { key: 'converted', label: 'Converted' }
        ].map(tab => (
          <button
            key={tab.key}
            className={`status-tab ${statusFilter === tab.key ? 'status-tab-active' : ''}`}
            onClick={() => {
              setStatusFilter(tab.key);
              setSelectedContactIds([]);
              setDataFilter(null);
            }}
          >
            {tab.label}
            <span className="tab-count">{statusCounts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* ── Controls ───────────────────────────────── */}
      <div className="controls-section">
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
            <button className="clear-search-btn" onClick={() => setSearchTerm('')}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="sort-controls">
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="readiness">Sort by Readiness</option>
            <option value="date">Sort by Date Added</option>
            <option value="name">Sort by Name</option>
            <option value="company">Sort by Company</option>
            <option value="email-quality">Sort by Email Quality</option>
          </select>

          <button
            className="sort-order-btn"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            {sortOrder === 'asc' ? '\u2191' : '\u2193'}
          </button>

          <button className="export-btn" onClick={() => exportToCSV()}>
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── Data Filter Chips ──────────────────────── */}
      <div className="data-filters">
        <button
          className={`filter-chip ${dataFilter === 'has-email' ? 'filter-chip-active' : ''}`}
          onClick={() => setDataFilter(dataFilter === 'has-email' ? null : 'has-email')}
        >
          <Mail className="w-3.5 h-3.5" /> Has Email
        </button>
        <button
          className={`filter-chip filter-chip-warn ${dataFilter === 'needs-email' ? 'filter-chip-active' : ''}`}
          onClick={() => setDataFilter(dataFilter === 'needs-email' ? null : 'needs-email')}
        >
          <Sparkles className="w-3.5 h-3.5" /> Needs Email
          {needsEnrichmentCount > 0 && <span className="chip-count">{needsEnrichmentCount}</span>}
        </button>
        <button
          className={`filter-chip ${dataFilter === 'needs-phone' ? 'filter-chip-active' : ''}`}
          onClick={() => setDataFilter(dataFilter === 'needs-phone' ? null : 'needs-phone')}
        >
          <Phone className="w-3.5 h-3.5" /> Needs Phone
        </button>
        {dataFilter && (
          <button className="filter-chip-clear" onClick={() => setDataFilter(null)}>
            <X className="w-3.5 h-3.5" /> Clear Filter
          </button>
        )}
      </div>

      {/* ── Bulk Actions Bar ───────────────────────── */}
      {selectedContactIds.length > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-left">
            <span className="bulk-count">
              {selectedContactIds.length} selected
            </span>
            <button className="bulk-clear" onClick={() => setSelectedContactIds([])}>
              Clear
            </button>
          </div>
          <div className="bulk-right">
            {statusFilter === 'archived' ? (
              <button
                className="bulk-btn bulk-restore"
                onClick={() => handleBulkStatusChange('active')}
                disabled={statusUpdateLoading === 'bulk'}
              >
                <RotateCcw className="w-4 h-4" />
                {statusUpdateLoading === 'bulk' ? 'Restoring...' : 'Restore'}
              </button>
            ) : (
              <button
                className="bulk-btn bulk-archive"
                onClick={() => handleBulkStatusChange('archived')}
                disabled={statusUpdateLoading === 'bulk'}
              >
                <Archive className="w-4 h-4" />
                {statusUpdateLoading === 'bulk' ? 'Archiving...' : 'Archive'}
              </button>
            )}
            <button
              className="bulk-btn bulk-export"
              onClick={() => {
                const selected = finalContacts.filter(c => selectedContactIds.includes(c.id));
                exportToCSV(selected);
              }}
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <button
              className="bulk-btn bulk-engage"
              onClick={() => handleStartMission(selectedContactIds)}
            >
              <Send className="w-4 h-4" />
              Start Mission ({selectedContactIds.length})
            </button>
          </div>
        </div>
      )}

      {/* ── Results Count + Select All ─────────────── */}
      <div className="results-bar">
        <label className="select-all-label">
          <input
            type="checkbox"
            checked={finalContacts.length > 0 && selectedContactIds.length === finalContacts.length}
            onChange={toggleSelectAll}
          />
          <span>Select All</span>
        </label>
        <span className="results-count-text">
          Showing {finalContacts.length} of {contacts.length} contacts
          {searchTerm && ` matching "${searchTerm}"`}
          {dataFilter && ` \u00B7 Filtered`}
        </span>
      </div>

      {/* ── Archived Banner ────────────────────────── */}
      {statusFilter === 'archived' && finalContacts.length > 0 && (
        <div className="archived-banner">
          <Archive className="w-4 h-4" />
          <span>These leads are archived. You can restore them at any time.</span>
        </div>
      )}

      {/* ── Contacts Grid ──────────────────────────── */}
      <div className="leads-grid">
        {finalContacts.map(contact => {
          const company = companies[contact.company_id];
          const isSelected = selectedContactIds.includes(contact.id);
          const backgroundImage = contact.photo_url || '/barry.png';
          const readiness = getReadiness(contact);
          const hasEmail = !!(contact.email || contact.work_email);
          const lastTouched = getLastTouched(contact);
          const currentStatus = getLeadStatus(contact);
          const isUpdating = statusUpdateLoading === contact.id;

          return (
            <div key={contact.id} className={`lead-card ${isSelected ? 'lead-card-selected' : ''}`}>
              {/* ── Photo Section ──────────────────── */}
              <div
                className="lead-card-photo"
                onClick={() => handleCardClick(contact)}
                style={{ backgroundImage: `url(${backgroundImage})` }}
              >
                {/* Top Right: Checkbox + Menu */}
                <div className="card-top-actions" onClick={e => e.stopPropagation()}>
                  <div
                    className={`card-checkbox ${isSelected ? 'card-checkbox-checked' : ''}`}
                    onClick={(e) => toggleContactSelection(contact.id, e)}
                  >
                    {isSelected && <CheckCircle className="w-4 h-4" />}
                  </div>

                  {/* Three-dot menu */}
                  <div className="card-menu">
                    <button
                      className="menu-trigger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenFor(menuOpenFor === contact.id ? null : contact.id);
                      }}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpenFor === contact.id && (
                      <div className="menu-dropdown">
                        {currentStatus !== 'engaged' && (
                          <button
                            className="menu-item"
                            onClick={() => handleStatusChange(contact.id, 'engaged')}
                            disabled={isUpdating}
                          >
                            <Send className="w-4 h-4" /> Mark Engaged
                          </button>
                        )}
                        {currentStatus !== 'converted' && (
                          <button
                            className="menu-item"
                            onClick={() => handleStatusChange(contact.id, 'converted')}
                            disabled={isUpdating}
                          >
                            <CheckCircle className="w-4 h-4" /> Mark Converted
                          </button>
                        )}
                        <button
                          className="menu-item"
                          onClick={() => { downloadVCard(contact); setMenuOpenFor(null); }}
                        >
                          <Smartphone className="w-4 h-4" /> Save vCard
                        </button>
                        <div className="menu-divider" />
                        {currentStatus === 'archived' ? (
                          <button
                            className="menu-item menu-restore"
                            onClick={() => handleStatusChange(contact.id, 'active')}
                            disabled={isUpdating}
                          >
                            <RotateCcw className="w-4 h-4" /> Restore Lead
                          </button>
                        ) : (
                          <button
                            className="menu-item menu-danger"
                            onClick={() => handleStatusChange(contact.id, 'archived')}
                            disabled={isUpdating}
                          >
                            <Archive className="w-4 h-4" /> Archive Lead
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Gradient + Contact Info */}
                <div className="card-gradient-overlay">
                  <p className="card-name">{contact.name || 'Unknown'}</p>
                  <p className="card-title">{contact.title || 'Title not available'}</p>
                  {company?.name && (
                    <span className="card-company-badge">{company.name}</span>
                  )}
                </div>
              </div>

              {/* ── Info Section ───────────────────── */}
              <div className="lead-card-info">
                {/* Email Row */}
                {hasEmail ? (
                  <div className="info-row">
                    <Mail className="w-4 h-4 info-icon" />
                    <a
                      href={`mailto:${contact.email}`}
                      onClick={e => e.stopPropagation()}
                      className="info-email-link"
                    >
                      {contact.email}
                    </a>
                    {contact.email_status && (
                      <span className={`email-status-pill email-status-${contact.email_status}`}>
                        {contact.email_status}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="info-row info-row-missing">
                    <Mail className="w-4 h-4 info-icon" />
                    <span className="missing-label">No email found</span>
                    <button
                      className="enrich-inline-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/scout/contact/${contact.id}`);
                      }}
                    >
                      <Sparkles className="w-3 h-3" /> Enrich
                    </button>
                  </div>
                )}

                {/* Phone Row */}
                {(contact.phone_mobile || contact.phone_direct || contact.phone) ? (
                  <div className="info-row">
                    <Phone className="w-4 h-4 info-icon" />
                    <a
                      href={`tel:${contact.phone_mobile || contact.phone_direct || contact.phone}`}
                      onClick={e => e.stopPropagation()}
                      className="info-phone-link"
                    >
                      {contact.phone_mobile ? `M: ${contact.phone_mobile}` :
                       contact.phone_direct ? `D: ${contact.phone_direct}` :
                       contact.phone}
                    </a>
                  </div>
                ) : (
                  <div className="info-row info-row-missing">
                    <Phone className="w-4 h-4 info-icon" />
                    <span className="missing-label">No phone</span>
                  </div>
                )}

                {/* Last Touched */}
                {lastTouched && (
                  <div className="info-row info-row-subtle">
                    <Zap className="w-3.5 h-3.5 info-icon" />
                    <span className="last-touched">{lastTouched}</span>
                  </div>
                )}
              </div>

              {/* ── Actions ────────────────────────── */}
              <div className="lead-card-actions">
                {/* Primary: Engage button */}
                <button
                  className="action-btn action-hunter"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHunterContact(contact);
                  }}
                >
                  <Target className="w-5 h-5" />
                  <span>Engage</span>
                </button>

                {/* Enrich button if no email */}
                {!hasEmail && (
                  <button
                    className="action-btn action-enrich-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/scout/contact/${contact.id}`);
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Enrich</span>
                  </button>
                )}

                {/* Secondary: LinkedIn */}
                {contact.linkedin_url && (
                  <a
                    href={contact.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="action-btn action-linkedin"
                  >
                    <Linkedin className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── No Results ─────────────────────────────── */}
      {finalContacts.length === 0 && (
        <div className="no-results">
          {searchTerm ? (
            <>
              <Search className="w-12 h-12" style={{ color: '#9ca3af', marginBottom: '1rem' }} />
              <h3>No contacts found</h3>
              <p>No contacts match your search for &ldquo;{searchTerm}&rdquo;</p>
              <button className="clear-btn" onClick={() => setSearchTerm('')}>Clear Search</button>
            </>
          ) : dataFilter ? (
            <>
              <Sparkles className="w-12 h-12" style={{ color: '#f59e0b', marginBottom: '1rem' }} />
              <h3>No matching contacts</h3>
              <p>No {statusFilter} contacts match the current filter.</p>
              <button className="clear-btn" onClick={() => setDataFilter(null)}>Clear Filter</button>
            </>
          ) : (
            <>
              <CheckCircle className="w-12 h-12" style={{ color: '#10b981', marginBottom: '1rem' }} />
              <h3>
                {statusFilter === 'archived' && 'No archived leads'}
                {statusFilter === 'engaged' && 'No engaged leads yet'}
                {statusFilter === 'converted' && 'No converted leads yet'}
                {statusFilter === 'active' && 'All clear'}
              </h3>
              <p>
                {statusFilter === 'archived' && 'Leads you archive will appear here.'}
                {statusFilter === 'engaged' && 'Mark leads as engaged when you start outreach.'}
                {statusFilter === 'converted' && 'Mark leads as converted when they become customers.'}
                {statusFilter === 'active' && 'No active leads found.'}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Contact Snapshot Modal ─────────────────── */}
      {selectedContact && (
        <ContactSnapshot
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdate={handleContactUpdate}
          context="leads"
        />
      )}

      {/* ── Hunter Contact Drawer ──────────────────── */}
      {hunterContact && (
        <HunterContactDrawer
          contact={hunterContact}
          isOpen={!!hunterContact}
          onClose={() => setHunterContact(null)}
          onContactUpdate={handleContactUpdate}
        />
      )}
    </div>
  );
}
