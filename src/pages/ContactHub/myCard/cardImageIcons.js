/**
 * The five detail icons of the My Card preview, as drawing instructions for a
 * canvas. The geometry is lucide's (the icons the preview itself shows), on
 * lucide's 24 × 24 grid, drawn with a 2-unit round stroke. Held here as data so
 * the card image needs no image file, no request and no new dependency.
 *
 *   path    an SVG path string (drawn with Path2D)
 *   rect    { x, y, w, h, r }
 *   circle  { cx, cy, r, fill? }
 *   dot     a filled round dot: { cx, cy }
 */
export const ICON_GRID = 24;
export const ICON_STROKE = 2;

export const CARD_ICONS = Object.freeze({
  email: Object.freeze([
    { path: 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7' },
    { rect: { x: 2, y: 4, w: 20, h: 16, r: 2 } },
  ]),
  phone: Object.freeze([
    { path: 'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384' },
  ]),
  linkedinUrl: Object.freeze([
    { path: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z' },
    { rect: { x: 2, y: 9, w: 4, h: 12, r: 0 } },
    { circle: { cx: 4, cy: 4, r: 2 } },
  ]),
  instagram: Object.freeze([
    { rect: { x: 2, y: 2, w: 20, h: 20, r: 5 } },
    { path: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z' },
    { dot: { cx: 17.5, cy: 6.5 } },
  ]),
  website: Object.freeze([
    { circle: { cx: 12, cy: 12, r: 10 } },
    { path: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' },
    { path: 'M2 12h20' },
  ]),
});

export default CARD_ICONS;
