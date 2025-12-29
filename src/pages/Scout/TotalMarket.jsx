import { useEffect, useState } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './TotalMarket.css';

export default function TotalMarket() {
  const [totalCount, setTotalCount] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return (
      <div className="total-market-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">[LOADING TOTAL MARKET...]</p>
      </div>
    );
  }

  const uniqueIndustries = getUniqueIndustries();

  return (
    <div className="total-market">
      <div className="market-header">
        <h2>Total Addressable Market</h2>
        <div className="market-stat">
          <span className="stat-number">{totalCount.toLocaleString()}</span>
          <span className="stat-label">companies match your ICP</span>
        </div>
      </div>

      {/* Filters */}
      <div className="market-filters">
        <input
          type="text"
          placeholder="🔍 Search companies..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="search-input"
        />

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

      {/* Results Count */}
      <div className="results-count">
        Showing {filteredCompanies.length} of {totalCount} companies
      </div>

      {/* Companies Table */}
      <div className="market-table-container">
        {filteredCompanies.length === 0 ? (
          <div className="no-results">
            <p>No companies match your filters</p>
          </div>
        ) : (
          <table className="market-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Industry</th>
                <th>Revenue</th>
                <th>Founded</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.slice(0, 100).map(company => (
                <tr key={company.id}>
                  <td>
                    <div className="company-name-cell">
                      <strong>{company.name || 'Unknown Company'}</strong>
                      {company.website_url && (
                        <a
                          href={company.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="company-website"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {company.website_url.replace(/^https?:\/\//, '')}
                        </a>
                      )}
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
                  <td>
                    <div className="action-links">
                      {company.linkedin_url && (
                        <a
                          href={company.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="action-link"
                        >
                          💼 LinkedIn
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {filteredCompanies.length > 100 && (
          <p className="showing-count">
            Showing first 100 of {filteredCompanies.length} filtered companies
          </p>
        )}
      </div>
    </div>
  );
}
