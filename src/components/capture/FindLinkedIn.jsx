/**
 * Find LinkedIn — offered right after Scan Business Card saves a person who
 * has no LinkedIn yet.
 *
 *   Person added. Find their LinkedIn and complete the profile?  [Find LinkedIn] [Skip]
 *   → the few likely profiles, each with why it matched
 *   → "This is Kristin" (or paste their link)
 *   → LinkedIn added, and what it filled in
 *
 * Saving never waits on this: the person is already saved, the card stays the
 * source of their details, and Skip opens their profile. A person who already
 * has a LinkedIn URL goes straight to their profile.
 *
 * Nothing is attached until the user says which profile is theirs. Then one
 * write (linkedinConfirm.js): the URL, and LinkedIn's details only where the
 * contact's own are empty. A title that differs from the card's is offered,
 * never applied. Nothing here logs.
 *
 * Barry Enrich shows this same screen on the contact profile (context
 * "profile"), starting from the profiles Barry found instead of searching,
 * or from the paste box when it found none.
 */
import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle, Linkedin, Loader, Search, ExternalLink, RotateCcw, AlertCircle } from 'lucide-react';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { findLinkedInProfiles } from './captureLabApi.js';
import { matchExplanation, searchPersonFrom } from './findLinkedInView.js';
import { confirmLinkedIn, acceptLinkedInSuggestion } from './linkedinConfirm.js';
import { profileUrl } from './linkedinEnrichment.js';

const STRENGTH_COLOR = Object.freeze({ strong: '#16a34a', good: '#2563eb', possible: '#b45309' });
const SOURCE_TEXT = Object.freeze({ apollo: 'Apollo', search: 'Google' });
const FILLED_TEXT = Object.freeze({
  title: 'title', headline: 'headline', seniority: 'seniority', departments: 'department', location: 'location', photo_url: 'photo',
});

const firstName = name => (typeof name === 'string' ? name.trim().split(/\s+/)[0] : '') || 'them';

/** The words that differ between right after a card save and on the contact's profile. */
const TEXT = Object.freeze({
  capture: { noneOfThese: 'None of these: open profile', none: 'Open profile', leave: 'Open profile', skip: 'Skip', own: 'card', back: c => `Open ${firstName(c.name)}` },
  profile: { noneOfThese: 'None of these', none: 'Not now', leave: 'Done', skip: 'Not now', own: 'contact', back: () => 'Close' },
});

/** "headline, location and photo" */
function listText(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function currentUser() {
  const user = getEffectiveUser();
  return user && !user._isImpersonated ? user : null;
}

async function loadSavedContact(contactId) {
  const user = currentUser();
  if (!user) return null;
  const snap = await getDoc(doc(db, 'users', user.uid, 'contacts', contactId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function confirmForUser(contactId, linkedinUrl) {
  const user = currentUser();
  if (!user) return { status: 'invalid' };
  return confirmLinkedIn(user.uid, contactId, linkedinUrl);
}

async function acceptForUser(contactId, suggestion) {
  const user = currentUser();
  if (!user) throw new Error('not signed in');
  await acceptLinkedInSuggestion(user.uid, contactId, suggestion);
}

function Candidate({ candidate, personName, onConfirm, T }) {
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
      <button type="button" onClick={() => onConfirm(candidate.linkedinUrl)} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#0a66c2', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
        This is {firstName(personName)}
      </button>
    </li>
  );
}

/** "Or paste their LinkedIn link": for when search does not find them, or finds the wrong people. */
function PasteLink({ onConfirm, T }) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = (event) => {
    event.preventDefault();
    const url = profileUrl(value.trim());
    if (!url) { setInvalid(true); return; }
    onConfirm(url);
  };
  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor="find-linkedin-paste" style={{ fontSize: 13, color: T.textMuted }}>Or paste their LinkedIn link</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          id="find-linkedin-paste" type="url" inputMode="url" autoComplete="off" placeholder="linkedin.com/in/…"
          value={value} onChange={(e) => { setValue(e.target.value); setInvalid(false); }}
          style={{ flex: '1 1 180px', minWidth: 0, padding: '10px 12px', borderRadius: 10, border: `1px solid ${invalid ? '#dc2626' : T.border}`, background: T.cardBg, color: T.text, fontSize: 16 }}
        />
        <button type="submit" disabled={!value.trim()} style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.cardBg, color: T.text, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          Add this profile
        </button>
      </div>
      {invalid && <p role="alert" style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>That isn&apos;t a LinkedIn profile link (linkedin.com/in/…).</p>}
    </form>
  );
}

/** After the profile is attached: what it added, and what LinkedIn says differently. */
function Linked({ outcome, contact, onAccept, accepting, accepted, acceptFailed, own = 'card', T, muted }) {
  const filled = outcome.filled.map(f => FILLED_TEXT[f] ?? f);
  const title = outcome.suggestions.find(s => s.field === 'title' && s.actionable);
  const company = outcome.suggestions.find(s => s.field === 'company');
  const box = { border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, background: T.cardBg, display: 'flex', flexDirection: 'column', gap: 8 };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: T.text }} role="status">
        <Linkedin size={18} color="#0a66c2" /> LinkedIn added to {firstName(contact.name)}
      </div>
      {outcome.profileStatus === 'found' && (
        <p style={muted}>
          {filled.length ? `Added from LinkedIn: ${listText(filled)}.` : 'Nothing new to add: the contact already has what LinkedIn shows.'}
        </p>
      )}
      {outcome.profileStatus === 'not_found' && <p style={muted}>No more details were available for this profile.</p>}
      {outcome.profileStatus === 'failed' && <p style={muted}>Couldn&apos;t load more details from LinkedIn right now.</p>}

      {title && (
        <div style={box} data-testid="linkedin-title-suggestion">
          <div style={{ fontSize: 14, color: T.text }}>
            LinkedIn lists the title as <strong>{title.suggested}</strong>. The {own} says <strong>{title.current}</strong>.
          </div>
          {accepted ? (
            <div style={{ fontSize: 13, color: '#16a34a', display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle size={14} /> Title updated</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" disabled={accepting} onClick={() => onAccept(title)} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.cardBg, color: T.text, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Use LinkedIn&apos;s title
              </button>
              <span style={{ fontSize: 13, color: T.textMuted }}>or keep the {own}&apos;s</span>
            </div>
          )}
          {acceptFailed && <p role="alert" style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>Couldn&apos;t update the title. Try again.</p>}
        </div>
      )}
      {company && (
        <div style={box} data-testid="linkedin-company-difference">
          <div style={{ fontSize: 14, color: T.text }}>
            LinkedIn lists the company as <strong>{company.suggested}</strong>. The {own} says <strong>{company.current}</strong>, and that stays.
          </div>
        </div>
      )}
    </>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.contactId    the contact just saved
 * @param {Function} props.onDone       (contactId) => void: open their profile
 * @param {object}   props.T            theme tokens
 * @param {Function} [props.loadContact]  injectable for tests
 * @param {Function} [props.search]       injectable for tests
 * @param {Function} [props.confirm]      (contactId, linkedinUrl) => outcome; injectable for tests
 * @param {Function} [props.accept]       (contactId, suggestion) => void; injectable for tests
 * @param {object[]} [props.found]        profiles already found (Barry Enrich): shown at once, no search
 * @param {string}   [props.context]      'capture' (after a card save) or 'profile' (on the contact profile)
 */
export default function FindLinkedIn({
  contactId, onDone, T,
  loadContact = loadSavedContact, search = findLinkedInProfiles, confirm = confirmForUser, accept = acceptForUser,
  found = null, context = 'capture',
}) {
  // loading | offer | searching | results | none | error | confirming | linked | taken | has_other | save_error
  const [step, setStep] = useState('loading');
  const [contact, setContact] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptFailed, setAcceptFailed] = useState(false);
  const t = TEXT[context] ?? TEXT.capture;
  // The caller's handler and list may be new each render; the load runs once per contact.
  const doneRef = useRef(onDone);
  const foundRef = useRef(found);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    let live = true;
    loadContact(contactId)
      .then((saved) => {
        if (!live) return;
        // Already has a LinkedIn, or cannot be read: nothing to offer, open the profile.
        if (!saved || saved.linkedin_url || !saved.name) { doneRef.current(contactId); return; }
        setContact(saved);
        const given = Array.isArray(foundRef.current) ? foundRef.current : null;
        if (given) {
          setCandidates(given);
          setStep(given.length ? 'results' : 'none');
        } else {
          setStep('offer');
        }
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

  const choose = async (linkedinUrl) => {
    setChosen(linkedinUrl);
    setStep('confirming');
    try {
      const result = await confirm(contactId, linkedinUrl);
      setOutcome(result);
      if (result.status === 'linked') setStep('linked');
      else if (result.status === 'taken' || result.status === 'has_other') setStep(result.status);
      else setStep('save_error');
    } catch {
      setStep('save_error');
    }
  };

  const takeSuggestion = async (suggestion) => {
    setAccepting(true);
    setAcceptFailed(false);
    try {
      await accept(contactId, suggestion);
      setAccepted(true);
    } catch {
      setAcceptFailed(true);
    } finally {
      setAccepting(false);
    }
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
  const back = () => setStep(candidates.length ? 'results' : 'none');

  if (step === 'loading') {
    return <p style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center' }}><Loader size={16} className="animate-spin" /> Opening…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="find-linkedin">
      {context === 'profile' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: T.text }}>
          <Linkedin size={20} color="#0a66c2" /> {firstName(contact.name)}&apos;s LinkedIn
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: T.text }}>
          <CheckCircle size={22} color="#16a34a" /> {contact.name} added
        </div>
      )}

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
            {candidates.map(c => <Candidate key={c.linkedinUrl} candidate={c} personName={contact.name} onConfirm={choose} T={T} />)}
          </ul>
          <PasteLink onConfirm={choose} T={T} />
          <button type="button" style={{ ...secondary, alignSelf: 'flex-start' }} onClick={done}>{t.noneOfThese}</button>
        </>
      )}

      {step === 'none' && (
        <>
          <p style={muted}>No likely LinkedIn profile found for {contact.name}.</p>
          <PasteLink onConfirm={choose} T={T} />
          <button type="button" style={{ ...secondary, alignSelf: 'flex-start' }} onClick={done}>{t.none}</button>
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

      {step === 'confirming' && (
        <p style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center' }} role="status">
          <Loader size={16} className="animate-spin" /> Adding LinkedIn and completing {firstName(contact.name)}&apos;s profile…
        </p>
      )}

      {step === 'linked' && (
        <>
          <Linked outcome={outcome} contact={contact} onAccept={takeSuggestion} accepting={accepting} accepted={accepted} acceptFailed={acceptFailed} own={t.own} T={T} muted={muted} />
          <button type="button" style={{ ...primary, alignSelf: 'flex-start' }} onClick={done}>{t.leave}</button>
        </>
      )}

      {step === 'taken' && (
        <>
          <p style={{ ...muted, display: 'flex', gap: 8, alignItems: 'flex-start' }} role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              That LinkedIn profile is already on {outcome.by?.name ? <strong>{outcome.by.name}</strong> : 'another contact'}, so it wasn&apos;t added to {firstName(contact.name)}. Nothing was changed.
            </span>
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {outcome.by?.contactId && (
              <button type="button" style={secondary} onClick={() => onDone(outcome.by.contactId)}>
                Open {outcome.by.name ? firstName(outcome.by.name) : 'that contact'}
              </button>
            )}
            <button type="button" style={secondary} onClick={back}>Choose another</button>
            <button type="button" style={secondary} onClick={done}>{t.back(contact)}</button>
          </div>
        </>
      )}

      {step === 'has_other' && (
        <>
          <p style={muted} role="alert">{contact.name} already has a different LinkedIn profile. Nothing was changed.</p>
          <button type="button" style={{ ...secondary, alignSelf: 'flex-start' }} onClick={done}>{t.leave}</button>
        </>
      )}

      {step === 'save_error' && (
        <>
          <p style={muted} role="alert">Couldn&apos;t add the LinkedIn profile.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={secondary} onClick={() => choose(chosen)}><RotateCcw size={16} /> Try again</button>
            <button type="button" style={secondary} onClick={done}>{t.skip}</button>
          </div>
        </>
      )}
    </div>
  );
}
