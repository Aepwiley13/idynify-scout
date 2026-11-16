/**
 * HubSidePanel — Contact Hub's own navigation, inside the page.
 *
 * My People, the Sticker Wall, one row per active sticker with how many of the
 * listed people have it, and New sticker. It is NOT part of the application
 * shell: it is drawn inside Contact Hub's content area, and only when that
 * area is wide enough (HubPeople measures it). Narrower than that, the same
 * choices are the chip row (StickerChipRow), so only one of the two is ever in
 * the page.
 *
 * Everything here is the existing sticker system: the page's one registry
 * (StickersProvider), the same counting function as the chips, the existing
 * create dialog and the existing service. Nothing is stored anywhere new.
 *
 * WHAT IT SHOWS IN EACH STICKER STATE
 *   not available (rollout off, or an admin viewing as the user)
 *       HubPeople does not render this panel at all.
 *   still checking or loading
 *       My People only. Nothing that looks like "you have no stickers".
 *   the sticker list failed to load
 *       My People, and a plain message that stickers could not be loaded.
 *       It never looks like an account whose stickers were removed.
 *   ready, none yet
 *       My People, Sticker Wall, New sticker. No empty "Stickers" heading.
 *   ready
 *       all of it.
 */
import { useMemo, useRef, useState } from 'react';
import { LayoutGrid, Plus, Users } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { countStickers } from '../../components/stickers/peopleStickers';
import { hexOf } from '../../components/stickers/stickerPalette';
import { createSticker } from '../../services/stickerService';
import StickerDialog from '../../components/stickers/StickerDialog';
import { stickersFailedToLoad } from './peopleRules';

/**
 * Said wherever sticker controls would have been. A failed load is not the
 * same as having no stickers, and must not look like it.
 */
export function StickersLoadError({ className = '' }) {
  const T = useT();
  return (
    <div className={`hub-stickers-error ${className}`} role="status" style={{ color: T.textMuted, borderColor: T.border }}>
      <span>Your stickers could not be loaded. They have not been changed.</span>
      <button
        type="button"
        className="hub-link-btn"
        style={{ color: T.text }}
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

export default function HubSidePanel({ header, people, selectedId, onSelect, wallOpen, onOpenWall }) {
  const T = useT();
  const stickers = useStickers();
  const { ready, active, uid, notify } = stickers;
  const counts = useMemo(() => (ready ? countStickers(people, active) : new Map()), [ready, people, active]);
  const [creating, setCreating] = useState(false);
  const newButton = useRef(null);

  const onPeople = !selectedId && !wallOpen;
  // Purple marks where you are, as it does in the main sidebar. On a dark
  // theme the purple text is too dim to read, so the label stays the text colour.
  const current = { background: `${BRAND.purple}${T.isDark ? '40' : '1c'}`, color: T.isDark ? T.text : BRAND.purple };
  const plain = { background: 'transparent', color: T.text };
  const closeDialog = () => { setCreating(false); newButton.current?.focus(); };

  return (
    <aside className="hub-panel" style={{ background: T.cardBg, borderColor: T.border }}>
      {header}

      <nav className="hub-panel-nav" aria-label="Contact Hub">
        <button
          type="button"
          className="hub-panel-item"
          aria-current={onPeople ? 'page' : undefined}
          style={onPeople ? current : plain}
          onClick={() => onSelect(null)}
        >
          <Users size={17} aria-hidden="true" />
          <span className="hub-panel-name">My People</span>
          <span className="hub-panel-count" style={{ color: T.textMuted, background: T.surface }} aria-label={`${people.length} ${people.length === 1 ? 'person' : 'people'}`}>
            {people.length}
          </span>
        </button>

        {ready && (
          <button
            type="button"
            className="hub-panel-item"
            aria-current={wallOpen ? 'page' : undefined}
            style={wallOpen ? current : plain}
            onClick={onOpenWall}
          >
            <LayoutGrid size={17} aria-hidden="true" />
            <span className="hub-panel-name">Sticker Wall</span>
          </button>
        )}

        {stickersFailedToLoad(stickers) && <StickersLoadError className="hub-stickers-error--panel" />}

        {ready && active.length > 0 && (
          <>
            <h3 className="hub-panel-label" style={{ color: T.textMuted }}>Stickers</h3>
            <ul className="hub-panel-list" aria-label="Filter by sticker">
              {active.map((sticker) => {
                const on = selectedId === sticker.id && !wallOpen;
                const count = counts.get(sticker.id) ?? 0;
                return (
                  <li key={sticker.id}>
                    <button
                      type="button"
                      className="hub-panel-item"
                      aria-pressed={on ? 'true' : 'false'}
                      aria-label={`${sticker.name}, ${count} ${count === 1 ? 'person' : 'people'}`}
                      style={on ? current : plain}
                      onClick={() => onSelect(on ? null : sticker.id)}
                    >
                      <span className="hub-panel-dot" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
                      {sticker.emoji ? <span aria-hidden="true">{sticker.emoji}</span> : null}
                      <span className="hub-panel-name">{sticker.name}</span>
                      <span className="hub-panel-count" style={{ color: T.textMuted, background: T.surface }} aria-hidden="true">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {ready && (
          <button
            ref={newButton}
            type="button"
            className="hub-panel-item hub-panel-item--new"
            style={{ color: T.textMuted }}
            onClick={() => setCreating(true)}
          >
            <Plus size={17} aria-hidden="true" />
            <span className="hub-panel-name">New sticker</span>
          </button>
        )}
      </nav>

      {creating ? (
        <StickerDialog
          others={active}
          onClose={closeDialog}
          // A failure is thrown back to the dialog, which shows it and stays open.
          onSubmit={async (values) => {
            await createSticker(uid, values);
            closeDialog();
            notify({ message: `Created ${values.name}` });
          }}
        />
      ) : null}
    </aside>
  );
}
