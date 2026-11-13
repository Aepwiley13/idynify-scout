/**
 * ContactCardStickersInteractive — a contact's stickers on a People card (up
 * to 2) or list row (1), with "+n" for the rest, plus add and remove in place.
 *
 * Behaves like the Contact Profile row (ContactStickersRow): the same picker
 * (search, recent first, create inline), nothing optimistic (a chip is
 * pending until its write resolves), remove with Undo, and the same error
 * messages. Active stickers only, so archived ones are never shown or
 * counted. Nothing at all unless stickers are available.
 *
 * onUpdate(contactId, stickerId, op) lets the page apply the confirmed change
 * to its own copy of the contact. It is id-based, so it is still called when
 * an Undo finishes after this card has left the screen (for example, a
 * sticker filter hid it), and the card comes back.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { addSticker, removeSticker } from '../../services/contactStickers';
import { createSticker } from '../../services/stickerService';
import {
  STICKER_LIMIT, STICKER_STATUS, cleanStickerName, storedStickerIds, visibleStickers,
} from '../../services/stickers/stickerCore';
import { useStickers } from './stickersRegistry';
import StickerPicker from './StickerPicker';
import StickerChip from './StickerChip';
import { UNDO_MS } from './ContactStickersRow';
import { nextStickerColor } from './stickerPalette';
import { describeStickerError, logStickerFailure } from './stickerMessages';
import { readRecentStickerIds, rememberRecentSticker } from './recentStickers';
import './stickers.css';

export default function ContactCardStickersInteractive({ contact, max = 2, onUpdate, style = null }) {
  const stickers = useStickers();
  if (!stickers.ready || !contact?.id) return null;
  // Keyed like the profile row: an Undo or Retry raised for one contact can
  // never write to another if the card is reused.
  return <CardStickers key={contact.id} contact={contact} max={max} onUpdate={onUpdate} style={style} stickers={stickers} />;
}

function CardStickers({ contact, max, onUpdate, style, stickers }) {
  const { uid, byId, active, all, recheck, notify } = stickers;
  const T = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(() => new Map());
  const [recentIds, setRecentIds] = useState(() => readRecentStickerIds(uid));
  const buttonRef = useRef(null);
  const contactId = contact.id;
  const registry = useRef(byId);
  const mounted = useRef(true);
  const writing = useRef(new Set());

  useEffect(() => { registry.current = byId; }, [byId]);
  useEffect(() => () => { mounted.current = false; }, []);

  const stored = storedStickerIds(contact);
  const assigned = new Set(stored);
  const pendingAdds = [...pending.values()].filter((p) => p.op === 'add' && !assigned.has(p.sticker.id));
  const atLimit = stored.length + pendingAdds.length >= STICKER_LIMIT;

  const visible = visibleStickers(contact, byId);
  const chips = [
    ...visible.map((sticker) => ({ sticker, busy: pending.has(sticker.id) })),
    ...pendingAdds.map(({ sticker }) => ({ sticker, busy: true })),
  ];
  const shown = chips.slice(0, max);
  const more = chips.length - shown.length;

  function setBusy(sticker, op) {
    if (!mounted.current) return;
    setPending((prev) => {
      const next = new Map(prev);
      if (op) next.set(sticker.id, { op, sticker }); else next.delete(sticker.id);
      return next;
    });
  }

  function fail(action, error, retry) {
    logStickerFailure(action, error);
    const { message, retryable, writeDenied } = describeStickerError(error);
    if (writeDenied) recheck();
    notify({ tone: 'error', message, action: retryable ? { label: 'Retry', run: retry } : null, duration: 6000 });
  }

  async function change(op, sticker) {
    const key = `${sticker.id}:${op}`;
    if (writing.current.has(key)) return;
    writing.current.add(key);
    setBusy(sticker, op);
    try {
      if (op === 'add') await addSticker(uid, contactId, sticker.id);
      else await removeSticker(uid, contactId, sticker.id);
      onUpdate?.(contactId, sticker.id, op);
      if (op === 'add') {
        const recent = rememberRecentSticker(uid, sticker.id);
        if (mounted.current) setRecentIds(recent);
      } else {
        // Page-level notice (StickersProvider): it outlives this card.
        notify({
          message: `Removed ${sticker.name}`,
          description: 'Undo adds it again, dated now.',
          action: { label: 'Undo', run: () => change('add', sticker) },
          duration: UNDO_MS,
        });
      }
    } catch (error) {
      fail(op, error, () => change(op, sticker));
    } finally {
      writing.current.delete(key);
      setBusy(sticker, null);
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
      fail('create', error, () => create(name));
      return;
    }
    const sticker = registry.current.get(created.id)
      ?? { id: created.id, name: cleanStickerName(name), color, emoji: null, status: STICKER_STATUS.ACTIVE };
    await change('add', sticker);
  }

  const who = contact.name ? ` to ${contact.name}` : '';

  return (
    // The card and row open the contact on click and on Enter/Space; sticker
    // controls are their own targets.
    <span
      className="stk-card-row stk-card-row--interactive"
      data-testid="card-stickers-interactive"
      style={style ?? undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
    >
      {chips.length ? (
        <span className="stk-card-row" data-testid="card-stickers" role="list" aria-label="Stickers">
          {shown.map(({ sticker, busy }) => (
            <span key={sticker.id} role="listitem" className="stk-card-item">
              <StickerChip sticker={sticker} pending={busy} compact onRemove={() => change('remove', sticker)} />
            </span>
          ))}
          {more > 0 ? (
            <span className="stk-card-more" style={{ color: T.textFaint }} aria-label={`${more} more ${more === 1 ? 'sticker' : 'stickers'}`}>+{more}</span>
          ) : null}
        </span>
      ) : null}
      <span className="stk-add-item">
        <button
          ref={buttonRef}
          type="button"
          className="stk-add-btn stk-add-btn--compact"
          aria-label={`Add sticker${who}`}
          aria-haspopup="listbox"
          aria-expanded={open ? 'true' : 'false'}
          title="Add sticker"
          style={{ color: T.textFaint, border: `1.5px dashed ${T.border}` }}
          onClick={() => (open ? closePicker() : setOpen(true))}
        >
          <Plus size={10} aria-hidden="true" />
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
      </span>
    </span>
  );
}
