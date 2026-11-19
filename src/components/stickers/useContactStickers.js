/**
 * useContactStickers — one contact's sticker behaviour: what is shown, and what adding, removing,
 * creating, undoing and retrying do.
 *
 * MOVED, NOT REWRITTEN. This is the logic that lived inside ContactStickersRow's inner Row, moved here
 * unchanged so that a second surface can use it (the new profile header, later) without a third copy of
 * add / remove / create / undo. ContactStickersRow still decides WHEN to draw (the availability and
 * registry gate) and still keys the inner component by contact id; this hook is called inside that keyed
 * component, so every piece of its state belongs to one contact for the life of the component.
 *
 * It returns what a surface needs to draw and drive the controls:
 *   chips          [{ sticker, busy }]: the contact's visible stickers, then adds still in flight
 *   assigned       the ids already on the contact (the picker marks them chosen)
 *   recentIds      recently used sticker ids, newest first
 *   atLimit        50 stickers, counting adds in flight
 *   active         the registry's active stickers (the picker's options)
 *   open, setOpen  whether the picker is open
 *   buttonRef      the add button: focus returns to it, and a press on it does not count as "outside" the picker
 *   change(op, sticker)  'add' or 'remove' one sticker; remove is what a chip's remove control calls
 *   pick, create, closePicker   what the picker's onPick, onCreate and onClose call
 *
 * WHAT IT DOES, AND WHAT IT DOES NOT (documented, preserved on purpose, not fixed here; see M0's
 * contactStickersRowCharacterization.test.jsx, the tests marked KNOWN):
 *   - Nothing is optimistic: a chip is pending until its transaction resolves.
 *   - A write is made for the contact this component was made for, and only that one.
 *   - A denied write re-checks availability (recheck), and the notice lives on the page, not here.
 *   - Removing offers Undo for UNDO_MS; only the latest removal's offer stays.
 *   - KNOWN: an add that is still pending can be chosen again and is sent a second time.
 *   - KNOWN: a result that arrives after the component has been replaced (the person moved to another
 *     contact) is saved but is not reported through onUpdate.
 *   - KNOWN: a creation that finishes after the component has been replaced creates the sticker but does
 *     not add it to anyone.
 *
 * @param {object} args
 * @param {object} args.contact    the contact (needs an id)
 * @param {(next: object) => void} [args.onUpdate]  told the contact as it is after a confirmed change
 * @param {object} args.stickers   the useStickers() value (a ready one)
 */
import { useEffect, useRef, useState } from 'react';
import { addSticker, removeSticker } from '../../services/contactStickers';
import { createSticker } from '../../services/stickerService';
import {
  STICKER_LIMIT, STICKER_STATUS, cleanStickerName, storedStickerIds, visibleStickers, withMembershipChange,
} from '../../services/stickers/stickerCore';
import { describeStickerError, logStickerFailure } from './stickerMessages';
import { readRecentStickerIds, rememberRecentSticker } from './recentStickers';
import { nextStickerColor } from './stickerPalette';

/** How long the Undo offer for a removal stays. */
export const UNDO_MS = 6000;

export function useContactStickers({ contact, onUpdate, stickers }) {
  const { uid, byId, active, all, recheck, notify } = stickers;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(() => new Map());
  const [recentIds, setRecentIds] = useState(() => readRecentStickerIds(uid));
  const buttonRef = useRef(null);
  const latest = useRef(contact);
  const registry = useRef(byId);
  const mounted = useRef(true);

  useEffect(() => { latest.current = contact; }, [contact]);
  useEffect(() => { registry.current = byId; }, [byId]);
  useEffect(() => () => { mounted.current = false; }, []);

  // Page-level notice (StickersProvider): it stays even if this row goes away.
  const say = notify;

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

  return {
    chips, assigned, recentIds, atLimit, active, open, setOpen, buttonRef, change, pick, create, closePicker,
  };
}

export default useContactStickers;
