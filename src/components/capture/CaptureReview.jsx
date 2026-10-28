/**
 * Review: the people read from one capture, each with every detail editable.
 *
 * Takes a LIST of drafts (captureDraft.js). A card holds one person today;
 * the same screen shows several when a capture yields more. Phones use the
 * contact profile's own editor, so every number keeps its type (Mobile,
 * Direct, Main, Work, Home, Fax, Other or "Type not set") and a type is
 * changed, never guessed. Social handles are listed under Social: a handle
 * the card printed without its network waits for the user to choose one.
 * Nothing here saves or reads Firestore.
 */
import { AlertTriangle, Plus, X } from 'lucide-react';
import ContactPhones from '../contacts/ContactPhones';
import { newSocialRow, socialProblems } from './captureDraft.js';
import { parseSocialReference, platformLabel, REVIEW_SOCIAL_PLATFORMS } from '../../utils/socialProfiles';
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

/**
 * The card's social handles, each with its platform, and a way to add one.
 * Choosing a platform, typing or editing makes a row the user's (confirmed).
 */
function SocialRows({ draft, onChange, inputStyle, T }) {
  const rows = draft.socials ?? [];
  const problems = new Map(socialProblems(draft).map(p => [p.id, p.problem]));
  const setRows = next => onChange({ ...draft, socials: next });
  const update = (id, changes) => setRows(rows.map(row => (row.id === id ? { ...row, ...changes, confirmed: true } : row)));
  const setText = (row, value) => {
    // An address names its own network; a bare handle keeps the one chosen.
    const named = parseSocialReference(value)?.platform;
    update(row.id, { text: value, ...(REVIEW_SOCIAL_PLATFORMS.includes(named) ? { platform: named } : {}) });
  };
  const hint = { fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 };

  return (
    <div role="group" aria-label="Social profiles">
      <div style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>Social</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => {
          const problem = problems.get(row.id);
          const name = row.text || 'new profile';
          return (
            <div key={row.id} data-testid="capture-social-row">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <select
                  aria-label={`Platform for ${name}`}
                  value={row.platform ?? ''}
                  onChange={e => update(row.id, { platform: e.target.value || null })}
                  style={{ ...inputStyle, width: 'auto', flex: '0 0 auto', minWidth: 0 }}
                >
                  <option value="">Choose platform…</option>
                  {REVIEW_SOCIAL_PLATFORMS.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}
                </select>
                <input
                  aria-label={`Handle or profile address for ${name}`}
                  value={row.text}
                  onChange={e => setText(row, e.target.value)}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="@handle or profile address"
                  style={{ ...inputStyle, flex: '1 1 140px', width: 'auto', minWidth: 0 }}
                />
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => setRows(rows.filter(r => r.id !== row.id))}
                  style={{ flex: '0 0 auto', padding: 8, borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, cursor: 'pointer', display: 'inline-flex' }}
                >
                  <X size={14} />
                </button>
              </div>
              {problem === 'platform_required' && (
                <div style={{ ...hint, color: '#b45309' }}><AlertTriangle size={11} /> Which network is this? Choose one, or remove it.</div>
              )}
              {problem === 'unreadable' && (
                <div style={{ ...hint, color: '#b45309' }}><AlertTriangle size={11} /> Not a {platformLabel(row.platform)} handle or profile address.</div>
              )}
              {!problem && row.unsure && !row.confirmed && (
                <div style={{ ...hint, color: T.textMuted }}>Check this against the card <CheckMark /></div>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setRows([...rows, newSocialRow(rows)])}
        className="idc-add-entry"
        style={{ color: T.textFaint, marginTop: 6 }}
      >
        <Plus size={12} /><span>add social profile</span>
      </button>
    </div>
  );
}

function PersonDraft({ draft, index, count, onChange, T }) {
  const set = (key, value) => onChange({ ...draft, [key]: value, toCheck: draft.toCheck.filter(k => k !== key) });
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, fontSize: 16,
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
      <SocialRows draft={draft} onChange={onChange} inputStyle={inputStyle} T={T} />
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
