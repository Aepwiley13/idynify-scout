import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Search, Loader, CheckCircle, X, AlertCircle, User, Building2, Linkedin, Mail, Phone, MapPin } from 'lucide-react';
import './ContactSearch.css';

/**
 * Contact Search Component
 *
 * Allows users to search for contacts via Apollo API using flexible parameters
 * (name, company, LinkedIn URL, or Facebook URL). Barry (Claude AI) helps
 * validate and recommend the best match before saving.
 *
 * Features:
 * - Flexible contact search with multiple parameters
 * - AI-powered match validation via Barry
 * - User confirmation before saving
 * - Auto-creates associated companies
 * - Updates contact counts
 */

export default function ContactSearch() {
  const [searchParams, setSearchParams] = useState({
    name: '',
    company_name: '',
    linkedin_url: '',
    facebook_url: ''
  });
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [barryRecommendation, setBarryRecommendation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const handleInputChange = (field, value) => {
    setSearchParams(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleRunSearch = async (e) => {
    e.preventDefault();

    // Validate at least one field is filled
    const hasInput = Object.values(searchParams).some(val => val && val.trim() !== '');
    if (!hasInput) {
      setError('Please provide at least one search field');
      return;
    }

    setSearching(true);
    setError(null);
    setSearchResults(null);
    setBarryRecommendation(null);
    setSuccessMessage(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in');
      }

      const authToken = await user.getIdToken();

      // Step 1: Search Apollo
      const response = await fetch('/.netlify/functions/findContact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          searchParams: {
            name: searchParams.name.trim() || undefined,
            company_name: searchParams.company_name.trim() || undefined,
            linkedin_url: searchParams.linkedin_url.trim() || undefined,
            facebook_url: searchParams.facebook_url.trim() || undefined
          }
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Search failed');
      }

      if (data.results.length === 0) {
        setError('No matching contacts found. Try refining your search inputs.');
        setSearching(false);
        return;
      }

      console.log(`✅ Found ${data.results.length} potential matches`);
      setSearchResults(data.results);

      // Step 2: Get Barry's AI recommendation
      await getBarryRecommendation(data.results, searchParams);

    } catch (err) {
      console.error('Search error:', err);
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const getBarryRecommendation = async (results, originalSearchParams) => {
    setValidating(true);

    try {
      // Call Claude API for Barry's validation
      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/barryValidateContact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          results,
          searchParams: originalSearchParams
        })
      });

      const data = await response.json();

      if (data.success) {
        setBarryRecommendation(data.recommendation);
      } else {
        // Fallback: just show top match
        setBarryRecommendation({
          contact: results[0],
          confidence: 'medium',
          explanation: 'This is the top match based on the search criteria.'
        });
      }
    } catch (err) {
      console.error('Barry validation error:', err);
      // Fallback: show top match
      setBarryRecommendation({
        contact: results[0],
        confidence: 'medium',
        explanation: 'This is the top match based on the search criteria.'
      });
    } finally {
      setValidating(false);
    }
  };

  const handleConfirmAndSave = async () => {
    if (!selectedContact) return;

    setSaving(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in');
      }

      // Step 1: Ensure company exists in Saved Companies
      const companyId = await ensureCompanyExists(selectedContact, user.uid);

      // Step 2: Save contact to /users/{uid}/contacts
      const contactId = selectedContact.id || `apollo_${Date.now()}`;
      const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);

      const contactData = {
        // Apollo IDs
        apollo_person_id: selectedContact.id,

        // Basic Info
        name: selectedContact.name || 'Unknown',
        title: selectedContact.title || selectedContact.headline || '',
        email: selectedContact.email || null,
        phone: selectedContact.phone_numbers?.[0]?.sanitized_number || null,
        linkedin_url: selectedContact.linkedin_url || null,
        facebook_url: selectedContact.facebook_url || null,
        photo_url: selectedContact.photo_url || null,

        // Company Association
        company_id: companyId,
        company_name: selectedContact.organization_name || selectedContact.organization?.name || null,
        company_industry: selectedContact.organization?.industry || null,

        // Apollo Enrichment Fields
        department: selectedContact.departments?.[0] || null,
        seniority: selectedContact.seniority || null,
        location: selectedContact.city && selectedContact.state
          ? `${selectedContact.city}, ${selectedContact.state}`
          : selectedContact.city || selectedContact.state || null,

        // Metadata
        status: 'active',
        saved_at: new Date().toISOString(),
        source: 'Found via Search',

        // Match quality from search
        match_quality: selectedContact.match_quality || 0,

        // Barry's confidence
        barry_confidence: barryRecommendation?.confidence || 'medium'
      };

      await setDoc(contactRef, contactData);

      console.log('✅ Contact saved:', contactId);

      // Update company contact count
      await updateCompanyContactCount(companyId, user.uid);

      // Show success message and reset form
      setSuccessMessage(`${selectedContact.name} has been added to your leads!`);
      setSearchParams({
        name: '',
        company_name: '',
        linkedin_url: '',
        facebook_url: ''
      });
      setSearchResults(null);
      setBarryRecommendation(null);
      setSelectedContact(null);

    } catch (err) {
      console.error('Error saving contact:', err);
      setError(err.message || 'Failed to save contact. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const ensureCompanyExists = async (contact, userId) => {
    const companyName = contact.organization_name || contact.organization?.name;
    const apolloOrgId = contact.organization_id || contact.organization?.id;

    if (!companyName) {
      // No company info available
      return null;
    }

    // Check if company already exists by apollo_id
    if (apolloOrgId) {
      const companiesRef = collection(db, 'users', userId, 'companies');
      const q = query(companiesRef, where('apollo_id', '==', apolloOrgId));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        return snapshot.docs[0].id;
      }
    }

    // Create new company
    const companyId = apolloOrgId || `company_${Date.now()}`;
    const companyRef = doc(db, 'users', userId, 'companies', companyId);

    const companyData = {
      apollo_id: apolloOrgId || null,
      name: companyName,
      industry: contact.organization?.industry || null,
      website_url: contact.organization?.website_url || null,
      domain: contact.organization?.primary_domain || null,
      location: contact.organization?.city && contact.organization?.state
        ? `${contact.organization.city}, ${contact.organization.state}`
        : null,
      employee_count: contact.organization?.estimated_num_employees || null,

      // Metadata
      saved_at: new Date().toISOString(),
      source: 'Found via Search',
      status: 'accepted',
      contact_count: 0,

      // For future enrichment
      apolloEnriched: false
    };

    await setDoc(companyRef, companyData);
    console.log('✅ Company saved:', companyId);

    return companyId;
  };

  const updateCompanyContactCount = async (companyId, userId) => {
    if (!companyId) return;

    try {
      const companyRef = doc(db, 'users', userId, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);

      if (companyDoc.exists()) {
        const currentCount = companyDoc.data().contact_count || 0;
        await updateDoc(companyRef, {
          contact_count: currentCount + 1
        });
      }
    } catch (err) {
      console.error('Error updating company contact count:', err);
    }
  };

  const handleStartOver = () => {
    setSelectedContact(null);
    setSearchResults(null);
    setBarryRecommendation(null);
    setSearchParams({
      name: '',
      company_name: '',
      linkedin_url: '',
      facebook_url: ''
    });
  };

  return (
    <div className="contact-search">
      {/* Header */}
      <div className="contact-search-header">
        <h1>Contact Search</h1>
        <p>Search for contacts using name, company, LinkedIn, or Facebook. Barry will help you find and validate the right match.</p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="success-message">
          <CheckCircle className="w-5 h-5" />
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)}>×</button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="error-message">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Info Banner */}
      <div className="info-banner">
        <div className="barry-avatar">
          <span className="text-xl">🐻</span>
        </div>
        <div className="flex-1">
          <p className="info-title">Barry will help you find the right contact</p>
          <p className="info-text">
            Provide any combination of information you have. Barry will search, validate the best match, and help you confirm before saving.
          </p>
        </div>
      </div>

      {/* Search Form */}
      {!searchResults && (
        <form onSubmit={handleRunSearch} className="search-form-contact">
          {/* Full Name */}
          <div className="form-field">
            <label className="field-label">Full Name</label>
            <input
              type="text"
              value={searchParams.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="field-input"
              placeholder="John Doe"
              disabled={searching}
            />
          </div>

          {/* Company Name */}
          <div className="form-field">
            <label className="field-label">Company Name</label>
            <input
              type="text"
              value={searchParams.company_name}
              onChange={(e) => handleInputChange('company_name', e.target.value)}
              className="field-input"
              placeholder="Acme Corporation"
              disabled={searching}
            />
          </div>

          {/* LinkedIn URL */}
          <div className="form-field">
            <label className="field-label">LinkedIn URL</label>
            <input
              type="url"
              value={searchParams.linkedin_url}
              onChange={(e) => handleInputChange('linkedin_url', e.target.value)}
              className="field-input"
              placeholder="https://linkedin.com/in/johndoe"
              disabled={searching}
            />
          </div>

          {/* Facebook URL */}
          <div className="form-field">
            <label className="field-label">Facebook URL</label>
            <input
              type="url"
              value={searchParams.facebook_url}
              onChange={(e) => handleInputChange('facebook_url', e.target.value)}
              className="field-input"
              placeholder="https://facebook.com/johndoe"
              disabled={searching}
            />
          </div>

          {/* Action Button */}
          <button
            type="submit"
            disabled={searching}
            className="search-button-contact"
          >
            {searching ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Run Search
              </>
            )}
          </button>
        </form>
      )}

      {/* Validation & Results */}
      {searchResults && (
        <div className="search-results-section">
          {/* Barry's Validation Loading */}
          {validating && (
            <div className="validation-loading">
              <Loader className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-900">Barry is reviewing the matches...</p>
            </div>
          )}

          {/* Barry's Recommendation */}
          {barryRecommendation && !selectedContact && (
            <div className="recommendation-section">
              <div className="recommendation-banner">
                <div className="barry-avatar">
                  <span className="text-xl">🐻</span>
                </div>
                <div className="flex-1">
                  <p className="recommendation-title">Barry's Recommendation</p>
                  <p className="recommendation-text">{barryRecommendation.explanation}</p>
                </div>
              </div>

              {/* Recommended Contact Preview */}
              <ContactPreviewCard
                contact={barryRecommendation.contact}
                confidence={barryRecommendation.confidence}
                onConfirm={() => setSelectedContact(barryRecommendation.contact)}
                onReject={() => setError('Please refine your search and try again.')}
              />

              {/* Show other matches if available */}
              {searchResults.length > 1 && (
                <div className="other-matches">
                  <p className="other-matches-label">Other potential matches:</p>
                  <div className="other-matches-list">
                    {searchResults.slice(1).map((contact, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedContact(contact)}
                        className="other-match-item"
                      >
                        <p className="other-match-name">{contact.name}</p>
                        <p className="other-match-details">{contact.title} at {contact.organization_name}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Final Confirmation */}
          {selectedContact && (
            <div className="confirmation-section">
              <div className="confirmation-banner">
                <p className="confirmation-text">Confirm this is the right person before saving</p>
              </div>

              <ContactPreviewCard
                contact={selectedContact}
                confidence={barryRecommendation?.confidence || 'medium'}
                showActions={false}
              />

              <div className="confirmation-actions">
                <button
                  onClick={handleConfirmAndSave}
                  disabled={saving}
                  className="confirm-button"
                >
                  {saving ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Confirm & Save Lead
                    </>
                  )}
                </button>
                <button
                  onClick={handleStartOver}
                  className="start-over-button"
                  disabled={saving}
                >
                  Start Over
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Contact Preview Card Component
function ContactPreviewCard({ contact, confidence, onConfirm, onReject, showActions = true }) {
  const confidenceColors = {
    high: 'bg-green-100 text-green-800 border-green-300',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    low: 'bg-orange-100 text-orange-800 border-orange-300'
  };

  return (
    <div className="contact-preview-card">
      {/* Confidence Badge */}
      <div className="preview-header">
        <div className="preview-info">
          {contact.photo_url ? (
            <img
              src={contact.photo_url}
              alt={contact.name}
              className="preview-photo"
            />
          ) : (
            <div className="preview-photo-placeholder">
              <User className="w-8 h-8 text-blue-600" />
            </div>
          )}
          <div>
            <h3 className="preview-name">{contact.name}</h3>
            <p className="preview-title">{contact.title || 'Title not available'}</p>
          </div>
        </div>
        <span className={`confidence-badge ${confidenceColors[confidence] || confidenceColors.medium}`}>
          {confidence === 'high' ? '✓ High Match' : confidence === 'medium' ? '~ Medium Match' : '⚠ Low Match'}
        </span>
      </div>

      {/* Contact Details */}
      <div className="preview-details">
        {contact.organization_name && (
          <div className="preview-detail">
            <Building2 className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.organization_name}</span>
          </div>
        )}
        {contact.email && (
          <div className="preview-detail">
            <Mail className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.email}</span>
          </div>
        )}
        {contact.phone_numbers && contact.phone_numbers.length > 0 && (
          <div className="preview-detail">
            <Phone className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.phone_numbers[0].sanitized_number || contact.phone_numbers[0].raw_number}</span>
          </div>
        )}
        {contact.linkedin_url && (
          <div className="preview-detail">
            <Linkedin className="w-4 h-4 text-gray-500" />
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              View LinkedIn Profile
            </a>
          </div>
        )}
        {(contact.city || contact.state) && (
          <div className="preview-detail">
            <MapPin className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">
              {contact.city && contact.state ? `${contact.city}, ${contact.state}` : contact.city || contact.state}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {showActions && (
        <div className="preview-actions">
          <button
            onClick={onConfirm}
            className="preview-confirm"
          >
            <CheckCircle className="w-4 h-4" />
            This is the Right Person
          </button>
          <button
            onClick={onReject}
            className="preview-reject"
          >
            <X className="w-4 h-4" />
            Not the Right Person
          </button>
        </div>
      )}
    </div>
  );
}
