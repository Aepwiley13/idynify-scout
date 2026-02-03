import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, addDoc } from 'firebase/firestore';
import { UserPlus } from 'lucide-react';
import { startBackgroundEnrichment, assessEnrichmentViability } from '../../utils/contactEnrichment';

export default function ManualContactForm({ onContactAdded, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    linkedin_url: ''
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name || formData.name.trim() === '') {
      newErrors.name = 'Name is required';
    }

    // Email validation (optional but must be valid if provided)
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // LinkedIn URL validation (optional but must be valid if provided)
    if (formData.linkedin_url && !formData.linkedin_url.includes('linkedin.com')) {
      newErrors.linkedin_url = 'Please enter a valid LinkedIn URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert('You must be logged in to add contacts');
      return;
    }

    setSaving(true);

    try {
      // Create contact with manual source
      const contactData = {
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        company: formData.company.trim() || null,
        title: formData.title.trim() || null,
        linkedin_url: formData.linkedin_url.trim() || null,

        // Source tracking
        source: 'manual',
        enrichment_status: 'user_added',

        // Scout metadata
        lead_status: 'saved',
        export_ready: true,
        addedAt: new Date().toISOString(),

        // Placeholder for future enrichment
        apollo_data: null,
        enriched: false
      };

      // Add to user's contacts collection
      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const docRef = await addDoc(contactsRef, contactData);

      console.log('✅ Manual contact added:', docRef.id);

      const savedContact = { id: docRef.id, ...contactData };

      // Assess enrichment viability and start background enrichment
      const viability = assessEnrichmentViability(savedContact);
      savedContact._enrichmentViability = viability;

      // Start background enrichment (non-blocking)
      startBackgroundEnrichment(
        [savedContact],
        (results) => {
          console.log('Manual contact enrichment complete:', results);
        }
      );

      // Notify parent
      onContactAdded([savedContact]);

    } catch (error) {
      console.error('Error adding manual contact:', error);
      alert('Failed to add contact. Please try again.');
      setSaving(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
        <p className="text-sm text-gray-700">
          <strong>Quick add:</strong> Only name is required. Add more details now or enrich later.
        </p>
      </div>

      {/* Name (Required) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Full Name <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className={`w-full px-4 py-3 rounded-lg border ${
            errors.name ? 'border-red-500' : 'border-gray-300'
          } focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all`}
          placeholder="John Doe"
          disabled={saving}
        />
        {errors.name && (
          <p className="text-red-600 text-xs mt-1">⚠️ {errors.name}</p>
        )}
      </div>

      {/* Email (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Email
        </label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => handleChange('email', e.target.value)}
          className={`w-full px-4 py-3 rounded-lg border ${
            errors.email ? 'border-red-500' : 'border-gray-300'
          } focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all`}
          placeholder="john.doe@company.com"
          disabled={saving}
        />
        {errors.email && (
          <p className="text-red-600 text-xs mt-1">⚠️ {errors.email}</p>
        )}
      </div>

      {/* Phone (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Phone
        </label>
        <input
          type="tel"
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
          placeholder="+1 (555) 123-4567"
          disabled={saving}
        />
      </div>

      {/* Company (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Company
        </label>
        <input
          type="text"
          value={formData.company}
          onChange={(e) => handleChange('company', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
          placeholder="Acme Corporation"
          disabled={saving}
        />
      </div>

      {/* Title (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Title
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => handleChange('title', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
          placeholder="VP of Sales"
          disabled={saving}
        />
      </div>

      {/* LinkedIn URL (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          LinkedIn URL
        </label>
        <input
          type="url"
          value={formData.linkedin_url}
          onChange={(e) => handleChange('linkedin_url', e.target.value)}
          className={`w-full px-4 py-3 rounded-lg border ${
            errors.linkedin_url ? 'border-red-500' : 'border-gray-300'
          } focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all`}
          placeholder="https://linkedin.com/in/johndoe"
          disabled={saving}
        />
        {errors.linkedin_url && (
          <p className="text-red-600 text-xs mt-1">⚠️ {errors.linkedin_url}</p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-6 py-3 rounded-xl bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <span className="animate-spin">⚙️</span>
              Saving...
            </>
          ) : (
            <>
              <UserPlus className="w-5 h-5" />
              Scout+
            </>
          )}
        </button>
      </div>
    </form>
  );
}
