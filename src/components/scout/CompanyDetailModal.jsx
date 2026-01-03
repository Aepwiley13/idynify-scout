import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { X, Building2, Users, DollarSign, Calendar, MapPin, Briefcase, Globe, Linkedin, ExternalLink, Loader, AlertCircle, TrendingUp, Code, Award, CheckCircle, UserPlus, ChevronDown } from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import './CompanyDetailModal.css';

export default function CompanyDetailModal({ company, onClose }) {
  const navigate = useNavigate();
  const [enrichedData, setEnrichedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState([]);
  const [savingContacts, setSavingContacts] = useState(false);

  // Scroll detection states
  const [isScrolled, setIsScrolled] = useState(false);
  const [hasScroll, setHasScroll] = useState(false);
  const contentRef = useRef(null);
  const headerRef = useRef(null);

  // Collapsible section states
  const [departmentsExpanded, setDepartmentsExpanded] = useState(true);
  const [techStackExpanded, setTechStackExpanded] = useState(true);

  useEffect(() => {
    enrichCompanyData();
  }, [company.id]);

  // Scroll detection effect
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const scrollTop = contentElement.scrollTop;
      const scrollHeight = contentElement.scrollHeight;
      const clientHeight = contentElement.clientHeight;

      // Add 'scrolled' class to header when scrolled down
      setIsScrolled(scrollTop > 10);

      // Show scroll gradient if there's more content below
      setHasScroll(scrollHeight > clientHeight && scrollTop < scrollHeight - clientHeight - 20);
    };

    // Initial check
    handleScroll();

    // Add scroll listener
    contentElement.addEventListener('scroll', handleScroll);

    // Recheck on content changes
    const observer = new ResizeObserver(handleScroll);
    observer.observe(contentElement);

    return () => {
      contentElement.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [enrichedData]);

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

      // Check if we already have fresh Apollo data (14 days cache)
      if (currentData.apolloEnrichment &&
          currentData.apolloEnrichedAt &&
          Date.now() - currentData.apolloEnrichedAt < 14 * 24 * 60 * 60 * 1000) {
        console.log('✅ Using cached Apollo data');
        setEnrichedData(currentData.apolloEnrichment);
        setLoading(false);
        return;
      }

      // Call Netlify Function to enrich with Apollo
      console.log('🔄 Calling Apollo enrichment API...');

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/enrichCompany', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.uid,
          authToken: authToken,
          domain: company.domain || extractDomain(company.website_url),
          organizationId: currentData.apollo_id || null
        })
      });

      if (!response.ok) {
        throw new Error('Company enrichment failed');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enrichment failed');
      }

      console.log('✅ Apollo enrichment successful');

      // Store enriched data in Firestore
      await updateDoc(companyRef, {
        apolloEnrichment: result.data,
        apolloEnrichedAt: Date.now(),
        apollo_id: result.data._raw?.apolloOrgId || null
      });

      setEnrichedData(result.data);
      setLoading(false);

    } catch (err) {
      console.error('Error enriching company data:', err);
      setError(err.message);
      setLoading(false);

      // Show basic company data even if enrichment fails
      setEnrichedData({
        snapshot: {
          name: company.name,
          industry: company.industry,
          location: { full: company.location || 'Unknown' }
        }
      });
    }
  }

  function extractDomain(url) {
    if (!url) return null;
    try {
      const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      return domain;
    } catch {
      return null;
    }
  }

  function handleOpenLink(url) {
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

  function formatGrowthPercentage(value) {
    if (!value) return null;
    const num = parseFloat(value);
    if (isNaN(num)) return null;
    return num > 0 ? `+${num}%` : `${num}%`;
  }

  function handleSelectDecisionMaker(person) {
    setSelectedDecisionMakers(prev => {
      const isSelected = prev.some(p => p.id === person.id);
      if (isSelected) {
        return prev.filter(p => p.id !== person.id);
      } else {
        return [...prev, person];
      }
    });
  }

  async function handleAddSelectedToLeads() {
    if (selectedDecisionMakers.length === 0) return;

    try {
      setSavingContacts(true);
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Save each selected decision maker as a contact
      for (const person of selectedDecisionMakers) {
        const contactId = `${company.id}_${person.id}`;

        await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), {
          // Apollo IDs
          apollo_person_id: person.id,

          // Basic Info
          name: person.name || 'Unknown',
          title: person.title || '',
          email: person.email || null,
          phone: person.phone || null,
          linkedin_url: person.linkedin_url || null,
          photo_url: person.photo_url || null,

          // Company Association
          company_id: company.id,
          company_name: company.name,
          company_industry: company.industry || null,

          // Apollo Enrichment Fields (for Professional Snapshot & Decision-Making Context)
          department: person.department || null,
          seniority: person.seniority || null,
          location: person.location || null,

          // Metadata
          status: 'active',
          saved_at: new Date().toISOString(),
          source: 'apollo'
        });
      }

      // Update company contact count
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      const companyDoc = await getDoc(companyRef);
      const currentContactCount = companyDoc.data()?.contact_count || 0;

      await updateDoc(companyRef, {
        contact_count: currentContactCount + selectedDecisionMakers.length
      });

      console.log(`✅ Added ${selectedDecisionMakers.length} decision makers as leads`);

      // Clear selection and close modal
      setSelectedDecisionMakers([]);
      setSavingContacts(false);

      // Navigate to company leads page
      navigate(`/scout/company/${company.id}/leads`);

    } catch (err) {
      console.error('Error saving decision makers:', err);
      setSavingContacts(false);
      alert('Failed to save contacts. Please try again.');
    }
  }

  function handleFindMoreContacts() {
    navigate(`/scout/company/${company.id}`);
    onClose();
  }

  return (
    <div className="company-detail-overlay" onClick={onClose}>
      <div className="company-detail-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div ref={headerRef} className={`company-detail-header ${isScrolled ? 'scrolled' : ''}`}>
          <div className="header-content">
            {/* Robust multi-source logo */}
            <CompanyLogo company={company} size="large" className="company-detail-logo-wrapper" />
            <div className="header-text">
              <h2 className="company-detail-name">{company.name || 'Unknown Company'}</h2>
              <p className="company-detail-industry">{enrichedData?.snapshot?.industry || company.industry || 'Industry not specified'}</p>
            </div>
          </div>
          <button className="close-button" onClick={onClose}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className={`company-detail-content ${hasScroll ? 'has-scroll' : ''}`}>
          {loading ? (
            <div className="loading-state">
              <Loader className="spinner" />
              <p>Enriching company data...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <AlertCircle className="error-icon" />
              <p>Enrichment encountered an issue</p>
              <p className="error-message">{error}</p>
              <p className="error-hint">Showing basic company information</p>
            </div>
          ) : null}

          {enrichedData && (
            <>
              {/* Section 1: Company Snapshot (Top Fold) */}
              <div className="detail-section snapshot-section">
                <h3 className="section-title">Company Snapshot</h3>
                <div className="snapshot-grid">
                  <div className="snapshot-item">
                    <Briefcase className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Industry</p>
                      <p className="snapshot-value">{enrichedData.snapshot?.industry || 'Not available'}</p>
                    </div>
                  </div>

                  <div className="snapshot-item">
                    <Users className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Employees</p>
                      <p className="snapshot-value">
                        {enrichedData.snapshot?.employee_count_range ||
                         enrichedData.snapshot?.estimated_num_employees ||
                         'Not available'}
                      </p>
                    </div>
                  </div>

                  <div className="snapshot-item">
                    <DollarSign className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Revenue</p>
                      <p className="snapshot-value">
                        {enrichedData.snapshot?.revenue_range ||
                         enrichedData.snapshot?.annual_revenue ||
                         'Not available'}
                      </p>
                    </div>
                  </div>

                  <div className="snapshot-item">
                    <Calendar className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Founded</p>
                      <p className="snapshot-value">{enrichedData.snapshot?.founded_year || 'Not available'}</p>
                    </div>
                  </div>

                  <div className="snapshot-item">
                    <MapPin className="snapshot-icon" />
                    <div>
                      <p className="snapshot-label">Location</p>
                      <p className="snapshot-value">{enrichedData.snapshot?.location?.full || 'Not available'}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Growth & Hiring Signals */}
              {enrichedData.growth && (enrichedData.growth.employee_growth_12mo || enrichedData.growth.job_postings_count > 0) && (
                <div className="detail-section growth-section">
                  <h3 className="section-title">Growth & Hiring Signals</h3>

                  <div className="growth-indicators">
                    {enrichedData.growth.employee_growth_12mo && (
                      <div className="growth-card positive">
                        <TrendingUp className="w-5 h-5" />
                        <div>
                          <p className="growth-label">12-Month Growth</p>
                          <p className="growth-value">{formatGrowthPercentage(enrichedData.growth.employee_growth_12mo)}</p>
                        </div>
                      </div>
                    )}

                    {enrichedData.growth.hiring_velocity && (
                      <div className={`growth-card ${enrichedData.growth.hiring_velocity.toLowerCase()}`}>
                        <Award className="w-5 h-5" />
                        <div>
                          <p className="growth-label">Hiring Velocity</p>
                          <p className="growth-value">{enrichedData.growth.hiring_velocity}</p>
                        </div>
                      </div>
                    )}

                    {enrichedData.growth.job_postings_count > 0 && (
                      <div className="growth-card">
                        <Users className="w-5 h-5" />
                        <div>
                          <p className="growth-label">Active Job Postings</p>
                          <p className="growth-value">{enrichedData.growth.job_postings_count}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {enrichedData.growth.job_postings && enrichedData.growth.job_postings.length > 0 && (
                    <div className="job-postings">
                      <p className="job-postings-header">Relevant Openings:</p>
                      <div className="job-postings-list">
                        {enrichedData.growth.job_postings.map((job, idx) => (
                          <span key={idx} className="job-tag">{job.title}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 3: Decision Makers */}
              {enrichedData.decisionMakers && enrichedData.decisionMakers.length > 0 && (
                <div className="detail-section decision-makers-section">
                  <div className="section-header-with-actions">
                    <h3 className="section-title">Key Decision Makers</h3>
                    <p className="section-subtitle">Select contacts to add as leads</p>
                  </div>

                  <div className="decision-makers-grid">
                    {enrichedData.decisionMakers.map((person, idx) => {
                      const isSelected = selectedDecisionMakers.some(p => p.id === person.id);
                      return (
                        <div
                          key={idx}
                          className={`decision-maker-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectDecisionMaker(person)}
                        >
                          <div className="decision-maker-select-indicator">
                            <div className={`checkbox ${isSelected ? 'checked' : ''}`}>
                              {isSelected && <CheckCircle className="w-5 h-5" />}
                            </div>
                          </div>

                          <div className="decision-maker-header">
                            <div className="decision-maker-avatar">
                              {person.photo_url ? (
                                <img src={person.photo_url} alt={person.name} />
                              ) : (
                                <Users className="w-6 h-6" />
                              )}
                            </div>
                            <div className="decision-maker-info">
                              <p className="decision-maker-name">{person.name}</p>
                              <p className="decision-maker-title">{person.title}</p>
                              {person.department && (
                                <p className="decision-maker-dept">{person.department}</p>
                              )}
                            </div>
                          </div>

                          {person.linkedin_url && (
                            <button
                              className="decision-maker-linkedin"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenLink(person.linkedin_url);
                              }}
                            >
                              <Linkedin className="w-4 h-4" />
                              <span>LinkedIn</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Action Buttons */}
                  <div className="decision-makers-actions">
                    <button
                      className="btn-add-selected"
                      onClick={handleAddSelectedToLeads}
                      disabled={selectedDecisionMakers.length === 0 || savingContacts}
                    >
                      {savingContacts ? (
                        <>
                          <Loader className="w-5 h-5 spinner" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-5 h-5" />
                          <span>
                            {selectedDecisionMakers.length > 0
                              ? `Add ${selectedDecisionMakers.length} to Leads`
                              : 'Select contacts to add'}
                          </span>
                        </>
                      )}
                    </button>

                    <button
                      className="btn-find-more"
                      onClick={handleFindMoreContacts}
                    >
                      <Users className="w-5 h-5" />
                      <span>Find More Contacts</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Section 4: Department Breakdown */}
              {enrichedData.departments && Object.values(enrichedData.departments).some(d => d) && (
                <div className="detail-section departments-section">
                  <div
                    className="section-header-collapsible"
                    onClick={() => setDepartmentsExpanded(!departmentsExpanded)}
                  >
                    <h3 className="section-title">Department Breakdown</h3>
                    <ChevronDown className={`chevron ${departmentsExpanded ? 'expanded' : ''}`} />
                  </div>
                  {departmentsExpanded && (
                    <div className="departments-grid">
                    {enrichedData.departments.sales && (
                      <div className="dept-card">
                        <p className="dept-label">Sales</p>
                        <p className="dept-value">{enrichedData.departments.sales}</p>
                      </div>
                    )}
                    {enrichedData.departments.marketing && (
                      <div className="dept-card">
                        <p className="dept-label">Marketing</p>
                        <p className="dept-value">{enrichedData.departments.marketing}</p>
                      </div>
                    )}
                    {enrichedData.departments.engineering && (
                      <div className="dept-card">
                        <p className="dept-label">Engineering</p>
                        <p className="dept-value">{enrichedData.departments.engineering}</p>
                      </div>
                    )}
                    {enrichedData.departments.operations && (
                      <div className="dept-card">
                        <p className="dept-label">Operations</p>
                        <p className="dept-value">{enrichedData.departments.operations}</p>
                      </div>
                    )}
                    </div>
                  )}
                </div>
              )}

              {/* Section 5: Tech Stack */}
              {enrichedData.techStack && enrichedData.techStack.length > 0 && (
                <div className="detail-section tech-stack-section">
                  <div
                    className="section-header-collapsible"
                    onClick={() => setTechStackExpanded(!techStackExpanded)}
                  >
                    <h3 className="section-title">Tech Stack ({enrichedData.techStack.length})</h3>
                    <ChevronDown className={`chevron ${techStackExpanded ? 'expanded' : ''}`} />
                  </div>
                  {techStackExpanded && (
                    <div className="tech-stack-grid">
                    {enrichedData.techStack.map((tech, idx) => (
                      <div key={idx} className="tech-card">
                        <Code className="w-4 h-4 tech-icon" />
                        <div>
                          <p className="tech-name">{tech.name}</p>
                          {tech.category && <p className="tech-category">{tech.category}</p>}
                        </div>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              )}

              {/* Section 6: Data Confidence & Freshness */}
              {enrichedData.dataQuality && (
                <div className="detail-section data-quality-section">
                  <h3 className="section-title">Data Confidence</h3>
                  <div className="data-quality-info">
                    <div className="data-quality-item">
                      <span className="data-quality-label">Last Updated:</span>
                      <span className="data-quality-value">
                        {new Date(enrichedData._raw?.enrichedAt || Date.now()).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="data-quality-item">
                      <span className="data-quality-label">Status:</span>
                      <span className={`data-quality-badge ${enrichedData.dataQuality.organization_status}`}>
                        {enrichedData.dataQuality.organization_status || 'Active'}
                      </span>
                    </div>
                    <div className="data-quality-item">
                      <span className="data-quality-label">Source:</span>
                      <span className="data-quality-value">Verified Data</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Social Links */}
              {(enrichedData.snapshot?.website_url || enrichedData.dataQuality?.linkedin_url || company.website_url || company.linkedin_url) && (
                <div className="detail-section">
                  <h3 className="section-title">Links</h3>
                  <div className="links-container">
                    {(enrichedData.snapshot?.website_url || company.website_url) && (
                      <button
                        className="link-button website"
                        onClick={() => handleOpenLink(enrichedData.snapshot?.website_url || company.website_url)}
                      >
                        <Globe className="w-5 h-5" />
                        <span>Visit Website</span>
                        <ExternalLink className="w-4 h-4 ml-auto" />
                      </button>
                    )}
                    {(enrichedData.dataQuality?.linkedin_url || company.linkedin_url) && (
                      <button
                        className="link-button linkedin"
                        onClick={() => handleOpenLink(enrichedData.dataQuality?.linkedin_url || company.linkedin_url)}
                      >
                        <Linkedin className="w-5 h-5" />
                        <span>View on LinkedIn</span>
                        <ExternalLink className="w-4 h-4 ml-auto" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Status & CTA */}
              <div className="detail-section">
                <div className="contact-status-card">
                  <div className="status-header">
                    <h3 className="section-title">Ready to Connect?</h3>
                    {company.contact_count > 0 && (
                      <span className="contact-badge-inline">
                        {company.contact_count} contact{company.contact_count !== 1 ? 's' : ''} found
                      </span>
                    )}
                  </div>
                  <button className="find-contacts-btn" onClick={onClose}>
                    {company.contact_count > 0 ? 'View Contacts' : 'Find Contacts'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
