/**
 * StickerChipRow — My People's sticker filter: "All", then one chip per
 * active sticker with how many of the listed people have it, then a way into
 * the Sticker Wall (create, edit, archive).
 *
 * This is the sticker navigation wherever the application sidebar does not
 * carry Contact Hub's entries (HubSidebarNav): on a phone, with the compact
 * sidebar, or with no sidebar at all. Where the sidebar does carry them,
 * HubPeople does not render this row.
 *
 * It reads the page's one sticker registry (StickersProvider) and counts from
 * the people already loaded, exactly as People's filter does. One sticker at a
 * time; pressing the selected one clears it.
 *
 * Renders nothing unless stickers are available for this account. Stickers are
 * optional: with none yet, the row is just the quiet "Sticker Wall" button.
 */
import { useMemo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { countStickers } from '../../components/stickers/peopleStickers';
import { hexOf, stickerStyle } from '../../components/stickers/stickerPalette';

/**
 * @param wallChip  false leaves out the "Sticker Wall" chip, where something
 *                  else already leads there (a phone's bottom bar). The row is
 *                  then filters only, and nothing at all with no stickers yet.
 */
export default function StickerChipRow({ people, selectedId, onSelect, managing, onToggleManage, wallChip = true }) {
  const T = useT();
  const { ready, active } = useStickers();
  const counts = useMemo(() => (ready ? countStickers(people, active) : new Map()), [ready, people, active]);

  if (!ready) return null;
  // Nothing to filter by and no chip to show: no empty row.
  if (!wallChip && active.length === 0) return null;

  // Border widths live in the stylesheet (the selected "All" is heavier on a phone).
  const plain = { color: T.textMuted, background: T.cardBg, borderColor: T.border };
  const chosen = { color: T.text, background: T.accentBg, borderColor: T.accent };
  // The way into the Stickers view: an outline only, so it does not read as a filter.
  const manage = { color: T.textMuted, background: 'transparent', borderColor: T.textMuted };

  return (
    <div className="hub-chips" role="group" aria-label="Filter by sticker">
      {active.length > 0 && (
        <button
          type="button"
          className="hub-chip hub-chip--all"
          aria-pressed={!selectedId && !managing ? 'true' : 'false'}
          style={!selectedId && !managing ? chosen : plain}
          onClick={() => onSelect(null)}
        >
          All
        </button>
      )}
      {active.map((sticker) => {
        const on = selectedId === sticker.id && !managing;
        const count = counts.get(sticker.id) ?? 0;
        return (
          <button
            key={sticker.id}
            type="button"
            className="hub-chip"
            aria-pressed={on ? 'true' : 'false'}
            aria-label={`${sticker.name}, ${count} ${count === 1 ? 'person' : 'people'}`}
            style={{ ...stickerStyle(sticker.color, T), ...(on ? { boxShadow: `0 0 0 2px ${hexOf(sticker.color)}` } : null) }}
            onClick={() => onSelect(on ? null : sticker.id)}
          >
            <span className="hub-chip-dot" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
            {sticker.emoji ? <span aria-hidden="true">{sticker.emoji}</span> : null}
            <span className="hub-chip-name">{sticker.name}</span>
            <span className="hub-chip-count" style={{ color: T.textMuted }} aria-hidden="true">{count}</span>
          </button>
        );
      })}
      {wallChip ? (
        <button
          type="button"
          className="hub-chip hub-chip--manage"
          aria-pressed={managing ? 'true' : 'false'}
          style={managing ? chosen : manage}
          onClick={onToggleManage}
        >
          <LayoutGrid size={14} aria-hidden="true" />
          Sticker Wall
        </button>
      ) : null}
    </div>
  );
}
