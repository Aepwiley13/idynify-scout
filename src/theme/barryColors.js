/**
 * Barry's colours, theme-aware (#005.3).
 *
 * Barry's brand hues (pink, purple, cyan) fail as text on every theme as raw
 * values — pink falls to 3.3:1, purple 2.6:1 and cyan 1.6:1 somewhere across
 * the seven themes. Mixing the hue into the theme's own text colour keeps it
 * recognisable while it darkens on light themes and lightens on dark ones.
 * The percentages are the largest share of hue that stays >= 4.5:1 on card,
 * surface, page and secondary backgrounds in all seven themes.
 *
 * Nothing here changes a global theme token: these are values Barry's
 * components use instead of raw brand hex for TEXT and meaningful ICONS.
 * Backgrounds, borders and decoration keep the brand colours.
 */
import { BRAND } from './tokens';

const mixText = (hex, pct) => `color-mix(in srgb, ${hex} ${pct}%, var(--text-primary))`;

export const BARRY_TEXT = Object.freeze({
  pink: mixText(BRAND.pink, 60),     // >= 5.0:1
  purple: mixText(BRAND.purple, 60), // >= 4.9:1
  cyan: mixText(BRAND.cyan, 45),     // >= 4.7:1
});
