import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Search, Loader, CheckCircle, AlertCircle, Linkedin, MapPin, Building2, Mail, Phone } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, BRIGADE } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';

export default function LinkedInLinkSearch({ onContactAdded, onCancel }) {
  const T = useT();
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [searching, setSearching] = useState(false);
  const [contact, setContact] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
    setError(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('You must be logged in');
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
      await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), contactData);
      await updateCompanyContactCount(companyId, user.uid);
      onContactAdded([{ id: contactId, ...contactData }]);
    } catch (err) {
      setError(err.message || 'Failed to save contact. Please try again.');
      setSaving(false);
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
              {saving ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />Saving...</> : <><CheckCircle size={14} />Save Contact</>}
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
