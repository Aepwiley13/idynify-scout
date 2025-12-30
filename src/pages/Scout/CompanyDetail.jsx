import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './CompanyDetail.css';

export default function CompanyDetail() {
  const { companyId } = useParams();
  const navigate = useNavigate();

  const [company, setCompany] = useState(null);
  const [selectedTitles, setSelectedTitles] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [approvedContacts, setApprovedContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [approvingContactIds, setApprovingContactIds] = useState(new Set());

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

  // Search for contacts from Apollo
  async function searchContacts(companyData, titles) {
    setSearchingContacts(true);

    try {
      const userId = auth.currentUser.uid;
      const idToken = await auth.currentUser.getIdToken();

      // Get top 3 titles for priority search
      const topTitles = titles.slice(0, 3).map(t => t.title);

      console.log('🔍 Searching Apollo for contacts...');
      console.log('   Company:', companyData.name);
      console.log('   Org ID:', companyData.apollo_organization_id);
      console.log('   Titles:', topTitles);

      const response = await fetch('/.netlify/functions/searchPeople', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken: idToken,
          organizationId: companyData.apollo_organization_id,
          titles: topTitles
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
      {/* Header with Back Button */}
      <div className="page-header">
        <button
          className="back-btn"
          onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
        >
          ← Back to Saved Companies
        </button>
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

      {/* Selected Titles */}
      {selectedTitles.length > 0 && (
        <div className="selected-titles-section">
          <h3>Searching for contacts with these titles:</h3>
          <div className="titles-badges">
            {selectedTitles.slice(0, 3).map(titleObj => (
              <span key={titleObj.title} className="title-badge">
                #{titleObj.rank} {titleObj.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contacts Section */}
      <div className="contacts-section">
        <div className="section-header">
          <div>
            <h2>Available Contacts</h2>
            <p className="section-subtitle">
              {searchingContacts ? 'Searching Apollo...' : `${contacts.length} contacts found`}
            </p>
          </div>
          <div className="approval-counter">
            Approved: <strong>{approvedContacts.length}</strong> contacts
          </div>
        </div>

        {searchingContacts ? (
          <div className="searching-state">
            <div className="loading-spinner"></div>
            <p>Searching for contacts from Apollo...</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="empty-contacts">
            <p>No contacts found for the selected titles</p>
            <button onClick={() => navigate(`/scout/company/${companyId}`)}>
              Try Different Titles
            </button>
          </div>
        ) : (
          <div className="contacts-grid">
            {contacts.map(contact => {
              const isApproved = approvedContacts.some(c => c.apollo_person_id === contact.id);
              const isApproving = approvingContactIds.has(contact.id);

              return (
                <div key={contact.id} className={`contact-card ${isApproved ? 'approved' : ''}`}>
                  <div className="contact-avatar">
                    {contact.name?.charAt(0).toUpperCase() || '?'}
                  </div>

                  <div className="contact-info">
                    <h3>{contact.name || 'Unknown'}</h3>
                    <p className="contact-title">{contact.title || 'Title not available'}</p>

                    {contact.email && (
                      <div className="contact-detail">
                        <span className="icon">📧</span>
                        <span>{contact.email}</span>
                      </div>
                    )}

                    {contact.phone_numbers && contact.phone_numbers[0] && (
                      <div className="contact-detail">
                        <span className="icon">📞</span>
                        <span>{contact.phone_numbers[0]}</span>
                      </div>
                    )}

                    {contact.linkedin_url && (
                      <div className="contact-detail">
                        <span className="icon">💼</span>
                        <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                          LinkedIn Profile
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="contact-actions">
                    {isApproving ? (
                      <button className="approve-btn approving" disabled>
                        ⏳ Enriching...
                      </button>
                    ) : isApproved ? (
                      <button className="approve-btn approved" disabled>
                        ✓ Approved
                      </button>
                    ) : (
                      <button
                        className="approve-btn"
                        onClick={() => handleApproveContact(contact)}
                      >
                        + Approve
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Approved Contacts Section */}
      {approvedContacts.length > 0 && (
        <div className="approved-contacts-section">
          <div className="section-header">
            <h3>Approved Contacts ({approvedContacts.length})</h3>
            <button
              className="view-all-btn"
              onClick={() => navigate(`/scout/company/${companyId}/leads`)}
            >
              View All →
            </button>
          </div>

          <div className="contacts-preview">
            {approvedContacts.slice(0, 3).map(contact => (
              <div key={contact.id} className="contact-preview-card">
                <div className="contact-avatar-small">
                  {contact.name?.charAt(0).toUpperCase()}
                </div>
                <div className="contact-info-small">
                  <strong>{contact.name}</strong>
                  <span>{contact.title}</span>
                </div>
                <button
                  className="view-profile-btn"
                  onClick={() => navigate(`/scout/contact/${contact.id}`)}
                >
                  View Profile →
                </button>
              </div>
            ))}
          </div>

          {approvedContacts.length > 3 && (
            <p className="more-contacts">
              +{approvedContacts.length - 3} more contacts
            </p>
          )}
        </div>
      )}
    </div>
  );
}
