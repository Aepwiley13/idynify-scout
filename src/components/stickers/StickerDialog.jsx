/**
 * Create or edit a sticker (S7, UI spec §3.1): name, color, emoji,
 * description. Validated here with the same limits and messages the service
 * enforces (§4); the service and the rules check again. A name another
 * active sticker already has is allowed (names are labels) but called out.
 *
 * A modal dialog: focus starts in the name field, stays inside the dialog,
 * and Escape or Cancel closes it. The opener gets focus back (the caller
 * restores it on close).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../theme/ThemeContext';
import { STICKER_COLORS, STICKER_NAME_MAX, stickerNameKey } from '../../services/stickers/stickerCore';
import { validateStickerValues } from './stickerForm';
import { COLOR_LABELS, hexOf } from './stickerPalette';
import { describeStickerError } from './stickerMessages';
import './stickers.css';

export function ModalDialog({ title, onClose, children, role = 'dialog', initialFocusRef = null }) {
  const T = useT();
  const titleId = useId();
  const boxRef = useRef(null);
  useEffect(() => {
    (initialFocusRef?.current ?? boxRef.current?.querySelector('input, textarea, button'))?.focus();
  }, [initialFocusRef]);
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = [...boxRef.current.querySelectorAll('input:not([disabled]), textarea:not([disabled]), button:not([disabled])')]
      .filter((el) => !(el.type === 'radio' && !el.checked));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return (
    <>
      <div className="stk-dialog-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={boxRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className="stk-dialog"
        style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="stk-dialog-title">{title}</h2>
        {children}
      </div>
    </>
  );
}

export default function StickerDialog({ sticker = null, others = [], onSubmit, onClose }) {
  const T = useT();
  const editing = Boolean(sticker);
  const [name, setName] = useState(sticker?.name ?? '');
  const [color, setColor] = useState(sticker?.color ?? STICKER_COLORS[others.length % STICKER_COLORS.length]);
  const [emoji, setEmoji] = useState(sticker?.emoji ?? '');
  const [description, setDescription] = useState(sticker?.description ?? '');
  const [problem, setProblem] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  const ids = { name: useId(), emoji: useId(), description: useId(), error: useId(), same: useId() };

  const sameName = name.trim() && others.find((s) => s.id !== sticker?.id && stickerNameKey(s.name) === stickerNameKey(name));

  async function submit(event) {
    event.preventDefault();
    const invalid = validateStickerValues({ name, emoji, description });
    if (invalid) { setProblem({ field: invalid.field, message: describeStickerError(invalid).message }); return; }
    const values = {
      name: name.trim().replace(/\s+/g, ' '),
      color,
      emoji: emoji.trim() ? emoji.trim() : null,
      description: description.trim() ? description.trim() : null,
    };
    const changes = editing
      ? Object.fromEntries(Object.entries(values).filter(([k, v]) => (sticker[k] ?? null) !== v))
      : values;
    if (editing && !Object.keys(changes).length) { onClose(); return; }
    setSaving(true);
    setProblem(null);
    try {
      await onSubmit(changes);
    } catch (error) {
      setProblem({ field: null, message: describeStickerError(error).message });
      setSaving(false);
    }
  }

  const fieldStyle = { background: T.input, color: T.text, border: `1px solid ${T.border}` };
  const describedBy = (field) => [problem?.field === field ? ids.error : null, field === 'name' && sameName ? ids.same : null].filter(Boolean).join(' ') || undefined;

  return (
    <ModalDialog title={editing ? `Edit “${sticker.name}”` : 'New sticker'} onClose={onClose} initialFocusRef={nameRef}>
      <form className="stk-dialog-form" onSubmit={submit} noValidate>
        <label htmlFor={ids.name} className="stk-field-label">Name</label>
        <input
          id={ids.name}
          ref={nameRef}
          className="stk-field"
          style={fieldStyle}
          value={name}
          maxLength={STICKER_NAME_MAX + 20}
          aria-invalid={problem?.field === 'name' ? 'true' : undefined}
          aria-describedby={describedBy('name')}
          onChange={(e) => setName(e.target.value)}
        />
        {sameName ? <p id={ids.same} className="stk-field-note" style={{ color: T.textMuted }}>Another sticker is already called “{sameName.name}”. Names can repeat; the color tells them apart.</p> : null}

        <fieldset className="stk-swatches">
          <legend className="stk-field-label">Color</legend>
          {STICKER_COLORS.map((c) => (
            <label key={c} className="stk-swatch" style={{ borderColor: color === c ? T.text : 'transparent' }}>
              <input type="radio" name="sticker-color" value={c} checked={color === c} onChange={() => setColor(c)} />
              <span className="stk-swatch-dot" style={{ background: hexOf(c) }} aria-hidden="true" />
              <span className="stk-swatch-label" style={{ color: T.textMuted }}>{COLOR_LABELS[c]}</span>
            </label>
          ))}
        </fieldset>

        <label htmlFor={ids.emoji} className="stk-field-label">Emoji <span style={{ color: T.textFaint }}>(optional)</span></label>
        <input
          id={ids.emoji}
          className="stk-field stk-field--short"
          style={fieldStyle}
          value={emoji}
          aria-invalid={problem?.field === 'emoji' ? 'true' : undefined}
          aria-describedby={describedBy('emoji')}
          onChange={(e) => setEmoji(e.target.value)}
        />

        <label htmlFor={ids.description} className="stk-field-label">Description <span style={{ color: T.textFaint }}>(optional)</span></label>
        <textarea
          id={ids.description}
          className="stk-field"
          style={fieldStyle}
          rows={2}
          value={description}
          aria-invalid={problem?.field === 'description' ? 'true' : undefined}
          aria-describedby={describedBy('description')}
          onChange={(e) => setDescription(e.target.value)}
        />

        {problem ? <p id={ids.error} role="alert" className="stk-field-error">{problem.message}</p> : null}

        <div className="stk-dialog-actions">
          <button type="button" className="stk-btn" style={{ color: T.textMuted, border: `1px solid ${T.border}` }} onClick={onClose}>Cancel</button>
          <button type="submit" className="stk-btn stk-btn--primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </ModalDialog>
  );
}
