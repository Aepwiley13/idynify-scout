/**
 * PhotoPanel — the small panel under the photo for adding, replacing or removing it.
 *
 * It is the connected layer's, not the header's: PersonHeader only gives it a place to be drawn (photoEdit.panel).
 * It holds the address being typed (that draft exists only while the panel is open), asks the photo hook to save
 * it, and shows why a link was refused or a save failed. It writes nothing itself.
 *
 *   Enter or Save   saves (an explicit Save: a link is not saved just by leaving the box)
 *   Escape / Cancel closes without saving
 *   Remove          asks once more ("Remove this photo?"), then removes
 *
 * Pressing a button here does not take focus from the box first, and a press outside the photo closes the panel.
 * The saved or failed result is shown here: a failure keeps the panel open with the typed link.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { photoFailureMessage, photoRefusalMessage } from './profileMessages';

export default function PhotoPanel({ hasPhoto, saving, failure, onSave, onRemove, onClose }) {
  const [url, setUrl] = useState('');
  const [refusal, setRefusal] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const box = useRef(null);
  const panel = useRef(null);
  const messageId = useId();

  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const outside = (event) => { if (!event.target.closest?.('.ph-avatar-wrap')) onClose(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onClose]);

  const message = refusal ? photoRefusalMessage(refusal) : failure ? photoFailureMessage(failure) : '';
  const keep = (event) => event.preventDefault();

  async function save() {
    setRefusal(null);
    setConfirming(false);
    const result = await onSave(url);
    if (result.status === 'saved' || result.status === 'unchanged') onClose(true);
    else if (result.status === 'refused') setRefusal(result.reason);
  }
  async function remove() {
    if (!confirming) { setConfirming(true); return; }
    setRefusal(null);
    const result = await onRemove();
    if (result.status === 'saved') onClose(true);
    else { setConfirming(false); if (result.status === 'refused') setRefusal(result.reason); }
  }

  return (
    <div ref={panel} className="ph-photo-panel" role="group" aria-label={hasPhoto ? 'Change photo' : 'Add photo'}>
      <input
        ref={box}
        className="ph-input"
        type="url"
        inputMode="url"
        value={url}
        placeholder="https://… link to a photo"
        aria-label="Link to a photo (https)"
        aria-invalid={message ? 'true' : 'false'}
        aria-describedby={message ? messageId : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={saving}
        onChange={(event) => { setUrl(event.target.value); setRefusal(null); }}
        onKeyDown={(event) => {
          if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat && !saving) save(); }
          else if (event.key === 'Escape') { event.preventDefault(); onClose(true); }
        }}
      />
      {message ? <p id={messageId} className="ph-editor-msg" data-kind={refusal ? 'problem' : 'failure'}>{message}</p> : null}
      <p className="ph-sr" role="status" aria-live="polite" aria-atomic="true">{saving ? 'Saving photo…' : message}</p>
      <div className="ph-photo-actions">
        <button type="button" className="ph-editor-btn ph-editor-btn--primary" disabled={saving} aria-busy={saving ? 'true' : undefined} onMouseDown={keep} onClick={save}>
          {saving ? 'Saving…' : hasPhoto ? 'Replace photo' : 'Add photo'}
        </button>
        {hasPhoto ? (
          <button type="button" className="ph-editor-btn" disabled={saving} onMouseDown={keep} onClick={remove}>
            {confirming ? 'Yes, remove' : 'Remove photo'}
          </button>
        ) : null}
        <button type="button" className="ph-editor-btn ph-editor-cancel" onMouseDown={keep} onClick={() => onClose(true)}>Cancel</button>
      </div>
      {confirming ? <p className="ph-editor-msg ph-photo-confirm">Remove this photo? You can add one again.</p> : null}
    </div>
  );
}
