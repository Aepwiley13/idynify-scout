/**
 * StickerChipRow — My People's sticker filter: "All", then one chip per
 * active sticker with how many of the listed people have it, then a way into
 * the Stickers view (create, edit, archive).
 *
 * It reads the page's one sticker registry (StickersProvider) and counts from
 * the people already loaded, exactly as People's filter does. One sticker at a
 * time; pressing the selected one clears it.
 *
 * Renders nothing unless stickers are available for this account. Stickers are
 * optional: with none yet, the row is just the quiet "Stickers" button.
 */
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { countStickers } from '../../components/stickers/peopleStickers';
import { hexOf, stickerStyle } from '../../components/stickers/stickerPalette';

export default function StickerChipRow({ people, selectedId, onSelect, managing, onToggleManage }) {
  const T = useT();
  const { ready, active } = useStickers();
  const counts = useMemo(() => (ready ? countStickers(people, active) : new Map()), [ready, people, active]);

  if (!ready) return null;

  const plain = { color: T.textMuted, background: T.cardBg, border: `1.5px solid ${T.border}` };
  const chosen = { color: T.text, background: T.accentBg, border: `1.5px solid ${T.accent}` };

  return (
    <div className="hub-chips" role="group" aria-label="Filter by sticker">
      {active.length > 0 && (
        <button
          type="button"
          className="hub-chip"
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
      <button
        type="button"
        className="hub-chip hub-chip--manage"
        aria-pressed={managing ? 'true' : 'false'}
        style={managing ? chosen : { ...plain, borderStyle: 'dashed' }}
        onClick={onToggleManage}
      >
        <Plus size={14} aria-hidden="true" />
        Stickers
      </button>
    </div>
  );
}
