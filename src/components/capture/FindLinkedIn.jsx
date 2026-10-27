/**
 * Find LinkedIn — offered right after Scan Business Card saves a person who
 * has no LinkedIn yet.
 *
 *   Person added. Find their LinkedIn and complete the profile?  [Find LinkedIn] [Skip]
 *   → the few likely profiles, each with why it matched
 *   → this is them (confirming and enriching is the next step)
 *
 * Saving never waits on this: the person is already saved, the card stays the
 * source of their details, and Skip opens their profile. A person who already
 * has a LinkedIn URL goes straight to their profile.
 *
 * Read-only: it reads the saved contact and asks captureLinkedIn for likely
 * profiles. It writes nothing and logs nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle, Linkedin, Loader, Search, ExternalLink, RotateCcw } from 'lucide-react';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { findLinkedInProfiles } from './captureLabApi.js';
import { matchExplanation, searchPersonFrom } from './findLinkedInView.js';

const STRENGTH_COLOR = Object.freeze({ strong: '#16a34a', good: '#2563eb', possible: '#b45309' });
const SOURCE_TEXT = Object.freeze({ apollo: 'Apollo', search: 'Google' });

const firstName = name => (typeof name === 'string' ? name.trim().split(/\s+/)[0] : '') || 'them';

async function loadSavedContact(contactId) {
  const user = getEffectiveUser();
  if (!user || user._isImpersonated) return null;
  const snap = await getDoc(doc(db, 'users', user.uid, 'contacts', contactId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function Candidate({ candidate, personName, T }) {
  const [photoBroken, setPhotoBroken] = useState(false);
  const color = STRENGTH_COLOR[candidate.strength] ?? T.textMuted;
  const initials = (candidate.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <li style={{ listStyle: 'none', border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, background: T.cardBg, display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="linkedin-candidate">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        {candidate.photoUrl && !photoBroken ? (
          <img src={candidate.photoUrl} alt="" referrerPolicy="no-referrer" onError={() => setPhotoBroken(true)} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div aria-hidden="true" style={{ width: 48, height: 48, borderRadius: '50%', background: '#dbeafe', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>{initials}</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: T.text }}>{candidate.name || 'Name not shown'}</div>
          {candidate.headline && <div style={{ fontSize: 14, color: T.text, overflowWrap: 'anywhere' }}>{candidate.headline}</div>}
          {candidate.company && <div style={{ fontSize: 13, color: T.textMuted }}>{candidate.company}</div>}
          {candidate.location && <div style={{ fontSize: 13, color: T.textMuted }}>{candidate.location}</div>}
          <a href={candidate.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#0a66c2', display: 'inline-flex', alignItems: 'center', gap: 4, overflowWrap: 'anywhere' }}>
            {candidate.linkedinUrl.replace(/^https:\/\/www\./, '')} <ExternalLink size={12} />
          </a>
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color }}>
        {matchExplanation(candidate)}
        {candidate.sources?.length > 0 && (
          <span style={{ fontWeight: 400, color: T.textMuted }}> · found by {candidate.sources.map(s => SOURCE_TEXT[s] ?? s).join(' and ')}</span>
        )}
      </div>
      <button type="button" disabled title="Confirming a profile arrives in the next update" style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#0a66c2', color: '#fff', fontWeight: 700, fontSize: 14, opacity: 0.5, cursor: 'default' }}>
        This is {firstName(personName)}
      </button>
    </li>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.contactId    the contact just saved
 * @param {Function} props.onDone       (contactId) => void: open their profile
 * @param {object}   props.T            theme tokens
 * @param {Function} [props.loadContact]  injectable for tests
 * @param {Function} [props.search]       injectable for tests
 */
export default function FindLinkedIn({ contactId, onDone, T, loadContact = loadSavedContact, search = findLinkedInProfiles }) {
  const [step, setStep] = useState('loading');        // loading | offer | searching | results | none | error
  const [contact, setContact] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState(null);
  // The caller's handler may be a new function each render; the load runs once per contact.
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    let live = true;
    loadContact(contactId)
      .then((saved) => {
        if (!live) return;
        // Already has a LinkedIn, or cannot be read: nothing to offer, open the profile.
        if (!saved || saved.linkedin_url || !saved.name) { doneRef.current(contactId); return; }
        setContact(saved);
        setStep('offer');
      })
      .catch(() => { if (live) doneRef.current(contactId); });
    return () => { live = false; };
  }, [contactId, loadContact]);

  const find = async () => {
    setStep('searching');
    setError(null);
    const result = await search(searchPersonFrom(contact));
    if (result.status === 200) {
      const found = Array.isArray(result.body?.candidates) ? result.body.candidates : [];
      setCandidates(found);
      setStep(found.length ? 'results' : 'none');
      return;
    }
    setError(result.body?.error === 'capture_disabled' ? 'disabled' : 'failed');
    setStep('error');
  };

  const muted = { fontSize: 14, color: T.textMuted, margin: 0 };
  const primary = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 12,
    fontSize: 15, fontWeight: 700, border: 'none', background: '#0a66c2', color: '#fff', cursor: 'pointer',
  };
  const secondary = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 18px', borderRadius: 12,
    fontSize: 15, fontWeight: 600, border: `1px solid ${T.border}`, background: T.cardBg, color: T.text, cursor: 'pointer',
  };
  const done = () => onDone(contactId);

  if (step === 'loading') {
    return <p style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center' }}><Loader size={16} className="animate-spin" /> Opening…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="find-linkedin">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: T.text }}>
        <CheckCircle size={22} color="#16a34a" /> {contact.name} added
      </div>

      {step === 'offer' && (
        <>
          <p style={muted}>Find their LinkedIn and complete the profile?</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={primary} onClick={find}><Linkedin size={18} /> Find LinkedIn</button>
            <button type="button" style={secondary} onClick={done}>Skip</button>
          </div>
        </>
      )}

      {step === 'searching' && (
        <p style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center' }} role="status">
          <Search size={16} /> Looking for {firstName(contact.name)} on LinkedIn…
        </p>
      )}

      {step === 'results' && (
        <>
          <p style={muted}>
            {candidates.length === 1 ? 'One likely profile.' : `${candidates.length} likely profiles.`} Check which one is {firstName(contact.name)}.
          </p>
          <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {candidates.map(c => <Candidate key={c.linkedinUrl} candidate={c} personName={contact.name} T={T} />)}
          </ul>
          <p style={{ ...muted, fontSize: 13 }}>Confirming a profile and completing the contact from it arrives in the next update.</p>
          <button type="button" style={{ ...secondary, alignSelf: 'flex-start' }} onClick={done}>None of these: open profile</button>
        </>
      )}

      {step === 'none' && (
        <>
          <p style={muted}>No likely LinkedIn profile found for {contact.name}.</p>
          <button type="button" style={{ ...secondary, alignSelf: 'flex-start' }} onClick={done}>Open profile</button>
        </>
      )}

      {step === 'error' && (
        <>
          <p style={muted} role="alert">
            {error === 'disabled' ? 'LinkedIn search is not available for this account.' : "Couldn't search LinkedIn right now."}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {error !== 'disabled' && <button type="button" style={secondary} onClick={find}><RotateCcw size={16} /> Try again</button>}
            <button type="button" style={secondary} onClick={done}>Skip</button>
          </div>
        </>
      )}
    </div>
  );
}
