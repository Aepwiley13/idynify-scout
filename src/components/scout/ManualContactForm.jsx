import { useState, useRef } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, addDoc, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { UserPlus, Search, X, Loader } from 'lucide-react';
import { CONTACT_STATUSES } from '../../utils/contactStateMachine';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { recordReferralReceived } from '../../services/referralIntelligenceService';

export default function ManualContactForm({ onContactAdded, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    linkedin_url: '',
    address: '',
    website: ''
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [referredBy, setReferredBy] = useState(null);

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

    const user = getEffectiveUser();
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
        address: formData.address.trim() || null,
        website: formData.website.trim() || null,

        // Source tracking
        source: referredBy ? 'referral' : 'manual',
        enrichment_status: 'user_added',
        addedFrom: referredBy ? 'referral' : 'manual',
        addedFromSource: referredBy ? referredBy.id : null,

        // Scout metadata
        lead_status: 'saved',
        contact_status: CONTACT_STATUSES.NEW,
        contact_status_updated_at: new Date().toISOString(),
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

      // Record referral attribution (post-save, sequential — needs contactId)
      if (referredBy) {
        await recordReferralReceived(user.uid, {
          fromContactId: referredBy.id,
          fromContactName: referredBy.name,
          toContactId: docRef.id,
          toContactName: formData.name.trim(),
          context: `Added manually via Scout+`
        });
      }

      // Notify parent
      onContactAdded([{ id: docRef.id, ...contactData }]);

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

  const user = getEffectiveUser();

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

      {/* Address (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Address
        </label>
        <input
          type="text"
          value={formData.address}
          onChange={(e) => handleChange('address', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
          placeholder="123 Main St, City, State"
          disabled={saving}
        />
      </div>

      {/* Website (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Website
        </label>
        <input
          type="url"
          value={formData.website}
          onChange={(e) => handleChange('website', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
          placeholder="https://example.com"
          disabled={saving}
        />
      </div>

      {/* Referred By (Optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-900 mb-2">
          Referred By
        </label>
        <ReferredByPicker value={referredBy} onChange={setReferredBy} />
        <p className="text-xs text-gray-400 mt-1">
          Optional — tag who referred this person to track referral attribution.
        </p>
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

// ─── ReferredByPicker ─────────────────────────────────────────────────────
function ReferredByPicker({ value, onChange }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const doSearch = async (term) => {
    if (!term || term.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const q = query(
        collection(db, 'users', user.uid, 'contacts'),
        where('is_archived', '==', false),
        orderBy('name'),
        limit(50)
      );
      const snap = await getDocs(q);
      const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const termLower = term.toLowerCase();
      setResults(contacts.filter(c => {
        const name = (c.name || '').toLowerCase();
        const company = (c.company || c.company_name || '').toLowerCase();
        return name.includes(termLower) || company.includes(termLower);
      }).slice(0, 6));
    } catch (err) {
      console.error('[ReferredByPicker] Search failed:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleInput = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    setOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-purple-300 bg-purple-50">
        <span className="text-sm text-purple-800 font-medium flex-1">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-purple-400 hover:text-purple-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={handleInput}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search existing contacts..."
          className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900"
        />
        {searching && <Loader className="w-4 h-4 text-gray-400 animate-spin" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({ id: c.id, name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() });
                setSearchTerm('');
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              <div className="text-sm font-medium text-gray-900">
                {c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
              </div>
              {(c.company || c.company_name) && (
                <div className="text-xs text-gray-400">{c.company || c.company_name}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
