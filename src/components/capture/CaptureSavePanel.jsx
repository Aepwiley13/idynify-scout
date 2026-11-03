/**
 * Match → Save, under the review of a capture.
 *
 *   Continue      look each reviewed person up in the workspace (read-only)
 *   the match     New person / Already in IDYNIFY / Possible match (choose) /
 *                 Conflict (cannot save); and Existing company / Possible
 *                 match (link, or No company) / New company (add, or No
 *                 company) / No company. A company the card showed only weakly
 *                 (a logo, an unclear read) that the user did not confirm
 *                 starts at No company: a company is never created for it
 *                 unless the user chooses to.
 *   Add Person    save (captureSave.js), then hand the saved ids back
 *
 * Editing a detail after the check makes the match stale: Continue again.
 * Save itself looks again and writes nothing if the match moved since it was
 * shown; the new match is shown instead.
 */
import { useState } from 'react';
import { Loader, UserPlus, UserCheck, AlertTriangle, Building2, RotateCcw } from 'lucide-react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { previewCapturePerson, saveCapturePerson } from './captureSave.js';
import { socialProblems, companyIsUnconfirmed } from './captureDraft.js';

const MATCHED_ON = Object.freeze({
  email: 'email', phone: 'phone number', linkedin_url: 'LinkedIn', apollo_person_id: 'Apollo ID', name_company: 'name and company',
});

/** The fields that decide a match; editing anything else does not make it stale. */
const identityKey = people => JSON.stringify(people.map(p => [
  p.name, p.email, p.linkedinUrl, p.company, p.website, (p.phones ?? []).map(n => [n.value, n.extension, n.label]),
]));

function signedInUid() {
  try {
    const user = getEffectiveUser();
    return user && !user._isImpersonated ? user.uid : null;
  } catch {
    return null;
  }
}

function canSave(match, choice) {
  if (!match) return false;
  if (match.person.status === 'conflict' || match.person.status === 'saved') return false;
  if (match.person.status === 'review' && !choice.person) return false;
  return true;
}

function saveLabel(match) {
  if (match?.person.status === 'existing') return `Update ${match.person.name || 'existing contact'}`;
  return 'Add Person';
}

function PersonMatch({ match, choice, setChoice, onOpen, T }) {
  const box = (color) => ({ borderRadius: 12, padding: 12, fontSize: 14, border: `1px solid ${color}55`, background: `${color}12`, color: T.text });
  const radio = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 14, cursor: 'pointer' };
  const { person } = match;

  if (person.status === 'new') {
    return <div style={box('#16a34a')} data-testid="person-match"><strong>New person.</strong> They'll be added to IDYNIFY.</div>;
  }
  if (person.status === 'existing') {
    return (
      <div style={box('#2563eb')} data-testid="person-match">
        <strong>Already in IDYNIFY:</strong> {person.name || 'a saved contact'}{person.company ? ` · ${person.company}` : ''}
        {person.matchedOn ? ` (same ${MATCHED_ON[person.matchedOn] ?? person.matchedOn})` : ''}.
        <div style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Saving adds what's new from this card. It won't change what's already there.</div>
      </div>
    );
  }
  if (person.status === 'review') {
    return (
      <div style={box('#f59e0b')} data-testid="person-match" role="radiogroup" aria-label="Is this the same person?">
        <strong>Possible match.</strong> Someone with the same name and company is already in IDYNIFY. Is this the same person?
        {person.candidates.map(c => (
          <label key={c.contactId} style={radio}>
            <input type="radio" name="capture-person" checked={choice.person === c.contactId} onChange={() => setChoice({ ...choice, person: c.contactId })} />
            Same person: update {c.name || 'the saved contact'}{c.company ? ` · ${c.company}` : ''}
          </label>
        ))}
        <label style={radio}>
          <input type="radio" name="capture-person" checked={choice.person === 'new'} onChange={() => setChoice({ ...choice, person: 'new' })} />
          Different person: add them as new
        </label>
      </div>
    );
  }
  if (person.status === 'conflict') {
    const what = MATCHED_ON[person.matchedOn] ?? 'detail';
    return (
      <div style={box('#ef4444')} data-testid="person-match" role="alert">
        <strong>Needs review.</strong> {person.count} contacts in IDYNIFY already share this {what}, so IDYNIFY won't guess which one this is.
        Change or remove the {what} above to add a new person, or merge those contacts first.
      </div>
    );
  }
  // saved: this scan already added them (a retry, or a second tap).
  return (
    <div style={box('#16a34a')} data-testid="person-match">
      <strong>Already saved from this scan:</strong> {person.name || 'this person'}.
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={() => onOpen(person.contactId)} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.cardBg, color: T.text, cursor: 'pointer', fontWeight: 600 }}>
          Open contact
        </button>
      </div>
    </div>
  );
}

function CompanyMatch({ match, choice, setChoice, weak, T }) {
  const { person, company } = match;
  const line = { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: T.text, minWidth: 0 };
  const radio = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', minHeight: 44, fontSize: 14, cursor: 'pointer' };
  const text = { minWidth: 0, overflowWrap: 'anywhere' };
  const noCompany = (
    <label style={radio}>
      <input type="radio" name="capture-company" checked={choice.company === 'none'} onChange={() => setChoice({ ...choice, company: 'none' })} />
      <span style={text}>No company</span>
    </label>
  );
  const icon = <Building2 size={16} style={{ flexShrink: 0, marginTop: 2, color: T.textMuted }} />;

  if (person.status === 'saved' || person.status === 'conflict') return null;
  if (person.status === 'existing' && person.company) {
    return <div style={line} data-testid="company-match">{icon}<span style={text}>Company stays <strong>{person.company}</strong>.</span></div>;
  }
  if (company.status === 'existing') {
    return <div style={line} data-testid="company-match">{icon}<span style={text}><strong>Existing company:</strong> {company.name}</span></div>;
  }
  if (company.status === 'possible') {
    return (
      <div style={line} data-testid="company-match">
        {icon}
        <div role="radiogroup" aria-label="Link this company?" style={{ minWidth: 0 }}>
          <span style={text}><strong>Possible company match:</strong> {company.name} (same website or email domain, different name).</span>
          <label style={radio}>
            <input type="radio" name="capture-company" checked={choice.company !== 'none'} onChange={() => setChoice({ ...choice, company: 'link' })} />
            <span style={text}>Link to {company.name}</span>
          </label>
          {noCompany}
        </div>
      </div>
    );
  }
  if (company.status === 'new') {
    return (
      <div style={line} data-testid="company-match">
        {icon}
        <div role="radiogroup" aria-label="Add this company?" style={{ minWidth: 0 }}>
          {weak && (
            <span style={{ ...text, display: 'block', color: T.textMuted }}>
              The company on the card was unclear or only in a logo, so it isn't added unless you choose it.
            </span>
          )}
          <label style={radio}>
            <input type="radio" name="capture-company" checked={choice.company !== 'none'} onChange={() => setChoice({ ...choice, company: 'link' })} />
            <span style={text}><strong>New company:</strong> {company.name}, added to Saved Companies</span>
          </label>
          {noCompany}
        </div>
      </div>
    );
  }
  return <div style={line} data-testid="company-match">{icon}<span>No company.</span></div>;
}

/** The company choice a match starts at: No company for a weak read the user has not confirmed. */
function startingCompanyChoice(match, draft) {
  const offered = ['new', 'possible'].includes(match.company?.status);
  return offered && companyIsUnconfirmed(draft) ? 'none' : 'link';
}

/**
 * @param {object}   props
 * @param {string}   props.operationId  the capture's cap_ id
 * @param {object[]} props.people       the reviewed drafts
 * @param {Function} props.onSaved      ([{ contactId, companyId, outcome }]) => void
 * @param {object}   props.T            theme tokens
 */
export default function CaptureSavePanel({ operationId, people, onSaved, T }) {
  const [phase, setPhase] = useState('idle');           // idle | checking | ready | saving
  const [checkedKey, setCheckedKey] = useState(null);
  const [matches, setMatches] = useState([]);
  const [choices, setChoices] = useState([]);
  const [notice, setNotice] = useState(null);
  const [failed, setFailed] = useState(null);           // 'check' | 'save'

  const key = identityKey(people);
  const stale = checkedKey !== key;
  const missingName = people.some(p => !p.name?.trim());
  const socialsUnresolved = people.some(p => socialProblems(p).length > 0);
  const blocked = missingName || socialsUnresolved;
  const uid = signedInUid();

  const check = async () => {
    setPhase('checking');
    setNotice(null);
    setFailed(null);
    try {
      const found = [];
      for (let index = 0; index < people.length; index += 1) {
        found.push(await previewCapturePerson(uid, { operationId, index, draft: people[index] }));
      }
      setMatches(found);
      setChoices(found.map((match, i) => ({ person: null, company: startingCompanyChoice(match, people[i]) })));
      setCheckedKey(key);
      setPhase('ready');
    } catch {
      setFailed('check');
      setPhase('idle');
    }
  };

  const save = async () => {
    setPhase('saving');
    setNotice(null);
    setFailed(null);
    const saved = [];
    try {
      for (let index = 0; index < people.length; index += 1) {
        const result = await saveCapturePerson(uid, {
          operationId, index, draft: people[index], shown: matches[index].person, choices: choices[index],
        });
        if (result.status === 'saved') {
          saved.push({ contactId: result.contactId, companyId: result.companyId, outcome: result.outcome });
          continue;
        }
        if (result.person) {
          setMatches(list => list.map((m, i) => (i === index ? { ...m, person: result.person } : m)));
          setChoices(list => list.map((c, i) => (i === index ? { ...c, person: null } : c)));
        }
        setNotice(result.status !== 'invalid'
          ? 'Something changed in IDYNIFY since you checked. Look at the match again, then save.'
          : result.reason === 'social_needs_platform'
            ? 'Choose a network for each social profile, or remove it, before saving.'
            : 'Add a name before saving.');
        setPhase('ready');
        return;
      }
    } catch {
      setFailed('save');
      setPhase('ready');
      return;
    }
    onSaved(saved);
  };

  const primary = enabled => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 12,
    fontSize: 15, fontWeight: 700, border: 'none', background: '#2563eb', color: '#fff', cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
  });
  const muted = { fontSize: 13, color: T.textMuted, margin: 0 };

  if (!uid) return <p style={muted}>Saving is not available while viewing as another user.</p>;

  if ((stale && phase !== 'saving') || phase === 'idle' || phase === 'checking') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {failed === 'check' && <p role="alert" style={{ ...muted, color: '#b91c1c' }}>Couldn't check IDYNIFY for this person. Try again.</p>}
        <button type="button" style={primary(!blocked && phase !== 'checking')} disabled={blocked || phase === 'checking'} onClick={check}>
          {phase === 'checking' ? <><Loader size={16} className="animate-spin" /> Checking IDYNIFY…</> : 'Continue'}
        </button>
        {missingName && <p style={muted}>Add a name to continue.</p>}
        {!missingName && socialsUnresolved && <p style={muted}>Choose a network for each social profile, or remove it, to continue.</p>}
      </div>
    );
  }

  const ready = !socialsUnresolved && matches.every((m, i) => canSave(m, choices[i]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="capture-match">
      {matches.map((match, i) => (
        <div key={people[i]?.key ?? i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PersonMatch
            match={match}
            choice={choices[i]}
            setChoice={next => setChoices(list => list.map((c, j) => (j === i ? next : c)))}
            onOpen={id => onSaved([{ contactId: id, companyId: null, outcome: 'already_saved' }])}
            T={T}
          />
          <CompanyMatch
            match={match}
            choice={choices[i]}
            setChoice={next => setChoices(list => list.map((c, j) => (j === i ? next : c)))}
            weak={companyIsUnconfirmed(people[i])}
            T={T}
          />
        </div>
      ))}
      {notice && <p role="alert" style={{ ...muted, color: '#b45309', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} /> {notice}</p>}
      {socialsUnresolved && !notice && <p style={muted}>Choose a network for each social profile, or remove it, to save.</p>}
      {failed === 'save' && (
        <p role="alert" style={{ ...muted, color: '#b91c1c', display: 'flex', gap: 6, alignItems: 'center' }}>
          <RotateCcw size={14} /> Couldn't save. Your details are still here: try again.
        </p>
      )}
      {matches.some(m => m.person.status !== 'saved') && (
        <button type="button" style={primary(ready && phase !== 'saving')} disabled={!ready || phase === 'saving'} onClick={save}>
          {phase === 'saving'
            ? <><Loader size={16} className="animate-spin" /> Saving…</>
            : <>{matches.length === 1 && matches[0].person.status === 'existing' ? <UserCheck size={18} /> : <UserPlus size={18} />} {matches.length === 1 ? saveLabel(matches[0]) : 'Save people'}</>}
        </button>
      )}
    </div>
  );
}
