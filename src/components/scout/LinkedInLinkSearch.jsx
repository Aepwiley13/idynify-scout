import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Search, Loader, CheckCircle, X, AlertCircle, User, Building2, Linkedin, Mail, Phone, MapPin } from 'lucide-react';

/**
 * LINKEDIN LINK SEARCH - EXACT MATCH ONLY
 *
 * This component is for the LinkedIn Link option in Scout+.
 *
 * Flow:
 * 1. User pastes LinkedIn URL
 * 2. Call findContactByLinkedInUrl (exact match, no fuzzy search)
 * 3. Show preview of exact person
 * 4. User confirms and saves
 *
 * NO Barry validation (not needed for exact URL match)
 * NO "potential matches" (only exact match)
 * NO fuzzy search fallback
 */
export default function LinkedInLinkSearch({ onContactAdded, onCancel }) {
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [searching, setSearching] = useState(false);
  const [contact, setContact] = useState(null);
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
    setContact(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in');
      }

      const authToken = await user.getIdToken();

      // Call NEW function for exact LinkedIn URL lookup
      const response = await fetch('/.netlify/functions/findContactByLinkedInUrl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          linkedin_url: linkedinUrl.trim()
        })
      });

      const data = await response.json();

      if (!data.success) {
        // Use the exact error message from the function
        throw new Error(data.error || 'Failed to find contact');
      }

      if (!data.contact) {
        throw new Error('Unable to retrieve public profile details from this LinkedIn link. Please verify the URL or try again.');
      }

      console.log(`✅ Found exact match: ${data.contact.name}`);
      setContact(data.contact);

    } catch (err) {
      console.error('Search error:', err);
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleConfirmAndSave = async () => {
    if (!contact) return;

    setSaving(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in');
      }

      // Step 1: Ensure company exists in Saved Companies
      const companyId = await ensureCompanyExists(contact, user.uid);

      // Step 2: Save contact to /users/{uid}/contacts
      const contactId = contact.id || `apollo_${Date.now()}`;
      const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);

      const contactData = {
        // Apollo IDs
        apollo_person_id: contact.id,

        // Basic Info
        name: contact.name || 'Unknown',
        title: contact.title || '',
        email: contact.email || null,
        phone: contact.phone_numbers?.[0]?.sanitized_number || null,
        linkedin_url: contact.linkedin_url || null,
        photo_url: contact.photo_url || null,

        // Company Association
        company_id: companyId,
        company_name: contact.organization_name || null,
        company_industry: contact.organization?.industry || null,

        // Apollo Enrichment Fields
        department: contact.departments?.[0] || null,
        seniority: contact.seniority || null,
        location: contact.location || null,

        // Metadata
        status: 'active',
        saved_at: new Date().toISOString(),
        source: 'LinkedIn Link',

        // Match quality is always 100 for exact LinkedIn URL
        match_quality: 100
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
            <Linkedin className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900 mb-1">Find contact by LinkedIn URL</p>
            <p className="text-xs text-gray-700">
              Paste the LinkedIn profile URL below to retrieve contact information.
            </p>
          </div>
        </div>
      </div>

      {/* Search Form */}
      {!contact && (
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

      {/* Contact Preview and Save */}
      {contact && (
        <div className="space-y-4">
          {/* Success message */}
          <div className="bg-green-50 rounded-xl p-4 border border-green-200">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">Contact Found!</p>
                <p className="text-xs text-gray-700">Review the details below and confirm to save.</p>
              </div>
            </div>
          </div>

          {/* Contact Preview Card */}
          <ContactPreviewCard contact={contact} />

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
                setContact(null);
                setLinkedinUrl('');
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
  );
}

// Contact Preview Card Component (Simplified - No confidence badge needed for exact match)
function ContactPreviewCard({ contact }) {
  return (
    <div className="bg-white border-2 border-blue-400 rounded-xl p-6 shadow-lg">
      {/* Contact Header */}
      <div className="flex items-start gap-4 mb-4">
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
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-900">{contact.name}</h3>
          <p className="text-sm text-gray-600">{contact.title || 'Title not available'}</p>
        </div>
      </div>

      {/* Contact Details - ONLY Required Fields */}
      <div className="space-y-3">
        {contact.organization_name && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.organization_name}</span>
          </div>
        )}
        {contact.location && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-gray-500" />
            <span className="text-gray-700">{contact.location}</span>
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
      </div>
    </div>
  );
}
