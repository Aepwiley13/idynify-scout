import TrustedMergeReview from './TrustedMergeReview';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { getInitials } from '../../../utils/contactPhoto';
import { personName } from '../peopleRules';
import { buildDuplicatePreview, detectPossibleDuplicates, contactReviewDetails } from './duplicateReviewModel';
import './DuplicateReview.css';

const list = (values) => values.filter(Boolean).join(', ') || '—';
const stickerNames = (ids, stickers) => ids.map((id) => stickers?.[id]?.name ?? stickers?.get?.(id)?.name ?? id);

function Comparison({ pair, stickers }) {
  const preview = buildDuplicatePreview(pair.contacts);
  const names = pair.contacts.map((contact) => personName(contact) || 'Unnamed contact');
  const details = pair.contacts.map(contactReviewDetails);
  const rows = [
    ...preview.fields.filter(({ label }) => !['Primary email', 'Primary phone'].includes(label)).map(({ label, values }) => [label, ...values]),
    ['All email addresses', ...details.map((entry) => list(entry.emails))],
    ['All phone numbers', ...details.map((entry) => list(entry.phones))],
    ['Stickers', ...details.map((entry) => list(stickerNames(entry.stickers, stickers)))],
    ['Notes', ...details.map((entry) => `${entry.notes} saved`)],
    ['Photo source', ...details.map((entry) => entry.photoSource || 'Not recorded')],
    ['Email permission', ...details.map((entry) => entry.permission)],
  ];
  return <>
    <p className="hub-merge-match"><strong>{pair.confidence}</strong><span>{pair.evidence.join(' · ')}</span></p>
    {pair.shared && <p className="hub-merge-note">More than two contacts share this match evidence. Review each pair carefully.</p>}
    {pair.conflicts?.length > 0 && <p className="hub-merge-note">Some verified identifiers differ. Confirm that these records belong to the same person before continuing.</p>}
    <div className="hub-merge-comparison-wrap">
      <table className="hub-duplicate-compare">
        <caption>Compare the saved contact details</caption>
        <thead><tr><th scope="col">Information</th>
          {names.map((name, index) => <th scope="col" key={pair.contacts[index].id}>
            <span className="hub-duplicate-person"><span className="hub-duplicate-avatar" aria-hidden="true">{getInitials(name)}</span><span>{name}</span></span>
          </th>)}
        </tr></thead>
        <tbody>{rows.map(([label, left, right]) => <tr key={label}><th scope="row">{label}</th>
          <td>{left === '' ? '—' : left ?? '—'}</td><td>{right === '' ? '—' : right ?? '—'}</td></tr>)}</tbody>
      </table>
    </div>
  </>;
}

export default function DuplicateReview({ contacts, stickers, readOnly, request, onMerged }) {
  const T = useT();
  const title = useId();
  const dialog = useRef(null);
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [latest, setLatest] = useState(null);
  const [persisted, setPersisted] = useState(false);
  const pending = useRef(false);
  const live = useRef(false);
  const pairId = (ids) => JSON.stringify([...ids].sort((a, b) => a.localeCompare(b)));

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!request || readOnly || persisted) return undefined;
    let active = true;
    async function load() {
      const saved = [];
      let cursor;
      do {
        const page = await request('dismissals', { cursor }, () => active);
        if (active && !cursor) setLatest(page.latest);
        saved.push(...page.pairs.map(pairId));
        cursor = page.cursor;
      } while (cursor && active);
      if (active) { setDismissed(saved); setPersisted(true); }
    }
    load().catch(() => { if (active) setNotice('Saved review choices could not be loaded. Close and try again.'); });
    return () => { active = false; };
  }, [open, request, readOnly, persisted]);

  const pairs = useMemo(() => detectPossibleDuplicates(contacts), [contacts]);
  const visible = pairs.filter((pair) => !dismissed.includes(pair.id));
  const index = Math.max(0, visible.findIndex((pair) => pair.id === selected));
  const pair = visible[index];
  const busy = saving || mergeBusy;

  useEffect(() => {
    if (!open) return undefined;
    const element = dialog.current;
    element?.showModal?.();
    element?.querySelector('button:not(:disabled)')?.focus();
    return () => element?.close?.();
  }, [open]);

  function showDialog() {
    setSelected(null);
    setNotice('');
    setHasDraft(false);
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    if (hasDraft && !window.confirm('Discard your merge choices and close this review? The contacts will not be changed.')) return;
    setHasDraft(false);
    setOpen(false);
    requestAnimationFrame(() => (trigger.current ?? document.getElementById('hub-people-heading'))?.focus?.());
  }

  function changePair(nextId) {
    if (busy) return;
    if (hasDraft && !window.confirm('Discard these merge choices and review another match? The contacts will not be changed.')) return;
    setSelected(nextId);
    setHasDraft(false);
  }

  async function saveDismissal(action, targets) {
    if (pending.current || busy) return;
    pending.current = true;
    setSaving(true);
    setNotice('');
    try {
      for (const key of targets) {
        if (request) {
          const [sourceId, survivorId] = JSON.parse(key);
          await request(action, { sourceId, survivorId }, () => live.current);
        }
        if (!live.current) return;
        setDismissed((previous) => action === 'dismiss' ? [...new Set([...previous, key])] : previous.filter((id) => id !== key));
      }
    } catch {
      if (live.current) setNotice('We could not update this review choice. Try again.');
    } finally {
      pending.current = false;
      if (live.current) setSaving(false);
    }
  }

  const comparison = pair ? <Comparison pair={pair} stickers={stickers} /> : null;
  const triggerButton = visible.length > 0 ? (
    <button ref={trigger} type="button" className="hub-secondary-btn hub-duplicate-trigger" onClick={showDialog}>
      Review possible duplicates <span className="hub-duplicate-count">{visible.length}</span>
    </button>
  ) : (
    <details className="hub-duplicate-management">
      <summary aria-label="Contact management actions" title="Contact management actions"><MoreHorizontal size={19} aria-hidden="true" /><span>Manage</span></summary>
      <div className="hub-duplicate-management-menu">
        <button ref={trigger} type="button" aria-label="Check for duplicates" onClick={showDialog}>Check for duplicates</button>
      </div>
    </details>
  );

  return <>
    {triggerButton}
    {notice && !open && <p className="hub-duplicate-notice" role="status">{notice}</p>}
    {open && <dialog ref={dialog} tabIndex={-1} className="hub-duplicate-dialog" aria-labelledby={title}
      open={typeof HTMLDialogElement.prototype.showModal !== 'function' || undefined}
      style={{ '--duplicate-card': T.cardBg, '--duplicate-border': T.border, '--duplicate-text': T.text, '--duplicate-accent': T.accent, '--duplicate-accent-bg': T.accentBg }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeDialog(); } }}
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <header className="hub-duplicate-dialog-header">
        <div><p className="hub-duplicate-eyebrow">Contact Hub</p><h2 id={title}>Review possible duplicates</h2></div>
        <button type="button" className="hub-duplicate-close" aria-label="Close duplicate review" title="Close" disabled={busy} onClick={closeDialog}><X size={20} aria-hidden="true" /></button>
      </header>

      <div className="hub-duplicate-pairbar">
        <p role="status">{pair ? `Possible match ${index + 1} of ${visible.length}` : 'No possible duplicates to review.'}</p>
        {pair && <nav className="hub-duplicate-actions" aria-label="Possible matches">
          <button type="button" className="hub-merge-button hub-merge-button--quiet" disabled={busy || index === 0} onClick={() => changePair(visible[index - 1].id)}>Previous</button>
          <button type="button" className="hub-merge-button hub-merge-button--quiet" disabled={busy || index + 1 === visible.length} onClick={() => changePair(visible[index + 1].id)}>Next</button>
          {!readOnly && <button type="button" className="hub-merge-button hub-merge-button--quiet" disabled={busy} onClick={() => {
            if (hasDraft && !window.confirm('Discard these merge choices and mark this pair as not a duplicate?')) return;
            setHasDraft(false);
            saveDismissal('dismiss', [pair.id]);
          }}>Not a duplicate</button>}
        </nav>}
        {!readOnly && dismissed.length > 0 && <button type="button" className="hub-merge-button hub-merge-button--quiet hub-duplicate-restore" disabled={busy} onClick={() => saveDismissal('restore', dismissed)}>Restore dismissed matches</button>}
      </div>

      {notice && <p className="hub-duplicate-notice" role="alert">{notice}</p>}
      <div className="hub-duplicate-content">
        {pair ? request && !readOnly ? (
          <TrustedMergeReview
            key={pair.id}
            pair={pair}
            request={request}
            comparison={comparison}
            onCancel={closeDialog}
            onComplete={() => {
              setNotice('Contacts merged. The contact you chose remains in My People.');
              setHasDraft(false);
              setOpen(false);
              onMerged?.();
            }}
            onBusyChange={setMergeBusy}
            onDraftChange={setHasDraft}
          />
        ) : <Comparison pair={pair} stickers={stickers} /> : null}
        {request && latest?.status === 'merged' && latest.rollbackUntil > Date.now() && !pair && <details className="hub-duplicate-recovery">
          <summary>Recent merge recovery</summary>
          <TrustedMergeReview key={latest.operationId} pair={{ id: latest.operationId, contacts: [] }} existingReceipt={latest} request={request} onComplete={() => { setOpen(false); onMerged?.(); }} />
        </details>}
      </div>

      {!(pair && request && !readOnly) && <footer className="hub-duplicate-footer">
        <button type="button" className="hub-merge-button hub-merge-button--quiet" disabled={busy} onClick={closeDialog}>Close</button>
      </footer>}
    </dialog>}
  </>;
}
