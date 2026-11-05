/**
 * The sticker form's checks (S7): the same limits, measured the same way, as
 * the service (stickerCore cleanStickerName / checkEmoji / checkDescription),
 * so the dialog says no before a write would.
 */
import { STICKER_NAME_MAX, STICKER_EMOJI_MAX, STICKER_DESCRIPTION_MAX, STICKER_ERRORS } from '../../services/stickers/stickerCore';

/** The first problem with the values, as { code, field }, or null. */
export function validateStickerValues({ name, emoji, description }) {
  const cleaned = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!cleaned || cleaned.length > STICKER_NAME_MAX) return { code: STICKER_ERRORS.INVALID_NAME, field: 'name' };
  if (typeof emoji === 'string' && emoji.trim().length > STICKER_EMOJI_MAX) return { code: STICKER_ERRORS.INVALID_EMOJI, field: 'emoji' };
  if (typeof description === 'string' && description.trim().length > STICKER_DESCRIPTION_MAX) return { code: STICKER_ERRORS.INVALID_DESCRIPTION, field: 'description' };
  return null;
}
