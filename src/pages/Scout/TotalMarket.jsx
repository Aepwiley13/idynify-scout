import { useEffect, useState } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Building2, Search, Filter, TrendingUp, Globe, CheckCircle, X, ExternalLink, Linkedin } from 'lucide-react';
import './TotalMarket.css';

export default function TotalMarket() {
  const [totalCount, setTotalCount] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    industry: 'all',
    status: 'all',
    search: ''
  });

  useEffect(() => {
    loadTotalMarket();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [filters, companies]);

  async function loadTotalMarket() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Get ICP criteria
      const profileDoc = await getDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current')
      );
      const profile = profileDoc.data();

      // Get ALL companies matching ICP (not just daily batch)
      const companiesSnapshot = await getDocs(
        collection(db, 'users', user.uid, 'companies')
      );

      const allCompanies = companiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setTotalCount(allCompanies.length);
      setCompanies(allCompanies);
      setFilteredCompanies(allCompanies);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load total market:', error);
      setLoading(false);
    }
  }

  function applyFilters() {
    let filtered = [...companies];

    // Filter by industry
    if (filters.industry !== 'all') {
      filtered = filtered.filter(c => c.industry === filters.industry);
    }

    // Filter by status
    if (filters.status !== 'all') {
      filtered = filtered.filter(c => c.status === filters.status);
    }

    // Filter by search term
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(c =>
        (c.name && c.name.toLowerCase().includes(searchLower)) ||
        (c.website_url && c.website_url.toLowerCase().includes(searchLower))
      );
    }

    setFilteredCompanies(filtered);
  }

  function getUniqueIndustries() {
    const industries = new Set();
    companies.forEach(c => {
      if (c.industry) industries.add(c.industry);
    });
    return Array.from(industries).sort();
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'accepted':
        return 'status-accepted';
      case 'rejected':
        return 'status-rejected';
      case 'pending':
        return 'status-pending';
      default:
        return 'status-unknown';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'accepted':
        return 'Interested';
      case 'rejected':
        return 'Not Interested';
      case 'pending':
        return 'Not Reviewed';
      default:
        return status || 'Unknown';
    }
  }

  // Calculate KPIs
  const uniqueIndustries = getUniqueIndustries();
  const reviewedCompanies = companies.filter(c => c.status && c.status !== 'pending').length;
  const reviewRate = totalCount > 0 ? Math.round((reviewedCompanies / totalCount) * 100) : 0;
  const acceptedCompanies = companies.filter(c => c.status === 'accepted').length;

  if (loading) {
    return (
      <div className="total-market-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading total addressable market...</p>
      </div>
    );
  }

  return (
    <div className="total-market">
      {/* Enterprise Header */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">Total Addressable Market</h1>
          <p className="page-subtitle">Complete view of companies matching your ICP criteria</p>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="kpi-summary">
        <div className="kpi-card highlight">
          <div className="kpi-icon-wrapper">
            <Building2 className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Total Companies</p>
            <p className="kpi-value">{totalCount.toLocaleString()}</p>
            <p className="kpi-sublabel">Match your ICP</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <Globe className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Industries</p>
            <p className="kpi-value">{uniqueIndustries.length}</p>
            <p className="kpi-sublabel">Represented</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <CheckCircle className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Reviewed</p>
            <p className="kpi-value">{reviewedCompanies}</p>
            <p className="kpi-sublabel">{reviewRate}% of total</p>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper">
            <TrendingUp className="kpi-icon" />
          </div>
          <div className="kpi-content">
            <p className="kpi-label">Interested</p>
            <p className="kpi-value">{acceptedCompanies}</p>
            <p className="kpi-sublabel">Companies saved</p>
          </div>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="controls-section">
        <div className="search-input-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search companies or websites..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="search-input"
          />
          {filters.search && (
            <button
              className="clear-search-btn"
              onClick={() => setFilters({ ...filters, search: '' })}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          className="filter-toggle-btn"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="w-4 h-4" />
          <span>Filters</span>
          {(filters.industry !== 'all' || filters.status !== 'all') && (
            <span className="filter-badge">Active</span>
          )}
        </button>
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filter-group">
            <label className="filter-label">Industry</label>
            <select
              value={filters.industry}
              onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
              className="filter-select"
            >
              <option value="all">All Industries ({companies.length})</option>
              {uniqueIndustries.map(industry => (
                <option key={industry} value={industry}>
                  {industry} ({companies.filter(c => c.industry === industry).length})
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Review Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="filter-select"
            >
              <option value="all">All Status</option>
              <option value="pending">Not Reviewed</option>
              <option value="accepted">Interested</option>
              <option value="rejected">Not Interested</option>
            </select>
          </div>

          <button
            className="clear-filters-btn"
            onClick={() => setFilters({ industry: 'all', status: 'all', search: '' })}
          >
            Clear All Filters
          </button>
        </div>
      )}

      {/* Results Count */}
      <div className="results-count">
        Showing {filteredCompanies.length.toLocaleString()} of {totalCount.toLocaleString()} companies
        {filteredCompanies.length > 100 && ' (displaying first 100)'}
      </div>

      {/* Companies Table */}
      <div className="table-container">
        {filteredCompanies.length === 0 ? (
          <div className="no-results">
            <Search className="w-12 h-12 text-gray-400 mb-4" />
            <h3>No companies found</h3>
            <p>Try adjusting your filters or search criteria</p>
            <button
              className="clear-btn"
              onClick={() => setFilters({ industry: 'all', status: 'all', search: '' })}
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <table className="market-table">
            <thead>
              <tr>
                <th>
                  <div className="th-content">
                    <Building2 className="w-4 h-4" />
                    <span>Company</span>
                  </div>
                </th>
                <th>
                  <div className="th-content">
                    <Globe className="w-4 h-4" />
                    <span>Industry</span>
                  </div>
                </th>
                <th>
                  <div className="th-content">
                    <TrendingUp className="w-4 h-4" />
                    <span>Revenue</span>
                  </div>
                </th>
                <th>
                  <div className="th-content">
                    <span>Founded</span>
                  </div>
                </th>
                <th>
                  <div className="th-content">
                    <CheckCircle className="w-4 h-4" />
                    <span>Status</span>
                  </div>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.slice(0, 100).map(company => (
                <tr key={company.id}>
                  <td className="company-cell">
                    <div className="company-info">
                      <div className="company-logo">
                        {company.name ? company.name.charAt(0).toUpperCase() : '?'}
                      </div>
                      <div className="company-details">
                        <strong className="company-name">{company.name || 'Unknown Company'}</strong>
                        {company.website_url && (
                          <a
                            href={company.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="company-website"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Globe className="w-3 h-3" />
                            <span>{company.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="industry-cell">{company.industry || 'N/A'}</td>
                  <td className="revenue-cell">{company.revenue || 'N/A'}</td>
                  <td className="founded-cell">{company.founded_year || 'N/A'}</td>
                  <td>
                    <span className={`status-badge ${getStatusBadgeClass(company.status)}`}>
                      {getStatusLabel(company.status)}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <div className="action-links">
                      {company.linkedin_url && (
                        <a
                          href={company.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="action-link"
                          title="View LinkedIn"
                        >
                          <Linkedin className="w-4 h-4" />
                        </a>
                      )}
                      {company.website_url && (
                        <a
                          href={company.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="action-link"
                          title="Visit Website"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filteredCompanies.length > 100 && (
        <div className="pagination-info">
          <p>Showing first 100 of {filteredCompanies.length.toLocaleString()} filtered companies</p>
          <p className="pagination-hint">Use filters to narrow down results</p>
        </div>
      )}
    </div>
  );
}
