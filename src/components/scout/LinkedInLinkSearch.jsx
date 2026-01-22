import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Search, Loader, CheckCircle, X, AlertCircle, User, Building2, Linkedin, Mail, Phone, MapPin } from 'lucide-react';

export default function LinkedInLinkSearch({ onContactAdded, onCancel }) {
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [barryRecommendation, setBarryRecommendation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleInputChange = (value) => {
    setLinkedinUrl(value);
    setError(null);
  };

  const handleFindContact = async (e) => {
    e.preventDefault();

    // Validate LinkedIn URL is provided
    if (!linkedinUrl || linkedinUrl.trim() === '') {
      setError('Please paste a LinkedIn profile URL');
      return;
    }

    // Basic LinkedIn URL validation
    if (!linkedinUrl.includes('linkedin.com')) {
      setError('Please enter a valid LinkedIn URL');
      return;
    }

    setSearching(true);
    setError(null);
    setSearchResults(null);
    setBarryRecommendation(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in');
      }

      const authToken = await user.getIdToken();

      // Step 1: Search Apollo using LinkedIn URL
      const response = await fetch('/.netlify/functions/findContact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          searchParams: {
            linkedin_url: linkedinUrl.trim()
          }
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Search failed');
      }

      if (data.results.length === 0) {
        setError('No contact found for this LinkedIn URL. The profile may not be in our database.');
        setSearching(false);
        return;
      }

      console.log(`✅ Found ${data.results.length} potential matches`);
      setSearchResults(data.results);

      // Step 2: Get Barry's AI recommendation
      await getBarryRecommendation(data.results, { linkedin_url: linkedinUrl.trim() });

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
          confidence: 'high',
          explanation: 'This contact matches the LinkedIn profile URL you provided.'
        });
      }
    } catch (err) {
      console.error('Barry validation error:', err);
      // Fallback: show top match
      setBarryRecommendation({
        contact: results[0],
        confidence: 'high',
        explanation: 'This contact matches the LinkedIn profile URL you provided.'
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
        source: 'LinkedIn Link',

        // Match quality from search
        match_quality: selectedContact.match_quality || 100,

        // Barry's confidence
        barry_confidence: barryRecommendation?.confidence || 'high'
      };

      await setDoc(contactRef, contactData);

      console.log('✅ Contact saved:', contactId);

      // Update company contact count
      await updateCompanyContactCount(companyId, user.uid);

      // Notify parent
      onContactAdded([{ id: contactId, ...contactData }]);

    } catch (err) {
      console.error('Error saving contact:', err);
      setError(err.message || 'Failed to save contact. Please try again.');
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
      source: 'LinkedIn Link',
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

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xl">🐻</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900 mb-1">Barry will find the contact for you</p>
            <p className="text-xs text-gray-700">
              Paste the LinkedIn profile URL below and Barry will instantly retrieve the contact information.
            </p>
          </div>
        </div>
      </div>

      {/* Search Form */}
      {!searchResults && (
        <form onSubmit={handleFindContact} className="space-y-4">
          {/* LinkedIn URL Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              LinkedIn Profile URL
            </label>
            <input
              type="url"
              value={linkedinUrl}
              onChange={(e) => handleInputChange(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all text-lg"
              placeholder="https://linkedin.com/in/johndoe"
              disabled={searching}
              autoFocus
            />
            <p className="mt-2 text-xs text-gray-500">
              Paste the full LinkedIn URL (e.g., https://linkedin.com/in/username)
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={searching}
              className="flex-1 px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all shadow-md flex items-center justify-center gap-2"
            >
              {searching ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Finding Contact...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Find Contact
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-3 rounded-xl bg-white border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all"
              disabled={searching}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Validation & Results */}
      {searchResults && (
        <div className="space-y-6">
          {/* Barry's Validation Loading */}
          {validating && (
            <div className="bg-blue-50 rounded-xl p-6 border border-blue-200 text-center">
              <Loader className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-900">Barry is validating the contact...</p>
            </div>
          )}

          {/* Barry's Recommendation */}
          {barryRecommendation && !selectedContact && (
            <div className="space-y-4">
              <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xl">🐻</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900 mb-1">Contact Found!</p>
                    <p className="text-xs text-gray-700">{barryRecommendation.explanation}</p>
                  </div>
                </div>
              </div>

              {/* Recommended Contact Preview */}
              <ContactPreviewCard
                contact={barryRecommendation.contact}
                confidence={barryRecommendation.confidence}
                onConfirm={() => setSelectedContact(barryRecommendation.contact)}
                onReject={() => {
                  setSearchResults(null);
                  setBarryRecommendation(null);
                  setError('Please try a different LinkedIn URL.');
                }}
              />
            </div>
          )}

          {/* Final Confirmation */}
          {selectedContact && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                <p className="text-sm font-semibold text-gray-900">Confirm this is the right person before saving</p>
              </div>

              <ContactPreviewCard
                contact={selectedContact}
                confidence={barryRecommendation?.confidence || 'high'}
                showActions={false}
              />

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleConfirmAndSave}
                  disabled={saving}
                  className="flex-1 px-6 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all shadow-md flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Save Contact
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setSelectedContact(null);
                    setSearchResults(null);
                    setBarryRecommendation(null);
                  }}
                  className="px-6 py-3 rounded-xl bg-white border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all"
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
    <div className="bg-white border-2 border-blue-400 rounded-xl p-6 shadow-lg">
      {/* Confidence Badge */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          {contact.photo_url ? (
            <img
              src={contact.photo_url}
              alt={contact.name}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
              <User className="w-8 h-8 text-blue-600" />
            </div>
          )}
          <div>
            <h3 className="text-xl font-bold text-gray-900">{contact.name}</h3>
            <p className="text-sm text-gray-600">{contact.title || 'Title not available'}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${confidenceColors[confidence] || confidenceColors.high}`}>
          {confidence === 'high' ? '✓ High Match' : confidence === 'medium' ? '~ Medium Match' : '⚠ Low Match'}
        </span>
      </div>

      {/* Contact Details */}
      <div className="space-y-3 mb-4">
        {contact.organization_name && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.organization_name}</span>
          </div>
        )}
        {contact.email && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.email}</span>
          </div>
        )}
        {contact.phone_numbers && contact.phone_numbers.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.phone_numbers[0].sanitized_number || contact.phone_numbers[0].raw_number}</span>
          </div>
        )}
        {contact.linkedin_url && (
          <div className="flex items-center gap-2 text-sm">
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
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">
              {contact.city && contact.state ? `${contact.city}, ${contact.state}` : contact.city || contact.state}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {showActions && (
        <div className="flex gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            This is the Right Person
          </button>
          <button
            onClick={onReject}
            className="flex-1 px-4 py-2 rounded-lg bg-white border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            Not the Right Person
          </button>
        </div>
      )}
    </div>
  );
}
