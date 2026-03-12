import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { X, Building2, Users, DollarSign, Calendar, MapPin, Briefcase, Globe, Linkedin, ExternalLink, Loader, AlertCircle, TrendingUp, Code, Award, CheckCircle, UserPlus, RefreshCw, Search, User } from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import { searchPeople, updatePerson } from '../../services/peopleService';
import './CompanyDetailModal.css';
import { getEffectiveUser } from '../context/ImpersonationContext';

export default function CompanyDetailModal({ company, onClose, onFindMoreContacts }) {
  const navigate = useNavigate();
  const [enrichedData, setEnrichedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState([]);
  const [savingContacts, setSavingContacts] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Scroll detection states
  const [isScrolled, setIsScrolled] = useState(false);
  const [hasScroll, setHasScroll] = useState(false);
  const contentRef = useRef(null);
  const headerRef = useRef(null);

  // Ghost-click guard: ignore overlay clicks for first 200ms after mount
  const [overlayReady, setOverlayReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOverlayReady(true), 200);
    return () => clearTimeout(t);
  }, []);

  // Add People from Your Contacts states
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [selectedPeopleToAdd, setSelectedPeopleToAdd] = useState([]);
  const [addingPeopleToCompany, setAddingPeopleToCompany] = useState(false);
  const [addPeopleSuccess, setAddPeopleSuccess] = useState(false);
  const searchTimeoutRef = useRef(null);

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

  async function enrichCompanyData(forceRefresh = false) {
    let existingEnrichment = null;
    try {
      setError(null);

      const user = getEffectiveUser();
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
      existingEnrichment = currentData.apolloEnrichment || null;

      // Show existing cached data IMMEDIATELY (stale-while-revalidate)
      if (existingEnrichment) {
        setEnrichedData(existingEnrichment);
        setLoading(false);
      }

      // Check if cache is still fresh (skip API call)
      if (!forceRefresh &&
          existingEnrichment &&
          currentData.apolloEnrichedAt &&
          Date.now() - currentData.apolloEnrichedAt < 14 * 24 * 60 * 60 * 1000) {
        console.log('✅ Using cached Apollo data');
        return;
      }

      if (forceRefresh) {
        console.log('🔄 Force refresh requested - bypassing cache');
      }

      // Only show full-page loading spinner when there is no existing data
      if (!existingEnrichment) {
        setLoading(true);
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
      setLoading(false);

      // Only show error and fallback when there is no existing data to display
      if (!existingEnrichment) {
        setError(err.message);
        setEnrichedData({
          snapshot: {
            name: company.name,
            industry: company.industry,
            location: { full: company.location || 'Unknown' }
          }
        });
      }
      // If we had cached data already showing, silently ignore the refresh failure
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
      const user = getEffectiveUser();
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
    if (onFindMoreContacts) {
      onFindMoreContacts(company.id);
    } else {
      navigate(`/scout/company/${company.id}`);
    }
    onClose();
  }

  function handlePeopleSearch(e) {
    const query = e.target.value;
    setPeopleSearchQuery(query);

    clearTimeout(searchTimeoutRef.current);

    if (query.trim().length < 2) {
      setPeopleResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearchingPeople(true);
      try {
        const user = getEffectiveUser();
        if (!user) return;
        const results = await searchPeople(user.uid, query);
        setPeopleResults(results);
      } finally {
        setSearchingPeople(false);
      }
    }, 300);
  }

  function handleTogglePersonSelection(person) {
    setSelectedPeopleToAdd(prev => {
      const isSelected = prev.some(p => p.id === person.id);
      if (isSelected) return prev.filter(p => p.id !== person.id);
      return [...prev, person];
    });
  }

  async function handleAddPeopleToCompany() {
    if (selectedPeopleToAdd.length === 0) return;

    setAddingPeopleToCompany(true);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      for (const person of selectedPeopleToAdd) {
        await updatePerson(user.uid, person.id, {
          company_id: company.id,
          company_name: company.name,
          company_industry: company.industry || null,
          company: company.name
        });
      }

      // Update company contact count
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      const companyDoc = await getDoc(companyRef);
      const currentCount = companyDoc.data()?.contact_count || 0;
      await updateDoc(companyRef, {
        contact_count: currentCount + selectedPeopleToAdd.length
      });

      setAddPeopleSuccess(true);
      setSelectedPeopleToAdd([]);
      setPeopleSearchQuery('');
      setPeopleResults([]);
      setTimeout(() => setAddPeopleSuccess(false), 3000);
    } catch (err) {
      console.error('Error adding people to company:', err);
      alert('Failed to add people to company. Please try again.');
    } finally {
      setAddingPeopleToCompany(false);
    }
  }

  async function handleForceRefresh() {
    try {
      setRefreshing(true);
      console.log('🔄 Force refreshing company data...');
      await enrichCompanyData(true);
      console.log('✅ Force refresh complete');
    } catch (err) {
      console.error('❌ Force refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="company-detail-overlay" onClick={overlayReady ? onClose : undefined}>
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
          <div className="header-actions">
            <button
              className="refresh-button"
              onClick={handleForceRefresh}
              disabled={refreshing || loading}
              title="Force refresh company data (bypass cache)"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'spinning' : ''}`} />
            </button>
            <button className="close-button" onClick={onClose}>
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={contentRef} className={`company-detail-content ${hasScroll ? 'has-scroll' : ''}`}>
          {loading && !enrichedData ? (
            <div className="loading-state">
              <Loader className="spinner" />
              <p>Enriching company data...</p>
            </div>
          ) : error && !enrichedData ? (
            <div className="error-state">
              <AlertCircle className="error-icon" />
              <p>Enrichment encountered an issue</p>
              <p className="error-message">{error}</p>
              <p className="error-hint">Showing basic company information</p>
            </div>
          ) : null}

          {/* Section 1: Company Snapshot — always visible, enrichedData fills in richer values */}
          <div className="detail-section snapshot-section">
            <h3 className="section-title">Company Snapshot</h3>
            <div className="snapshot-grid">
              <div className="snapshot-item">
                <Briefcase className="snapshot-icon" />
                <div>
                  <p className="snapshot-label">Industry</p>
                  <p className="snapshot-value">{enrichedData?.snapshot?.industry || company.industry || 'Not available'}</p>
                </div>
              </div>

              <div className="snapshot-item">
                <Users className="snapshot-icon" />
                <div>
                  <p className="snapshot-label">Employees</p>
                  <p className="snapshot-value">
                    {enrichedData?.snapshot?.employee_count_range ||
                     enrichedData?.snapshot?.estimated_num_employees ||
                     company.employee_count ||
                     company.company_size ||
                     'Not available'}
                  </p>
                </div>
              </div>

              <div className="snapshot-item">
                <DollarSign className="snapshot-icon" />
                <div>
                  <p className="snapshot-label">Revenue</p>
                  <p className="snapshot-value">
                    {enrichedData?.snapshot?.revenue_range ||
                     enrichedData?.snapshot?.annual_revenue ||
                     company.revenue ||
                     'Not available'}
                  </p>
                </div>
              </div>

              <div className="snapshot-item">
                <Calendar className="snapshot-icon" />
                <div>
                  <p className="snapshot-label">Founded</p>
                  <p className="snapshot-value">{enrichedData?.snapshot?.founded_year || company.founded_year || 'Not available'}</p>
                </div>
              </div>

              <div className="snapshot-item">
                <MapPin className="snapshot-icon" />
                <div>
                  <p className="snapshot-label">Location</p>
                  <p className="snapshot-value">{enrichedData?.snapshot?.location?.full || company.location || 'Not available'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Company Overview — shown whenever a description is available */}
          {enrichedData?.snapshot?.description && (
            <div className="detail-section">
              <h3 className="section-title">Company Overview</h3>
              <p className="company-overview-text">{enrichedData.snapshot.description}</p>
            </div>
          )}

          {/* Links — always shown when URLs are available */}
          {(enrichedData?.snapshot?.website_url || enrichedData?.dataQuality?.linkedin_url || company.website_url || company.linkedin_url) && (
            <div className="detail-section">
              <h3 className="section-title">Links</h3>
              <div className="links-container">
                {(enrichedData?.snapshot?.website_url || company.website_url) && (
                  <button
                    className="link-button website"
                    onClick={() => handleOpenLink(enrichedData?.snapshot?.website_url || company.website_url)}
                  >
                    <Globe className="w-5 h-5" />
                    <span>Visit Website</span>
                    <ExternalLink className="w-4 h-4 ml-auto" />
                  </button>
                )}
                {(enrichedData?.dataQuality?.linkedin_url || company.linkedin_url) && (
                  <button
                    className="link-button linkedin"
                    onClick={() => handleOpenLink(enrichedData?.dataQuality?.linkedin_url || company.linkedin_url)}
                  >
                    <Linkedin className="w-5 h-5" />
                    <span>View on LinkedIn</span>
                    <ExternalLink className="w-4 h-4 ml-auto" />
                  </button>
                )}
              </div>
            </div>
          )}

          {enrichedData && (
            <>
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

              {/* Section: Add Your Contacts from All Leads/People */}
              <div className="detail-section add-from-people-section">
                <div className="section-header-with-actions">
                  <h3 className="section-title">Add Your Contacts</h3>
                  <p className="section-subtitle">Search your existing leads & people by name and link them to this company</p>
                </div>

                {addPeopleSuccess && (
                  <div className="people-add-success">
                    <CheckCircle className="w-4 h-4" />
                    <span>Contacts successfully linked to {company.name}!</span>
                  </div>
                )}

                <div className="people-search-container">
                  <div className="people-search-input-wrapper">
                    <Search className="people-search-icon" />
                    <input
                      type="text"
                      className="people-search-input"
                      placeholder="Search all leads & people by name..."
                      value={peopleSearchQuery}
                      onChange={handlePeopleSearch}
                    />
                    {peopleSearchQuery && (
                      <button
                        className="people-search-clear"
                        onClick={() => {
                          setPeopleSearchQuery('');
                          setPeopleResults([]);
                          setSelectedPeopleToAdd([]);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {searchingPeople && (
                    <div className="people-search-loading">
                      <Loader className="w-4 h-4 spinner" />
                      <span>Searching...</span>
                    </div>
                  )}

                  {!searchingPeople && peopleResults.length > 0 && (
                    <div className="people-search-results">
                      {peopleResults.map(person => {
                        const isSelected = selectedPeopleToAdd.some(p => p.id === person.id);
                        const isAlreadyLinked = person.company_id === company.id;
                        return (
                          <div
                            key={person.id}
                            className={`people-result-item ${isSelected ? 'selected' : ''} ${isAlreadyLinked ? 'already-linked' : ''}`}
                            onClick={() => !isAlreadyLinked && handleTogglePersonSelection(person)}
                          >
                            <div className="people-result-avatar">
                              {person.photo_url ? (
                                <img src={person.photo_url} alt={person.name} />
                              ) : (
                                <User className="w-5 h-5" />
                              )}
                            </div>
                            <div className="people-result-info">
                              <p className="people-result-name">{person.name}</p>
                              <p className="people-result-meta">
                                {[person.title, person.company_name || person.company].filter(Boolean).join(' • ')}
                              </p>
                            </div>
                            {isAlreadyLinked ? (
                              <span className="people-already-linked-badge">Already linked</span>
                            ) : (
                              <div className={`people-select-indicator ${isSelected ? 'checked' : ''}`}>
                                {isSelected && <CheckCircle className="w-4 h-4" />}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!searchingPeople && peopleSearchQuery.length >= 2 && peopleResults.length === 0 && (
                    <div className="people-no-results">
                      <p>No contacts found for &ldquo;{peopleSearchQuery}&rdquo;</p>
                    </div>
                  )}

                  {selectedPeopleToAdd.length > 0 && (
                    <button
                      className="btn-add-people-to-company"
                      onClick={handleAddPeopleToCompany}
                      disabled={addingPeopleToCompany}
                    >
                      {addingPeopleToCompany ? (
                        <>
                          <Loader className="w-4 h-4 spinner" />
                          <span>Adding...</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4" />
                          <span>Add {selectedPeopleToAdd.length} to {company.name}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Section 4: Department Breakdown */}
              {enrichedData.departments && Object.values(enrichedData.departments).some(d => d) && (
                <div className="detail-section departments-section">
                  <h3 className="section-title">Department Breakdown</h3>
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
                </div>
              )}

              {/* Section 5: Tech Stack */}
              {enrichedData.techStack && enrichedData.techStack.length > 0 && (
                <div className="detail-section tech-stack-section">
                  <h3 className="section-title">Tech Stack ({enrichedData.techStack.length})</h3>
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

            </>
          )}

          {/* Contact Status & CTA — always visible */}
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
        </div>
      </div>
    </div>
  );
}
