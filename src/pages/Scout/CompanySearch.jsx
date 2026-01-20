import { useState } from 'react';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Search, Building2, Globe, Users, DollarSign, MapPin, Check, X } from 'lucide-react';
import './CompanySearch.css';

/**
 * Company Search Component
 *
 * Allows users to manually search for companies via Apollo API
 * and add them to their Saved Companies list after confirmation.
 *
 * Features:
 * - Manual company name search
 * - Display matching companies from Apollo
 * - User confirmation before saving
 * - Prevents duplicate companies
 */

export default function CompanySearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();

    if (!searchQuery.trim()) {
      setError('Please enter a company name');
      return;
    }

    setSearching(true);
    setError(null);
    setSearchResults([]);
    setSuccessMessage(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in to search companies');
      }

      const authToken = await user.getIdToken();

      console.log('🔍 Searching for companies:', searchQuery);

      // Call our backend function
      const response = await fetch('/.netlify/functions/search-companies-manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyName: searchQuery,
          authToken: authToken,
          userId: user.uid
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to search companies');
      }

      const data = await response.json();

      console.log(`✅ Found ${data.count} companies`);
      setSearchResults(data.companies || []);

      if (data.companies.length === 0) {
        setError('No companies found. Try a different search term.');
      }

    } catch (err) {
      console.error('❌ Search error:', err);
      setError(err.message || 'Failed to search companies');
    } finally {
      setSearching(false);
    }
  }

  async function handleAddCompany(company) {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in to add companies');
      }

      console.log('➕ Adding company to saved list:', company.name);

      // Check if company already exists
      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const existingQuery = query(
        companiesRef,
        where('apollo_organization_id', '==', company.apollo_organization_id)
      );
      const existingSnapshot = await getDocs(existingQuery);

      if (!existingSnapshot.empty) {
        setError(`${company.name} is already in your Saved Companies`);
        return;
      }

      // Add company to Firestore
      await addDoc(companiesRef, {
        apollo_organization_id: company.apollo_organization_id,
        name: company.name,
        industry: company.industry,
        employee_count: company.employee_count,
        revenue: company.revenue,
        founded_year: company.founded_year,
        phone: company.phone,
        website_url: company.website_url,
        linkedin_url: company.linkedin_url,
        location: company.location,
        description: company.description,
        logo_url: company.logo_url,
        status: 'accepted', // Auto-accept since user manually selected
        source: 'manual_search',
        found_at: new Date(),
        saved_at: new Date()
      });

      console.log('✅ Company added successfully');
      setSuccessMessage(`${company.name} has been added to your Saved Companies!`);

      // Remove from search results
      setSearchResults(prev => prev.filter(c => c.apollo_organization_id !== company.apollo_organization_id));

    } catch (err) {
      console.error('❌ Error adding company:', err);
      setError(err.message || 'Failed to add company');
    }
  }

  function handleSkipCompany(company) {
    console.log('⏭️  Skipping company:', company.name);
    setSearchResults(prev => prev.filter(c => c.apollo_organization_id !== company.apollo_organization_id));
  }

  return (
    <div className="company-search">
      {/* Header */}
      <div className="company-search-header">
        <h1>Company Search</h1>
        <p>Search for companies to add to your Saved Companies list</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="search-form">
        <div className="search-input-container">
          <Search className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter company name (e.g., Salesforce, Microsoft, Stripe)"
            className="search-input"
            disabled={searching}
          />
        </div>
        <button
          type="submit"
          className="search-button"
          disabled={searching || !searchQuery.trim()}
        >
          {searching ? (
            <>
              <span className="spinner">⚙️</span>
              Searching...
            </>
          ) : (
            <>
              <Search className="w-5 h-5" />
              Search
            </>
          )}
        </button>
      </form>

      {/* Success Message */}
      {successMessage && (
        <div className="success-message">
          <Check className="w-5 h-5" />
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)}>×</button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="error-message">
          <X className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="search-results">
          <div className="results-header">
            <h2>Found {searchResults.length} matching {searchResults.length === 1 ? 'company' : 'companies'}</h2>
            <p>Review and confirm to add to your Saved Companies</p>
          </div>

          <div className="results-grid">
            {searchResults.map((company) => (
              <div key={company.apollo_organization_id} className="company-result-card">
                {/* Company Logo/Icon */}
                <div className="company-logo">
                  {company.logo_url ? (
                    <img src={company.logo_url} alt={company.name} />
                  ) : (
                    <div className="company-logo-placeholder">
                      {company.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Company Info */}
                <div className="company-info">
                  <h3>{company.name}</h3>

                  <div className="company-details">
                    <div className="detail-item">
                      <Building2 className="w-4 h-4" />
                      <span>{company.industry}</span>
                    </div>

                    {company.location && (
                      <div className="detail-item">
                        <MapPin className="w-4 h-4" />
                        <span>{company.location}</span>
                      </div>
                    )}

                    {company.employee_count > 0 && (
                      <div className="detail-item">
                        <Users className="w-4 h-4" />
                        <span>{company.employee_count.toLocaleString()} employees</span>
                      </div>
                    )}

                    {company.revenue && (
                      <div className="detail-item">
                        <DollarSign className="w-4 h-4" />
                        <span>{company.revenue} revenue</span>
                      </div>
                    )}

                    {company.website_url && (
                      <div className="detail-item">
                        <Globe className="w-4 h-4" />
                        <a
                          href={company.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {company.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      </div>
                    )}
                  </div>

                  {company.description && (
                    <p className="company-description">{company.description}</p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="company-actions">
                  <button
                    className="add-button"
                    onClick={() => handleAddCompany(company)}
                  >
                    <Check className="w-5 h-5" />
                    Add to Saved Companies
                  </button>
                  <button
                    className="skip-button"
                    onClick={() => handleSkipCompany(company)}
                  >
                    <X className="w-5 h-5" />
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!searching && searchResults.length === 0 && !error && (
        <div className="empty-state">
          <Search className="w-16 h-16" />
          <h3>Search for Companies</h3>
          <p>Enter a company name above to find and add companies to your list.</p>
          <div className="example-searches">
            <p className="example-label">Try searching for:</p>
            <div className="example-chips">
              <button onClick={() => setSearchQuery('Salesforce')}>Salesforce</button>
              <button onClick={() => setSearchQuery('Microsoft')}>Microsoft</button>
              <button onClick={() => setSearchQuery('Stripe')}>Stripe</button>
              <button onClick={() => setSearchQuery('Shopify')}>Shopify</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
