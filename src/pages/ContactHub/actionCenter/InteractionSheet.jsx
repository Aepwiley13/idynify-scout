import { useEffect, useRef, useState } from 'react';
import { INTERACTIONS } from './relationship';

export default function InteractionSheet({ draft, setDraft, busy, error, onCancel, onSave }) {
  const dialog = useRef(null);
  const [channel, setChannel] = useState('call');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [time, setTime] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element.showModal?.();
    return () => element.close?.();
  }, []);
  return <dialog ref={dialog} className="ac-sheet" aria-label="Log interaction"
    open={typeof HTMLDialogElement.prototype.showModal !== 'function' || undefined}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const now = new Date();
      const when = !time && date === now.toLocaleDateString('sv-SE') ? undefined
        : date ? new Date(date + 'T' + (time || '00:00')) : undefined;
      onSave({ channel, occurredAt: when && Number.isFinite(when.getTime()) ? when.toISOString() : undefined });
    }}>
      <h2>Log interaction</h2>
      <fieldset><legend>Interaction type</legend><div className="ac-types">
        {Object.entries(INTERACTIONS).map(([id, label]) => <label key={id}>
          <input type="radio" name="channel" checked={channel === id} disabled={busy} onChange={() => setChannel(id)} />{label}
        </label>)}
      </div></fieldset>
      <label>What happened?<textarea value={draft} maxLength={2000} disabled={busy}
        onChange={(event) => setDraft(event.target.value)} /></label>
      <div className="ac-dates">
        <label>Date<input type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Time <span>(optional)</span><input type="time" value={time} disabled={busy} onChange={(event) => setTime(event.target.value)} /></label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="ac-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={busy}>Save update</button></div>
    </form>
  </dialog>;
}
