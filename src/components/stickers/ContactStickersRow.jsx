/**
 * ContactStickersRow — the Stickers row on the Contact Profile (S5, UI spec §1).
 *
 * Shown only when the page's StickersProvider says stickers are available
 * and the registry has loaded; otherwise it renders nothing and takes no
 * space (U1). Every write goes through contactStickers / stickerService (U2).
 * Nothing is optimistic (U3): a chip is pending until its transaction
 * resolves, and the row then shows the confirmed change.
 */
import { Plus } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { useStickers } from './stickersRegistry';
import StickerChip from './StickerChip';
import StickerPicker from './StickerPicker';
import { UNDO_MS, useContactStickers } from './useContactStickers';
import './stickers.css';

// Still exported from here (its one definition is in useContactStickers): ContactCardStickersInteractive imports it from this module.
// eslint-disable-next-line react-refresh/only-export-components
export { UNDO_MS };

export default function ContactStickersRow({ contact, onUpdate }) {
  const stickers = useStickers();
  if (!stickers.ready || !contact?.id) return null;
  // One Row per contact. The full-page profile keeps this component mounted
  // when the route moves to another contact, while a notice's Undo or Retry
  // (page-level, StickersProvider) can still be pressed. Keyed, that action
  // belongs to the old Row, which still points at the contact it was raised
  // for, so it can never write to the contact now on screen.
  return <Row key={contact.id} contact={contact} onUpdate={onUpdate} stickers={stickers} />;
}

function Row({ contact, onUpdate, stickers }) {
  const T = useT();
  // The behaviour (state, writes, Undo, Retry, focus return) is in useContactStickers; this draws it.
  const {
    chips, assigned, recentIds, atLimit, active, open, setOpen, buttonRef, change, pick, create, closePicker,
  } = useContactStickers({ contact, onUpdate, stickers });

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
            style={{ color: T.textMuted, border: `1.5px dashed ${T.textFaint}` }}
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
    </div>
  );
}
