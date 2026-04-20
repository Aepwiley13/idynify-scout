import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { archiveCompanyWithCascade, restoreCompanyWithCascade } from '../../services/companyArchiveService';
import { Search, X, CheckCircle, UserPlus, Mail, Phone, Linkedin, Briefcase, Award, Clock, Shield, Target, Building2, Users, Globe, DollarSign, Calendar, MapPin, Tag, FileText, Facebook, Twitter, ChevronDown, ChevronUp, Archive, RotateCcw, RefreshCw, Code, ExternalLink, Loader, User } from 'lucide-react';
import './ScoutMain.css';
import './CompanyDetail.css';
import { searchPeople, updatePerson } from '../../services/peopleService';
import { getEffectiveUser } from '../../context/ImpersonationContext';

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
  const [showKeywords, setShowKeywords] = useState(false);
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState([]);
  const [savingDecisionMakers, setSavingDecisionMakers] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [suggestedContacts, setSuggestedContacts] = useState([]);
  const [selectedSuggestedIds, setSelectedSuggestedIds] = useState(new Set());
  const [approvingSuggested, setApprovingSuggested] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [selectedPeopleToAdd, setSelectedPeopleToAdd] = useState([]);
  const [addingPeopleToCompany, setAddingPeopleToCompany] = useState(false);
  const [addPeopleSuccess, setAddPeopleSuccess] = useState(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    loadCompanyData();
    loadApprovedContacts();
  }, [companyId]);

  // Load company data and selected titles
  async function loadCompanyData() {
    try {
      const user = getEffectiveUser();
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
      let titles = companyData.selected_titles || [];

      // If no titles saved, auto-populate from user's ICP targetTitles
      if (titles.length === 0) {
        try {
          const icpDoc = await getDoc(doc(db, 'users', userId, 'companyProfile', 'current'));
          if (icpDoc.exists()) {
            const icpTitles = icpDoc.data().targetTitles || [];
            if (icpTitles.length > 0) {
              titles = icpTitles.map((title, index) => ({
                title,
                rank: index + 1,
                score: 100 - (index * 10),
                source: 'icp',
              }));
              // Persist so they're saved to the company for next load
              await updateDoc(doc(db, 'users', userId, 'companies', companyId), {
                selected_titles: titles,
                titles_source: 'icp_auto',
                titles_updated_at: new Date().toISOString(),
              });
              console.log('🎯 Auto-loaded ICP titles:', titles.map(t => t.title));
            }
          }
        } catch (icpErr) {
          console.warn('⚠️ Could not load ICP titles:', icpErr);
        }
      }

      setSelectedTitles(titles);

      console.log('✅ Company loaded:', companyData.name);
      console.log('📋 Selected titles:', titles);

      setLoading(false);

      // Automatically search for contacts if titles exist
      if (titles.length > 0) {
        searchContacts(companyData, titles);
      }

      // Auto-trigger enrichment if no cached data or cache is stale
      const isStale = !companyData.apolloEnrichedAt ||
        Date.now() - companyData.apolloEnrichedAt > 14 * 24 * 60 * 60 * 1000;
      if (!companyData.apolloEnrichment || isStale) {
        enrichCompanyData(false);
      }
    } catch (error) {
      console.error('❌ Failed to load company:', error);
      setLoading(false);
    }
  }

  // Load approved and suggested contacts for this company
  async function loadApprovedContacts() {
    try {
      const userId = getEffectiveUser()?.uid;

      const contactsQuery = query(
        collection(db, 'users', userId, 'contacts'),
        where('company_id', '==', companyId)
      );

      const snapshot = await getDocs(contactsQuery);
      const allContacts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const approved = allContacts.filter(c => c.status !== 'suggested');
      const suggested = allContacts.filter(c => c.status === 'suggested');

      setApprovedContacts(approved);
      setSuggestedContacts(suggested);
      console.log('✅ Loaded contacts:', approved.length, 'approved,', suggested.length, 'suggested');
    } catch (error) {
      console.error('❌ Failed to load approved contacts:', error);
    }
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
      const userId = getEffectiveUser()?.uid;
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
      const userId = getEffectiveUser()?.uid;
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
      const userId = getEffectiveUser()?.uid;

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

      // Company Association (required for Lead system)
      company_id: companyId,
      company_name: company.name,
      company_industry: company.industry || null,

      // Lead Ownership (required for CRM export and multi-user support)
      lead_owner: userId,

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

  // Helper: Get leadership badge (star system)
  function getLeadershipBadge(contact) {
    const seniority = contact.seniority?.toLowerCase() || '';
    const title = (contact.title || '').toLowerCase();

    if (seniority.includes('c_') || seniority.includes('c-') || title.includes('chief') || title.includes(' ceo') || title.includes(' cfo') || title.includes(' cto')) {
      return { letter: 'C', class: 'c-level' };
    }
    if (seniority.includes('vp') || seniority.includes('vice president') || title.includes(' vp ') || title.includes('vice president')) {
      return { letter: 'V', class: 'vp-level' };
    }
    if (seniority.includes('director') || title.includes('director')) {
      return { letter: 'D', class: 'director-level' };
    }
    if (seniority.includes('manager') || title.includes('manager')) {
      return { letter: 'M', class: 'manager-level' };
    }
    // No leadership badge for non-leadership roles
    return null;
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
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      // Save each selected decision maker as a contact/lead
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

          // Company Association (required for Lead system)
          company_id: companyId,
          company_name: company.name,
          company_industry: company.industry || null,

          // Lead Ownership (required for CRM export and multi-user support)
          lead_owner: user.uid,

          // Additional Info
          department: person.department || null,
          seniority: person.seniority || null,

          // Metadata
          status: 'pending_enrichment',
          saved_at: new Date().toISOString(),
          source: 'decision_makers'
        });

        // Trigger enrichment for decision makers too
        await enrichContact(user.uid, person.id);
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

  // Toggle suggested contact selection
  function handleToggleSuggested(contactId) {
    setSelectedSuggestedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  }

  // Approve selected suggested contacts
  async function handleApproveSuggestedContacts() {
    if (selectedSuggestedIds.size === 0) return;

    setApprovingSuggested(true);

    try {
      const userId = getEffectiveUser()?.uid;
      const toApprove = suggestedContacts.filter(c => selectedSuggestedIds.has(c.id));

      for (const contact of toApprove) {
        // Update status from 'suggested' to 'pending_enrichment'
        await updateDoc(doc(db, 'users', userId, 'contacts', contact.id), {
          status: 'pending_enrichment',
          approved_at: new Date().toISOString()
        });

        // Trigger enrichment
        const apolloPersonId = contact.apollo_person_id || contact.id.split('_').pop();
        await enrichContact(userId, apolloPersonId);
      }

      // Update company contact count
      const companyRef = doc(db, 'users', userId, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);
      const currentContactCount = companyDoc.data()?.contact_count || 0;

      await updateDoc(companyRef, {
        contact_count: currentContactCount + toApprove.length
      });

      console.log(`✅ Approved ${toApprove.length} suggested contacts`);

      // Reload contacts and clear selection
      await loadApprovedContacts();
      setSelectedSuggestedIds(new Set());
    } catch (error) {
      console.error('❌ Failed to approve suggested contacts:', error);
      alert('Failed to approve contacts. Please try again.');
    } finally {
      setApprovingSuggested(false);
    }
  }

  // Enrich company data via Apollo (force refresh bypasses 14-day cache)
  async function enrichCompanyData(forceRefresh = false) {
    try {
      setEnriching(true);
      const user = getEffectiveUser();
      if (!user) return;

      const companyRef = doc(db, 'users', user.uid, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);
      if (!companyDoc.exists()) return;

      const currentData = companyDoc.data();

      // Check if cache is still fresh
      if (!forceRefresh &&
          currentData.apolloEnrichment &&
          currentData.apolloEnrichedAt &&
          Date.now() - currentData.apolloEnrichedAt < 14 * 24 * 60 * 60 * 1000) {
        console.log('✅ Using cached Apollo data');
        return;
      }

      console.log(forceRefresh ? '🔄 Force refreshing company data...' : '🔄 Fetching Apollo enrichment...');

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/enrichCompany', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          domain: currentData.domain || extractDomain(currentData.website_url),
          organizationId: currentData.apollo_id || null
        })
      });

      if (!response.ok) throw new Error('Enrichment failed');

      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Enrichment failed');

      await updateDoc(companyRef, {
        apolloEnrichment: result.data,
        apolloEnrichedAt: Date.now(),
        apollo_id: result.data._raw?.apolloOrgId || null
      });

      // Update local company state with fresh enrichment data
      setCompany(prev => ({
        ...prev,
        apolloEnrichment: result.data,
        apolloEnrichedAt: Date.now()
      }));

      console.log('✅ Company enriched successfully');
    } catch (err) {
      console.error('❌ Enrichment failed:', err);
    } finally {
      setEnriching(false);
    }
  }

  function extractDomain(url) {
    if (!url) return null;
    try {
      return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    } catch {
      return null;
    }
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
          company_id: companyId,
          company_name: company.name,
          company_industry: company.industry || null,
          company: company.name
        });
      }

      // Update company contact count
      const companyRef = doc(db, 'users', user.uid, 'companies', companyId);
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

  // Archive this company (with cascade to contacts)
  async function handleArchiveCompany() {
    const confirmed = window.confirm(
      `Archive ${company?.name}? This will move it out of your active pipeline. You can restore it later from the Archived tab.`
    );
    if (!confirmed) return;

    setArchiving(true);
    try {
      const userId = getEffectiveUser()?.uid;
      await archiveCompanyWithCascade(userId, companyId);

      // Navigate back to saved companies
      navigate('/scout', { state: { activeTab: 'saved-companies' } });
    } catch (error) {
      console.error('Failed to archive company:', error);
      alert('Failed to archive company. Please try again.');
      setArchiving(false);
    }
  }

  // Restore this company from archive (with cascade to contacts)
  async function handleRestoreCompany() {
    setArchiving(true);
    try {
      const userId = getEffectiveUser()?.uid;
      await restoreCompanyWithCascade(userId, companyId);

      // Reload company data to reflect new status
      setCompany(prev => ({ ...prev, status: 'accepted' }));
      setArchiving(false);
    } catch (error) {
      console.error('Failed to restore company:', error);
      alert('Failed to restore company. Please try again.');
      setArchiving(false);
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
      {/* Company Info Card */}
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

          {/* Archive / Restore Banner */}
          {company.status === 'archived' ? (
            <div className="company-archive-banner restored">
              <div className="archive-banner-text">
                <Archive className="w-4 h-4" />
                <span>This company is archived</span>
              </div>
              <button
                className="company-restore-btn"
                onClick={handleRestoreCompany}
                disabled={archiving}
              >
                <RotateCcw className="w-4 h-4" />
                <span>{archiving ? 'Restoring...' : 'Restore to Active'}</span>
              </button>
            </div>
          ) : (
            <div className="company-archive-action">
              <button
                className="company-refresh-btn"
                onClick={() => enrichCompanyData(true)}
                disabled={enriching}
                title="Refresh & enrich company data from Apollo"
              >
                {enriching ? (
                  <>
                    <Loader className="w-4 h-4 cd-spinner" />
                    <span>Refreshing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Refresh / Enrich</span>
                  </>
                )}
              </button>
              <button
                className="company-archive-btn"
                onClick={handleArchiveCompany}
                disabled={archiving}
              >
                <Archive className="w-4 h-4" />
                <span>{archiving ? 'Archiving...' : 'Archive Company'}</span>
              </button>
            </div>
          )}

          {/* Stats Grid - Company Snapshot */}
          <div className="company-stats-grid">
            {/* Industry */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <Briefcase className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Industry</p>
                <p className="stat-value">
                  {company.apolloEnrichment?.snapshot?.industry || company.industry || 'Not available'}
                </p>
              </div>
            </div>

            {/* Employees */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <Users className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Employees</p>
                <p className="stat-value">
                  {company.apolloEnrichment?.snapshot?.employee_count_range ||
                   company.apolloEnrichment?.snapshot?.estimated_num_employees ||
                   company.employee_count || company.company_size || 'Not available'}
                </p>
              </div>
            </div>

            {/* Revenue */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <DollarSign className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Revenue</p>
                <p className="stat-value">
                  {company.apolloEnrichment?.snapshot?.revenue_range || company.revenue || 'Not available'}
                </p>
              </div>
            </div>

            {/* Founded */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <Calendar className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Founded</p>
                <p className="stat-value">
                  {company.apolloEnrichment?.snapshot?.founded_year || company.founded_year || 'Not available'}
                </p>
              </div>
            </div>

            {/* Location */}
            <div className="company-stat-item">
              <div className="stat-icon">
                <MapPin className="w-5 h-5 text-gray-500" />
              </div>
              <div className="stat-content">
                <p className="stat-label">Location</p>
                <p className="stat-value">
                  {company.apolloEnrichment?.snapshot?.location?.full || company.location || 'Not available'}
                </p>
              </div>
            </div>
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

          {/* Company Overview — always visible */}
          {company.apolloEnrichment?.snapshot?.description && (
            <div className="company-expandable-section">
              <div className="expandable-header non-collapsible">
                <div className="expandable-title">
                  <FileText className="w-5 h-5" />
                  <span>Company Overview</span>
                </div>
              </div>
              <div className="expandable-content">
                <p className="company-description">{company.apolloEnrichment.snapshot.description}</p>
              </div>
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
                View All People →
              </button>
            </div>

            <div className="decision-makers-grid">
              {approvedContacts.map(contact => {
                // Use contact photo or Barry fallback
                const backgroundImage = contact.photo_url || '/barry.png';

                return (
                  <div key={contact.id} className="decision-maker-card-container">
                    <div
                      className="decision-maker-card-photo already-saved"
                      style={{ backgroundImage: `url(${backgroundImage})` }}
                    >
                      {/* Saved Badge - Top Right */}
                      <div className="decision-maker-saved-badge">
                        <CheckCircle className="w-4 h-4" />
                        <span>Saved</span>
                      </div>

                      {/* Gradient Overlay with Text */}
                      <div className="card-gradient-overlay">
                        <div className="card-text-overlay">
                          <p className="card-name">{contact.name}</p>
                          <p className="card-title">{contact.title}</p>
                          {(contact.departments?.[0] || contact.department) && (
                            <span className="card-dept-badge">
                              {contact.departments?.[0] || contact.department}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* LinkedIn Button - Below Card (Secondary Action) */}
                    {contact.linkedin_url && (
                      <button
                        className="card-linkedin-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(contact.linkedin_url, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        <Linkedin className="w-4 h-4" />
                        <span>View LinkedIn</span>
                      </button>
                    )}

                    {/* View Profile Button - Primary Action */}
                    <button
                      className="saved-contact-primary-btn"
                      onClick={() => navigate(`/scout/contact/${contact.id}`)}
                    >
                      View Full Profile →
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Suggested Contacts Section (auto-discovered from ICP) */}
        {suggestedContacts.length > 0 && (
          <div className="saved-contacts-section">
            <div className="section-header-main">
              <h3 className="section-title-main">
                <Target className="w-6 h-6" />
                <span>Suggested Contacts ({suggestedContacts.length})</span>
              </h3>
              <p className="section-subtitle-main">Auto-discovered from your ICP titles</p>
            </div>

            <div className="decision-makers-grid">
              {suggestedContacts.map(contact => {
                const backgroundImage = contact.photo_url || '/barry.png';
                const isSelected = selectedSuggestedIds.has(contact.id);
                const leadershipBadge = getLeadershipBadge(contact);

                return (
                  <div key={contact.id} className="decision-maker-card-container">
                    <div
                      className={`decision-maker-card-photo ${isSelected ? 'selected' : ''}`}
                      style={{ backgroundImage: `url(${backgroundImage})` }}
                      onClick={() => handleToggleSuggested(contact.id)}
                    >
                      {/* Leadership Badge - Top Left */}
                      {leadershipBadge && (
                        <div className={`leadership-badge ${leadershipBadge.class}`}>
                          <Award className="w-3 h-3" />
                          <span>{leadershipBadge.letter}</span>
                        </div>
                      )}

                      {/* Selection Checkbox - Top Right */}
                      <div className="decision-maker-select-indicator">
                        <div className={`checkbox ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <CheckCircle className="w-5 h-5" />}
                        </div>
                      </div>

                      {/* Gradient Overlay with Text */}
                      <div className="card-gradient-overlay">
                        <div className="card-text-overlay">
                          <p className="card-name">{contact.name || 'Unknown'}</p>
                          <p className="card-title">{contact.title || 'Title not available'}</p>
                        </div>
                      </div>
                    </div>

                    {/* LinkedIn Button - Below Card */}
                    {contact.linkedin_url && (
                      <button
                        className="card-linkedin-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(contact.linkedin_url, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        <Linkedin className="w-4 h-4" />
                        <span>View LinkedIn</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Approve Selected Button */}
            {selectedSuggestedIds.size > 0 && (
              <div className="decision-makers-actions">
                <button
                  className="btn-add-selected-dm"
                  onClick={handleApproveSuggestedContacts}
                  disabled={approvingSuggested}
                >
                  {approvingSuggested ? (
                    <>
                      <div className="loading-spinner-small"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-5 h-5" />
                      <span>Add {selectedSuggestedIds.size} to Leads</span>
                    </>
                  )}
                </button>
              </div>
            )}
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
                const leadershipBadge = getLeadershipBadge(person);

                // Background image: use person photo or Barry fallback
                const backgroundImage = person.photo_url || '/barry.png';

                return (
                  <div key={idx} className="decision-maker-card-container">
                    <div
                      className={`decision-maker-card-photo ${isSelected ? 'selected' : ''} ${isAlreadySaved ? 'already-saved' : ''}`}
                      style={{ backgroundImage: `url(${backgroundImage})` }}
                      onClick={() => !isAlreadySaved && handleToggleDecisionMaker(person)}
                    >
                      {/* Leadership Badge - Top Left */}
                      {leadershipBadge && (
                        <div className={`leadership-badge ${leadershipBadge.class}`}>
                          <Award className="w-3 h-3" />
                          <span>{leadershipBadge.letter}</span>
                        </div>
                      )}

                      {/* Selection Checkbox or Saved Badge - Top Right */}
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

                      {/* Gradient Overlay with Text */}
                      <div className="card-gradient-overlay">
                        <div className="card-text-overlay">
                          <p className="card-name">{person.name}</p>
                          <p className="card-title">{person.title}</p>
                        </div>
                      </div>
                    </div>

                    {/* LinkedIn Button - Below Card */}
                    {person.linkedin_url && (
                      <button
                        className="card-linkedin-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(person.linkedin_url, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        <Linkedin className="w-4 h-4" />
                        <span>View LinkedIn</span>
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
        </div>

        {/* Title Input */}
        <form onSubmit={handleAddCustomTitle} className="custom-title-form">
          <div className="search-input-wrapper">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="Add a title to search (e.g., 'VP Sales', 'Marketing Manager', 'CEO')..."
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
                ? `Searching for ${selectedTitles.length} title${selectedTitles.length !== 1 ? 's' : ''}...`
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
            <h4>Searching for Contacts</h4>
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
                <p className="empty-hint">Add more titles above to find additional contacts</p>
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
              const leadershipBadge = getLeadershipBadge(contact);

              // Background image: use contact photo or Barry fallback
              const backgroundImage = contact.photo_url || '/barry.png';

              return (
                <div key={contact.id} className="contact-card-container">
                  <div
                    className={`contact-card-photo ${isApproved ? 'approved' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ backgroundImage: `url(${backgroundImage})` }}
                  >
                    {/* Leadership Badge - Top Left */}
                    {leadershipBadge && (
                      <div className={`leadership-badge ${leadershipBadge.class}`}>
                        <Award className="w-3 h-3" />
                        <span>{leadershipBadge.letter}</span>
                      </div>
                    )}

                    {/* Selection Checkbox - Top Right */}
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

                    {/* Gradient Overlay with Text */}
                    <div className="card-gradient-overlay">
                      <div className="card-text-overlay">
                        <p className="card-name">{contact.name || 'Unknown'}</p>
                        <p className="card-title">{contact.title || 'Title not available'}</p>
                      </div>
                    </div>
                  </div>

                  {/* LinkedIn Button - Below Card */}
                  {contact.linkedin_url && (
                    <button
                      className="card-linkedin-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(contact.linkedin_url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <Linkedin className="w-4 h-4" />
                      <span>View LinkedIn</span>
                    </button>
                  )}

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

      {/* ── Add Your Contacts ───────────────────────────────── */}
      <div className="cd-add-from-people-section">
        <div className="section-header-main">
          <h3 className="section-title-main">
            <UserPlus className="w-6 h-6" />
            <span>Add Your Contacts</span>
          </h3>
          <p className="section-subtitle-main">Search your existing leads & people by name and link them to this company</p>
        </div>

        {addPeopleSuccess && (
          <div className="cd-people-add-success">
            <CheckCircle className="w-4 h-4" />
            <span>Contacts successfully linked to {company.name}!</span>
          </div>
        )}

        <div className="cd-people-search-container">
          <div className="cd-people-search-input-wrapper">
            <Search className="cd-people-search-icon" />
            <input
              type="text"
              className="cd-people-search-input"
              placeholder="Search all leads & people by name..."
              value={peopleSearchQuery}
              onChange={handlePeopleSearch}
            />
            {peopleSearchQuery && (
              <button
                className="cd-people-search-clear"
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
            <div className="cd-people-search-loading">
              <Loader className="w-4 h-4 cd-spinner" />
              <span>Searching...</span>
            </div>
          )}

          {!searchingPeople && peopleResults.length > 0 && (
            <div className="cd-people-search-results">
              {peopleResults.map(person => {
                const isSelected = selectedPeopleToAdd.some(p => p.id === person.id);
                const isAlreadyLinked = person.company_id === companyId;
                return (
                  <div
                    key={person.id}
                    className={`cd-people-result-item ${isSelected ? 'selected' : ''} ${isAlreadyLinked ? 'already-linked' : ''}`}
                    onClick={() => !isAlreadyLinked && handleTogglePersonSelection(person)}
                  >
                    <div className="cd-people-result-avatar">
                      {person.photo_url ? (
                        <img src={person.photo_url} alt={person.name} />
                      ) : (
                        <User className="w-5 h-5" />
                      )}
                    </div>
                    <div className="cd-people-result-info">
                      <p className="cd-people-result-name">{person.name}</p>
                      <p className="cd-people-result-meta">
                        {[person.title, person.company_name || person.company].filter(Boolean).join(' • ')}
                      </p>
                    </div>
                    {isAlreadyLinked ? (
                      <span className="cd-people-already-linked-badge">Already linked</span>
                    ) : (
                      <div className={`cd-people-select-indicator ${isSelected ? 'checked' : ''}`}>
                        {isSelected && <CheckCircle className="w-4 h-4" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!searchingPeople && peopleSearchQuery.length >= 2 && peopleResults.length === 0 && (
            <div className="cd-people-no-results">
              <p>No contacts found for &ldquo;{peopleSearchQuery}&rdquo;</p>
            </div>
          )}

          {selectedPeopleToAdd.length > 0 && (
            <button
              className="cd-btn-add-people-to-company"
              onClick={handleAddPeopleToCompany}
              disabled={addingPeopleToCompany}
            >
              {addingPeopleToCompany ? (
                <>
                  <Loader className="w-4 h-4 cd-spinner" />
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

      {/* ── Tech Stack ──────────────────────────────────────── */}
      {company.apolloEnrichment?.techStack && company.apolloEnrichment.techStack.length > 0 && (
        <div className="cd-tech-stack-section">
          <div className="section-header-main">
            <h3 className="section-title-main">
              <Code className="w-6 h-6" />
              <span>Tech Stack ({company.apolloEnrichment.techStack.length})</span>
            </h3>
          </div>
          <div className="cd-tech-stack-grid">
            {company.apolloEnrichment.techStack.map((tech, idx) => (
              <div key={idx} className="cd-tech-card">
                <Code className="w-4 h-4 cd-tech-icon" />
                <div>
                  <p className="cd-tech-name">{tech.name}</p>
                  {tech.category && <p className="cd-tech-category">{tech.category}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Data Confidence ─────────────────────────────────── */}
      {company.apolloEnrichment?.dataQuality && (
        <div className="cd-data-quality-section">
          <div className="section-header-main">
            <h3 className="section-title-main">
              <Shield className="w-6 h-6" />
              <span>Data Confidence</span>
            </h3>
          </div>
          <div className="cd-data-quality-info">
            <div className="cd-data-quality-item">
              <span className="cd-data-quality-label">Last Updated</span>
              <span className="cd-data-quality-value">
                {new Date(company.apolloEnrichedAt || Date.now()).toLocaleDateString()}
              </span>
            </div>
            <div className="cd-data-quality-item">
              <span className="cd-data-quality-label">Status</span>
              <span className={`cd-data-quality-badge ${company.apolloEnrichment.dataQuality.organization_status || 'active'}`}>
                {company.apolloEnrichment.dataQuality.organization_status || 'Active'}
              </span>
            </div>
            <div className="cd-data-quality-item">
              <span className="cd-data-quality-label">Source</span>
              <span className="cd-data-quality-value">Verified Data</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Links ───────────────────────────────────────────── */}
      {(company.apolloEnrichment?.snapshot?.website_url || company.apolloEnrichment?.dataQuality?.linkedin_url ||
        company.website_url || company.linkedin_url) && (
        <div className="cd-links-section">
          <div className="section-header-main">
            <h3 className="section-title-main">
              <Globe className="w-6 h-6" />
              <span>Links</span>
            </h3>
          </div>
          <div className="cd-links-container">
            {(company.apolloEnrichment?.snapshot?.website_url || company.website_url) && (
              <button
                className="cd-link-button website"
                onClick={() => window.open(
                  company.apolloEnrichment?.snapshot?.website_url || company.website_url,
                  '_blank', 'noopener,noreferrer'
                )}
              >
                <Globe className="w-5 h-5" />
                <span>Visit Website</span>
                <ExternalLink className="w-4 h-4 cd-link-external" />
              </button>
            )}
            {(company.apolloEnrichment?.dataQuality?.linkedin_url || company.linkedin_url) && (
              <button
                className="cd-link-button linkedin"
                onClick={() => window.open(
                  company.apolloEnrichment?.dataQuality?.linkedin_url || company.linkedin_url,
                  '_blank', 'noopener,noreferrer'
                )}
              >
                <Linkedin className="w-5 h-5" />
                <span>View on LinkedIn</span>
                <ExternalLink className="w-4 h-4 cd-link-external" />
              </button>
            )}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
