import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import TitleSelectionModal from '../../components/TitleSelectionModal';
import NavigationBar from '../../components/NavigationBar';
import { Search, X, CheckCircle, UserPlus, Mail, Phone, Linkedin, Briefcase, Award, Clock, Shield } from 'lucide-react';
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
    <>
      <NavigationBar />
      <div className="company-detail">
        {/* Breadcrumb Navigation */}
        <div className="breadcrumb-nav">
          <button onClick={() => navigate('/scout')} className="breadcrumb-link">
            Scout
          </button>
          <span className="breadcrumb-separator">›</span>
          <button onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })} className="breadcrumb-link">
            Saved Companies
          </button>
          <span className="breadcrumb-separator">›</span>
          <span className="breadcrumb-current">{company?.name || 'Company'}</span>
        </div>

        {/* Company Info Section */}
      <div className="company-header-section">
        <div className="company-logo-large">
          {company.name.charAt(0).toUpperCase()}
        </div>

        <div className="company-info-main">
          <h1>{company.name}</h1>
          <p className="company-meta">
            {company.industry && <span>{company.industry}</span>}
            {company.location && <span>• {company.location}</span>}
            {company.employee_count && <span>• {company.employee_count} employees</span>}
          </p>

          <div className="company-links">
            {company.website_url && (
              <a href={company.website_url} target="_blank" rel="noopener noreferrer" className="company-link-btn">
                🌐 Website
              </a>
            )}
            {company.linkedin_url && (
              <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="company-link-btn">
                💼 LinkedIn
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Custom Title Search */}
      <div className="title-search-section">
        <div className="title-search-header">
          <h3>Search for Contacts by Title</h3>
          <button className="browse-titles-btn" onClick={() => setShowTitleModal(true)}>
            Browse Common Titles
          </button>
        </div>

        <form onSubmit={handleAddCustomTitle} className="custom-title-form">
          <div className="search-input-wrapper">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="Add custom title (e.g., 'Head of Revenue Operations')..."
              value={customTitleInput}
              onChange={(e) => setCustomTitleInput(e.target.value)}
              className="custom-title-input"
            />
            <button type="submit" className="add-title-btn" disabled={!customTitleInput.trim()}>
              Add
            </button>
          </div>
        </form>

        {/* Selected Titles Badges */}
        {selectedTitles.length > 0 && (
          <div className="selected-titles-display">
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
            <p className="titles-count">
              Searching with <strong>{selectedTitles.length}</strong> title{selectedTitles.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>

      {/* Contacts Section */}
      <div className="contacts-section">
        <div className="section-header">
          <div>
            <h2>Available Contacts</h2>
            <p className="section-subtitle">
              {searchingContacts ? 'Searching...' : `${contacts.length} contacts found`}
            </p>
          </div>

          {/* Bulk Actions */}
          {!searchingContacts && contacts.length > 0 && (
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
            <p>Searching for contacts from Apollo...</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="empty-contacts">
            <p>No contacts found for the selected titles</p>
            <button onClick={() => setShowTitleModal(true)}>
              Try Different Titles
            </button>
          </div>
        ) : (
          <div className="contacts-grid">
            {contacts.map(contact => {
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
        )}
      </div>

      {/* Saved Contacts Section */}
      {approvedContacts.length > 0 && (
        <div className="saved-contacts-section">
          <div className="section-header">
            <h3>Saved Contacts ({approvedContacts.length})</h3>
            <button
              className="view-all-leads-btn"
              onClick={() => navigate(`/scout/company/${companyId}/leads`)}
            >
              View All Leads →
            </button>
          </div>

          <div className="saved-contacts-grid">
            {approvedContacts.slice(0, 6).map(contact => (
              <div key={contact.id} className="saved-contact-card">
                {/* Contact Avatar */}
                <div className="saved-contact-avatar">
                  {contact.photo_url ? (
                    <img src={contact.photo_url} alt={contact.name} />
                  ) : (
                    <div className="avatar-fallback-saved">
                      {contact.name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Contact Info */}
                <div className="saved-contact-info">
                  <h4 className="saved-contact-name">{contact.name}</h4>
                  <p className="saved-contact-title">{contact.title}</p>

                  {/* Quick Contact Info */}
                  <div className="saved-contact-quick-info">
                    {contact.email && (
                      <div className="quick-info-item">
                        <Mail className="w-3 h-3" />
                        <span className="quick-info-text">{contact.email}</span>
                      </div>
                    )}
                    {contact.phone && (
                      <div className="quick-info-item">
                        <Phone className="w-3 h-3" />
                        <span className="quick-info-text">{contact.phone}</span>
                      </div>
                    )}
                    {contact.department && (
                      <div className="quick-info-item">
                        <Briefcase className="w-3 h-3" />
                        <span className="quick-info-text">{contact.department}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="saved-contact-actions">
                  {contact.linkedin_url && (
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="saved-action-btn linkedin"
                      title="View LinkedIn"
                    >
                      <Linkedin className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    className="saved-action-btn profile"
                    onClick={() => navigate(`/scout/contact/${contact.id}`)}
                    title="View Full Profile"
                  >
                    View Profile →
                  </button>
                </div>
              </div>
            ))}
          </div>

          {approvedContacts.length > 6 && (
            <div className="more-contacts-banner">
              <p>+{approvedContacts.length - 6} more saved contacts</p>
              <button
                className="view-all-inline-btn"
                onClick={() => navigate(`/scout/company/${companyId}/leads`)}
              >
                View All
              </button>
            </div>
          )}
        </div>
      )}

        {/* Title Selection Modal */}
        {showTitleModal && company && (
          <TitleSelectionModal
            company={company}
            onClose={() => setShowTitleModal(false)}
            onConfirm={handleTitlesSelected}
          />
        )}
      </div>
    </>
  );
}
