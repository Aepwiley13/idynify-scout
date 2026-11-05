/**
 * Sticker colors, drawn with the theme's own text color on a light tint of
 * the sticker color, so the name meets 4.5:1 contrast in every theme
 * (src/test/stickerPalette.test.js checks all of them). The color is never
 * the only signal: the name is always shown.
 */
import { STICKER_COLORS } from '../../services/stickers/stickerCore';

export const STICKER_HEX = Object.freeze({
  teal: '#14b8a6',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  coral: '#f97362',
  amber: '#f59e0b',
  pink: '#ec4899',
  green: '#22c55e',
  gray: '#94a3b8',
});

export const COLOR_LABELS = Object.freeze({
  teal: 'Teal', blue: 'Blue', purple: 'Purple', coral: 'Coral', amber: 'Amber', pink: 'Pink', green: 'Green', gray: 'Gray',
});

/** Tint and border strength, as two-digit hex alpha. */
export const TINT_ALPHA = '24';
export const BORDER_ALPHA = '73';

export const hexOf = (color) => STICKER_HEX[color] ?? STICKER_HEX.gray;

/** Inline style for a chip or tile on theme T. */
export function stickerStyle(color, T) {
  const hex = hexOf(color);
  return { color: T.text, background: `${hex}${TINT_ALPHA}`, border: `1.5px solid ${hex}${BORDER_ALPHA}` };
}

/** The color a new sticker gets: the next one in palette order. */
export function nextStickerColor(existingCount) {
  return STICKER_COLORS[Math.abs(Number(existingCount) || 0) % STICKER_COLORS.length];
}
