import { useState, useRef, useId, Fragment } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, addDoc, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { UserPlus, Search, X, Loader } from 'lucide-react';
import { buildUserAddedContact } from '../../schemas/userAddedContact';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { recordReferralReceived } from '../../services/referralIntelligenceService';
import { prepareContactWrite, applyContactMerge } from '../../services/contactWriteGuard';
import { ensureCompanyForContact, NAME_SOURCE } from '../../services/companyIdentityService';
import { useT } from '../../theme/ThemeContext';

/**
 * `copy` lets a caller reword the two sentences that speak the sales
 * product's language, without changing what the form does:
 *   copy.hint          the note under "Quick add:" (default mentions enriching)
 *   copy.duplicate     (name) => the message when this person already exists
 *   copy.submit        the save button's label (default "Scout+")
 *   copy.showReferral  false hides the optional "Referred By" field; the
 *                      contact is then saved exactly as one added with that
 *                      field left empty
 *   copy.moreDetails   true starts the form with Name, Email and Phone only;
 *                      every other field sits behind a "More details" button.
 *                      Nothing is removed: the fields, their validation and
 *                      what is saved are the same, opened or not
 *   copy.companyFromEmail  false means a company is only looked up or
 *                      created when the user typed one in the Company field.
 *                      An email address (or a website) alone then never
 *                      creates a company, and so never starts the background
 *                      name correction that calls company enrichment. A typed
 *                      company is handled exactly as it always was
 *   copy.autofill      false asks the browser not to offer or insert saved
 *                      personal details. This form is for somebody else's
 *                      details, and the browser's saved ones are the signed-in
 *                      user's own
 *   copy.describeError (error) => the sentence shown when saving fails. It is
 *                      shown in the form instead of the default alert box
 * Contact Hub passes all eight. Every other caller passes nothing and gets the
 * original wording, every field shown, and the original behaviour.
 */
// Deliberately not one of the standard autocomplete values. See `noAutofill`.
const NOT_THE_USERS_OWN_DETAILS = 'someone-else';

export default function ManualContactForm({ onContactAdded, onCancel, copy = null }) {
  const T = useT();
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
  // Only meaningful with copy.moreDetails. A problem in a field behind the
  // button (the LinkedIn URL is the one that is validated) keeps it open, so
  // an error message is never hidden.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsId = useId();

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
      // A hand-typed company is still a company. This form collected it as
      // free text and wrote nothing else, so every contact added here landed
      // with no `company_id` — countable by neither Scout people counter once
      // the contact was engaged, because Saved Companies had no company to
      // count it under and People excludes engaged contacts by design. Resolve
      // it to an existing company where one matches (on name, or on the email
      // domain the user just typed) and create one where none does.
      //
      // With copy.companyFromEmail === false the step runs only for a company
      // the user actually typed. Nothing is inferred from the email address.
      const wantsCompany = copy?.companyFromEmail !== false || formData.company.trim() !== '';
      const { companyId } = !wantsCompany ? { companyId: null } : await ensureCompanyForContact(user.uid, {
        name: formData.company,
        email: formData.email,
        domain: formData.website || null,
      }, {
        source: 'manual',
        // The user typed this name. Enrichment may not overwrite it.
        nameSource: NAME_SOURCE.USER,
        extraFields: { website_url: formData.website || null },
      });

      // Identity resolution BEFORE the write. A hand-typed contact is the most
      // likely to duplicate someone already imported from Apollo or Gmail —
      // the user is typing from memory, not from a record.
      const resolution = await prepareContactWrite(user.uid, {
        email: formData.email,
        phone: formData.phone,
        linkedin_url: formData.linkedin_url,
        name: formData.name,
        company: formData.company,
        company_id: companyId,
        company_name: formData.company.trim() || null,
        source: referredBy ? 'referral' : 'manual',
      }, { source: 'ManualContactForm' });

      if (resolution.action === 'merge') {
        await applyContactMerge(user.uid, resolution);
        setSaving(false);
        setErrors({
          email: copy?.duplicate
            ? copy.duplicate(formData.name.trim())
            : `${formData.name.trim()} is already in your pipeline. Any new details you entered have been added to the existing record.`,
        });
        return;
      }

      // Create contact with manual source. The document shape is shared with
      // the CSV import — see schemas/userAddedContact.js.
      const contactData = buildUserAddedContact({
        identityFields: resolution.fields,
        person: formData,
        companyId,
        source: referredBy ? 'referral' : 'manual',
        addedFrom: referredBy ? 'referral' : 'manual',
        addedFromSource: referredBy ? referredBy.id : null,
        extra: {
          address: formData.address.trim() || null,
          website: formData.website.trim() || null,
        },
      });

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
      if (copy?.describeError) {
        setErrors({ form: copy.describeError(error) });
      } else {
        alert('Failed to add contact. Please try again.');
      }
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

  // Spread onto the form and every field, so with the option unset no
  // attribute is added and the markup is what it always was.
  //
  // Two values on purpose. Chrome (checked in 150) ignores "off" on name,
  // email and phone fields and fills them anyway, but does not fill a field
  // whose autocomplete value it does not recognise. Browsers that follow the
  // standard treat an unrecognised value as "no value here" and fall back to
  // the form's own setting, which is "off".
  const noAutofill = copy?.autofill === false;
  const formAutofill = noAutofill ? { autoComplete: 'off' } : {};
  const fieldAutofill = noAutofill ? { autoComplete: NOT_THE_USERS_OWN_DETAILS } : {};

  const collapsible = copy?.moreDetails === true;
  const detailsOpen = !collapsible || detailsExpanded || Boolean(errors.linkedin_url);
  // The wrapper exists only in the collapsible form, where the button needs
  // something to point at. Otherwise the fields are the form's own children,
  // exactly as they were before this option existed.
  const DetailsWrap = collapsible ? 'div' : Fragment;
  const detailsWrapProps = collapsible ? { id: detailsId, className: 'space-y-6' } : {};

  return (
    <form onSubmit={handleSubmit} className="space-y-6" {...formAutofill}>
      <div className="rounded-xl p-4 border" style={{ background: T.isDark ? `${T.accent}10` : '#eff6ff', borderColor: T.isDark ? `${T.accent}30` : '#bfdbfe' }}>
        <p className="text-sm" style={{ color: T.textMuted }}>
          <strong>Quick add:</strong> {copy?.hint ?? 'Only name is required. Add more details now or enrich later.'}
        </p>
      </div>

      {/* Name (Required) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Full Name <span style={{ color: '#dc2626' }}>*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: errors.name ? '#dc2626' : T.border, color: T.text }}
          placeholder="John Doe"
          disabled={saving}
          {...fieldAutofill}
        />
        {errors.name && (
          <p className="text-xs mt-1" style={{ color: '#dc2626' }}>⚠️ {errors.name}</p>
        )}
      </div>

      {/* Email (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Email
        </label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => handleChange('email', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: errors.email ? '#dc2626' : T.border, color: T.text }}
          placeholder="john.doe@company.com"
          disabled={saving}
          {...fieldAutofill}
        />
        {errors.email && (
          <p className="text-xs mt-1" style={{ color: '#dc2626' }}>⚠️ {errors.email}</p>
        )}
      </div>

      {/* Phone (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Phone
        </label>
        <input
          type="tel"
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: T.border, color: T.text }}
          placeholder="+1 (555) 123-4567"
          disabled={saving}
          {...fieldAutofill}
        />
      </div>

      {collapsible && (
        <button
          type="button"
          className="w-full px-4 py-3 rounded-lg border text-sm font-semibold text-left"
          style={{ background: 'transparent', borderColor: T.border, color: T.textMuted, minHeight: 48 }}
          aria-expanded={detailsOpen ? 'true' : 'false'}
          aria-controls={detailsId}
          disabled={saving}
          onClick={() => setDetailsExpanded((open) => !open)}
        >
          {detailsOpen ? '− Fewer details' : '+ More details'}
        </button>
      )}

      {detailsOpen && (
      <DetailsWrap {...detailsWrapProps}>
      {/* Company (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Company
        </label>
        <input
          type="text"
          value={formData.company}
          onChange={(e) => handleChange('company', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: T.border, color: T.text }}
          placeholder="Acme Corporation"
          disabled={saving}
          {...fieldAutofill}
        />
      </div>

      {/* Title (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Title
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => handleChange('title', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: T.border, color: T.text }}
          placeholder="VP of Sales"
          disabled={saving}
          {...fieldAutofill}
        />
      </div>

      {/* LinkedIn URL (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          LinkedIn URL
        </label>
        <input
          type="url"
          value={formData.linkedin_url}
          onChange={(e) => handleChange('linkedin_url', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: errors.linkedin_url ? '#dc2626' : T.border, color: T.text }}
          placeholder="https://linkedin.com/in/johndoe"
          disabled={saving}
          {...fieldAutofill}
        />
        {errors.linkedin_url && (
          <p className="text-xs mt-1" style={{ color: '#dc2626' }}>⚠️ {errors.linkedin_url}</p>
        )}
      </div>

      {/* Address (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Address
        </label>
        <input
          type="text"
          value={formData.address}
          onChange={(e) => handleChange('address', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: T.border, color: T.text }}
          placeholder="123 Main St, City, State"
          disabled={saving}
          {...fieldAutofill}
        />
      </div>

      {/* Website (Optional) */}
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Website
        </label>
        <input
          type="url"
          value={formData.website}
          onChange={(e) => handleChange('website', e.target.value)}
          className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-all"
          style={{ background: T.input || T.surface, borderColor: T.border, color: T.text }}
          placeholder="https://example.com"
          disabled={saving}
          {...fieldAutofill}
        />
      </div>

      {/* Referred By (Optional) */}
      {copy?.showReferral !== false && (
      <div>
        <label className="block text-sm font-semibold mb-2" style={{ color: T.accent }}>
          Referred By
        </label>
        <ReferredByPicker value={referredBy} onChange={setReferredBy} T={T} />
        <p className="text-xs mt-1" style={{ color: T.textFaint }}>
          Optional — tag who referred this person to track referral attribution.
        </p>
      </div>
      )}
      </DetailsWrap>
      )}

      {errors.form && (
        <p role="alert" className="text-sm" style={{ color: '#dc2626' }}>{errors.form}</p>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-6 py-3 rounded-xl border font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: T.cardBg, borderColor: T.border, color: T.textMuted }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-6 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
          style={{ background: T.accent, color: '#fff', border: 'none' }}
        >
          {saving ? (
            <>
              <span className="animate-spin">⚙️</span>
              Saving...
            </>
          ) : (
            <>
              <UserPlus className="w-5 h-5" />
              {copy?.submit ?? 'Scout+'}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ─── ReferredByPicker ─────────────────────────────────────────────────────
function ReferredByPicker({ value, onChange, T }) {
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
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border" style={{ background: `${T.accent}10`, borderColor: `${T.accent}40` }}>
        <span className="text-sm font-medium flex-1" style={{ color: T.accent }}>{value.name}</span>
        <button type="button" onClick={() => onChange(null)} style={{ color: T.textFaint }}>
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border" style={{ borderColor: T.border, background: T.input || T.surface }}>
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: T.textFaint }} />
        <input
          type="text"
          value={searchTerm}
          onChange={handleInput}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search existing contacts..."
          className="flex-1 bg-transparent border-none outline-none text-sm"
          style={{ color: T.text }}
        />
        {searching && <Loader className="w-4 h-4 animate-spin" style={{ color: T.textFaint }} />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg shadow-lg max-h-48 overflow-y-auto border" style={{ background: T.cardBg, borderColor: T.border }}>
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({ id: c.id, name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() });
                setSearchTerm('');
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 border-b last:border-b-0"
              style={{ borderColor: T.border, color: T.text }}
              onMouseEnter={e => e.currentTarget.style.background = T.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div className="text-sm font-medium" style={{ color: T.text }}>
                {c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
              </div>
              {(c.company || c.company_name) && (
                <div className="text-xs" style={{ color: T.textFaint }}>{c.company || c.company_name}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
