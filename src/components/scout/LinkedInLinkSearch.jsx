import { useState, useRef } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { Search, Loader, CheckCircle, AlertCircle, Linkedin, MapPin, Building2, Mail, Phone, X, GitBranch } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, BRIGADE } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { recordReferralReceived } from '../../services/referralIntelligenceService';

export default function LinkedInLinkSearch({ onContactAdded, onCancel }) {
  const T = useT();
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [searching, setSearching] = useState(false);
  const [contact, setContact] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'saving' | 'processing' | 'saved' | null
  const [error, setError] = useState(null);
  const [referredBy, setReferredBy] = useState(null);

  const handleFindContact = async (e) => {
    e.preventDefault();
    if (!linkedinUrl || linkedinUrl.trim() === '') {
      setError('Please paste a LinkedIn profile URL');
      return;
    }
    if (!linkedinUrl.includes('linkedin.com')) {
      setError('Please enter a valid LinkedIn URL (must contain linkedin.com)');
      return;
    }
    setSearching(true);
    setError(null);
    setContact(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('You must be logged in');
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/findContactByLinkedInUrl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, linkedin_url: linkedinUrl.trim() })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to find contact');
      if (!data.contact) throw new Error('Unable to retrieve profile details. Please verify the URL and try again.');
      setContact(data.contact);
    } catch (err) {
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleConfirmAndSave = async () => {
    if (!contact) return;
    setSaving(true);
    setSaveStatus('saving');
    setError(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('You must be logged in');
      setSaveStatus('processing');
      const companyId = await ensureCompanyExists(contact, user.uid);
      const contactId = contact.id || `apollo_${Date.now()}`;
      const contactData = {
        apollo_person_id: contact.id,
        name: contact.name || 'Unknown',
        title: contact.title || '',
        email: contact.email || null,
        phone: contact.phone_numbers?.[0]?.sanitized_number || null,
        linkedin_url: contact.linkedin_url || null,
        photo_url: contact.photo_url || null,
        company_id: companyId,
        company_name: contact.organization_name || null,
        company_industry: contact.organization?.industry || null,
        department: contact.departments?.[0] || null,
        seniority: contact.seniority || null,
        location: contact.location || null,
        status: 'active',
        saved_at: new Date().toISOString(),
        source: 'LinkedIn Link',
        match_quality: 100
      };
      // Set source tracking for referrals
      if (referredBy) {
        contactData.source = 'referral';
        contactData.addedFrom = 'referral';
        contactData.addedFromSource = referredBy.id;
      }

      await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), contactData);
      await updateCompanyContactCount(companyId, user.uid);

      // Record referral attribution post-save (sequential — needs contactId confirmed)
      if (referredBy) {
        await recordReferralReceived(user.uid, {
          fromContactId: referredBy.id,
          fromContactName: referredBy.name,
          toContactId: contactId,
          toContactName: contact.name || 'Unknown',
          context: 'Added via LinkedIn Link import'
        });
      }

      setSaveStatus('saved');
      onContactAdded([{ id: contactId, ...contactData }]);
    } catch (err) {
      setError(err.message || 'Failed to save contact. Please try again.');
      setSaving(false);
      setSaveStatus(null);
    }
  };

  const ensureCompanyExists = async (contact, userId) => {
    const companyName = contact.organization_name || contact.organization?.name;
    const apolloOrgId = contact.organization_id || contact.organization?.id;
    if (!companyName) return null;
    if (apolloOrgId) {
      const q = query(collection(db, 'users', userId, 'companies'), where('apollo_id', '==', apolloOrgId));
      const snap = await getDocs(q);
      if (!snap.empty) return snap.docs[0].id;
    }
    const companyId = apolloOrgId || `company_${Date.now()}`;
    await setDoc(doc(db, 'users', userId, 'companies', companyId), {
      apollo_id: apolloOrgId || null,
      name: companyName,
      industry: contact.organization?.industry || null,
      website_url: contact.organization?.website_url || null,
      domain: contact.organization?.primary_domain || null,
      location: contact.organization?.city && contact.organization?.state
        ? `${contact.organization.city}, ${contact.organization.state}` : null,
      employee_count: contact.organization?.estimated_num_employees || null,
      saved_at: new Date().toISOString(),
      source: 'LinkedIn Link',
      status: 'accepted',
      contact_count: 0,
      apolloEnriched: false
    });
    return companyId;
  };

  const updateCompanyContactCount = async (companyId, userId) => {
    if (!companyId) return;
    try {
      const ref = doc(db, 'users', userId, 'companies', companyId);
      const snap = await getDoc(ref);
      if (snap.exists()) await updateDoc(ref, { contact_count: (snap.data().contact_count || 0) + 1 });
    } catch (err) {
      console.error('Error updating company contact count:', err);
    }
  };

  return (
    <div style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── URL input form ── */}
      {!contact && (
        <form onSubmit={handleFindContact} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.6, marginBottom: 8, textTransform: 'uppercase' }}>
              LinkedIn Profile URL
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: T.input, border: `1.5px solid ${error ? STATUS.red : T.border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>
              <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', borderRight: `1px solid ${T.border}` }}>
                <Linkedin size={16} color="#0077b5" />
              </div>
              <input
                type="url"
                value={linkedinUrl}
                onChange={e => { setLinkedinUrl(e.target.value); setError(null); }}
                style={{
                  flex: 1, padding: '11px 14px', background: 'transparent', border: 'none',
                  outline: 'none', color: T.text, fontSize: 13,
                }}
                placeholder="https://linkedin.com/in/johndoe"
                disabled={searching}
                autoFocus
              />
            </div>
            <p style={{ marginTop: 6, fontSize: 11, color: T.textFaint }}>
              Copy the full profile URL from LinkedIn and paste it here.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', background: `${STATUS.red}12`, border: `1px solid ${STATUS.red}40`, borderRadius: 9 }}>
              <AlertCircle size={15} color={STATUS.red} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: STATUS.red, lineHeight: 1.5 }}>{error}</span>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 9 }}>
            <button
              type="submit"
              disabled={searching}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 9, border: 'none',
                background: searching ? T.surface : 'linear-gradient(135deg,#0077b5,#005f8e)',
                color: searching ? T.textMuted : '#fff',
                fontSize: 13, fontWeight: 700, cursor: searching ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.15s'
              }}
            >
              {searching ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />Finding...</> : <><Search size={14} />Find Contact</>}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={searching}
              style={{ padding: '11px 18px', borderRadius: 9, border: `1.5px solid ${T.border}`, background: 'transparent', color: T.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
          <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
        </form>
      )}

      {/* ── Contact found ── */}
      {contact && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Success banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', background: `${STATUS.green}12`, border: `1px solid ${STATUS.green}35`, borderRadius: 9 }}>
            <CheckCircle size={15} color={STATUS.green} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: STATUS.green, fontWeight: 600 }}>Contact found — review and save below.</span>
          </div>

          {/* Contact card */}
          <ContactCard contact={contact} T={T} />

          {/* Referred By (optional) */}
          <ReferredByPickerLinkedIn value={referredBy} onChange={setReferredBy} T={T} />

          {/* Error on save */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', background: `${STATUS.red}12`, border: `1px solid ${STATUS.red}40`, borderRadius: 9 }}>
              <AlertCircle size={15} color={STATUS.red} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: STATUS.red, lineHeight: 1.5 }}>{error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 9 }}>
            <button
              onClick={handleConfirmAndSave}
              disabled={saving}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 9, border: 'none',
                background: saving ? T.surface : `linear-gradient(135deg,${STATUS.green},#059669)`,
                color: saving ? T.textMuted : '#fff',
                fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.15s'
              }}
            >
              {saving
                ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />{saveStatus === 'processing' ? 'Processing...' : saveStatus === 'saved' ? 'Saved!' : 'Saving...'}</>
                : <><CheckCircle size={14} />Save Contact</>}
            </button>
            <button
              onClick={() => { setContact(null); setLinkedinUrl(''); setError(null); }}
              disabled={saving}
              style={{ padding: '11px 18px', borderRadius: 9, border: `1.5px solid ${T.border}`, background: 'transparent', color: T.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ContactCard ──────────────────────────────────────────────────────────────
function ContactCard({ contact, T }) {
  const photo = contact.photo_url;
  const email = contact.email;
  const phone = contact.phone_numbers?.[0]?.sanitized_number || contact.phone;

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${T.border}`, background: T.cardBg }}>
      {/* Header row: avatar + name/title + badge */}
      <div style={{ padding: '16px 16px 14px', display: 'flex', alignItems: 'center', gap: 14, background: `linear-gradient(135deg,#0077b510 0%,${T.cardBg} 100%)`, borderBottom: `1px solid ${T.border}` }}>
        {/* Avatar */}
        <div style={{ flexShrink: 0, width: 88, height: 88, borderRadius: '50%', overflow: 'hidden', border: '2.5px solid #0077b540', background: '#0077b515', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {photo ? (
            <img src={photo} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
          ) : (
            <Linkedin size={36} color="#0077b5" />
          )}
        </div>
        {/* Name + title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text, lineHeight: 1.2, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name}</div>
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.4 }}>{contact.title || 'Title not available'}</div>
        </div>
        {/* EXACT MATCH badge */}
        <div style={{ flexShrink: 0, background: '#0077b5', borderRadius: 6, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Linkedin size={11} color="#fff" />
          <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: 0.5 }}>EXACT MATCH</span>
        </div>
      </div>

      {/* Details */}
      <div style={{ padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contact.organization_name && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.textMuted }}>
            <Building2 size={13} color={T.textFaint} />
            <span>{contact.organization_name}</span>
            {contact.organization?.industry && <span style={{ color: T.textFaint }}>· {contact.organization.industry}</span>}
          </div>
        )}
        {contact.location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.textMuted }}>
            <MapPin size={13} color={T.textFaint} />
            <span>{contact.location}</span>
          </div>
        )}
        {email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: BRIGADE.blue }}>
            <Mail size={13} color={T.textFaint} />
            <span>{email}</span>
          </div>
        )}
        {phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.textMuted }}>
            <Phone size={13} color={T.textFaint} />
            <span>{phone}</span>
          </div>
        )}
        {contact.linkedin_url && (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#0077b5', textDecoration: 'none', marginTop: 2, padding: '7px 10px', background: '#0077b510', border: '1px solid #0077b530', borderRadius: 7 }}
          >
            <Linkedin size={13} color="#0077b5" />
            View LinkedIn Profile →
          </a>
        )}
      </div>
    </div>
  );
}

// ─── ReferredByPickerLinkedIn ───────────────────────────────────────────────
function ReferredByPickerLinkedIn({ value, onChange, T }) {
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
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '10px 13px', borderRadius: 9,
        background: '#8b5cf615', border: '1px solid #8b5cf640',
      }}>
        <GitBranch size={14} color="#7c3aed" />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#7c3aed' }}>
          Referred by {value.name}
        </span>
        <X size={13} color="#7c3aed" style={{ cursor: 'pointer', opacity: 0.6 }}
          onClick={() => onChange(null)} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
        <GitBranch size={11} color={T.textFaint} />
        Referred by (optional)
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: T.input || T.surface, border: `1px solid ${T.border}`,
        borderRadius: 9, padding: '8px 12px',
      }}>
        <Search size={13} color={T.textFaint} />
        <input
          type="text"
          value={searchTerm}
          onChange={handleInput}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search contacts who referred this person..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: T.text, fontSize: 12,
          }}
        />
        {searching && <Loader size={13} color={T.textFaint} style={{ animation: 'spin 1s linear infinite' }} />}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: T.cardBg || '#fff', border: `1px solid ${T.border}`,
          borderRadius: 9, marginTop: 4, maxHeight: 180, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          {results.map(c => (
            <div
              key={c.id}
              onMouseDown={() => {
                onChange({ id: c.id, name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() });
                setSearchTerm('');
                setOpen(false);
              }}
              style={{
                padding: '8px 14px', cursor: 'pointer', transition: 'background 0.1s',
                borderBottom: `1px solid ${T.border}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.surface || '#f9fafb'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>
                {c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
              </div>
              {(c.company || c.company_name) && (
                <div style={{ fontSize: 10, color: T.textFaint }}>{c.company || c.company_name}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
