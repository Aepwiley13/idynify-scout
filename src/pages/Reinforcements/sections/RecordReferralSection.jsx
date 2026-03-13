/**
 * RecordReferralSection — Log referrals sent and received.
 * Two-tab interface: "I received a referral" and "I sent a referral".
 * Uses contact autocomplete from Firestore.
 */
import { useState, useEffect, useRef } from 'react';
import { ArrowDownLeft, ArrowUpRight, Search, Check, X, Loader } from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { auth, db } from '../../../firebase/config';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { PEOPLE_PATHS } from '../../../schemas/peopleSchema';
import {
  recordReferralReceived,
  recordReferralSent
} from '../../../services/referralIntelligenceService';

const ACCENT = '#f59e0b';

function ContactPicker({ userId, label, value, onChange, T }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const doSearch = async (term) => {
    if (!term || term.length < 2 || !userId) { setResults([]); return; }
    setSearching(true);
    try {
      const q = query(
        collection(db, PEOPLE_PATHS.allPeople(userId)),
        where('is_archived', '==', false),
        orderBy('name'),
        limit(50)
      );
      const snap = await getDocs(q);
      const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const termLower = term.toLowerCase();
      const filtered = contacts.filter(c => {
        const name = (c.name || '').toLowerCase();
        const company = (c.company || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        return name.includes(termLower) || company.includes(termLower) || email.includes(termLower);
      }).slice(0, 8);
      setResults(filtered);
    } catch (err) {
      console.error('[ContactPicker] Search failed:', err);
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

  const selectContact = (contact) => {
    onChange({ id: contact.id, name: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() });
    setSearchTerm(contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim());
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: T.surface, border: `1px solid ${T.border2}`,
        borderRadius: 8, padding: '8px 12px',
      }}>
        <Search size={13} color={T.textFaint} />
        <input
          type="text"
          value={value ? value.name : searchTerm}
          onChange={(e) => { if (value) onChange(null); handleInput(e); }}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder="Search contacts..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: T.text, fontSize: 13,
          }}
        />
        {value && (
          <X size={13} color={T.textFaint} style={{ cursor: 'pointer' }}
            onClick={() => { onChange(null); setSearchTerm(''); }} />
        )}
        {searching && <Loader size={13} color={T.textFaint} style={{ animation: 'spin 1s linear infinite' }} />}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: T.cardBg, border: `1px solid ${T.border2}`,
          borderRadius: 10, marginTop: 4, maxHeight: 200, overflowY: 'auto',
          boxShadow: `0 8px 30px rgba(0,0,0,0.3)`,
        }}>
          {results.map(c => (
            <div
              key={c.id}
              onClick={() => selectContact(c)}
              style={{
                padding: '8px 14px', cursor: 'pointer', transition: 'background 0.1s',
                borderBottom: `1px solid ${T.border}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.surface; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>
                {c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
              </div>
              {c.company && <div style={{ fontSize: 10, color: T.textFaint }}>{c.company}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecordReferralSection() {
  const T = useT();
  const activeUser = useActiveUser();
  const userId = activeUser?.uid || activeUser?.id || auth.currentUser?.uid;

  const [mode, setMode] = useState('received'); // 'received' | 'sent'
  const [fromContact, setFromContact] = useState(null);
  const [toContact, setToContact] = useState(null);
  const [toName, setToName] = useState('');
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setFromContact(null);
    setToContact(null);
    setToName('');
    setContext('');
    setSuccess(false);
  };

  const handleSubmit = async () => {
    if (!userId) return;
    if (mode === 'received' && !fromContact) return;
    if (mode === 'sent' && !fromContact) return;

    setSubmitting(true);
    try {
      const referredName = toContact?.name || toName;
      if (mode === 'received') {
        await recordReferralReceived(userId, {
          fromContactId: fromContact.id,
          fromContactName: fromContact.name,
          toContactId: toContact?.id || null,
          toContactName: referredName,
          context,
        });
      } else {
        await recordReferralSent(userId, {
          fromContactId: fromContact.id,
          fromContactName: fromContact.name,
          toContactId: toContact?.id || null,
          toContactName: referredName,
          context,
        });
      }
      setSuccess(true);
      setTimeout(() => reset(), 2000);
    } catch (err) {
      console.error('[RecordReferral] Submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = fromContact && (toContact || toName.trim().length > 0);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 600, animation: 'fadeUp 0.2s ease' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Record Referral</div>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
          Log referrals to build your network intelligence
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
        {[
          { id: 'received', label: 'I received a referral', Icon: ArrowDownLeft, color: '#10b981' },
          { id: 'sent', label: 'I sent a referral', Icon: ArrowUpRight, color: '#3b82f6' },
        ].map(m => (
          <div
            key={m.id}
            onClick={() => { setMode(m.id); reset(); }}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
              background: mode === m.id ? `${m.color}12` : T.surface,
              border: `1px solid ${mode === m.id ? m.color + '40' : T.border}`,
              transition: 'all 0.15s',
            }}
          >
            <m.Icon size={15} color={mode === m.id ? m.color : T.textFaint} />
            <div style={{ fontSize: 12, fontWeight: mode === m.id ? 600 : 400, color: mode === m.id ? m.color : T.textMuted }}>
              {m.label}
            </div>
          </div>
        ))}
      </div>

      {/* Success state */}
      {success && (
        <div style={{
          background: '#10b98115', border: '1px solid #10b98140',
          borderRadius: 12, padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        }}>
          <Check size={16} color="#10b981" />
          <div style={{ fontSize: 13, color: '#10b981', fontWeight: 500 }}>
            Referral recorded successfully
          </div>
        </div>
      )}

      {/* Form */}
      <div style={{
        background: T.cardBg, border: `1px solid ${T.border2}`,
        borderRadius: 14, padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <ContactPicker
          userId={userId}
          label={mode === 'received' ? 'Who sent you the referral?' : 'Who did you send the referral to?'}
          value={fromContact}
          onChange={setFromContact}
          T={T}
        />

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
            {mode === 'received' ? 'Who did they refer to you?' : 'Who did you refer?'}
          </div>
          <ContactPicker
            userId={userId}
            label=""
            value={toContact}
            onChange={setToContact}
            T={T}
          />
          {!toContact && (
            <div style={{ marginTop: 6 }}>
              <input
                type="text"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                placeholder="Or type a name if not in contacts..."
                style={{
                  width: '100%', background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: 8, padding: '8px 12px', color: T.text, fontSize: 12,
                  outline: 'none',
                }}
              />
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
            Context (optional)
          </div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="What was the referral about? e.g. 'Needs accounting software for their 50-person team'"
            rows={3}
            style={{
              width: '100%', background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: '10px 12px', color: T.text, fontSize: 12,
              outline: 'none', resize: 'vertical', lineHeight: 1.5,
            }}
          />
        </div>

        <div
          onClick={canSubmit && !submitting ? handleSubmit : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 8,
            background: canSubmit ? ACCENT : T.surface,
            border: `1px solid ${canSubmit ? ACCENT : T.border}`,
            color: canSubmit ? '#000' : T.textFaint,
            fontSize: 13, fontWeight: 600,
            cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed',
            opacity: submitting ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
        >
          {submitting ? 'Recording...' : 'Record referral'}
        </div>
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
