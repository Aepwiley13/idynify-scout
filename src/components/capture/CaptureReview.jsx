/**
 * Review: the people read from one capture, each with every detail editable.
 *
 * Takes a LIST of drafts (captureDraft.js). A card holds one person today;
 * the same screen shows several when a capture yields more. Phones use the
 * contact profile's own editor, so every number keeps its type (Mobile,
 * Direct, Main, Work, Home, Fax, Other or "Type not set") and a type is
 * changed, never guessed. Nothing here saves or reads Firestore.
 */
import { AlertTriangle } from 'lucide-react';
import ContactPhones from '../contacts/ContactPhones';
import '../contacts/IdentityCard.css';
import './CaptureReview.css';

const FIELDS = Object.freeze([
  { key: 'name', label: 'Name', autoComplete: 'off' },
  { key: 'title', label: 'Title', autoComplete: 'off' },
  { key: 'company', label: 'Company', autoComplete: 'off' },
  { key: 'email', label: 'Email', type: 'email', inputMode: 'email', autoComplete: 'off' },
  { key: 'linkedinUrl', label: 'LinkedIn', type: 'url', inputMode: 'url', autoComplete: 'off' },
  { key: 'website', label: 'Website', type: 'url', inputMode: 'url', autoComplete: 'off' },
]);

function CheckMark() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#b45309' }}>
      <AlertTriangle size={11} /> Check
    </span>
  );
}

function PersonDraft({ draft, index, count, onChange, T }) {
  const set = (key, value) => onChange({ ...draft, [key]: value, toCheck: draft.toCheck.filter(k => k !== key) });
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, fontSize: 15,
    border: `1px solid ${T.border}`, background: T.input ?? T.cardBg, color: T.text,
  };

  return (
    <section
      aria-label={count > 1 ? `Person ${index + 1} of ${count}` : 'Person'}
      style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {count > 1 && <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted }}>Person {index + 1} of {count}</div>}
      {FIELDS.map(({ key, label, ...input }) => {
        const id = `capture-${draft.key}-${key}`;
        return (
          <div key={key}>
            <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              {label}
              {draft.toCheck.includes(key) && <CheckMark />}
            </label>
            <input
              id={id}
              value={draft[key]}
              onChange={e => set(key, e.target.value)}
              type={input.type ?? 'text'}
              inputMode={input.inputMode}
              autoComplete={input.autoComplete}
              autoCapitalize={input.type ? 'none' : undefined}
              spellCheck={false}
              placeholder="Not on the card"
              style={inputStyle}
            />
            {key === 'email' && draft.otherEmails.length > 0 && (
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                Also on the card: {draft.otherEmails.join(', ')}
              </div>
            )}
          </div>
        );
      })}
      <div>
        {draft.toCheck.includes('phones') && (
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: T.textMuted }}>
            Check these numbers against the card <CheckMark />
          </div>
        )}
        <ContactPhones
          contact={{ phones: draft.phones }}
          onSave={phones => onChange({ ...draft, phones, toCheck: draft.toCheck.filter(k => k !== 'phones') })}
          T={T}
        />
      </div>
    </section>
  );
}

/**
 * @param {object}   props
 * @param {object[]} props.people    review drafts (captureDraft.js), one per person
 * @param {Function} props.onChange  (index, draft) => void
 * @param {object}   props.T         theme tokens (useT)
 */
export default function CaptureReview({ people, onChange, T }) {
  return (
    <div className="capture-review" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {people.map((draft, index) => (
        <PersonDraft
          key={draft.key}
          draft={draft}
          index={index}
          count={people.length}
          onChange={next => onChange(index, next)}
          T={T}
        />
      ))}
    </div>
  );
}
