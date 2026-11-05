/**
 * StickersWall — People's Stickers view (S7, UI spec §3).
 *
 * One tile per active sticker with how many people the current tab shows
 * with it; a tile opens People filtered by that sticker. Each tile's menu
 * edits or archives it (after a confirm). Archived stickers sit in a
 * collapsed section with Restore: memberships were never removed, so a
 * restore brings every one back. Writes go through stickerService only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { createSticker, updateSticker, archiveSticker, restoreSticker } from '../../services/stickerService';
import { useStickers } from './stickersRegistry';
import { countStickers } from './peopleStickers';
import { hexOf } from './stickerPalette';
import { describeStickerError, logStickerFailure } from './stickerMessages';
import StickerDialog, { ModalDialog } from './StickerDialog';
import StickerToast from './StickerToast';
import './stickers.css';

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

function TileMenu({ sticker, onEdit, onArchive, onClose, buttonRef }) {
  const T = useT();
  const menuRef = useRef(null);
  useEffect(() => {
    menuRef.current?.querySelector('button')?.focus();
    const onDown = (event) => {
      if (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      onClose(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, buttonRef]);
  function onKeyDown(event) {
    const items = [...menuRef.current.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); onClose(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length].focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    else if (event.key === 'Tab') onClose(false);
  }
  return (
    <div ref={menuRef} role="menu" aria-label={`${sticker.name} options`} className="stk-tile-menu" style={{ background: T.cardBg, border: `1px solid ${T.border}` }} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" className="stk-tile-menu-item" style={{ color: T.text }} onClick={onEdit}>Edit</button>
      <button type="button" role="menuitem" className="stk-tile-menu-item" style={{ color: '#dc2626' }} onClick={onArchive}>Archive</button>
    </div>
  );
}

export default function StickersWall({ contacts, onOpenSticker }) {
  const { ready, uid, active, archived, all, recheck } = useStickers();
  const T = useT();
  const counts = useMemo(() => countStickers(contacts, active), [contacts, active]);
  const [dialog, setDialog] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const openerRef = useRef(null);
  const menuButtons = useRef(new Map());
  const dismiss = useCallback(() => setToast(null), []);

  if (!ready) return null;

  const say = (next) => setToast({ ...next, id: Date.now() + Math.random() });
  const closeDialog = () => { setDialog(null); openerRef.current?.focus(); };

  function failed(action, error, retry = null) {
    logStickerFailure(action, error);
    const { message, retryable, writeDenied } = describeStickerError(error);
    if (writeDenied) recheck();
    say({ tone: 'error', message, action: retryable && retry ? { label: 'Retry', run: retry } : null, duration: 6000 });
  }

  async function archive(sticker) {
    setDialog(null);
    setBusyId(sticker.id);
    try {
      await archiveSticker(uid, sticker.id);
      say({ message: `Archived ${sticker.name}`, action: { label: 'Restore', run: () => restore(sticker) }, duration: 6000 });
    } catch (error) {
      failed('archive', error, () => archive(sticker));
    } finally {
      setBusyId(null);
    }
  }

  async function restore(sticker) {
    setBusyId(sticker.id);
    try {
      await restoreSticker(uid, sticker.id);
      say({ message: `Restored ${sticker.name}` });
    } catch (error) {
      failed('restore', error, () => restore(sticker));
    } finally {
      setBusyId(null);
    }
  }

  const closeMenu = (refocus) => {
    const id = menuFor;
    setMenuFor(null);
    if (refocus && id) menuButtons.current.get(id)?.focus();
  };

  return (
    <div className="stk-wall" data-testid="stickers-wall">
      <div className="stk-wall-head">
        <h2 className="stk-wall-title" style={{ color: T.text }}>Stickers</h2>
        <button
          type="button"
          className="stk-btn stk-btn--primary"
          onClick={(e) => { openerRef.current = e.currentTarget; setDialog({ mode: 'create' }); }}
        >
          <Plus size={12} aria-hidden="true" /> New sticker
        </button>
      </div>

      {active.length === 0 ? (
        <p className="stk-wall-empty" style={{ color: T.textMuted }}>No stickers yet. Create one to start grouping people.</p>
      ) : (
        <ul className="stk-wall-grid" aria-label="Stickers">
          {active.map((sticker) => {
            const n = counts.get(sticker.id) ?? 0;
            return (
              <li key={sticker.id} className="stk-tile" style={{ background: T.cardBg, border: `1px solid ${T.border}` }} aria-busy={busyId === sticker.id ? 'true' : undefined}>
                <span className="stk-tile-band" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
                <button type="button" className="stk-tile-main" aria-label={`${sticker.name}, ${people(n)}`} onClick={() => onOpenSticker(sticker.id)}>
                  <span className="stk-tile-top">
                    {sticker.emoji ? <span className="stk-tile-emoji" aria-hidden="true">{sticker.emoji}</span> : null}
                    <span className="stk-tile-name" style={{ color: T.text }}>{sticker.name}</span>
                  </span>
                  {sticker.description ? <span className="stk-tile-desc" style={{ color: T.textMuted }}>{sticker.description}</span> : null}
                  <span className="stk-tile-count" style={{ color: BRAND.pink }}>{people(n)}</span>
                </button>
                <button
                  type="button"
                  ref={(el) => { if (el) menuButtons.current.set(sticker.id, el); else menuButtons.current.delete(sticker.id); }}
                  className="stk-tile-menu-btn"
                  style={{ color: T.textMuted }}
                  aria-label={`${sticker.name} options`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === sticker.id ? 'true' : 'false'}
                  onClick={() => setMenuFor((id) => (id === sticker.id ? null : sticker.id))}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
                {menuFor === sticker.id ? (
                  <TileMenu
                    sticker={sticker}
                    buttonRef={{ current: menuButtons.current.get(sticker.id) }}
                    onClose={closeMenu}
                    onEdit={() => { openerRef.current = menuButtons.current.get(sticker.id); setMenuFor(null); setDialog({ mode: 'edit', sticker }); }}
                    onArchive={() => { openerRef.current = menuButtons.current.get(sticker.id); setMenuFor(null); setDialog({ mode: 'archive', sticker }); }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {archived.length ? (
        <section className="stk-wall-archived" aria-label="Archived stickers">
          <button type="button" className="stk-btn" style={{ color: T.textMuted, border: `1px solid ${T.border}` }} aria-expanded={archivedOpen ? 'true' : 'false'} onClick={() => setArchivedOpen((o) => !o)}>
            Archived ({archived.length})
          </button>
          {archivedOpen ? (
            <ul className="stk-wall-archived-list">
              {archived.map((sticker) => (
                <li key={sticker.id} style={{ color: T.textMuted, borderBottom: `1px solid ${T.border}` }} aria-busy={busyId === sticker.id ? 'true' : undefined}>
                  <span className="stk-dot" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
                  <span className="stk-tile-name">{sticker.name}</span>
                  <button type="button" className="stk-btn" style={{ color: T.text, border: `1px solid ${T.border}` }} aria-label={`Restore ${sticker.name}`} disabled={busyId === sticker.id} onClick={() => restore(sticker)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {dialog?.mode === 'create' ? (
        <StickerDialog
          others={all.filter((s) => s.status === 'active')}
          onClose={closeDialog}
          onSubmit={async (values) => {
            await createSticker(uid, values);
            setDialog(null);
            openerRef.current?.focus();
            say({ message: `Created ${values.name}` });
          }}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <StickerDialog
          sticker={dialog.sticker}
          others={active}
          onClose={closeDialog}
          onSubmit={async (changes) => {
            try {
              await updateSticker(uid, dialog.sticker.id, changes);
            } catch (error) {
              if (describeStickerError(error).writeDenied) recheck();
              throw error;
            }
            setDialog(null);
            openerRef.current?.focus();
            say({ message: `Saved ${changes.name ?? dialog.sticker.name}` });
          }}
        />
      ) : null}
      {dialog?.mode === 'archive' ? (
        <ModalDialog title={`Archive ${dialog.sticker.name}?`} role="alertdialog" onClose={closeDialog}>
          <p className="stk-dialog-text" style={{ color: T.textMuted }}>
            It disappears from pickers and filters. {people(counts.get(dialog.sticker.id) ?? 0)} keep it, and it comes back if you restore it.
          </p>
          <div className="stk-dialog-actions">
            <button type="button" className="stk-btn" style={{ color: T.textMuted, border: `1px solid ${T.border}` }} onClick={closeDialog}>Cancel</button>
            <button type="button" className="stk-btn stk-btn--danger" onClick={() => archive(dialog.sticker)}>Archive</button>
          </div>
        </ModalDialog>
      ) : null}

      <StickerToast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
