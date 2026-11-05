/**
 * One sticker: color dot, optional emoji, name, optional remove button.
 * Looks different from a tag on purpose (UI spec U6): tags keep their
 * hashed pill with a tag icon; stickers carry a color dot.
 */
import { Loader, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { hexOf, stickerStyle } from './stickerPalette';
import './stickers.css';

export default function StickerChip({ sticker, pending = false, onRemove = null, compact = false }) {
  const T = useT();
  return (
    <span
      className={`stk-chip${compact ? ' stk-chip--compact' : ''}`}
      style={stickerStyle(sticker.color, T)}
      aria-busy={pending ? 'true' : undefined}
      data-pending={pending ? 'true' : undefined}
    >
      <span className="stk-dot" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
      {sticker.emoji ? <span className="stk-emoji" aria-hidden="true">{sticker.emoji}</span> : null}
      <span className="stk-name">{sticker.name}</span>
      {pending ? <Loader size={10} className="stk-spin" aria-hidden="true" /> : null}
      {onRemove ? (
        <button
          type="button"
          className="stk-remove"
          aria-label={`Remove sticker ${sticker.name}`}
          disabled={pending}
          onClick={onRemove}
        >
          <X size={10} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
