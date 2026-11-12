/**
 * ContactCardStickersInteractive — Interactive sticker display for contact cards.
 *
 * Extends the existing ContactCardStickers with add/remove capabilities.
 * Shows up to `max` stickers as removable chips, plus a + button to add more.
 * Reuses StickerPicker and established service contracts.
 *
 * Usage: <ContactCardStickersInteractive contact={contact} max={2} onUpdate={fn} />
 */
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { addSticker, removeSticker, storedStickerIds, withMembershipChange, STICKER_LIMIT } from '../../services/contactStickers';
import { createSticker } from '../../services/stickerService';
import { STICKER_STATUS, cleanStickerName } from '../../services/stickers/stickerCore';
import { useStickers } from './stickersRegistry';
import StickerPicker from './StickerPicker';
import StickerChip from './StickerChip';
import { nextStickerColor } from './stickerPalette';
import { describeStickerError, logStickerFailure } from './stickerMessages';
import { readRecentStickerIds, rememberRecentSticker } from './recentStickers';
import './stickers.css';

export default function ContactCardStickersInteractive({ contact, max = 2, onUpdate, style = null }) {
  const { ready, uid, active, all, byId, notify, recheck } = useStickers();
  const T = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(new Map()); // stickerId -> {op, sticker}
  const [recentIds, setRecentIds] = useState(() => readRecentStickerIds(uid));
  const buttonRef = useRef(null);
  const latest = useRef(contact);
  const registry = useRef(byId);
  const mounted = useRef(true);
  const writingRef = useRef(new Set()); // Synchronous concurrency guard

  useEffect(() => { latest.current = contact; }, [contact]);
  useEffect(() => { registry.current = byId; }, [byId]);
  useEffect(() => () => { mounted.current = false; }, []);

  if (!ready || !contact?.id) return null;

  const stored = storedStickerIds(contact);
  const assigned = new Set(stored);
  const pendingAdds = [...pending.values()].filter((p) => p.op === 'add' && !assigned.has(p.sticker.id));
  const atLimit = stored.length + pendingAdds.length >= STICKER_LIMIT;

  // Get visible stickers for display
  const shown = stored
    .map(id => byId.get(id))
    .filter(s => s && s.status === STICKER_STATUS.ACTIVE)
    .slice(0, max);

  const more = Math.max(0, stored.length - max);

  function setBusy(sticker, op) {
    setPending(prev => {
      const next = new Map(prev);
      if (op) next.set(sticker.id, { op, sticker });
      else next.delete(sticker.id);
      return next;
    });
  }

  function apply(op, stickerId) {
    const next = withMembershipChange(latest.current, stickerId, op);
    latest.current = next;
    // Pass (contactId, stickerId, op) to parent so it can apply to its latest state
    onUpdate?.(contact.id, stickerId, op);
  }

  function fail(action, error, retry) {
    logStickerFailure(action, error);
    const { message, retryable, writeDenied } = describeStickerError(error);
    if (writeDenied) recheck();
    notify({ tone: 'error', message, action: retryable && retry ? { label: 'Retry', run: retry } : null, duration: 6000 });
  }

  async function change(op, sticker) {
    const contactId = latest.current.id;
    const key = `${contactId}:${sticker.id}:${op}`;

    // Synchronous guard: prevent duplicate concurrent operations
    if (writingRef.current.has(key)) return;
    writingRef.current.add(key);

    setBusy(sticker, op);
    try {
      if (op === 'add') await addSticker(uid, contactId, sticker.id);
      else await removeSticker(uid, contactId, sticker.id);
      if (!mounted.current) return;
      apply(op, sticker.id);
      if (op === 'add') setRecentIds(rememberRecentSticker(uid, sticker.id));
    } catch (error) {
      if (mounted.current) fail(op, error, () => change(op, sticker));
    } finally {
      writingRef.current.delete(key);
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
    let createdId;
    try {
      const result = await createSticker(uid, { name, color });
      createdId = result.id; // Extract id from {id: ...} return value
    } catch (error) {
      if (mounted.current) fail('create', error, () => create(name));
      return;
    }
    if (!mounted.current) return;

    // Registry may not have the new sticker yet, construct it
    const sticker = registry.current.get(createdId) ?? {
      id: createdId,
      name: cleanStickerName(name),
      color,
      emoji: null,
      status: STICKER_STATUS.ACTIVE,
    };

    // Add to contact (separate operation, can fail independently)
    await change('add', sticker);
  }

  return (
    <span
      className="stk-card-row"
      data-testid="card-stickers-interactive"
      style={style ?? undefined}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        // Prevent card navigation on Enter/Space when interacting with stickers
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
        }
      }}
    >
      {/* Existing stickers as removable chips */}
      {shown.map(sticker => {
        const isBusy = pending.has(sticker.id);
        return (
          <StickerChip
            key={sticker.id}
            sticker={sticker}
            pending={isBusy}
            compact
            onRemove={e => {
              e?.stopPropagation();
              change('remove', sticker);
            }}
          />
        );
      })}

      {/* Pending additions */}
      {pendingAdds.map(({ sticker }) => (
        <StickerChip
          key={sticker.id}
          sticker={sticker}
          pending
          compact
        />
      ))}

      {/* +N indicator for hidden stickers */}
      {more > 0 && (
        <span
          className="stk-card-more"
          style={{ color: T.textFaint }}
          aria-label={`${more} more ${more === 1 ? 'sticker' : 'stickers'}`}
        >
          +{more}
        </span>
      )}

      {/* Add button */}
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <button
          ref={buttonRef}
          type="button"
          className="stk-add-btn-compact"
          aria-label="Add sticker"
          aria-haspopup="listbox"
          aria-expanded={open ? 'true' : 'false'}
          disabled={atLimit}
          onClick={e => {
            e.stopPropagation();
            setOpen(o => !o);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: '2px 6px',
            borderRadius: 10,
            border: `1px dashed ${open ? BRAND.pink : T.border}`,
            background: open ? `${BRAND.pink}08` : 'transparent',
            color: open ? BRAND.pink : T.textFaint,
            fontSize: 8,
            fontWeight: 600,
            cursor: atLimit ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            opacity: atLimit ? 0.4 : 1,
          }}
          title={atLimit ? `Limit: ${STICKER_LIMIT} stickers` : 'Add sticker'}
        >
          <Plus size={8} aria-hidden="true" />
        </button>
        {open && (
          <StickerPicker
            stickers={active}
            assignedIds={assigned}
            recentIds={recentIds}
            atLimit={atLimit}
            onPick={pick}
            onCreate={create}
            onClose={closePicker}
            ignoreRef={buttonRef}
            placement="below"
          />
        )}
      </span>
    </span>
  );
}
