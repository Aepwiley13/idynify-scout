/**
 * The My Card image: the card as a PNG, drawn the way the preview draws it.
 *
 *   renderCardImage(card, { theme })   → { ok: true, blob, fileName, width, height, photo }
 *                                      | { ok: false, reason }
 *
 * WHAT IS ON IT is what publicCardView(card) says: the card's own privacy rule,
 * applied to the card as handed over (an unsaved draft included). The renderer
 * reads nothing but that view, so a Private field is never available to draw,
 * whatever the editor holds. The same view gives the file name.
 *
 * LAYOUT AND DRAWING ARE APART. layoutCardImage turns the view into a plain list
 * of things to draw, given only a way to measure text, so every wrapping, size
 * and ordering decision is testable without a canvas. drawCardImage paints that
 * list. renderCardImage joins them to a real canvas through `platform`.
 *
 * IT MAKES NO REQUEST AND WRITES NOTHING. The only picture it will draw is a
 * profile photo kept in the card (a JPEG data URL that passes the same check the
 * card applies to it); a photo that is a link is not fetched, and the initials are
 * drawn instead, so the canvas can never be tainted by another site's picture.
 * Text is drawn with the fonts the page already has (it waits for them, and asks
 * for none), and the icons are drawn from path data. No dependency, no storage.
 *
 * THE SIZE: 1080 px wide, which is the preview's 400 px reference width at 2.7×;
 * every measure below is the stylesheet's, scaled by that. Tall as the content
 * needs, never shorter than square. Full-bleed (no rounded corners, no
 * transparency), so it looks the same in any viewer.
 *
 * KNOWN LIMITS: text runs left to right (a right-to-left name is drawn in order
 * but not shaped as it would be on the page's own layout); the stored photo is
 * 320 px, so on the image it is drawn at about its own size.
 */
import { publicCardView } from '../../../utils/myCardRules';
import { inspectPhotoDataUrl } from '../../../utils/photoPrep';
import { myCardVCardFileName } from '../../../utils/vcard';
import { BRAND, THEMES } from '../../../theme/tokens';
import { readableLink } from './cardDraft';
import { CARD_ICONS, ICON_GRID, ICON_STROKE } from './cardImageIcons';

// ─── Measures: the stylesheet's, at 2.7× ─────────────────────────────────────

export const IMAGE_WIDTH = 1080;
const SCALE = IMAGE_WIDTH / 400;
const px = (css) => Math.round(css * SCALE);

export const MIN_IMAGE_HEIGHT = IMAGE_WIDTH; // never shorter than square

const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const font = (weight, size) => `${weight} ${size}px ${FONT_FAMILY}`;

const BANNER_H = px(128);
const AVATAR_D = px(112);
const AVATAR_RING = px(5);
const AVATAR_OVERLAP = px(56);
const BODY_PAD = px(24);
const HEADER_LEFT = px(20);
const HEADER_TOP = px(16);
const HEADER_MAX_W = IMAGE_WIDTH - px(96);
const NAME_SIZES = Object.freeze([px(28), px(23), px(18.5), px(15.5)]);
const NAME_MAX_LINES = 3;
const TITLE_SIZE = px(17);
const TITLE_MAX_LINES = 3;
const ROW_SIZE = px(15);
// An address can be 254 characters: room for all of it, and a long page of image is better than a cut address.
const ROW_MAX_LINES = 6;
const ICON_CIRCLE = px(32);
const ICON_SIZE = px(16);
const MADE_SIZE = px(12);

/** The card is IDYNIFY-branded in every theme; only the card's own surface and text follow the theme. */
const PALETTES = Object.freeze({
  light: Object.freeze({ card: THEMES.workspace.cardBg, text: THEMES.workspace.text, muted: THEMES.workspace.textMuted, border: THEMES.workspace.border, accentBg: THEMES.workspace.accentBg }),
  dark: Object.freeze({ card: THEMES.mission.cardBg, text: THEMES.mission.text, muted: THEMES.mission.textMuted, border: THEMES.mission.border, accentBg: THEMES.mission.accentBg }),
});
const ON_BRAND = '#ffffff';

/** The header when there is no organization to show: the same neutral words as the preview. */
export const HEADER_FALLBACK = 'Contact card';

// ─── Text: breaking lines ────────────────────────────────────────────────────

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SOFT_BREAK_AFTER = new Set(['/', '@', '.', '-', '_']);

function graphemesOf(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/** Where a line may break: after a space, after / @ . - _, and between any two CJK characters. */
function tokensOf(text) {
  const tokens = [];
  let current = '';
  const flush = () => { if (current) { tokens.push(current); current = ''; } };
  for (const g of graphemesOf(text)) {
    if (/^\s+$/u.test(g)) { flush(); tokens.push(' '); continue; }
    if (CJK.test(g)) { flush(); tokens.push(g); continue; }
    current += g;
    if (SOFT_BREAK_AFTER.has(g)) flush();
  }
  flush();
  return tokens;
}

/** Cuts `text` to what fits in `maxWidth` with an ellipsis after it. */
function ellipsize(text, maxWidth, fontSpec, measure) {
  const parts = graphemesOf(text.trimEnd());
  while (parts.length > 0 && measure(`${parts.join('')}…`, fontSpec) > maxWidth) parts.pop();
  return `${parts.join('').trimEnd()}…`;
}

/**
 * `text` as lines no wider than `maxWidth`: broken at the places above, and
 * inside a single word only when that word alone is wider than a line. At most
 * `maxLines`; what does not fit is replaced by an ellipsis on the last line.
 *
 * @returns {{ lines: string[], truncated: boolean }}
 */
export function wrapText(text, maxWidth, fontSpec, measure, maxLines = Infinity) {
  const lines = [];
  let line = '';
  const fits = (candidate) => measure(candidate.trimEnd(), fontSpec) <= maxWidth;
  const place = (token) => {
    // A token wider than a whole line is cut between characters.
    for (const g of graphemesOf(token)) {
      if (line === '' || fits(line + g)) { line += g; } else { lines.push(line.trimEnd()); line = g; }
    }
  };
  for (const token of tokensOf(String(text ?? ''))) {
    if (token === ' ') { if (line !== '') line += ' '; continue; }
    if (fits(line + token)) { line += token; continue; }
    if (line.trim() !== '') { lines.push(line.trimEnd()); line = ''; }
    if (fits(token)) line = token; else place(token);
  }
  if (line.trim() !== '') lines.push(line.trimEnd());

  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxWidth, fontSpec, measure);
  return { lines: kept, truncated: true };
}

// ─── Layout ──────────────────────────────────────────────────────────────────

/** The detail rows of a view, in the preview's order, as { icon, text }. */
export function detailRows(view) {
  const rows = [];
  if (view.email) rows.push({ icon: 'email', text: view.email });
  if (view.phone) rows.push({ icon: 'phone', text: view.phone });
  if (view.linkedinUrl) rows.push({ icon: 'linkedinUrl', text: readableLink(view.linkedinUrl) });
  if (view.instagram) rows.push({ icon: 'instagram', text: `@${view.instagram}` });
  if (view.website) rows.push({ icon: 'website', text: readableLink(view.website) });
  return rows;
}

/**
 * Everything to draw, and how big the image is, for a card's public view.
 *
 * @param {object} view  publicCardView(card), and nothing else
 * @param {{ measure: (text: string, font: string) => number, theme?: 'light'|'dark', photo?: boolean }} options
 *        `photo`: a photo is available to draw (otherwise the initials are)
 */
export function layoutCardImage(view, { measure, theme = 'light', photo = false }) {
  const palette = PALETTES[theme] ?? PALETTES.light;
  const ops = [];
  const centre = IMAGE_WIDTH / 2;

  // Header: the organization, or the neutral words.
  ops.push({ type: 'banner', x: 0, y: 0, w: IMAGE_WIDTH, h: BANNER_H });
  if (view.organization) {
    const spec = font(700, px(15));
    const { lines } = wrapText(view.organization, HEADER_MAX_W, spec, measure, 2);
    const lineH = Math.round(px(15) * 1.25);
    lines.forEach((text, i) => ops.push({ type: 'text', role: 'header', text, x: HEADER_LEFT, y: HEADER_TOP + i * lineH + lineH / 2, font: spec, color: ON_BRAND, align: 'left' }));
  } else {
    ops.push({ type: 'text', role: 'header', text: HEADER_FALLBACK, x: HEADER_LEFT, y: HEADER_TOP + px(12) / 2, font: font(800, px(12)), color: ON_BRAND, align: 'left', spacing: '0.22em' });
  }

  // The photo, or the initials, rising over the banner.
  const avatarTop = BANNER_H - AVATAR_OVERLAP;
  const avatarCy = avatarTop + AVATAR_D / 2;
  ops.push({ type: 'avatar', cx: centre, cy: avatarCy, r: AVATAR_D / 2, ring: AVATAR_RING, photo, initials: view.initials, font: font(700, px(40)) });
  let y = avatarTop + AVATAR_D + px(14);

  // The name: as large as fits in three lines, else smaller, else cut.
  const nameW = IMAGE_WIDTH - 2 * BODY_PAD;
  let name = null;
  for (const size of NAME_SIZES) {
    const spec = font(800, size);
    const wrapped = wrapText(view.name, nameW, spec, measure, NAME_MAX_LINES);
    name = { size, spec, ...wrapped };
    if (!wrapped.truncated) break;
  }
  const nameLineH = Math.round(name.size * 1.15);
  name.lines.forEach((text, i) => ops.push({ type: 'text', role: 'name', text, x: centre, y: y + i * nameLineH + nameLineH / 2, font: name.spec, color: palette.text, align: 'center' }));
  y += name.lines.length * nameLineH;

  if (view.title) {
    y += px(4);
    const spec = font(600, TITLE_SIZE);
    const { lines } = wrapText(view.title, nameW, spec, measure, TITLE_MAX_LINES);
    const lineH = Math.round(TITLE_SIZE * 1.3);
    lines.forEach((text, i) => ops.push({ type: 'text', role: 'title', text, x: centre, y: y + i * lineH + lineH / 2, font: spec, color: palette.text, align: 'center' }));
    y += lines.length * lineH;
  }

  // The details, after a rule.
  const rows = detailRows(view);
  if (rows.length > 0) {
    y += px(20);
    ops.push({ type: 'rule', x: BODY_PAD, y, w: IMAGE_WIDTH - 2 * BODY_PAD, h: Math.max(2, px(1)), color: palette.border });
    y += px(1) + px(14);
    const textX = BODY_PAD + ICON_CIRCLE + px(12);
    const textW = IMAGE_WIDTH - BODY_PAD - textX;
    const spec = font(400, ROW_SIZE);
    const lineH = Math.round(ROW_SIZE * 1.35);
    rows.forEach((row, index) => {
      const { lines } = wrapText(row.text, textW, spec, measure, ROW_MAX_LINES);
      const rowH = Math.max(px(40), lines.length * lineH);
      const mid = y + rowH / 2;
      ops.push({ type: 'iconCircle', cx: BODY_PAD + ICON_CIRCLE / 2, cy: mid, r: ICON_CIRCLE / 2, color: palette.accentBg });
      ops.push({ type: 'icon', name: row.icon, x: BODY_PAD + (ICON_CIRCLE - ICON_SIZE) / 2, y: mid - ICON_SIZE / 2, size: ICON_SIZE, color: BRAND.pink });
      const top = mid - (lines.length * lineH) / 2;
      lines.forEach((text, i) => ops.push({ type: 'text', role: 'detail', text, x: textX, y: top + i * lineH + lineH / 2, font: spec, color: palette.text, align: 'left' }));
      y += rowH + (index < rows.length - 1 ? px(2) : 0);
    });
  }

  // The attribution closes the card.
  const madeH = Math.round(MADE_SIZE * 1.2);
  const contentBottom = y + px(18) + madeH + BODY_PAD;
  const height = Math.max(MIN_IMAGE_HEIGHT, contentBottom);
  ops.push({ type: 'text', role: 'attribution', text: 'Made with IDYNIFY', x: centre, y: height - BODY_PAD - madeH / 2, font: font(400, MADE_SIZE), color: palette.muted, align: 'center' });

  return { width: IMAGE_WIDTH, height, background: palette.card, ops };
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

/** A CSS `linear-gradient(135deg, …)` over a box: the line through its centre at 45°, as long as the box needs. */
function diagonal(ctx, w, h) {
  const half = (w + h) * Math.SQRT1_2 / 2;
  const d = Math.SQRT1_2;
  return ctx.createLinearGradient(w / 2 - d * half, h / 2 - d * half, w / 2 + d * half, h / 2 + d * half);
}

function drawBanner(ctx, { x, y, w, h }) {
  ctx.save();
  ctx.translate(x, y);
  const base = diagonal(ctx, w, h);
  base.addColorStop(0, BRAND.navy);
  base.addColorStop(0.55, BRAND.indigo);
  base.addColorStop(1, BRAND.purple);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // The pink glow: an ellipse 120% × 150% of the box, centred on the top right corner.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.translate(w, 0);
  ctx.scale(1.2 * w, 1.5 * h);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, BRAND.pink);
  glow.addColorStop(0.58, `${BRAND.pink}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(-1, 0, 1, 1);
  ctx.restore();
  ctx.restore();
}

function drawAvatar(ctx, op, background, photo) {
  const { cx, cy, r, ring } = op;
  ctx.beginPath();
  ctx.arc(cx, cy, r + ring, 0, Math.PI * 2);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (op.photo && photo) {
    ctx.drawImage(photo.source, 0, 0, photo.width, photo.height, cx - r, cy - r, r * 2, r * 2);
  } else {
    const fill = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    fill.addColorStop(0, BRAND.indigo);
    fill.addColorStop(1, BRAND.pink);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = ON_BRAND;
    ctx.font = op.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(op.initials, cx, cy + 2);
  }
  ctx.restore();
}

function drawIcon(ctx, op) {
  const parts = CARD_ICONS[op.name] ?? [];
  const k = op.size / ICON_GRID;
  ctx.save();
  ctx.translate(op.x, op.y);
  ctx.scale(k, k);
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = ICON_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const part of parts) {
    if (part.path) {
      ctx.stroke(new Path2D(part.path));
    } else if (part.rect) {
      const { x, y, w, h, r } = part.rect;
      ctx.beginPath();
      if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
      ctx.stroke();
    } else if (part.circle) {
      ctx.beginPath();
      ctx.arc(part.circle.cx, part.circle.cy, part.circle.r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (part.dot) {
      ctx.beginPath();
      ctx.arc(part.dot.cx, part.dot.cy, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Paints a layout onto a 2D context (the canvas is already `layout.width` × `layout.height`). `photo`: { source, width, height } or null. */
export function drawCardImage(ctx, layout, photo = null) {
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const op of layout.ops) {
    switch (op.type) {
      case 'banner': drawBanner(ctx, op); break;
      case 'avatar': drawAvatar(ctx, op, layout.background, photo); break;
      case 'rule':
        ctx.fillStyle = op.color;
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case 'iconCircle':
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fillStyle = op.color;
        ctx.fill();
        break;
      case 'icon': drawIcon(ctx, op); break;
      case 'text':
        ctx.font = op.font;
        ctx.fillStyle = op.color;
        ctx.textAlign = op.align;
        ctx.textBaseline = 'middle';
        if ('letterSpacing' in ctx) ctx.letterSpacing = op.spacing ?? '0px';
        ctx.fillText(op.text, op.x, op.y);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        break;
      default: break;
    }
  }
}

// ─── The file name ───────────────────────────────────────────────────────────

/**
 * "Ada_Lovelace_card.png", or "IDYNIFY_card.png" when the name leaves nothing safe.
 * The base is the contact file's own (letters and digits of any script, joined by
 * underscores, at most 60, never a name a computer reserves), so the two downloads
 * are named by one rule and cannot drift.
 */
export function cardImageFileName(card) {
  const base = myCardVCardFileName(card).replace(/\.vcf$/, '');
  return base === 'contact' ? 'IDYNIFY_card.png' : `${base}_card.png`;
}

// ─── The real browser ────────────────────────────────────────────────────────

export const browserCardImagePlatform = Object.freeze({
  createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  /** A data URL decoded into a picture. A data URL needs no request, and cannot taint the canvas. */
  async loadImage(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  },
  /** The page's own fonts, once they are ready. Nothing is asked for: a font the page has not loaded is not fetched. */
  async fontsReady() {
    try { await document.fonts?.ready; } catch { /* the system font is used */ }
  },
  toBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))), 'image/png');
    });
  },
  release(canvas) {
    canvas.width = 0;
    canvas.height = 0;
  },
});

export const CARD_IMAGE_ERRORS = Object.freeze({ NO_NAME: 'no-name', RENDER_FAILED: 'render-failed' });

/**
 * The card as a PNG. Never throws: a failure is { ok: false, reason }.
 * `card`: the card as it stands (a draft is fine); only its public view is used.
 *
 * @param {object} card
 * @param {{ theme?: 'light'|'dark', platform?: typeof browserCardImagePlatform }} [options]
 */
export async function renderCardImage(card, { theme = 'light', platform = browserCardImagePlatform } = {}) {
  const view = publicCardView(card);
  if (!view) return { ok: false, reason: CARD_IMAGE_ERRORS.NO_NAME };

  let canvas = null;
  let measureCanvas = null;
  try {
    await platform.fontsReady();

    // A photo kept in the card, and only that: a link is never fetched, and the initials are drawn.
    let photo = null;
    if (view.photoUrl && inspectPhotoDataUrl(view.photoUrl).ok) {
      try { photo = await platform.loadImage(view.photoUrl); } catch { photo = null; }
    }

    measureCanvas = platform.createCanvas(1, 1);
    const measureCtx = measureCanvas.getContext('2d');
    const measure = (text, spec) => { measureCtx.font = spec; return measureCtx.measureText(text).width; };

    const layout = layoutCardImage(view, { measure, theme, photo: photo !== null });
    canvas = platform.createCanvas(layout.width, layout.height);
    drawCardImage(canvas.getContext('2d'), layout, photo);
    const blob = await platform.toBlob(canvas);
    return { ok: true, blob, fileName: cardImageFileName(card), width: layout.width, height: layout.height, photo: photo !== null };
  } catch {
    return { ok: false, reason: CARD_IMAGE_ERRORS.RENDER_FAILED };
  } finally {
    if (canvas) platform.release(canvas);
    if (measureCanvas) platform.release(measureCanvas);
  }
}
