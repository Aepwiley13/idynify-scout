/**
 * A contact's stickers on a People card (up to 2) or list row (1), with
 * "+n" for the rest (S6, UI spec §2.1). Active stickers only. Nothing at all
 * unless stickers are available.
 */
import { useT } from '../../theme/ThemeContext';
import { visibleStickers } from '../../services/stickers/stickerCore';
import { useStickers } from './stickersRegistry';
import StickerChip from './StickerChip';
import './stickers.css';

export default function ContactCardStickers({ contact, max = 2, style = null }) {
  const { ready, byId } = useStickers();
  const T = useT();
  if (!ready) return null;
  const shown = visibleStickers(contact, byId);
  if (!shown.length) return null;
  const more = shown.length - max;
  return (
    <span className="stk-card-row" data-testid="card-stickers" style={style ?? undefined}>
      {shown.slice(0, max).map((sticker) => <StickerChip key={sticker.id} sticker={sticker} compact />)}
      {more > 0 ? (
        <span className="stk-card-more" style={{ color: T.textFaint }} aria-label={`${more} more ${more === 1 ? 'sticker' : 'stickers'}`}>+{more}</span>
      ) : null}
    </span>
  );
}
