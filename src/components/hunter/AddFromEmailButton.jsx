/**
 * AddFromEmailButton — "Add to Scout" action on inbound Gmail messages.
 *
 * Appears on inbound messages from unknown senders in the reply thread viewer.
 * Flow: Parse sender email → Apollo enrichment → Preview card → Save → Optional referral attribution
 *
 * Sprint 3: Gmail contact import (no new OAuth scope needed)
 */
import { useState, useRef } from 'react';
import { UserPlus, Loader, CheckCircle, AlertCircle, Search, X, GitBranch } from 'lucide-react';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { recordReferralReceived } from '../../services/referralIntelligenceService';

/**
 * Parse email address from a Gmail "From" header.
 * e.g. "Laura Hoxie <laurahoxie@gmail.com>" → { name: "Laura Hoxie", email: "laurahoxie@gmail.com" }
 */
function parseFromHeader(from) {
  if (!from) return { name: null, email: null };

  const match = from.match(/^"?([^"<]*)"?\s*<?([^>]+)>?$/);
  if (match) {
    return {
      name: match[1]?.trim() || null,
      email: match[2]?.trim().toLowerCase() || null
    };
  }
  // Just an email address
  if (from.includes('@')) {
    return { name: null, email: from.trim().toLowerCase() };
  }
  return { name: from.trim(), email: null };
}

export default function AddFromEmailButton({ fromHeader, onContactAdded }) {
  const [state, setState] = useState('idle'); // idle | loading | preview | saving | saved | error
  const [enrichedContact, setEnrichedContact] = useState(null);
  const [error, setError] = useState(null);
  const [referredBy, setReferredBy] = useState(null);

  const parsed = parseFromHeader(fromHeader);

  const handleLookup = async () => {
    if (!parsed.email) {
      setError('Could not extract email address');
      setState('error');
      return;
    }

    setState('loading');
    setError(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      // Check if contact already exists in Scout
      const existingQuery = query(
        collection(db, 'users', user.uid, 'contacts'),
        where('email', '==', parsed.email)
      );
      const existingSnap = await getDocs(existingQuery);
      if (!existingSnap.empty) {
        setError('This contact is already in your pipeline');
        setState('error');
        return;
      }

      // Try Apollo enrichment
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/find-contact-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, email: parsed.email })
      });

      const data = await res.json();

      if (data.contact) {
        setEnrichedContact(data.contact);
      } else {
        // No Apollo match — use what we have from the email header
        setEnrichedContact({
          name: parsed.name || parsed.email.split('@')[0],
          email: parsed.email,
          title: null,
          organization_name: null,
          photo_url: null,
          linkedin_url: null,
          location: null,
        });
      }
      setState('preview');
    } catch (err) {
      setError(err.message || 'Lookup failed');
      setState('error');
    }
  };

  const handleSave = async () => {
    if (!enrichedContact) return;
    setState('saving');

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const contactId = enrichedContact.id
        ? `apollo_${enrichedContact.id}`
        : `email_${Date.now()}`;

      const contactData = {
        name: enrichedContact.name || parsed.name || 'Unknown',
        email: enrichedContact.email || parsed.email,
        title: enrichedContact.title || null,
        phone: enrichedContact.phone_numbers?.[0]?.sanitized_number || null,
        linkedin_url: enrichedContact.linkedin_url || null,
        photo_url: enrichedContact.photo_url || null,
        company_name: enrichedContact.organization_name || null,
        location: enrichedContact.location || null,
        apollo_person_id: enrichedContact.id || null,

        // Source tracking
        source: referredBy ? 'referral' : 'Gmail Import',
        addedFrom: referredBy ? 'referral' : 'gmail_import',
        addedFromSource: referredBy ? referredBy.id : `email:${parsed.email}`,

        // Scout metadata
        contact_status: 'New',
        contact_status_updated_at: new Date().toISOString(),
        lead_status: 'new_lead',
        saved_at: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        enrichment_status: enrichedContact.id ? 'apollo_enriched' : 'email_extracted',
        is_archived: false,
      };

      await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), contactData);

      // Record referral if tagged (post-save, sequential)
      if (referredBy) {
        await recordReferralReceived(user.uid, {
          fromContactId: referredBy.id,
          fromContactName: referredBy.name,
          toContactId: contactId,
          toContactName: contactData.name,
          context: 'Imported from Gmail thread'
        });
      }

      setState('saved');
      if (onContactAdded) onContactAdded({ id: contactId, ...contactData });
    } catch (err) {
      setError(err.message || 'Save failed');
      setState('error');
    }
  };

  // ── Idle state: small inline button ──
  if (state === 'idle') {
    return (
      <button
        onClick={handleLookup}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 6,
          background: '#10b98112', border: '1px solid #10b98130',
          color: '#10b981', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', transition: 'all 0.15s',
          marginTop: 6,
        }}
      >
        <UserPlus size={12} />
        Add to Scout
      </button>
    );
  }

  // ── Loading ──
  if (state === 'loading') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 8,
        background: '#3b82f608', border: '1px solid #3b82f620',
        marginTop: 6,
      }}>
        <Loader size={14} color="#3b82f6" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 11, color: '#3b82f6' }}>Looking up {parsed.email}...</span>
      </div>
    );
  }

  // ── Saved ──
  if (state === 'saved') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 8,
        background: '#10b98112', border: '1px solid #10b98130',
        marginTop: 6,
      }}>
        <CheckCircle size={14} color="#10b981" />
        <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>
          Added to Scout{referredBy ? ` (referred by ${referredBy.name})` : ''}
        </span>
      </div>
    );
  }

  // ── Error ──
  if (state === 'error') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 8,
        background: '#ef444412', border: '1px solid #ef444430',
        marginTop: 6,
      }}>
        <AlertCircle size={14} color="#ef4444" />
        <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>
        <button
          onClick={() => { setState('idle'); setError(null); }}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Preview + Save ──
  if (state === 'preview' || state === 'saving') {
    return (
      <div style={{
        marginTop: 8, padding: '12px 14px', borderRadius: 10,
        background: '#f8fafc', border: '1px solid #e2e8f0',
      }}>
        {/* Contact preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {enrichedContact?.photo_url ? (
            <img src={enrichedContact.photo_url} alt="" style={{
              width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
              border: '2px solid #e2e8f0',
            }} />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#3b82f615', border: '2px solid #3b82f630',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#3b82f6',
            }}>
              {(enrichedContact?.name || '?')[0].toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
              {enrichedContact?.name || 'Unknown'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {[enrichedContact?.title, enrichedContact?.organization_name].filter(Boolean).join(' at ') || parsed.email}
            </div>
          </div>
          <button
            onClick={() => { setState('idle'); setEnrichedContact(null); setReferredBy(null); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <X size={14} color="#94a3b8" />
          </button>
        </div>

        {/* Referred By picker */}
        <ReferredByInline value={referredBy} onChange={setReferredBy} />

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={state === 'saving'}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 7, border: 'none',
            background: state === 'saving' ? '#94a3b8' : '#10b981',
            color: '#fff', fontSize: 12, fontWeight: 700,
            cursor: state === 'saving' ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 8,
          }}
        >
          {state === 'saving' ? (
            <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</>
          ) : (
            <><UserPlus size={13} /> Save to Scout</>
          )}
        </button>
      </div>
    );
  }

  return null;
}

// ─── Inline ReferredBy picker ───────────────────────────────────────────────
function ReferredByInline({ value, onChange }) {
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
      const termLower = term.toLowerCase();
      setResults(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => {
        const name = (c.name || '').toLowerCase();
        return name.includes(termLower);
      }).slice(0, 5));
    } catch { setResults([]); }
    finally { setSearching(false); }
  };

  if (value) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderRadius: 6, background: '#8b5cf612', border: '1px solid #8b5cf630',
      }}>
        <GitBranch size={12} color="#7c3aed" />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#7c3aed' }}>
          Referred by {value.name}
        </span>
        <X size={11} color="#7c3aed" style={{ cursor: 'pointer', opacity: 0.6 }}
          onClick={() => onChange(null)} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 6,
        background: '#fff', border: '1px solid #e2e8f0',
      }}>
        <GitBranch size={12} color="#94a3b8" />
        <input
          type="text"
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setOpen(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => doSearch(e.target.value), 300);
          }}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Referred by... (optional)"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#1e293b', fontSize: 11,
          }}
        />
        {searching && <Loader size={11} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 6, marginTop: 2, maxHeight: 140, overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
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
                padding: '6px 10px', cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                fontSize: 11, color: '#1e293b',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
              {c.company_name && <span style={{ color: '#94a3b8' }}> · {c.company_name}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
