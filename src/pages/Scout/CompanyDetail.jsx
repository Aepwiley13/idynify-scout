import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import TitleSelectionModal from '../../components/TitleSelectionModal';
import { Search, X, CheckCircle, UserPlus, Mail, Phone, Linkedin, Briefcase, Award, Clock, Shield, ArrowLeft, Target, Building2, Users, TrendingUp, Settings, Globe, DollarSign, Calendar, MapPin, Tag, FileText, Facebook, Twitter, ChevronDown, ChevronUp } from 'lucide-react';
import './ScoutMain.css';
import './CompanyDetail.css';

export default function CompanyDetail() {
  const { companyId } = useParams();
  const navigate = useNavigate();

  const [company, setCompany] = useState(null);
  const [selectedTitles, setSelectedTitles] = useState([]);
  const [customTitleInput, setCustomTitleInput] = useState('');
  const [contacts, setContacts] = useState([]);
  const [approvedContacts, setApprovedContacts] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [approvingContactIds, setApprovingContactIds] = useState(new Set());
  const [savingBulkContacts, setSavingBulkContacts] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState([]);
  const [savingDecisionMakers, setSavingDecisionMakers] = useState(false);

  useEffect(() => {
    loadCompanyData();
    loadApprovedContacts();
  }, [companyId]);

  // Load company data and selected titles
  async function loadCompanyData() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;

      // Load company document
      const companyDoc = await getDoc(doc(db, 'users', userId, 'companies', companyId));

      if (!companyDoc.exists()) {
        console.error('❌ Company not found');
        navigate('/scout', { state: { activeTab: 'saved-companies' } });
        return;
      }

      const companyData = { id: companyDoc.id, ...companyDoc.data() };
      setCompany(companyData);

      // Get selected titles
      const titles = companyData.selected_titles || [];
      setSelectedTitles(titles);

      console.log('✅ Company loaded:', companyData.name);
      console.log('📋 Selected titles:', titles);

      setLoading(false);

      // Automatically search for contacts if titles exist
      if (titles.length > 0) {
        searchContacts(companyData, titles);
      }
    } catch (error) {
      console.error('❌ Failed to load company:', error);
      setLoading(false);
    }
  }

  // Load approved contacts for this company
  async function loadApprovedContacts() {
    try {
      const userId = auth.currentUser.uid;

      const contactsQuery = query(
        collection(db, 'users', userId, 'contacts'),
        where('company_id', '==', companyId)
      );

      const snapshot = await getDocs(contactsQuery);
      const contactsList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setApprovedContacts(contactsList);
      console.log('✅ Loaded approved contacts:', contactsList.length);
    } catch (error) {
      console.error('❌ Failed to load approved contacts:', error);
    }
  }

  // Handle new titles selected from modal
  function handleTitlesSelected(newTitles) {
    setShowTitleModal(false);
    setSelectedTitles(newTitles);
    // Re-search for contacts with new titles
    searchContacts(company, newTitles);
  }

  // Add custom title
  function handleAddCustomTitle(e) {
    e.preventDefault();
    const trimmedTitle = customTitleInput.trim();

    if (!trimmedTitle) return;

    // Check if already exists
    if (selectedTitles.some(t => t.title.toLowerCase() === trimmedTitle.toLowerCase())) {
      alert('This title is already in your search');
      return;
    }

    const newTitle = {
      title: trimmedTitle,
      rank: selectedTitles.length + 1,
      score: 100 - (selectedTitles.length * 10),
      custom: true
    };

    const updatedTitles = [...selectedTitles, newTitle];
    setSelectedTitles(updatedTitles);
    setCustomTitleInput('');

    // Re-search with new titles
    searchContacts(company, updatedTitles);
  }

  // Remove a title
  function handleRemoveTitle(titleToRemove) {
    const updatedTitles = selectedTitles.filter(t => t.title !== titleToRemove);
    setSelectedTitles(updatedTitles);

    // Re-search if we still have titles
    if (updatedTitles.length > 0) {
      searchContacts(company, updatedTitles);
    } else {
      setContacts([]);
    }
  }

  // Toggle contact selection
  function handleToggleContact(contactId) {
    setSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  }

  // Select all visible contacts
  function handleSelectAll() {
    const availableContacts = contacts.filter(
      c => !approvedContacts.some(ac => ac.apollo_person_id === c.id)
    );
    setSelectedContactIds(new Set(availableContacts.map(c => c.id)));
  }

  // Clear all selections
  function handleClearSelection() {
    setSelectedContactIds(new Set());
  }

  // Bulk approve selected contacts
  async function handleBulkApprove() {
    if (selectedContactIds.size === 0) return;

    setSavingBulkContacts(true);

    try {
      const userId = auth.currentUser.uid;
      const contactsToApprove = contacts.filter(c => selectedContactIds.has(c.id));

      console.log(`📦 Bulk approving ${contactsToApprove.length} contacts...`);

      // Save all contacts
      for (const contact of contactsToApprove) {
        await saveContact(userId, contact);
        await enrichContact(userId, contact.id);
      }

      // Update company contact count
      const companyRef = doc(db, 'users', userId, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);
      const currentContactCount = companyDoc.data()?.contact_count || 0;

      await updateDoc(companyRef, {
        contact_count: currentContactCount + contactsToApprove.length
      });

      console.log('✅ Bulk approval complete');

      // Reload approved contacts and clear selection
      await loadApprovedContacts();
      setSelectedContactIds(new Set());

    } catch (error) {
      console.error('❌ Bulk approval failed:', error);
      alert('Failed to approve contacts. Please try again.');
    } finally {
      setSavingBulkContacts(false);
    }
  }

  // Search for contacts from Apollo
  async function searchContacts(companyData, titles) {
    setSearchingContacts(true);

    try {
      const userId = auth.currentUser.uid;
      const idToken = await auth.currentUser.getIdToken();

      // Use ALL titles (no 3-title limit!)
      const allTitles = titles.map(t => t.title);

      console.log('🔍 Searching Apollo for contacts...');
      console.log('   Company:', companyData.name);
      console.log('   Org ID:', companyData.apollo_organization_id);
      console.log('   Titles:', allTitles);

      const response = await fetch('/.netlify/functions/searchPeople', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken: idToken,
          organizationId: companyData.apollo_organization_id,
          titles: allTitles
        })
      });

      const data = await response.json();

      if (data.success) {
        console.log('✅ Found contacts:', data.people.length);
        setContacts(data.people || []);
      } else {
        console.error('❌ Apollo search failed:', data.error);
        alert('Failed to search for contacts. Please try again.');
      }
    } catch (error) {
      console.error('❌ Contact search error:', error);
      alert('Failed to search for contacts. Please try again.');
    } finally {
      setSearchingContacts(false);
    }
  }

  // Approve a contact
  async function handleApproveContact(contact) {
    // Check if already approved
    if (approvedContacts.some(c => c.apollo_person_id === contact.id)) {
      alert('This contact has already been approved');
      return;
    }

    // Soft limit check
    if (approvedContacts.length >= 3) {
      const confirm = window.confirm(
        `You've already approved 3 contacts for this company. You can approve more if needed. Continue?`
      );
      if (!confirm) return;
    }

    // Mark as approving
    setApprovingContactIds(prev => new Set(prev).add(contact.id));

    try {
      const userId = auth.currentUser.uid;

      // Save basic contact info
      await saveContact(userId, contact);

      // Trigger enrichment
      await enrichContact(userId, contact.id);

      // Reload approved contacts
      await loadApprovedContacts();

      console.log('✅ Contact approved and enriched:', contact.name);
    } catch (error) {
      console.error('❌ Failed to approve contact:', error);
      alert('Failed to approve contact. Please try again.');
    } finally {
      // Remove from approving set
      setApprovingContactIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(contact.id);
        return newSet;
      });
    }
  }

  // Save contact to Firestore
  async function saveContact(userId, contact) {
    const contactId = `${companyId}_${contact.id}`;

    await setDoc(doc(db, 'users', userId, 'contacts', contactId), {
      // Apollo IDs
      apollo_person_id: contact.id,

      // Basic Info
      name: contact.name || 'Unknown',
      title: contact.title || '',
      email: contact.email || null,
      phone: contact.phone_numbers?.[0] || null,
      linkedin_url: contact.linkedin_url || null,

      // Company Association
      company_id: companyId,
      company_name: company.name,
      company_industry: company.industry || null,

      // Metadata
      status: 'pending_enrichment',
      saved_at: new Date().toISOString(),
      source: 'apollo_people_search'
    });

    console.log('✅ Contact saved with basic info');
  }

  // Enrich contact with full Apollo data
  async function enrichContact(userId, apolloPersonId) {
    try {
      const idToken = await auth.currentUser.getIdToken();

      console.log('🔄 Enriching contact:', apolloPersonId);

      const response = await fetch('/.netlify/functions/enrichContact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken: idToken,
          contactId: apolloPersonId
        })
      });

      const data = await response.json();

      if (data.success) {
        // Update contact with enriched data
        const contactId = `${companyId}_${apolloPersonId}`;

        await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
          ...data.enrichedData,
          status: 'active',
          enriched_at: new Date().toISOString()
        });

        console.log('✅ Contact enriched successfully');
      } else {
        // Enrichment failed - mark as failed but keep basic data
        const contactId = `${companyId}_${apolloPersonId}`;

        await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
          status: 'enrichment_failed',
          enrichment_error: data.error || 'Unknown error'
        });

        console.warn('⚠️ Enrichment failed, contact saved with basic info');
      }
    } catch (error) {
      console.error('❌ Enrichment error:', error);

      // Still mark as failed but keep the contact
      const contactId = `${companyId}_${apolloPersonId}`;
      await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
        status: 'enrichment_failed',
        enrichment_error: error.message
      });
    }
  }

  // Helper: Get seniority badge
  function getSeniorityBadge(contact) {
    const seniority = contact.seniority?.toLowerCase() || '';
    const title = (contact.title || '').toLowerCase();

    if (seniority.includes('c_') || seniority.includes('c-') || title.includes('chief') || title.includes(' ceo') || title.includes(' cfo') || title.includes(' cto')) {
      return { label: 'C-Suite', class: 'c-suite' };
    }
    if (seniority.includes('vp') || seniority.includes('vice president') || title.includes(' vp ') || title.includes('vice president')) {
      return { label: 'VP', class: 'vp' };
    }
    if (seniority.includes('director') || title.includes('director')) {
      return { label: 'Director', class: 'director' };
    }
    if (seniority.includes('manager') || title.includes('manager')) {
      return { label: 'Manager', class: 'manager' };
    }
    if (seniority.includes('senior') || title.includes('senior') || title.includes(' sr ')) {
      return { label: 'Senior', class: 'senior' };
    }
    return { label: 'Individual', class: 'individual' };
  }

  // Helper: Get department
  function getDepartment(contact) {
    const departments = contact.departments || contact.functions || [];
    if (departments.length > 0) {
      return departments[0];
    }
    return null;
  }

  // Helper: Get email status
  function getEmailStatus(contact) {
    if (!contact.email) {
      return { label: 'No Email', class: 'unavailable', icon: '✗' };
    }
    if (contact.email_status === 'verified') {
      return { label: 'Verified', class: 'verified', icon: '✓' };
    }
    return { label: 'Available', class: 'available', icon: '~' };
  }

  // Toggle decision maker selection
  function handleToggleDecisionMaker(person) {
    setSelectedDecisionMakers(prev => {
      const isSelected = prev.some(p => p.id === person.id);
      if (isSelected) {
        return prev.filter(p => p.id !== person.id);
      } else {
        return [...prev, person];
      }
    });
  }

  // Add selected decision makers as leads
  async function handleAddDecisionMakersToLeads() {
    if (selectedDecisionMakers.length === 0) return;

    try {
      setSavingDecisionMakers(true);
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Save each selected decision maker as a contact
      for (const person of selectedDecisionMakers) {
        const contactId = `${companyId}_${person.id}`;

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
          company_id: companyId,
          company_name: company.name,
          company_industry: company.industry || null,

          // Additional Info
          department: person.department || null,
          seniority: person.seniority || null,

          // Metadata
          status: 'active',
          saved_at: new Date().toISOString(),
          source: 'decision_makers'
        });
      }

      // Update company contact count
      const companyRef = doc(db, 'users', user.uid, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);
      const currentContactCount = companyDoc.data()?.contact_count || 0;

      await updateDoc(companyRef, {
        contact_count: currentContactCount + selectedDecisionMakers.length
      });

      console.log(`✅ Added ${selectedDecisionMakers.length} decision makers as leads`);

      // Reload approved contacts and clear selection
      await loadApprovedContacts();
      setSelectedDecisionMakers([]);
      setSavingDecisionMakers(false);

    } catch (err) {
      console.error('Error saving decision makers:', err);
      setSavingDecisionMakers(false);
      alert('Failed to save contacts. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="company-detail-loading">
        <div className="loading-spinner"></div>
        <p>[LOADING COMPANY...]</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="company-detail-error">
        <p>Company not found</p>
        <button onClick={() => navigate('/scout')}>← Back to Scout</button>
      </div>
    );
  }

  return (
    <div className="company-detail">
      {/* Scout Header */}
      <header className="scout-header">
        <div className="header-left">
          <button
            className="back-btn"
            onClick={() => navigate('/mission-control-v2')}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Mission Control</span>
          </button>
        </div>

        <div className="header-right">
          <div className="scout-branding">
            <Target className="w-5 h-5" />
            <span>Scout</span>
          </div>
        </div>
      </header>

      {/* Scout Tab Navigation */}
      <nav className="scout-tabs">
        <div className="tabs-container">
          <button
            className="tab"
            onClick={() => navigate('/scout', { state: { activeTab: 'daily-leads' } })}
          >
            <Target className="w-4 h-4" />
            <span>Daily Leads</span>
          </button>

          <button
            className="tab active"
            onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
          >
            <Building2 className="w-4 h-4" />
            <span>Saved Companies</span>
          </button>

          <button
            className="tab"
            onClick={() => navigate('/scout', { state: { activeTab: 'all-leads' } })}
          >
            <Users className="w-4 h-4" />
            <span>All Leads</span>
          </button>

          <button
            className="tab"
            onClick={() => navigate('/scout', { state: { activeTab: 'total-market' } })}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Total Market</span>
          </button>

          <button
            className="tab"
            onClick={() => navigate('/scout', { state: { activeTab: 'icp-settings' } })}
          >
            <Settings className="w-4 h-4" />
            <span>ICP Settings</span>
          </button>
        </div>
      </nav>

      {/* Company Info Card - Matching SavedCompanies Design */}
      <div className="company-detail-content">
        <div className="company-info-card">
          {/* Contact Badge */}
          {approvedContacts.length > 0 && (
            <div className="contact-badge">
              <CheckCircle className="w-3 h-3" />
              <span>{approvedContacts.length} contact{approvedContacts.length !== 1 ? 's' : ''} saved</span>
            </div>
          )}

          {/* Company Header with Logo */}
          <div className="company-card-header">
            <div className="company-logo-wrapper">
              {company.domain ? (
                <img
                  src={`https://logo.clearbit.com/${company.domain}`}
                  alt={`${company.name} logo`}
                  className="company-logo"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <div className="company-logo-fallback" style={{ display: company.domain ? 'none' : 'flex' }}>
                <Building2 className="w-8 h-8 text-gray-400" />
              </div>
            </div>
            <div className="company-header-info">
              <h1 className="company-name">{company.name || 'Unknown Company'}</h1>
              <p className="company-industry">{company.industry || 'Industry not specified'}</p>
            </div>
          </div>

          {/* Stats Grid - Matching SavedCompanies */}
          <div className="company-stats-grid">
            {/* Industry */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <Briefcase className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Industry</p>
                <p className="stat-value">{company.industry || 'Not available'}</p>
              </div>
            </div>

            {/* Employees */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <Users className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Employees</p>
                <p className="stat-value">{company.employee_count || company.company_size || 'Not available'}</p>
              </div>
            </div>

            {/* Revenue */}
            {company.revenue && (
              <div className="company-stat-item">
                <div className="stat-icon">
                  <DollarSign className="w-5 h-5 text-gray-500" />
                </div>
                <div className="stat-content">
                  <p className="stat-label">Revenue</p>
                  <p className="stat-value">{company.revenue}</p>
                </div>
              </div>
            )}

            {/* Founded */}
            {company.founded_year && (
              <div className="company-stat-item">
                <div className="stat-icon">
                  <Calendar className="w-5 h-5 text-gray-500" />
                </div>
                <div className="stat-content">
                  <p className="stat-label">Founded</p>
                  <p className="stat-value">{company.founded_year}</p>
                </div>
              </div>
            )}

            {/* Location */}
            {company.location && (
              <div className="company-stat-item">
                <div className="stat-icon">
                  <MapPin className="w-5 h-5 text-gray-500" />
                </div>
                <div className="stat-content">
                  <p className="stat-label">Location</p>
                  <p className="stat-value">{company.location}</p>
                </div>
              </div>
            )}
          </div>

          {/* Quick Links - Expanded with all social media */}
          <div className="company-quick-links">
            {(company.apolloEnrichment?.snapshot?.website_url || company.website_url) && (
              <button
                className="company-quick-link website"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(company.apolloEnrichment?.snapshot?.website_url || company.website_url, '_blank', 'noopener,noreferrer');
                }}
              >
                <Globe className="w-4 h-4" />
                <span>Website</span>
              </button>
            )}
            {(company.apolloEnrichment?.snapshot?.linkedin_url || company.linkedin_url) && (
              <button
                className="company-quick-link linkedin"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(company.apolloEnrichment?.snapshot?.linkedin_url || company.linkedin_url, '_blank', 'noopener,noreferrer');
                }}
              >
                <Linkedin className="w-4 h-4" />
                <span>LinkedIn</span>
              </button>
            )}
            {company.apolloEnrichment?.snapshot?.facebook_url && (
              <button
                className="company-quick-link facebook"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(company.apolloEnrichment.snapshot.facebook_url, '_blank', 'noopener,noreferrer');
                }}
              >
                <Facebook className="w-4 h-4" />
                <span>Facebook</span>
              </button>
            )}
            {company.apolloEnrichment?.snapshot?.twitter_url && (
              <button
                className="company-quick-link twitter"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(company.apolloEnrichment.snapshot.twitter_url, '_blank', 'noopener,noreferrer');
                }}
              >
                <Twitter className="w-4 h-4" />
                <span>X (Twitter)</span>
              </button>
            )}
            {company.apolloEnrichment?.snapshot?.phone && (
              <button
                className="company-quick-link phone"
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = `tel:${company.apolloEnrichment.snapshot.phone}`;
                }}
              >
                <Phone className="w-4 h-4" />
                <span>{company.apolloEnrichment.snapshot.phone}</span>
              </button>
            )}
          </div>

          {/* Collapsible Company Overview */}
          {company.apolloEnrichment?.snapshot?.description && (
            <div className="company-expandable-section">
              <button
                className="expandable-header"
                onClick={() => setShowOverview(!showOverview)}
              >
                <div className="expandable-title">
                  <FileText className="w-5 h-5" />
                  <span>Company Overview</span>
                </div>
                {showOverview ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
              {showOverview && (
                <div className="expandable-content">
                  <p className="company-description">{company.apolloEnrichment.snapshot.description}</p>
                </div>
              )}
            </div>
          )}

          {/* Collapsible Industries & Keywords */}
          {(company.apolloEnrichment?.snapshot?.keywords?.length > 0 || company.industry) && (
            <div className="company-expandable-section">
              <button
                className="expandable-header"
                onClick={() => setShowKeywords(!showKeywords)}
              >
                <div className="expandable-title">
                  <Tag className="w-5 h-5" />
                  <span>Industries & Keywords</span>
                </div>
                {showKeywords ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
              {showKeywords && (
                <div className="expandable-content">
                  <div className="tags-container">
                    {company.industry && (
                      <span className="tag tag-industry">{company.industry}</span>
                    )}
                    {company.apolloEnrichment?.snapshot?.keywords?.map((keyword, index) => (
                      <span key={index} className="tag tag-keyword">{keyword}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SIC Codes - Keep as separate section below */}
          {company.apolloEnrichment?.snapshot?.sic_codes?.length > 0 && (
            <div className="company-expandable-section">
              <div className="sic-codes-inline">
                <div className="sic-label">
                  <Briefcase className="w-4 h-4" />
                  <span>SIC Codes:</span>
                </div>
                <div className="sic-codes-list">
                  {company.apolloEnrichment.snapshot.sic_codes.map((code, index) => (
                    <span key={index} className="sic-code-inline">{code}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Saved Contacts Section */}
        {approvedContacts.length > 0 && (
          <div className="saved-contacts-section">
            <div className="section-header-main">
              <h3 className="section-title-main">
                <CheckCircle className="w-6 h-6" />
                <span>Saved Contacts ({approvedContacts.length})</span>
              </h3>
              <button
                className="view-all-leads-btn"
                onClick={() => navigate(`/scout/company/${companyId}/leads`)}
              >
                View All Leads →
              </button>
            </div>

            <div className="decision-makers-grid">
              {approvedContacts.map(contact => (
                <div key={contact.id} className="decision-maker-card already-saved">
                  {/* Saved Badge */}
                  <div className="decision-maker-saved-badge">
                    <CheckCircle className="w-4 h-4" />
                    <span>Saved</span>
                  </div>

                  <div className="decision-maker-header">
                    <div className="decision-maker-avatar">
                      {contact.photo_url ? (
                        <img src={contact.photo_url} alt={contact.name} />
                      ) : (
                        <div className="avatar-placeholder">
                          <Users className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <div className="decision-maker-info">
                      <p className="decision-maker-name">{contact.name}</p>
                      <p className="decision-maker-title">{contact.title}</p>
                      {(contact.departments?.[0] || contact.department) && (
                        <span className="decision-maker-dept">
                          {contact.departments?.[0] || contact.department}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* LinkedIn Button */}
                  {contact.linkedin_url && (
                    <button
                      className="decision-maker-linkedin"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(contact.linkedin_url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <Linkedin className="w-4 h-4" />
                      <span>LinkedIn</span>
                    </button>
                  )}

                  {/* View Profile Button */}
                  <button
                    className="decision-maker-view-profile"
                    onClick={() => navigate(`/scout/contact/${contact.id}`)}
                  >
                    View Profile →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key Decision Makers Section */}
        {company.apolloEnrichment?.decisionMakers && company.apolloEnrichment.decisionMakers.length > 0 && (
          <div className="decision-makers-section">
            <div className="section-header-main">
              <h3 className="section-title-main">
                <Users className="w-6 h-6" />
                <span>Key Decision Makers</span>
              </h3>
              <p className="section-subtitle-main">Select contacts to add as leads</p>
            </div>

            <div className="decision-makers-grid">
              {company.apolloEnrichment.decisionMakers.map((person, idx) => {
                const isSelected = selectedDecisionMakers.some(p => p.id === person.id);
                const isAlreadySaved = approvedContacts.some(c => c.apollo_person_id === person.id);

                return (
                  <div
                    key={idx}
                    className={`decision-maker-card ${isSelected ? 'selected' : ''} ${isAlreadySaved ? 'already-saved' : ''}`}
                    onClick={() => !isAlreadySaved && handleToggleDecisionMaker(person)}
                  >
                    {/* Selection Checkbox or Saved Badge */}
                    {isAlreadySaved ? (
                      <div className="decision-maker-saved-badge">
                        <CheckCircle className="w-4 h-4" />
                        <span>Saved</span>
                      </div>
                    ) : (
                      <div className="decision-maker-select-indicator">
                        <div className={`checkbox ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <CheckCircle className="w-5 h-5" />}
                        </div>
                      </div>
                    )}

                    <div className="decision-maker-header">
                      <div className="decision-maker-avatar">
                        {person.photo_url ? (
                          <img src={person.photo_url} alt={person.name} />
                        ) : (
                          <div className="avatar-placeholder">
                            <Users className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div className="decision-maker-info">
                        <p className="decision-maker-name">{person.name}</p>
                        <p className="decision-maker-title">{person.title}</p>
                        {person.department && (
                          <span className="decision-maker-dept">{person.department}</span>
                        )}
                      </div>
                    </div>

                    {person.linkedin_url && (
                      <button
                        className="decision-maker-linkedin"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(person.linkedin_url, '_blank', 'noopener,noreferrer');
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

            {/* Action Button */}
            {selectedDecisionMakers.length > 0 && (
              <div className="decision-makers-actions">
                <button
                  className="btn-add-selected-dm"
                  onClick={handleAddDecisionMakersToLeads}
                  disabled={savingDecisionMakers}
                >
                  {savingDecisionMakers ? (
                    <>
                      <div className="loading-spinner-small"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-5 h-5" />
                      <span>Add {selectedDecisionMakers.length} to Leads</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

      {/* Title Search Section */}
      <div className="title-search-section">
        <div className="title-search-header">
          <div className="header-text">
            <h3 className="section-title-search">Search for Contacts by Title</h3>
            <p className="section-subtitle-search">
              {selectedTitles.length === 0
                ? 'Add titles to search for contacts at this company'
                : `Searching for ${selectedTitles.length} title${selectedTitles.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>
          <button className="browse-titles-btn" onClick={() => setShowTitleModal(true)}>
            <Target className="w-4 h-4" />
            <span>Browse Common Titles</span>
          </button>
        </div>

        {/* Custom Title Input */}
        <form onSubmit={handleAddCustomTitle} className="custom-title-form">
          <div className="search-input-wrapper">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="Or add a custom title (e.g., 'Head of Revenue Operations')..."
              value={customTitleInput}
              onChange={(e) => setCustomTitleInput(e.target.value)}
              className="custom-title-input"
            />
            <button type="submit" className="add-title-btn" disabled={!customTitleInput.trim()}>
              <span>Add</span>
            </button>
          </div>
        </form>

        {/* Active Titles Display */}
        {selectedTitles.length > 0 && (
          <div className="active-titles-section">
            <div className="active-titles-header">
              <div className="active-titles-label">
                <Target className="w-4 h-4" />
                <span>Active Titles ({selectedTitles.length})</span>
              </div>
              {selectedTitles.length > 1 && (
                <button
                  className="clear-all-titles-btn"
                  onClick={() => {
                    setSelectedTitles([]);
                    setContacts([]);
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
            <div className="titles-badges-wrapper">
              {selectedTitles.map((titleObj) => (
                <div key={titleObj.title} className={`title-badge-chip ${titleObj.custom ? 'custom' : ''}`}>
                  <span className="badge-rank">#{titleObj.rank}</span>
                  <span className="badge-title">{titleObj.title}</span>
                  <button
                    className="badge-remove"
                    onClick={() => handleRemoveTitle(titleObj.title)}
                    title="Remove title"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {selectedTitles.length === 0 && (
          <div className="title-search-empty-state">
            <Target className="w-12 h-12" />
            <h4>No Titles Selected</h4>
            <p>Choose common titles or add custom ones to start finding contacts</p>
          </div>
        )}
      </div>

      {/* Contacts Section */}
      <div className="contacts-section">
        <div className="section-header">
          <div>
            <h2>Available Contacts</h2>
            <p className="section-subtitle">
              {searchingContacts
                ? `Searching Apollo for ${selectedTitles.length} title${selectedTitles.length !== 1 ? 's' : ''}...`
                : (() => {
                    const availableCount = contacts.filter(c => !approvedContacts.some(ac => ac.apollo_person_id === c.id)).length;
                    return availableCount > 0
                      ? `Found ${availableCount} contact${availableCount !== 1 ? 's' : ''}`
                      : selectedTitles.length > 0
                        ? 'No contacts found for these titles'
                        : 'Add titles above to start searching';
                  })()
              }
            </p>
          </div>

          {/* Bulk Actions */}
          {!searchingContacts && (() => {
            const availableCount = contacts.filter(c => !approvedContacts.some(ac => ac.apollo_person_id === c.id)).length;
            return availableCount > 0;
          })() && (
            <div className="bulk-actions">
              {selectedContactIds.size > 0 ? (
                <>
                  <span className="selected-count">
                    {selectedContactIds.size} selected
                  </span>
                  <button className="bulk-approve-btn" onClick={handleBulkApprove} disabled={savingBulkContacts}>
                    {savingBulkContacts ? (
                      <>
                        <div className="loading-spinner-small"></div>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>Add {selectedContactIds.size} to Leads</span>
                      </>
                    )}
                  </button>
                  <button className="clear-selection-btn" onClick={handleClearSelection}>
                    Clear
                  </button>
                </>
              ) : (
                <>
                  <button className="select-all-btn" onClick={handleSelectAll}>
                    Select All
                  </button>
                  <div className="approval-counter">
                    Saved: <strong>{approvedContacts.length}</strong>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {searchingContacts ? (
          <div className="searching-state">
            <div className="loading-spinner"></div>
            <h4>Searching Apollo</h4>
            <p>Looking for {selectedTitles.map(t => t.title).join(', ')} at {company.name}</p>
          </div>
        ) : (() => {
          const availableContacts = contacts.filter(c => !approvedContacts.some(ac => ac.apollo_person_id === c.id));

          if (availableContacts.length === 0 && selectedTitles.length > 0 && contacts.length > 0) {
            // All contacts have been saved
            return (
              <div className="empty-contacts">
                <CheckCircle className="w-16 h-16" style={{ color: '#10b981' }} />
                <h4>All Contacts Saved!</h4>
                <p>You've saved all {contacts.length} contact{contacts.length !== 1 ? 's' : ''} found for these titles at {company.name}</p>
                <div className="empty-actions">
                  <button className="try-different-btn" onClick={() => setShowTitleModal(true)}>
                    <Target className="w-4 h-4" />
                    <span>Add More Titles</span>
                  </button>
                </div>
              </div>
            );
          } else if (contacts.length === 0 && selectedTitles.length > 0) {
            // No contacts found
            return (
              <div className="empty-contacts">
                <Users className="w-16 h-16" />
                <h4>No Contacts Found</h4>
                <p>We couldn't find any contacts with these titles at {company.name}</p>
                <div className="empty-actions">
                  <button className="try-different-btn" onClick={() => setShowTitleModal(true)}>
                    <Target className="w-4 h-4" />
                    <span>Browse Common Titles</span>
                  </button>
                  <button className="clear-titles-btn" onClick={() => setSelectedTitles([])}>
                    <X className="w-4 h-4" />
                    <span>Clear Titles & Try Again</span>
                  </button>
                </div>
              </div>
            );
          } else if (contacts.length === 0) {
            // No search performed yet
            return (
              <div className="no-search-state">
                <Search className="w-16 h-16" />
                <h4>Ready to Find Contacts</h4>
                <p>Add job titles above to start searching for contacts at {company.name}</p>
              </div>
            );
          } else {
            // Show available contacts
            return (
          <div className="contacts-grid">
            {contacts
              .filter(contact => !approvedContacts.some(c => c.apollo_person_id === contact.id))
              .map(contact => {
              const isApproved = approvedContacts.some(c => c.apollo_person_id === contact.id);
              const isApproving = approvingContactIds.has(contact.id);
              const isSelected = selectedContactIds.has(contact.id);
              const seniority = getSeniorityBadge(contact);
              const department = getDepartment(contact);
              const emailStatus = getEmailStatus(contact);

              return (
                <div
                  key={contact.id}
                  className={`contact-card-enriched ${isApproved ? 'approved' : ''} ${isSelected ? 'selected' : ''}`}
                >
                  {/* Selection Checkbox */}
                  {!isApproved && (
                    <div className="contact-select-indicator">
                      <div
                        className={`checkbox ${isSelected ? 'checked' : ''}`}
                        onClick={() => handleToggleContact(contact.id)}
                      >
                        {isSelected && <CheckCircle className="w-5 h-5" />}
                      </div>
                    </div>
                  )}

                  {/* Contact Header with Photo */}
                  <div className="contact-card-header">
                    <div className="contact-avatar-enriched">
                      {contact.photo_url ? (
                        <img src={contact.photo_url} alt={contact.name} />
                      ) : (
                        <div className="avatar-fallback">
                          {contact.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                      )}
                    </div>

                    <div className="contact-header-info">
                      <h3 className="contact-name">{contact.name || 'Unknown'}</h3>

                      {/* Badges Row */}
                      <div className="contact-badges">
                        <span className={`seniority-badge ${seniority.class}`}>
                          <Award className="w-3 h-3" />
                          {seniority.label}
                        </span>
                        {department && (
                          <span className="department-badge">
                            <Briefcase className="w-3 h-3" />
                            {department}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Title */}
                  <p className="contact-title-enriched">{contact.title || 'Title not available'}</p>

                  {/* Contact Details Grid */}
                  <div className="contact-details-grid">
                    {/* Email */}
                    <div className="contact-detail-item">
                      <div className="detail-label">
                        <Mail className="w-4 h-4" />
                        <span>Email</span>
                      </div>
                      {contact.email ? (
                        <div className="detail-value">
                          <a href={`mailto:${contact.email}`} className="detail-link">
                            {contact.email}
                          </a>
                          <span className={`email-status ${emailStatus.class}`}>
                            {emailStatus.icon}
                          </span>
                        </div>
                      ) : (
                        <span className="detail-unavailable">Not available</span>
                      )}
                    </div>

                    {/* Phone */}
                    {contact.phone_numbers && contact.phone_numbers[0] && (
                      <div className="contact-detail-item">
                        <div className="detail-label">
                          <Phone className="w-4 h-4" />
                          <span>Phone</span>
                        </div>
                        <a href={`tel:${contact.phone_numbers[0]}`} className="detail-link">
                          {contact.phone_numbers[0]}
                        </a>
                      </div>
                    )}

                    {/* LinkedIn */}
                    {contact.linkedin_url && (
                      <div className="contact-detail-item">
                        <div className="detail-label">
                          <Linkedin className="w-4 h-4" />
                          <span>LinkedIn</span>
                        </div>
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="detail-link"
                        >
                          View Profile →
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="contact-card-footer">
                    {isApproving ? (
                      <button className="contact-action-btn approving" disabled>
                        <div className="loading-spinner-small"></div>
                        <span>Saving...</span>
                      </button>
                    ) : isApproved ? (
                      <button className="contact-action-btn approved" disabled>
                        <CheckCircle className="w-4 h-4" />
                        <span>Saved</span>
                      </button>
                    ) : (
                      <button
                        className="contact-action-btn"
                        onClick={() => handleApproveContact(contact)}
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Add to Leads</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
            );
          }
        })()}
      </div>
      </div>

      {/* Title Selection Modal */}
      {showTitleModal && company && (
        <TitleSelectionModal
          company={company}
          onClose={() => setShowTitleModal(false)}
          onConfirm={handleTitlesSelected}
        />
      )}
    </div>
  );
}
