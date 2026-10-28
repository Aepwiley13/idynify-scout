/**
 * Review: the people read from one capture, each with every detail editable.
 *
 * Takes a LIST of drafts (captureDraft.js). A card holds one person today;
 * the same screen shows several when a capture yields more. Phones use the
 * contact profile's own editor, so every number keeps its type (Mobile,
 * Direct, Main, Work, Home, Fax, Other or "Type not set") and a type is
 * changed, never guessed. Social profiles list LinkedIn, Instagram and
 * Facebook each, with "Not on card" for a network the card did not print; a
 * handle the card printed without its network waits for the user to choose
 * one. Nothing here saves or reads Firestore.
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
 * Social profiles, one line per network: LinkedIn, then each network in
 * REVIEW_SOCIAL_PLATFORMS. A network the card did not print says "Not on
 * card", with a way to add one. LinkedIn stays its own field (`linkedinUrl`),
 * which keeps its own confirm and duplicate checks. A handle printed without
 * its network is listed last, until the user chooses one. Choosing a network,
 * typing or editing makes a row the user's (confirmed).
 */
function SocialProfiles({ draft, onChange, setField, inputStyle, T }) {
  const rows = draft.socials ?? [];
  const problems = new Map(socialProblems(draft).map(p => [p.id, p.problem]));
  const setRows = next => onChange({ ...draft, socials: next });
  const update = (id, changes) => setRows(rows.map(row => (row.id === id ? { ...row, ...changes, confirmed: true } : row)));
  const setText = (row, value) => update(row.id, { text: value });
  // An address names its own network; a bare handle keeps the one it has.
  // Applied when the field is left, so a row never moves while it is typed in.
  const placeByAddress = (row) => {
    const named = parseSocialReference(row.text)?.platform;
    if (REVIEW_SOCIAL_PLATFORMS.includes(named) && named !== row.platform) update(row.id, { platform: named });
  };
  const add = platform => setRows([...rows, { ...newSocialRow(rows), platform }]);
  const unplaced = rows.filter(row => !REVIEW_SOCIAL_PLATFORMS.includes(row.platform));

  const hint = { fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 };
  const network = { display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 };
  const notOnCard = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 };
  const removeButton = { flex: '0 0 auto', minWidth: 44, minHeight: 44, borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  const linkedinId = `capture-${draft.key}-linkedinUrl`;

  const rowView = (row, { picker }) => {
    const problem = problems.get(row.id);
    const label = platformLabel(row.platform);
    const name = row.text || (label ? `new ${label} profile` : 'new profile');
    return (
      <div key={row.id} data-testid="capture-social-row">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {picker && (
            <select
              aria-label={`Platform for ${name}`}
              value={row.platform ?? ''}
              onChange={e => update(row.id, { platform: e.target.value || null })}
              style={{ ...inputStyle, width: 'auto', flex: '0 0 auto', minWidth: 0 }}
            >
              <option value="">Choose platform…</option>
              {REVIEW_SOCIAL_PLATFORMS.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}
            </select>
          )}
          <input
            aria-label={picker || !label ? `Handle or profile address for ${name}` : `${label} handle or profile address`}
            value={row.text}
            onChange={e => setText(row, e.target.value)}
            onBlur={() => placeByAddress(row)}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@handle or profile address"
            style={{ ...inputStyle, flex: '1 1 140px', width: 'auto', minWidth: 0 }}
          />
          <button type="button" aria-label={`Remove ${name}`} onClick={() => setRows(rows.filter(r => r.id !== row.id))} style={removeButton}>
            <X size={14} />
          </button>
        </div>
        {problem === 'platform_required' && (
          <div style={{ ...hint, color: '#b45309' }}><AlertTriangle size={11} /> Which network is this? Choose one, or remove it.</div>
        )}
        {problem === 'unreadable' && (
          <div style={{ ...hint, color: '#b45309' }}><AlertTriangle size={11} /> Not {/^[AEIOU]/.test(label ?? '') ? 'an' : 'a'} {label} handle or profile address.</div>
        )}
        {!problem && row.unsure && !row.confirmed && (
          <div style={{ ...hint, color: T.textMuted }}>Check this against the card <CheckMark /></div>
        )}
      </div>
    );
  };

  return (
    <div role="group" aria-label="Social profiles">
      <div style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>Social profiles</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div data-testid="capture-social-linkedin">
          <label htmlFor={linkedinId} style={network}>
            LinkedIn
            {draft.toCheck.includes('linkedinUrl') && <CheckMark />}
          </label>
          <input
            id={linkedinId}
            value={draft.linkedinUrl}
            onChange={e => setField('linkedinUrl', e.target.value)}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Not on card"
            style={inputStyle}
          />
        </div>
        {REVIEW_SOCIAL_PLATFORMS.map((platform) => {
          const label = platformLabel(platform);
          const mine = rows.filter(row => row.platform === platform);
          return (
            <div key={platform} data-testid={`capture-social-${platform}`}>
              <div style={network}>{label}</div>
              {mine.length === 0 ? (
                <div style={notOnCard}>
                  <span style={{ fontSize: 14, color: T.textFaint }}>Not on card</span>
                  <button type="button" onClick={() => add(platform)} className="idc-add-entry" style={{ color: T.textFaint, minHeight: 44 }} aria-label={`Add ${label}`}>
                    <Plus size={12} /><span>Add</span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mine.map(row => rowView(row, { picker: false }))}
                </div>
              )}
            </div>
          );
        })}
        {unplaced.length > 0 && (
          <div data-testid="capture-social-unplaced">
            <div style={network}>Network not shown on the card</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unplaced.map(row => rowView(row, { picker: true }))}
            </div>
          </div>
        )}
      </div>
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
      <SocialProfiles draft={draft} onChange={onChange} setField={set} inputStyle={inputStyle} T={T} />
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
