/**
 * People and stickers (S6, UI spec §2): the pure decisions the People page
 * makes for the sticker filter, its counts, search and the ?sticker= link.
 * Kept out of AllLeads so each rule is tested on its own.
 */
import { STICKER_STATUS, storedStickerIds } from '../../services/stickers/stickerCore';

export const STICKER_PARAM = 'sticker';

/** `?sticker=` from the current URL, or null. No router hook: People mounts under several shells. */
export function readUrlSticker(search = typeof window === 'undefined' ? '' : window.location.search) {
  try {
    return new URLSearchParams(search).get(STICKER_PARAM) || null;
  } catch {
    return null;
  }
}

/**
 * Put the chosen sticker in the address bar, or take it out, without
 * navigating (UI spec U8). Every other parameter and the history entry stay.
 */
export function writeUrlSticker(stickerId) {
  try {
    const url = new URL(window.location.href);
    if (stickerId) url.searchParams.set(STICKER_PARAM, stickerId);
    else url.searchParams.delete(STICKER_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // No address bar to update (a test, or an embedded view): the filter still works.
  }
}

/**
 * The filter to apply for a requested sticker id: the sticker when it is
 * known and active; otherwise none, with a notice (an archived, deleted or
 * someone else's sticker in a shared link).
 */
export function resolveStickerFilter(stickerId, byId) {
  if (!stickerId) return { sticker: null, notice: false };
  const sticker = byId.get(stickerId);
  return sticker && sticker.status === STICKER_STATUS.ACTIVE ? { sticker, notice: false } : { sticker: null, notice: true };
}

export function hasSticker(contact, stickerId) {
  return storedStickerIds(contact).includes(stickerId);
}

/** How many of `contacts` hold each active sticker: Map(id → count), in one pass. */
export function countStickers(contacts, active) {
  const counts = new Map(active.map((s) => [s.id, 0]));
  for (const contact of contacts) {
    for (const id of new Set(storedStickerIds(contact))) {
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
  }
  return counts;
}

/** Does one of the contact's ACTIVE stickers have a name containing `lower`? */
export function matchesStickerName(contact, byId, lower) {
  if (!lower) return false;
  for (const id of storedStickerIds(contact)) {
    const sticker = byId.get(id);
    if (sticker && sticker.status === STICKER_STATUS.ACTIVE && sticker.name.toLowerCase().includes(lower)) return true;
  }
  return false;
}

/** "Added to 37 · 2 already had it · 1 not changed" */
export function bulkSummaryText({ added = [], already = [], failed = [] }) {
  const parts = [`Added to ${added.length}`];
  if (already.length) parts.push(`${already.length} already had it`);
  if (failed.length) parts.push(`${failed.length} not changed`);
  return parts.join(' · ');
}
