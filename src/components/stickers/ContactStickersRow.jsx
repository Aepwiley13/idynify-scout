/**
 * ContactStickersRow — the Stickers row on the Contact Profile (S5, UI spec §1).
 *
 * Shown only when the page's StickersProvider says stickers are available
 * and the registry has loaded; otherwise it renders nothing and takes no
 * space (U1). Every write goes through contactStickers / stickerService (U2).
 * Nothing is optimistic (U3): a chip is pending until its transaction
 * resolves, and the row then shows the confirmed change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { addSticker, removeSticker } from '../../services/contactStickers';
import { createSticker } from '../../services/stickerService';
import {
  STICKER_LIMIT, STICKER_STATUS, cleanStickerName, storedStickerIds, visibleStickers, withMembershipChange,
} from '../../services/stickers/stickerCore';
import { useStickers } from './stickersRegistry';
import StickerChip from './StickerChip';
import StickerPicker from './StickerPicker';
import StickerToast from './StickerToast';
import { describeStickerError, logStickerFailure } from './stickerMessages';
import { readRecentStickerIds, rememberRecentSticker } from './recentStickers';
import { nextStickerColor } from './stickerPalette';
import './stickers.css';

export const UNDO_MS = 6000;

export default function ContactStickersRow({ contact, onUpdate }) {
  const stickers = useStickers();
  if (!stickers.ready || !contact?.id) return null;
  return <Row contact={contact} onUpdate={onUpdate} stickers={stickers} />;
}

function Row({ contact, onUpdate, stickers }) {
  const { uid, byId, active, all, recheck } = stickers;
  const T = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(() => new Map());
  const [toast, setToast] = useState(null);
  const [recentIds, setRecentIds] = useState(() => readRecentStickerIds(uid));
  const buttonRef = useRef(null);
  const latest = useRef(contact);
  const registry = useRef(byId);
  const mounted = useRef(true);

  useEffect(() => { latest.current = contact; }, [contact]);
  useEffect(() => { registry.current = byId; }, [byId]);
  useEffect(() => () => { mounted.current = false; }, []);

  const dismiss = useCallback(() => setToast(null), []);
  const say = (next) => { if (mounted.current) setToast({ ...next, id: Date.now() + Math.random() }); };

  const stored = storedStickerIds(contact);
  const assigned = new Set(stored);
  const pendingAdds = [...pending.values()].filter((p) => p.op === 'add' && !assigned.has(p.sticker.id));
  const atLimit = stored.length + pendingAdds.length >= STICKER_LIMIT;

  function setBusy(sticker, op) {
    setPending((prev) => {
      const next = new Map(prev);
      if (op) next.set(sticker.id, { op, sticker }); else next.delete(sticker.id);
      return next;
    });
  }

  function apply(op, stickerId) {
    const next = withMembershipChange(latest.current, stickerId, op);
    latest.current = next;
    onUpdate?.(next);
  }

  function fail(action, error, retry) {
    logStickerFailure(action, error);
    const { message, retryable, writeDenied } = describeStickerError(error);
    if (writeDenied) recheck();
    say({ tone: 'error', message, action: retryable ? { label: 'Retry', run: retry } : null, duration: 6000 });
  }

  async function change(op, sticker) {
    const contactId = latest.current.id;
    setBusy(sticker, op);
    try {
      if (op === 'add') await addSticker(uid, contactId, sticker.id);
      else await removeSticker(uid, contactId, sticker.id);
      if (!mounted.current) return;
      apply(op, sticker.id);
      if (op === 'add') setRecentIds(rememberRecentSticker(uid, sticker.id));
      else {
        say({
          message: `Removed ${sticker.name}`,
          description: 'Undo adds it again, dated now.',
          action: { label: 'Undo', run: () => change('add', sticker) },
          duration: UNDO_MS,
        });
      }
    } catch (error) {
      if (mounted.current) fail(op, error, () => change(op, sticker));
    } finally {
      if (mounted.current) setBusy(sticker, null);
    }
  }

  function closePicker() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function pick(sticker) {
    closePicker();
    change('add', sticker);
  }

  async function create(name) {
    closePicker();
    const color = nextStickerColor(all.length);
    let created;
    try {
      created = await createSticker(uid, { name, color });
    } catch (error) {
      if (mounted.current) fail('create', error, () => create(name));
      return;
    }
    if (!mounted.current) return;
    const sticker = registry.current.get(created.id)
      ?? { id: created.id, name: cleanStickerName(name), color, emoji: null, status: STICKER_STATUS.ACTIVE };
    await change('add', sticker);
  }

  const chips = [
    ...visibleStickers(contact, byId).map((sticker) => ({ sticker, busy: pending.has(sticker.id) })),
    ...pendingAdds.map(({ sticker }) => ({ sticker, busy: true })),
  ];

  return (
    <div className="stk-section" data-testid="contact-stickers">
      <ul className="stk-row" role="list" aria-label="Stickers">
        {chips.map(({ sticker, busy }) => (
          <li key={sticker.id}>
            <StickerChip sticker={sticker} pending={busy} onRemove={() => change('remove', sticker)} />
          </li>
        ))}
        <li className="stk-add-item">
          <button
            ref={buttonRef}
            type="button"
            className="stk-add-btn"
            aria-label="Add sticker"
            aria-haspopup="listbox"
            aria-expanded={open ? 'true' : 'false'}
            style={{ color: T.textFaint, border: `1.5px dashed ${T.border}` }}
            onClick={() => (open ? closePicker() : setOpen(true))}
          >
            <Plus size={10} aria-hidden="true" />
            <span>Sticker</span>
          </button>
          {open ? (
            <StickerPicker
              stickers={active}
              assignedIds={assigned}
              recentIds={recentIds}
              atLimit={atLimit}
              onPick={pick}
              onCreate={create}
              onClose={closePicker}
              ignoreRef={buttonRef}
            />
          ) : null}
        </li>
      </ul>
      <StickerToast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
