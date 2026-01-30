import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import TitleSelectionModal from '../../components/TitleSelectionModal';
import CompanyDetailModal from '../../components/scout/CompanyDetailModal';
import CompanyLogo from '../../components/scout/CompanyLogo';
import { Building2, Users, CheckCircle, TrendingUp, Search, Globe, Linkedin, ChevronRight, Target, DollarSign, Calendar, MapPin, Briefcase, Archive, RotateCcw } from 'lucide-react';
import './SavedCompanies.css';

// Company Card Component matching Daily Leads design
function CompanyCard({ company, onClick, onArchive, onRestore, isArchived }) {

  return (
    <div className={`saved-company-card ${isArchived ? 'archived' : ''}`} onClick={onClick}>
      {/* Contact Badge */}
      {company.contact_count > 0 && (
        <div className="contact-badge">
          <CheckCircle className="w-3 h-3" />
          <span>{company.contact_count} contact{company.contact_count !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Archived Badge */}
      {isArchived && (
        <div className="archived-badge">
          <Archive className="w-3 h-3" />
          <span>Archived</span>
        </div>
      )}

      {/* Company Header with Logo */}
      <div className="saved-card-header">
        {/* Robust multi-source logo */}
        <CompanyLogo company={company} size="default" />
        <div className="saved-company-info">
          <h3 className="saved-company-name">{company.name || 'Unknown Company'}</h3>
          <p className="saved-company-industry">{company.industry || 'Industry not specified'}</p>
        </div>
      </div>

      {/* Stats Grid - Matching Daily Leads */}
      <div className="saved-stats-grid">
        {/* Industry */}
        <div className="saved-stat-item">
          <div className="saved-stat-icon">
            <Briefcase className="w-5 h-5 text-gray-500" />
          </div>
          <div className="saved-stat-content">
            <p className="saved-stat-label">Industry</p>
            <p className="saved-stat-value">{company.industry || 'Not available'}</p>
          </div>
        </div>

        {/* Employees */}
        <div className="saved-stat-item">
          <div className="saved-stat-icon">
            <Users className="w-5 h-5 text-gray-500" />
          </div>
          <div className="saved-stat-content">
            <p className="saved-stat-label">Employees</p>
            <p className="saved-stat-value">{company.employee_count || company.company_size || 'Not available'}</p>
          </div>
        </div>

        {/* Revenue */}
        {company.revenue && (
          <div className="saved-stat-item">
            <div className="saved-stat-icon">
              <DollarSign className="w-5 h-5 text-gray-500" />
            </div>
            <div className="saved-stat-content">
              <p className="saved-stat-label">Revenue</p>
              <p className="saved-stat-value">{company.revenue}</p>
            </div>
          </div>
        )}

        {/* Founded */}
        {company.founded_year && (
          <div className="saved-stat-item">
            <div className="saved-stat-icon">
              <Calendar className="w-5 h-5 text-gray-500" />
            </div>
            <div className="saved-stat-content">
              <p className="saved-stat-label">Founded</p>
              <p className="saved-stat-value">{company.founded_year}</p>
            </div>
          </div>
        )}

        {/* Location */}
        {company.location && (
          <div className="saved-stat-item">
            <div className="saved-stat-icon">
              <MapPin className="w-5 h-5 text-gray-500" />
            </div>
            <div className="saved-stat-content">
              <p className="saved-stat-label">Location</p>
              <p className="saved-stat-value">{company.location}</p>
            </div>
          </div>
        )}
      </div>

      {/* Quick Links - Matching Daily Leads */}
      <div className="saved-quick-links">
        {company.website_url && (
          <button
            className="saved-quick-link website"
            onClick={(e) => {
              e.stopPropagation();
              // Check if mobile device
              const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
              if (isMobile || company.website_url.toLowerCase().startsWith('http://')) {
                const anchor = document.createElement('a');
                anchor.href = company.website_url;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
              } else {
                window.open(company.website_url, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            <Globe className="w-4 h-4" />
            <span>Visit Website</span>
          </button>
        )}
        {company.linkedin_url && (
          <button
            className="saved-quick-link linkedin"
            onClick={(e) => {
              e.stopPropagation();
              // Check if mobile device
              const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
              if (isMobile || company.linkedin_url.toLowerCase().startsWith('http://')) {
                const anchor = document.createElement('a');
                anchor.href = company.linkedin_url;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
              } else {
                window.open(company.linkedin_url, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            <Linkedin className="w-4 h-4" />
            <span>LinkedIn</span>
          </button>
        )}
      </div>

      {/* Action Buttons */}
      <div className="saved-card-actions">
        <button className="saved-view-details-btn">
          <span>{company.contact_count > 0 ? 'View Contacts' : 'Find Contacts'}</span>
          <ChevronRight className="w-4 h-4" />
        </button>
        {isArchived ? (
          <button
            className="saved-restore-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRestore(company);
            }}
            title="Restore company"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        ) : (
          <button
            className="saved-archive-btn"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(company);
            }}
            title="Archive company"
          >
            <Archive className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function SavedCompanies() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [archivedCompanies, setArchivedCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('active'); // 'active' or 'archived'

  useEffect(() => {
    loadSavedCompanies();
  }, []);

  useEffect(() => {
    // Filter companies based on search term and active tab
    const sourceList = activeTab === 'active' ? companies : archivedCompanies;
    if (searchTerm.trim() === '') {
      setFilteredCompanies(sourceList);
    } else {
      const filtered = sourceList.filter(company =>
        company.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        company.industry?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCompanies(filtered);
    }
  }, [searchTerm, companies, archivedCompanies, activeTab]);

  async function loadSavedCompanies() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;
      console.log('Loading saved companies for user:', userId);

      // Get ACCEPTED companies
      const companiesQuery = query(
        collection(db, 'users', userId, 'companies'),
        where('status', '==', 'accepted')
      );
      const companiesSnapshot = await getDocs(companiesQuery);

      // Get ARCHIVED companies
      const archivedQuery = query(
        collection(db, 'users', userId, 'companies'),
        where('status', '==', 'archived')
      );
      const archivedSnapshot = await getDocs(archivedQuery);

      console.log('Found accepted companies:', companiesSnapshot.size);
      console.log('Found archived companies:', archivedSnapshot.size);

      // Helper to enrich company docs with contact counts
      async function enrichWithContactCounts(snapshot) {
        return Promise.all(
          snapshot.docs.map(async (companyDoc) => {
            const company = { id: companyDoc.id, ...companyDoc.data() };
            try {
              const contactsQuery = query(
                collection(db, 'users', userId, 'contacts'),
                where('company_id', '==', company.id)
              );
              const contactsSnapshot = await getDocs(contactsQuery);
              return { ...company, contact_count: contactsSnapshot.size };
            } catch {
              return { ...company, contact_count: 0 };
            }
          })
        );
      }

      const companiesList = await enrichWithContactCounts(companiesSnapshot);
      const archivedList = await enrichWithContactCounts(archivedSnapshot);

      setCompanies(companiesList);
      setArchivedCompanies(archivedList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load saved companies:', error);
      setLoading(false);
    }
  }

  // Archive a company
  async function handleArchiveCompany(company) {
    try {
      const userId = auth.currentUser.uid;
      const companyRef = doc(db, 'users', userId, 'companies', company.id);

      await updateDoc(companyRef, {
        status: 'archived',
        archived_at: new Date().toISOString(),
        activity_log: arrayUnion({
          type: 'status_changed',
          from: 'accepted',
          to: 'archived',
          timestamp: new Date().toISOString()
        })
      });

      // Move from active to archived in local state
      setCompanies(prev => prev.filter(c => c.id !== company.id));
      setArchivedCompanies(prev => [...prev, { ...company, status: 'archived' }]);

      console.log('Company archived:', company.name);
    } catch (error) {
      console.error('Failed to archive company:', error);
      alert('Failed to archive company. Please try again.');
    }
  }

  // Restore an archived company
  async function handleRestoreCompany(company) {
    try {
      const userId = auth.currentUser.uid;
      const companyRef = doc(db, 'users', userId, 'companies', company.id);

      await updateDoc(companyRef, {
        status: 'accepted',
        archived_at: null,
        activity_log: arrayUnion({
          type: 'status_changed',
          from: 'archived',
          to: 'accepted',
          timestamp: new Date().toISOString()
        })
      });

      // Move from archived to active in local state
      setArchivedCompanies(prev => prev.filter(c => c.id !== company.id));
      setCompanies(prev => [...prev, { ...company, status: 'accepted' }]);

      console.log('Company restored:', company.name);
    } catch (error) {
      console.error('Failed to restore company:', error);
      alert('Failed to restore company. Please try again.');
    }
  }

  // Handle company click - navigate directly to company profile
  function handleCompanyClick(company) {
    navigate(`/scout/company/${company.id}`);
  }

  // Handle detail modal close
  function handleDetailModalClose() {
    setShowDetailModal(false);

    // After closing detail modal, check if user wants to find contacts
    // If company doesn't have titles yet, show title modal
    if (selectedCompany) {
      const hasTitles = selectedCompany.selected_titles && selectedCompany.selected_titles.length > 0;

      if (hasTitles) {
        // Already has titles, go straight to company detail
        navigate(`/scout/company/${selectedCompany.id}`);
      } else {
        // First time, show title selection modal
        setShowTitleModal(true);
      }
    }
  }

  // Handle titles selected from modal
  function handleTitlesSelected(titles) {
    setShowTitleModal(false);
    // Navigate to company detail page
    if (selectedCompany) {
      navigate(`/scout/company/${selectedCompany.id}`);
    }
  }

  // Calculate KPIs
  const totalContacts = companies.reduce((sum, c) => sum + (c.contact_count || 0), 0);
  const companiesWithContacts = companies.filter(c => c.contact_count > 0).length;
  const completionRate = companies.length > 0
    ? Math.round((companiesWithContacts / companies.length) * 100)
    : 0;

  if (loading) {
    return (
      <div className="saved-companies-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading your matched companies...</p>
      </div>
    );
  }

  if (companies.length === 0 && archivedCompanies.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Building2 className="w-16 h-16 text-gray-400" />
        </div>
        <h2>No Matched Companies Yet</h2>
        <p>Companies you match with will appear here</p>
        <p className="empty-hint">Go to Daily Leads and match with companies you want to target!</p>
        <button
          onClick={() => navigate('/scout', { state: { activeTab: 'daily-leads' } })}
          className="empty-action-btn"
        >
          <Target className="w-5 h-5" />
          <span>Start Matching Companies</span>
        </button>
      </div>
    );
  }

  return (
    <div className="saved-companies">
      {/* Enterprise Header */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">Matched Companies</h1>
          <p className="page-subtitle">Companies you've matched with and their contact status</p>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="kpi-summary">
        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <Building2 className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Total Companies</p>
            <p className="kpi-value">{companies.length}</p>
          </div>
        </div>

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
            <CheckCircle className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">With Contacts</p>
            <p className="kpi-value">{companiesWithContacts}</p>
          </div>
        </div>

        <div className="kpi-card highlight">
          <div className="kpi-icon-wrapper">
            <TrendingUp className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Completion Rate</p>
            <p className="kpi-value">{completionRate}%</p>
            <div className="kpi-progress-bar">
              <div
                className="kpi-progress-fill"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs: Active / Archived */}
      <div className="companies-tabs">
        <button
          className={`companies-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => { setActiveTab('active'); setSearchTerm(''); }}
        >
          <Building2 className="w-4 h-4" />
          <span>Active ({companies.length})</span>
        </button>
        <button
          className={`companies-tab ${activeTab === 'archived' ? 'active' : ''}`}
          onClick={() => { setActiveTab('archived'); setSearchTerm(''); }}
        >
          <Archive className="w-4 h-4" />
          <span>Archived ({archivedCompanies.length})</span>
        </button>
      </div>

      {/* Archived info banner */}
      {activeTab === 'archived' && archivedCompanies.length > 0 && (
        <div className="archived-info-banner">
          <Archive className="w-4 h-4" />
          <span>Archived companies are hidden from your active pipeline. You can restore them at any time.</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="search-section">
        <div className="search-input-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search companies by name or industry..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="search-results-count">
          Showing {filteredCompanies.length} of {activeTab === 'active' ? companies.length : archivedCompanies.length} companies
        </div>
      </div>

      {/* Companies Grid */}
      <div className="companies-grid">
        {filteredCompanies.map(company => (
          <CompanyCard
            key={company.id}
            company={company}
            onClick={() => handleCompanyClick(company)}
            onArchive={handleArchiveCompany}
            onRestore={handleRestoreCompany}
            isArchived={activeTab === 'archived'}
          />
        ))}
      </div>

      {/* No Search Results */}
      {filteredCompanies.length === 0 && (activeTab === 'active' ? companies.length > 0 : archivedCompanies.length > 0) && (
        <div className="no-results">
          <Search className="w-12 h-12 text-gray-400 mb-4" />
          <h3>No companies found</h3>
          <p>Try adjusting your search term</p>
        </div>
      )}

      {/* Empty Archived State */}
      {activeTab === 'archived' && archivedCompanies.length === 0 && (
        <div className="no-results">
          <Archive className="w-12 h-12 text-gray-400 mb-4" />
          <h3>No archived companies</h3>
          <p>Companies you archive will appear here</p>
        </div>
      )}

      {/* Company Detail Modal */}
      {showDetailModal && selectedCompany && (
        <CompanyDetailModal
          company={selectedCompany}
          onClose={handleDetailModalClose}
        />
      )}

      {/* Title Selection Modal */}
      {showTitleModal && selectedCompany && (
        <TitleSelectionModal
          company={selectedCompany}
          onClose={() => setShowTitleModal(false)}
          onConfirm={handleTitlesSelected}
        />
      )}
    </div>
  );
}
