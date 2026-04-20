import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Search, Building2, Globe, Check, X } from 'lucide-react';
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

export default function CompanySearch({ onCompanyAdded } = {}) {
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);

  // Website URL search state
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteSearching, setWebsiteSearching] = useState(false);
  const [websiteContact, setWebsiteContact] = useState(null);
  const [websiteError, setWebsiteError] = useState(null);
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [websiteSaveSuccess, setWebsiteSaveSuccess] = useState(false);

  // Pre-fill from navigation state (e.g. clicking a company name from People page)
  useEffect(() => {
    if (location.state?.searchCompanyName) {
      setSearchQuery(location.state.searchCompanyName);
    }
  }, []);

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
    setSelectedCompanyId(null);

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
      const docRef = await addDoc(companiesRef, {
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

      // If embedded in Scout+, delegate to its unified success screen
      if (onCompanyAdded) {
        onCompanyAdded([{ ...company, id: docRef.id, _uploadType: 'companies' }]);
        return;
      }

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
    if (selectedCompanyId === company.apollo_organization_id) {
      setSelectedCompanyId(null);
    }
  }

  function handleSelectCompany(companyId) {
    setSelectedCompanyId(selectedCompanyId === companyId ? null : companyId);
  }

  async function handleWebsiteSearch(e) {
    e.preventDefault();
    if (!websiteUrl.trim()) {
      setWebsiteError('Please enter a website URL');
      return;
    }

    setWebsiteSearching(true);
    setWebsiteError(null);
    setWebsiteContact(null);
    setWebsiteSaveSuccess(false);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('You must be logged in');

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/crawl-website-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, websiteUrl: websiteUrl.trim() })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to scan website');

      setWebsiteContact(data.contact);
    } catch (err) {
      setWebsiteError(err.message || "Couldn't find a contact email. Try adding manually.");
    } finally {
      setWebsiteSearching(false);
    }
  }

  async function handleSaveWebsiteContact() {
    if (!websiteContact) return;

    setWebsiteSaving(true);
    setWebsiteError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('You must be logged in');

      await addDoc(collection(db, 'users', user.uid, 'contacts'), {
        name: websiteContact.companyName,
        email: websiteContact.email || null,
        emailSource: 'website',
        company_name: websiteContact.companyName,
        company_website: websiteContact.websiteUrl,
        domain: websiteContact.domain,
        sourceType: 'website',
        source: 'website',
        status: 'saved',
        saved_at: new Date(),
        found_at: new Date(),
        last_enriched_at: null
      });

      setWebsiteSaveSuccess(true);
      setWebsiteContact(null);
      setWebsiteUrl('');
    } catch (err) {
      setWebsiteError(err.message || 'Failed to save contact');
    } finally {
      setWebsiteSaving(false);
    }
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

      {/* Website URL Search Section */}
      <div className="website-search-section">
        <div className="website-search-divider"><span>or</span></div>
        <p className="website-search-label">Know their website? Add them directly.</p>
        <form onSubmit={handleWebsiteSearch} className="search-form">
          <div className="search-input-container">
            <Globe className="search-icon" />
            <input
              type="text"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://lizwilcox.com"
              className="search-input"
              disabled={websiteSearching}
            />
          </div>
          <button
            type="submit"
            className="search-button"
            disabled={websiteSearching || !websiteUrl.trim()}
          >
            {websiteSearching ? 'Scanning website...' : 'Find Contact'}
          </button>
        </form>

        {websiteError && (
          <div className="error-message">
            <X className="w-5 h-5" />
            <span>{websiteError}</span>
            <button onClick={() => setWebsiteError(null)}>×</button>
          </div>
        )}

        {websiteSaveSuccess && (
          <div className="success-message">
            <Check className="w-5 h-5" />
            <span>Contact saved to People!</span>
            <button onClick={() => setWebsiteSaveSuccess(false)}>×</button>
          </div>
        )}

        {websiteContact && (
          <div className="website-contact-preview">
            <div className="preview-header">
              <div className="preview-avatar">
                {websiteContact.companyName.charAt(0).toUpperCase()}
              </div>
              <div className="preview-info">
                <h3>{websiteContact.companyName}</h3>
                <span>{websiteContact.domain}</span>
              </div>
            </div>
            <div className="preview-email">
              {websiteContact.email ? (
                <>
                  <span className="email-label">Email found:</span>
                  <span className="email-value">{websiteContact.email}</span>
                </>
              ) : (
                <span className="no-email">No email found on website</span>
              )}
            </div>
            <div className="preview-actions">
              <button
                className="action-btn reject"
                onClick={() => setWebsiteContact(null)}
              >
                <X className="w-5 h-5" />
                Dismiss
              </button>
              <button
                className="action-btn accept"
                onClick={handleSaveWebsiteContact}
                disabled={websiteSaving}
              >
                <Check className="w-5 h-5" />
                {websiteSaving ? 'Saving...' : 'Save to People'}
              </button>
            </div>
          </div>
        )}
      </div>

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
            {searchResults.map((company) => {
              const isSelected = selectedCompanyId === company.apollo_organization_id;

              return (
                <div
                  key={company.apollo_organization_id}
                  className={`company-result-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectCompany(company.apollo_organization_id)}
                >
                  {/* Logo Banner — full-width top section */}
                  <div className="company-logo-banner">
                    {company.logo_url ? (
                      <img src={company.logo_url} alt={company.name} />
                    ) : (
                      <div className="company-logo-placeholder">
                        {company.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {isSelected && (
                      <div className="selection-indicator">
                        <Check className="w-5 h-5" />
                      </div>
                    )}
                  </div>

                  {/* Info Section — name + meta */}
                  <div className="company-card-info">
                    <h3 className="company-name">{company.name}</h3>

                    <div className="company-meta-grid">
                      <div className="meta-cell">
                        <div className="meta-label">INDUSTRY</div>
                        <div className="meta-value">{company.industry || 'Not available'}</div>
                      </div>
                      <div className="meta-cell">
                        <div className="meta-label">EMPLOYEES</div>
                        <div className="meta-value">
                          {company.employee_count > 0
                            ? company.employee_count.toLocaleString()
                            : 'Not available'}
                        </div>
                      </div>
                      <div className="meta-cell">
                        <div className="meta-label">REVENUE</div>
                        <div className="meta-value">{company.revenue || 'Not available'}</div>
                      </div>
                      <div className="meta-cell">
                        <div className="meta-label">FOUNDED</div>
                        <div className="meta-value">{company.founded_year || 'Not available'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Website & LinkedIn Buttons */}
                  <div className="company-link-buttons">
                    {company.website_url ? (
                      <a
                        href={company.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-btn website-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Globe className="w-4 h-4" />
                        <span>Visit Website</span>
                      </a>
                    ) : (
                      <div className="link-btn website-btn disabled">
                        <Globe className="w-4 h-4" />
                        <span>No Website</span>
                      </div>
                    )}

                    {company.linkedin_url ? (
                      <a
                        href={company.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-btn linkedin-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Building2 className="w-4 h-4" />
                        <span>LinkedIn</span>
                      </a>
                    ) : (
                      <div className="link-btn linkedin-btn disabled">
                        <Building2 className="w-4 h-4" />
                        <span>No LinkedIn</span>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons (Skip first, Add to Saved second) */}
                  <div className="company-actions">
                    <button
                      className="action-btn reject"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSkipCompany(company);
                      }}
                    >
                      <X className="w-5 h-5" />
                      Skip
                    </button>
                    <button
                      className="action-btn accept"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddCompany(company);
                      }}
                    >
                      <Check className="w-5 h-5" />
                      Add to Saved
                    </button>
                  </div>
                </div>
              );
            })}
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
