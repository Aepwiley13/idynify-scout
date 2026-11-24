import { useEffect, useId, useRef, useState } from 'react';
import { auth } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import './ContactHubGmail.css';

const complete = (status) => status === 'deleted' || status === 'already_deleted';

export default function DeleteContactsDialog({ uid, ids, nameFor, onClose, onResult }) {
  const T = useT();
  const title = useId();
  const dialog = useRef(null);
  const active = useRef(false);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState(ids);

  useEffect(() => {
    const element = dialog.current;
    active.current = true;
    element.showModal?.();
    return () => { active.current = false; element.close?.(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    const user = auth.currentUser;
    const permitted = () => {
      const effective = getEffectiveUser();
      return active.current && user?.uid === uid && auth.currentUser === user
        && effective?.uid === uid && !effective._isImpersonated;
    };
    try {
      if (!permitted()) throw new Error();
      const token = await user.getIdToken();
      if (!permitted()) throw new Error();
      const response = await fetch('/.netlify/functions/contact-hub-delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, contactIds: remaining }),
      });
      if (!response.ok) throw new Error();
      const { results } = await response.json();
      if (!permitted()) return;
      const deleted = remaining.filter((id) => results.some((entry) => entry.id === id && complete(entry.status)));
      const failed = remaining.filter((id) => !deleted.includes(id));
      if (!failed.length) {
        onResult(deleted, true);
        return;
      }
      onResult(deleted, false);
      setRemaining(failed);
      setNotice(results.some((entry) => entry.status === 'too_many_related_records')
        ? 'A contact has too much history for online deletion. Contact support for help.'
        : `${failed.length} could not be deleted. You can retry the remaining selection.`);
    } catch {
      if (active.current) setNotice('Deletion could not be confirmed. Try again.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="hub-gmail-dialog" aria-labelledby={title}
      open={typeof HTMLDialogElement.prototype.showModal !== 'function' || undefined}
      style={{ '--hub-gmail-border': T.border, '--hub-gmail-background': T.cardBg, '--hub-gmail-text': T.text, '--hub-gmail-accent': T.accent }}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit}>
        <h2 id={title}>Delete {remaining.length === 1 ? 'this contact' : `${remaining.length} contacts`}?</h2>
        <p>This permanently removes the selected contacts, their photos, notes, activity, sticker assignments, and reminders.</p>
        <ul>{remaining.map((id) => <li key={id}>{nameFor(id)}</li>)}</ul>
        {notice && <p role="alert">{notice}</p>}
        <div className="hub-gmail-actions">
          <button type="button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
        </div>
      </form>
    </dialog>
  );
}
