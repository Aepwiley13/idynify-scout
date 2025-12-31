import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { X, Building2, Users, DollarSign, Calendar, MapPin, Briefcase, Globe, Linkedin, ExternalLink, Loader, AlertCircle } from 'lucide-react';
import './CompanyDetailModal.css';

export default function CompanyDetailModal({ company, onClose }) {
  const [enrichedData, setEnrichedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    enrichCompanyData();
  }, [company.id]);

  async function enrichCompanyData() {
    try {
      setLoading(true);
      setError(null);

      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Get current company data from Firestore
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      const companyDoc = await getDoc(companyRef);

      if (!companyDoc.exists()) {
        throw new Error('Company not found');
      }

      const currentData = companyDoc.data();

      // Check if we already have enriched data
      if (currentData.enrichedAt &&
          Date.now() - currentData.enrichedAt < 7 * 24 * 60 * 60 * 1000) { // 7 days cache
        setEnrichedData(currentData);
        setLoading(false);
        return;
      }

      // Enrich the data
      // For now, we'll use the existing data but mark it as enriched
      // In the future, this could call external APIs like Clearbit, Apollo, etc.
      const enriched = {
        ...currentData,
        enrichedAt: Date.now(),
        enrichmentSource: 'manual', // Could be 'clearbit', 'apollo', etc.

        // Additional fields that could be enriched:
        description: currentData.description || generateCompanyDescription(currentData),
        tags: currentData.tags || generateTags(currentData),
        icpScore: currentData.icpScore || 0,

        // Social media presence
        socialPresence: {
          hasWebsite: !!currentData.website_url,
          hasLinkedIn: !!currentData.linkedin_url,
          hasFacebook: !!currentData.facebook_url,
          hasTwitter: !!currentData.twitter_url,
        },

        // Company metrics
        metrics: {
          employeeCount: currentData.employee_count || currentData.company_size || 'Unknown',
          revenue: currentData.revenue || 'Unknown',
          foundedYear: currentData.founded_year || 'Unknown',
          location: currentData.location || 'Unknown',
        }
      };

      // Update Firestore with enriched data
      await updateDoc(companyRef, {
        enrichedAt: enriched.enrichedAt,
        enrichmentSource: enriched.enrichmentSource,
        description: enriched.description,
        tags: enriched.tags,
      });

      setEnrichedData(enriched);
      setLoading(false);
    } catch (err) {
      console.error('Error enriching company data:', err);
      setError(err.message);
      setLoading(false);

      // Still show basic company data even if enrichment fails
      setEnrichedData(company);
    }
  }

  // Helper function to generate a basic company description
  function generateCompanyDescription(data) {
    const parts = [];

    if (data.name) {
      parts.push(`${data.name} is`);
    }

    if (data.industry) {
      parts.push(`a company in the ${data.industry} industry`);
    }

    if (data.location) {
      parts.push(`based in ${data.location}`);
    }

    if (data.founded_year) {
      parts.push(`Founded in ${data.founded_year}`);
    }

    if (data.employee_count || data.company_size) {
      const size = data.employee_count || data.company_size;
      parts.push(`with ${size} employees`);
    }

    if (data.revenue) {
      parts.push(`generating ${data.revenue} in revenue`);
    }

    return parts.length > 0
      ? parts.join(', ') + '.'
      : 'No description available.';
  }

  // Helper function to generate tags
  function generateTags(data) {
    const tags = [];

    if (data.industry) tags.push(data.industry);
    if (data.location) tags.push(data.location);

    // Size tags
    const empCount = data.employee_count || data.company_size;
    if (empCount) {
      const size = parseInt(empCount.toString().replace(/[^0-9]/g, ''));
      if (size < 50) tags.push('Small Business');
      else if (size < 500) tags.push('Mid-Market');
      else tags.push('Enterprise');
    }

    // Social presence
    if (data.website_url) tags.push('Has Website');
    if (data.linkedin_url) tags.push('On LinkedIn');

    return tags.slice(0, 6); // Limit to 6 tags
  }

  function handleOpenLink(url) {
    // Check if mobile device
    const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);

    if (isMobile || url.toLowerCase().startsWith('http://')) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className="company-detail-overlay" onClick={onClose}>
      <div className="company-detail-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="company-detail-header">
          <div className="header-content">
            <div className="company-detail-logo-wrapper">
              {company.domain && !logoError ? (
                <img
                  src={`https://logo.clearbit.com/${company.domain}`}
                  alt={`${company.name} logo`}
                  className="company-detail-logo"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <Building2 className="company-detail-logo-fallback" />
              )}
            </div>
            <div className="header-text">
              <h2 className="company-detail-name">{company.name || 'Unknown Company'}</h2>
              <p className="company-detail-industry">{company.industry || 'Industry not specified'}</p>
            </div>
          </div>
          <button className="close-button" onClick={onClose}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="company-detail-content">
          {loading ? (
            <div className="loading-state">
              <Loader className="spinner" />
              <p>Enriching company data...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <AlertCircle className="error-icon" />
              <p>Failed to load company details</p>
              <p className="error-message">{error}</p>
            </div>
          ) : enrichedData ? (
            <>
              {/* Description */}
              <div className="detail-section">
                <h3 className="section-title">About</h3>
                <p className="company-description">{enrichedData.description}</p>
              </div>

              {/* Tags */}
              {enrichedData.tags && enrichedData.tags.length > 0 && (
                <div className="detail-section">
                  <h3 className="section-title">Tags</h3>
                  <div className="tags-container">
                    {enrichedData.tags.map((tag, index) => (
                      <span key={index} className="tag-pill">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Company Metrics */}
              <div className="detail-section">
                <h3 className="section-title">Company Details</h3>
                <div className="metrics-grid">
                  <div className="metric-card">
                    <div className="metric-icon">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div className="metric-content">
                      <p className="metric-label">Industry</p>
                      <p className="metric-value">{enrichedData.metrics.employeeCount !== 'Unknown' ? enrichedData.industry : 'Not available'}</p>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="metric-content">
                      <p className="metric-label">Employees</p>
                      <p className="metric-value">{enrichedData.metrics.employeeCount}</p>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div className="metric-content">
                      <p className="metric-label">Revenue</p>
                      <p className="metric-value">{enrichedData.metrics.revenue}</p>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon">
                      <Calendar className="w-5 h-5" />
                    </div>
                    <div className="metric-content">
                      <p className="metric-label">Founded</p>
                      <p className="metric-value">{enrichedData.metrics.foundedYear}</p>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="metric-content">
                      <p className="metric-label">Location</p>
                      <p className="metric-value">{enrichedData.metrics.location}</p>
                    </div>
                  </div>

                  {enrichedData.icpScore > 0 && (
                    <div className="metric-card highlight">
                      <div className="metric-icon">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="metric-content">
                        <p className="metric-label">ICP Score</p>
                        <p className="metric-value">{enrichedData.icpScore}/100</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Social Links */}
              {(enrichedData.website_url || enrichedData.linkedin_url) && (
                <div className="detail-section">
                  <h3 className="section-title">Links</h3>
                  <div className="links-container">
                    {enrichedData.website_url && (
                      <button
                        className="link-button website"
                        onClick={() => handleOpenLink(enrichedData.website_url)}
                      >
                        <Globe className="w-5 h-5" />
                        <span>Visit Website</span>
                        <ExternalLink className="w-4 h-4 ml-auto" />
                      </button>
                    )}
                    {enrichedData.linkedin_url && (
                      <button
                        className="link-button linkedin"
                        onClick={() => handleOpenLink(enrichedData.linkedin_url)}
                      >
                        <Linkedin className="w-5 h-5" />
                        <span>View on LinkedIn</span>
                        <ExternalLink className="w-4 h-4 ml-auto" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Status */}
              <div className="detail-section">
                <div className="contact-status-card">
                  <div className="status-header">
                    <h3 className="section-title">Contact Status</h3>
                    {company.contact_count > 0 && (
                      <span className="contact-badge-inline">
                        {company.contact_count} contact{company.contact_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <button className="find-contacts-btn" onClick={onClose}>
                    {company.contact_count > 0 ? 'View Contacts' : 'Find Contacts'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
