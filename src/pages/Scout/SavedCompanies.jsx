import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import TitleSelectionModal from '../../components/TitleSelectionModal';
import { Building2, Users, CheckCircle, TrendingUp, Search, Globe, Linkedin, ChevronRight, Target } from 'lucide-react';
import './SavedCompanies.css';

export default function SavedCompanies() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadSavedCompanies();
  }, []);

  useEffect(() => {
    // Filter companies based on search term
    if (searchTerm.trim() === '') {
      setFilteredCompanies(companies);
    } else {
      const filtered = companies.filter(company =>
        company.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        company.industry?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCompanies(filtered);
    }
  }, [searchTerm, companies]);

  async function loadSavedCompanies() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;
      console.log('🔍 Loading saved companies for user:', userId);

      // Get all ACCEPTED companies
      const companiesQuery = query(
        collection(db, 'users', userId, 'companies'),
        where('status', '==', 'accepted')
      );
      const companiesSnapshot = await getDocs(companiesQuery);

      console.log('📦 Found accepted companies:', companiesSnapshot.size);

      if (companiesSnapshot.empty) {
        console.log('⚠️ No accepted companies found. User needs to swipe right on companies first.');
        setCompanies([]);
        setFilteredCompanies([]);
        setLoading(false);
        return;
      }

      // For each company, count contacts
      const companiesList = await Promise.all(
        companiesSnapshot.docs.map(async (companyDoc) => {
          const company = { id: companyDoc.id, ...companyDoc.data() };

          try {
            const contactsQuery = query(
              collection(db, 'users', userId, 'contacts'),
              where('company_id', '==', company.id)
            );
            const contactsSnapshot = await getDocs(contactsQuery);

            return {
              ...company,
              contact_count: contactsSnapshot.size
            };
          } catch (error) {
            // Contacts collection might not exist yet
            return {
              ...company,
              contact_count: 0
            };
          }
        })
      );

      console.log('✅ Loaded companies:', companiesList.length);
      console.log('📊 Companies with contacts:', companiesList.filter(c => c.contact_count > 0).length);

      setCompanies(companiesList);
      setFilteredCompanies(companiesList);
      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to load saved companies:', error);
      setLoading(false);
    }
  }

  // Handle company click - show title modal or navigate to detail
  function handleCompanyClick(company) {
    // Check if titles already selected for this company
    const hasTitles = company.selected_titles && company.selected_titles.length > 0;

    if (hasTitles) {
      // Already has titles, go straight to company detail
      navigate(`/scout/company/${company.id}`);
    } else {
      // First time, show title selection modal
      setSelectedCompany(company);
      setShowTitleModal(true);
    }
  }

  // Handle titles selected from modal
  function handleTitlesSelected(titles) {
    setShowTitleModal(false);
    // Navigate to company detail page
    navigate(`/scout/company/${selectedCompany.id}`);
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

  if (companies.length === 0) {
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
          Showing {filteredCompanies.length} of {companies.length} companies
        </div>
      </div>

      {/* Companies Grid */}
      <div className="companies-grid">
        {filteredCompanies.map(company => (
          <div
            key={company.id}
            className="company-card"
            onClick={() => handleCompanyClick(company)}
          >
            {/* Contact Badge */}
            {company.contact_count > 0 && (
              <div className="contact-badge">
                <CheckCircle className="w-3 h-3" />
                <span>{company.contact_count} contact{company.contact_count !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* Company Header */}
            <div className="company-header">
              <div className="company-logo">
                {company.name ? company.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div className="company-title-section">
                <h3 className="company-name">{company.name || 'Unknown Company'}</h3>
                <p className="company-industry">{company.industry || 'Industry not specified'}</p>
              </div>
            </div>

            {/* Company Details */}
            <div className="company-stats">
              {company.revenue && (
                <div className="stat-pill">
                  <span className="stat-label">Revenue</span>
                  <span className="stat-value">{company.revenue}</span>
                </div>
              )}
              {company.founded_year && (
                <div className="stat-pill">
                  <span className="stat-label">Founded</span>
                  <span className="stat-value">{company.founded_year}</span>
                </div>
              )}
            </div>

            {/* Quick Links */}
            <div className="company-actions">
              {company.website_url && (
                <a
                  href={company.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="action-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Globe className="w-4 h-4" />
                  <span>Website</span>
                </a>
              )}
              {company.linkedin_url && (
                <a
                  href={company.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="action-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Linkedin className="w-4 h-4" />
                  <span>LinkedIn</span>
                </a>
              )}
            </div>

            {/* CTA Button */}
            <button className="view-details-btn">
              <span>{company.contact_count > 0 ? 'View Contacts' : 'Find Contacts'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* No Search Results */}
      {filteredCompanies.length === 0 && companies.length > 0 && (
        <div className="no-results">
          <Search className="w-12 h-12 text-gray-400 mb-4" />
          <h3>No companies found</h3>
          <p>Try adjusting your search term</p>
        </div>
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
