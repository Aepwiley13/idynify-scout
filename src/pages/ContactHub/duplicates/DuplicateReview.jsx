import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '../../../theme/ThemeContext';
import { getInitials } from '../../../utils/contactPhoto';
import { personName } from '../peopleRules';
import { buildDuplicatePreview, detectPossibleDuplicates } from './duplicateReviewModel';
import './DuplicateReview.css';

const list = (values) => values.filter(Boolean).join(', ') || '—';

function Comparison({ pair, stickers }) {
  const [choices, setChoices] = useState({});
  const { contacts, evidence, conflicts, confidence, shared } = pair;
  const preview = buildDuplicatePreview(contacts, choices);
  const names = contacts.map(personName);
  const stickerNames = (ids) => ids.map((id) => stickers?.[id]?.name ?? stickers?.get?.(id)?.name ?? id);
  const summaries = [
    ['Email addresses', ...preview.details.map((entry) => list(entry.emails))],
    ['Phone numbers', ...preview.details.map((entry) => list(entry.phones))],
    ['Stickers', ...preview.details.map((entry) => list(stickerNames(entry.stickers)))],
    ['Sticker assignment sources', ...preview.details.map((entry) => list(entry.stickerSources))],
    ['Notes', ...preview.details.map((entry) => entry.notes)],
    ['Sources', ...preview.details.map((entry) => list(entry.sources))],
    ['Original photo source', ...preview.details.map((entry) => entry.photoSource || '—')],
    ['Email permissions', ...preview.details.map((entry) => entry.permission)],
  ];

  return <>
    <p><strong>{confidence}.</strong> {evidence.join(' · ')}</p>
    {shared && <p>This match evidence is shared by more than two contacts.</p>}
    {conflicts.length > 0 && <p>{conflicts.join(' · ')}. Verify that these records represent the same person.</p>}
    <table className="hub-duplicate-compare">
      <caption>Contact comparison</caption>
      <thead><tr><th scope="col">Field</th>
        {names.map((name, index) => <th scope="col" key={contacts[index].id}>
          <span className="hub-duplicate-avatar" aria-hidden="true">{getInitials(name)}</span>
          {name}
        </th>)}
      </tr></thead>
      <tbody>
        {[...preview.fields.map(({ label, values }) => [label, ...values]), ...summaries]
          .map(([label, left, right]) => <tr key={label}><th scope="row">{label}</th>
            <td>{left === '' ? '—' : left ?? '—'}</td><td>{right === '' ? '—' : right ?? '—'}</td></tr>)}
      </tbody>
    </table>
    <h3>Combined preview</h3>
    <p>Choices are for this preview and reset when you leave the pair.</p>
    <dl className="hub-duplicate-preview">
      {preview.fields.filter(({ values }) => values.some(Boolean)).map(({ label, values, conflict, value }) => (
        <div key={label}><dt>{label}</dt><dd>
          {conflict
            ? <select aria-label={`Choose ${label}`} value={choices[label] ?? ''} onChange={(event) => {
              const next = event.target.value;
              setChoices((prior) => ({ ...prior, [label]: next }));
            }}>
              <option value="">Choose a value</option>
              {values.map((option, index) => <option key={contacts[index].id} value={index}>{option} · {names[index]} (Contact {index + 1})</option>)}
            </select>
            : value}
        </dd></div>
      ))}
      <div><dt>Email addresses</dt><dd>{list(preview.emails)}</dd></div>
      <div><dt>Phone numbers</dt><dd>{list(preview.phones)}</dd></div>
      <div><dt>Stickers</dt><dd>{list(stickerNames(preview.stickers))}{preview.stickers.length > 50 && ' (selection required to meet the 50-sticker limit)'}</dd></div>
      <div><dt>Notes</dt><dd>{preview.notes} to preserve with authors and timestamps</dd></div>
      <div><dt>Sources</dt><dd>{list(preview.sources)}</dd></div>
    </dl>
    <p>Transfer review needed for Activity and Gmail history, reminder queues, sticker assignment history, private photos, company links, external source records, and address-specific permissions and opt-outs. This preview grants no email permission.</p>
  </>;
}

export default function DuplicateReview({ contacts, stickers, readOnly }) {
  const T = useT();
  const title = useId();
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const pairs = useMemo(() => detectPossibleDuplicates(contacts), [contacts]);
  const visible = pairs.filter((pair) => !dismissed.includes(pair.id));
  const index = Math.max(0, visible.findIndex((pair) => pair.id === selected));
  const pair = visible[index];

  useEffect(() => {
    if (!open) return undefined;
    const element = dialog.current;
    element.showModal?.();
    return () => element.close?.();
  }, [open]);

  return <>
    <button type="button" className="hub-secondary-btn" onClick={() => setOpen(true)}>
      Review duplicates ({visible.length})
    </button>
    {open && <dialog ref={dialog} className="hub-duplicate-dialog" aria-labelledby={title}
      open={typeof HTMLDialogElement.prototype.showModal !== 'function' || undefined}
      style={{ '--duplicate-card': T.cardBg, '--duplicate-border': T.border, '--duplicate-text': T.text, '--duplicate-accent': T.accent }}
      onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
      <header><h2 id={title}>Possible duplicates</h2>
        <button type="button" className="hub-secondary-btn" autoFocus onClick={() => setOpen(false)}>Close</button>
      </header>
      <p role="status">{pair ? `Pair ${index + 1} of ${visible.length}` : 'No possible duplicates to review.'}</p>
      {pair && <>
        <nav className="hub-duplicate-actions" aria-label="Duplicate pairs">
          <button type="button" className="hub-secondary-btn" disabled={index === 0} onClick={() => setSelected(visible[index - 1].id)}>Previous</button>
          <button type="button" className="hub-secondary-btn" disabled={index + 1 === visible.length} onClick={() => setSelected(visible[index + 1].id)}>Next</button>
          {!readOnly && <button type="button" className="hub-secondary-btn" onClick={() => {
            setDismissed((previous) => [...previous, pair.id]);
            setSelected(visible[index + 1]?.id ?? visible[index - 1]?.id ?? null);
          }}>Not a duplicate</button>}
        </nav>
        <Comparison key={pair.id} pair={pair} stickers={stickers} />
      </>}
      {!readOnly && dismissed.length > 0 && <button type="button" className="hub-secondary-btn" onClick={() => setDismissed([])}>Show dismissed pairs</button>}
    </dialog>}
  </>;
}
