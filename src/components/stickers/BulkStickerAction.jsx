/**
 * "Add sticker" in People's bulk bar (S6, UI spec §2.1).
 *
 * Adds one sticker to every selected contact through addStickerToContacts:
 * one transaction per contact, so one failure never undoes the others. While
 * it runs the button shows progress and the page disables its other bulk
 * actions (onRunningChange). Afterwards a summary says what happened; on any
 * failure the selection narrows to the contacts that were not changed, and
 * Retry runs for them only.
 */
import { useRef, useState } from 'react';
import { Loader, Plus, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { addStickerToContacts } from '../../services/contactStickers';
import { createSticker } from '../../services/stickerService';
import { DENIAL_REASONS, STICKER_ERRORS } from '../../services/stickers/stickerCore';
import { useStickers } from './stickersRegistry';
import StickerPicker from './StickerPicker';
import { describeStickerError, logStickerFailure } from './stickerMessages';
import { bulkSummaryText } from './peopleStickers';
import { nextStickerColor } from './stickerPalette';
import './stickers.css';

export default function BulkStickerAction({ selectedIds, nameOf = (id) => id, onApplied, onReduceSelection, onRunningChange, buttonStyle = {} }) {
  const { ready, uid, active, all, recheck } = useStickers();
  const T = useT();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const buttonRef = useRef(null);

  if (!ready) return null;

  const closePicker = () => { setOpen(false); buttonRef.current?.focus(); };

  async function run(sticker, ids) {
    setResult(null);
    setDetailsOpen(false);
    setRunning({ done: 0, total: ids.length });
    onRunningChange?.(true);
    let outcome;
    try {
      const r = await addStickerToContacts(uid, ids, sticker.id, { onProgress: (done, total) => setRunning({ done, total }) });
      outcome = { sticker, ...r };
    } catch (error) {
      logStickerFailure('bulk_add', error);
      outcome = { sticker, added: [], already: [], failed: ids.map((contactId) => ({ contactId, code: error?.code ?? STICKER_ERRORS.WRITE_FAILED, reason: error?.reason ?? null })) };
    }
    setRunning(null);
    onRunningChange?.(false);
    onApplied?.(sticker.id, [...outcome.added, ...outcome.already]);
    if (outcome.failed.length) {
      for (const f of outcome.failed) logStickerFailure('bulk_add', f);
      onReduceSelection?.(outcome.failed.map((f) => f.contactId));
      if (outcome.failed.some((f) => f.code === STICKER_ERRORS.PERMISSION_DENIED && f.reason === DENIAL_REASONS.WRITE_DENIED)) recheck();
    }
    setResult(outcome);
  }

  async function create(name) {
    closePicker();
    const ids = [...selectedIds];
    const color = nextStickerColor(all.length);
    try {
      const { id } = await createSticker(uid, { name, color });
      await run({ id, name, color }, ids);
    } catch (error) {
      logStickerFailure('create', error);
      setResult({ sticker: { name }, added: [], already: [], failed: [], error: describeStickerError(error).message });
    }
  }

  const label = running ? `Adding… ${running.done} of ${running.total}` : 'Add sticker';

  return (
    <div className="stk-bulk">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        disabled={Boolean(running) || selectedIds.size === 0}
        onClick={() => (open ? closePicker() : setOpen(true))}
        style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.border2 ?? T.border}`, background: T.surface ?? 'transparent', color: T.textMuted, fontSize: 11, fontWeight: 600, cursor: running ? 'progress' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, ...buttonStyle }}
      >
        {running ? <Loader size={12} className="stk-spin" aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
        {label}
      </button>
      <span className="stk-sr-only" role="status" aria-live="polite">{running ? label : ''}</span>
      {open ? (
        <StickerPicker
          stickers={active}
          onPick={(sticker) => { closePicker(); run(sticker, [...selectedIds]); }}
          onCreate={create}
          onClose={closePicker}
          ignoreRef={buttonRef}
          placement="above"
          label={`Add a sticker to ${selectedIds.size} ${selectedIds.size === 1 ? 'person' : 'people'}`}
        />
      ) : null}
      {result ? (
        <div className="stk-bulk-summary" role="region" aria-label="Sticker results" style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}>
          <div className="stk-bulk-summary-head">
            <span role="status">{result.error ?? `${result.sticker.name}: ${bulkSummaryText(result)}`}</span>
            <button type="button" className="stk-toast-close" aria-label="Close results" onClick={() => setResult(null)}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          {result.failed.length ? (
            <div className="stk-bulk-summary-actions">
              <button type="button" className="stk-toast-action" aria-expanded={detailsOpen ? 'true' : 'false'} onClick={() => setDetailsOpen((o) => !o)}>Details</button>
              <button type="button" className="stk-toast-action" onClick={() => run(result.sticker, result.failed.map((f) => f.contactId))}>Retry</button>
            </div>
          ) : null}
          {detailsOpen ? (
            <ul className="stk-bulk-details" style={{ color: T.textMuted }}>
              {result.failed.map((f) => (
                <li key={f.contactId}><strong style={{ color: T.text }}>{nameOf(f.contactId)}</strong> — {describeStickerError(f).message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
