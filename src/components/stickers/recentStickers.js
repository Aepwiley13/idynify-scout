/**
 * The stickers this person added most recently, per user, in localStorage.
 * A convenience for ordering the picker: ids only, at most 5. Unreadable or
 * blocked storage means no Recent section, never an error.
 */
import { isStickerId } from '../../services/stickers/stickerCore';

export const RECENT_LIMIT = 5;
const key = (uid) => `idynify.stickers.recent.${uid}`;

export function readRecentStickerIds(uid) {
  if (!uid) return [];
  try {
    const ids = JSON.parse(window.localStorage.getItem(key(uid)) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id) => isStickerId(id)).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentSticker(uid, stickerId) {
  const next = [stickerId, ...readRecentStickerIds(uid).filter((id) => id !== stickerId)].slice(0, RECENT_LIMIT);
  if (!uid) return next;
  try {
    window.localStorage.setItem(key(uid), JSON.stringify(next));
  } catch {
    // Storage blocked: the order is lost, nothing else.
  }
  return next;
}
