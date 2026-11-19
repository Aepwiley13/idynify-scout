/* global process */
/**
 * The person header's stylesheet: the rules that are easy to undo by accident and hard to notice when they are.
 *
 * jsdom has no layout or paint, so this holds the stylesheet in place and works out the colours the
 * stylesheet will produce in every theme. How the header looks is checked in a browser, in the light and
 * dark themes at desktop, tablet and phone sizes (scripts/visual/person-header).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND } from '../theme/tokens';
import { STICKER_HEX, TINT_ALPHA } from '../components/stickers/stickerPalette';

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const root = (path) => resolve(process.cwd(), path);
const css = strip(readFileSync(root('src/components/contacts/personHeader/PersonHeader.css'), 'utf8'));
const indexCss = strip(readFileSync(root('src/index.css'), 'utf8'));

/** The declarations of every rule for a selector, wherever it sits (inside a container query too). */
const rules = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|[};{])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
};
const decl = (selector) => rules(selector).join(';');

/** The text of an @container block, by its condition. */
function container(condition) {
  const start = css.indexOf(`@container ph (${condition})`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(start, i + 1); }
  }
  return '';
}

// ─── Themes and colour ───────────────────────────────────────────────────────

function themeVars(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = indexCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const THEME_IDS = ['workspace', 'mission', 'navy', 'sand', 'darkSide', 'lightSide', 'theForce'];
const THEMES = Object.fromEntries(THEME_IDS.map((id) => [id, themeVars(`html[data-theme="${id}"]`)]));

const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
/** color-mix(in srgb, A pct%, B): the components mixed directly, as the browser does. */
const mix = (a, pct, b) => a.map((c, i) => c * (pct / 100) + b[i] * (1 - pct / 100));
const lum = ([r, g, b]) => {
  const [x, y, z] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
};
const contrast = (f, b) => { const [hi, lo] = [lum(f), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

describe('colour', () => {
  it('takes the card, its border and its text from the theme variables, in every theme', () => {
    for (const id of THEME_IDS) {
      for (const v of ['--bg-card', '--border', '--border-2', '--text-primary', '--text-secondary', '--shadow-card']) {
        expect(THEMES[id][v], `${id} ${v}`).toBeTruthy();
      }
    }
    const card = decl('.ph-card');
    expect(card).toMatch(/background:\s*var\(--bg-card\)/);
    expect(card).toMatch(/border:\s*1px solid var\(--border\)/);
    expect(card).toMatch(/var\(--shadow-card\)/);
    expect(decl('.ph-name')).toMatch(/color:\s*var\(--text-primary\)/);
    expect(decl('.ph-subtitle')).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(decl('.ph-location')).toMatch(/color:\s*var\(--text-secondary\)/);
    expect(decl('.ph-pill, .ph-social')).toMatch(/background:\s*var\(--bg-card\)/);
  });

  it('names only the colours it has to: white initials, the activity dots, the brand glow, and the fallbacks for a browser without color-mix', () => {
    const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0].replace(/\s+/g, ''));
    const allowed = new Set(['#fff', '#1d9e75', '#8a8a98', '#5b21b6', 'rgba(124,58,237,0.10)', 'rgba(124,58,237,0.16)', 'rgba(124,58,237,0.18)', 'rgba(124,58,237,0.07)']);
    for (const literal of literals) expect(allowed.has(literal), literal).toBe(true);
    expect(css).not.toMatch(/:\s*(?:white|black|red|blue|green|gray|grey|pink|purple)\b/i);
  });

  it('takes the brand purple and indigo from the design tokens, not from this file', () => {
    const source = readFileSync(root('src/components/contacts/personHeader/PersonHeader.jsx'), 'utf8');
    expect(source).toMatch(/'--ph-purple': BRAND\.purple/);
    expect(source).toMatch(/'--ph-indigo': BRAND\.indigo/);
    expect(css).not.toContain(BRAND.purple);
    expect(css).not.toContain(BRAND.indigo);
  });

  it('mixes the accent toward the theme\'s own text, so it reads on every theme (4.5:1 for its text and icons)', () => {
    expect(decl('.ph')).toMatch(/--ph-ink:\s*color-mix\(in srgb, var\(--ph-purple\) 60%, var\(--text-primary\)\)/);
    for (const id of THEME_IDS) {
      const vars = THEMES[id];
      const card = rgb(vars['--bg-card']);
      const ink = mix(rgb(BRAND.purple), 60, rgb(vars['--text-primary']));
      expect(contrast(ink, card), `${id}: accent on the card`).toBeGreaterThanOrEqual(4.5);
      // On the hover tints too (the pill under the pointer).
      expect(contrast(ink, mix(rgb(BRAND.purple), 9, card)), `${id}: accent on the hover tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink, mix(rgb(BRAND.purple), 16, card)), `${id}: accent on the stronger tint`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has a fallback accent deep enough for a light card where color-mix is not supported', () => {
    expect(contrast(rgb('#5b21b6'), rgb('#ffffff'))).toBeGreaterThanOrEqual(4.5);
    expect(decl('.ph')).toMatch(/--ph-ink:\s*#5b21b6/);
  });

  it('keeps the name, subtitle, location, pill text and sticker names readable on the card in every theme', () => {
    for (const id of THEME_IDS) {
      const vars = THEMES[id];
      const card = rgb(vars['--bg-card']);
      expect(contrast(rgb(vars['--text-primary']), card), `${id}: primary text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(vars['--text-secondary']), card), `${id}: secondary text`).toBeGreaterThanOrEqual(4.5);
      // A sticker's name is the theme's text on a light tint of the sticker's colour (the existing chips' tint).
      const alpha = parseInt(TINT_ALPHA, 16) / 255;
      for (const [color, hex] of Object.entries(STICKER_HEX)) {
        expect(contrast(rgb(vars['--text-primary']), mix(rgb(hex), alpha * 100, card)), `${id}: ${color} sticker`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps white initials readable on both ends of the photo-less avatar', () => {
    for (const end of [BRAND.indigo, BRAND.purple]) expect(contrast([255, 255, 255], rgb(end)), end).toBeGreaterThanOrEqual(4.5);
    expect(decl('.ph-avatar')).toMatch(/linear-gradient\(135deg, var\(--ph-indigo\), var\(--ph-purple\)\)/);
    expect(decl('.ph-avatar')).toMatch(/color:\s*#fff/);
  });
});

// ─── Touch targets and focus ─────────────────────────────────────────────────

describe('controls', () => {
  it('makes every pill and profile link 44px to hit, each way', () => {
    expect(decl('.ph-pill, .ph-social')).toMatch(/min-height:\s*44px/);
    expect(decl('.ph-social')).toMatch(/width:\s*44px/);
  });

  it('shows where the keyboard is, and never removes an outline', () => {
    expect(decl('.ph-pill:focus-visible, .ph-social:focus-visible')).toMatch(/outline:\s*2px solid var\(--ph-ink\)/);
    expect(decl('.ph-pill:focus-visible, .ph-social:focus-visible')).toMatch(/outline-offset:\s*2px/);
    expect(css).not.toMatch(/outline:\s*(?:none|0)\b/);
    expect(css).not.toMatch(/outline-width:\s*0/);
  });

  it('keeps the focus ring visible against the card in every theme (3:1)', () => {
    for (const id of THEME_IDS) {
      const vars = THEMES[id];
      const ink = mix(rgb(BRAND.purple), 60, rgb(vars['--text-primary']));
      expect(contrast(ink, rgb(vars['--bg-card'])), id).toBeGreaterThanOrEqual(3);
    }
  });

  it('only animates when the person has not asked for less motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*transition/);
    expect(css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\}\s*\}/, '')).not.toMatch(/transition|animation/);
  });
});

// ─── Layout ──────────────────────────────────────────────────────────────────

describe('layout', () => {
  it('follows the header\'s own width, not the screen\'s: a container, with a tablet and a desktop step', () => {
    expect(decl('.ph')).toMatch(/container-type:\s*inline-size/);
    expect(decl('.ph')).toMatch(/container-name:\s*ph/);
    expect(container('min-width: 540px')).not.toBe('');
    expect(container('min-width: 820px')).not.toBe('');
    expect(css).not.toMatch(/@media \((?:min|max)-width/);
  });

  it('sizes the photo 76px on a phone, 96px on a tablet, 112px on a desktop, set where a container query can reach it', () => {
    expect(decl('.ph-card')).toMatch(/--ph-avatar:\s*76px/);
    expect(container('min-width: 540px')).toMatch(/--ph-avatar:\s*96px/);
    expect(container('min-width: 820px')).toMatch(/--ph-avatar:\s*112px/);
    // The container cannot style itself: the variable is never set on .ph inside a container query.
    expect(container('min-width: 540px')).not.toMatch(/\s\.ph\s*\{/);
    expect(container('min-width: 820px')).not.toMatch(/\s\.ph\s*\{/);
    expect(decl('.ph-avatar-wrap')).toMatch(/width:\s*var\(--ph-avatar\)/);
  });

  it('sizes the name 24px, 28px and 32px, and the desktop name is prominent', () => {
    expect(decl('.ph-name')).toMatch(/font-size:\s*24px/);
    expect(container('min-width: 540px')).toMatch(/\.ph-name\s*\{\s*font-size:\s*28px/);
    expect(container('min-width: 820px')).toMatch(/\.ph-name\s*\{\s*font-size:\s*32px/);
    expect(decl('.ph-name')).toMatch(/font-weight:\s*800/);
  });

  it('draws a layout for each combination of optional rows, at every size, so a missing row leaves no gap', () => {
    for (const layout of ['c1s0', 'c0s1', 'c0s0']) {
      expect(decl(`.ph-card[data-layout="${layout}"]`), `phone ${layout}`).toMatch(/grid-template-areas/);
      expect(container('min-width: 540px'), `tablet ${layout}`).toContain(`[data-layout="${layout}"]`);
      expect(container('min-width: 820px'), `desktop ${layout}`).toContain(`[data-layout="${layout}"]`);
    }
    // The phone: avatar beside the identity, the ways to reach them and the stickers below, each across the card.
    expect(decl('.ph-card')).toMatch(/grid-template-areas:\s*"avatar identity" "contacts contacts" "stickers stickers"/);
    // The tablet: contacts under the identity, stickers across the foot.
    expect(container('min-width: 540px')).toMatch(/grid-template-areas:\s*"avatar identity" "avatar contacts" "stickers stickers"/);
    // The desktop: stickers at the top right.
    expect(container('min-width: 820px')).toMatch(/grid-template-areas:\s*"avatar identity stickers" "avatar contacts contacts"/);
  });

  it('puts the phone and email full width on a phone, and side by side where there is room', () => {
    expect(decl('.ph-contact:not(.ph-contact--social)')).toMatch(/flex:\s*1 1 100%/);
    expect(container('min-width: 540px')).toMatch(/\.ph-contact:not\(\.ph-contact--social\)\s*\{\s*flex:\s*0 1 auto/);
  });

  it('shortens nothing in the page: it fits long text by wrapping and clamping what the eye sees', () => {
    for (const selector of ['.ph-name', '.ph-subtitle', '.ph-location-text']) {
      expect(decl(selector), selector).toMatch(/overflow-wrap:\s*anywhere/);
      expect(decl(selector), selector).toMatch(/-webkit-line-clamp:\s*[23]/);
      expect(decl(selector), selector).toMatch(/(?:^|;|\s)line-clamp:\s*[23]/);
      expect(decl(selector), selector).toMatch(/overflow:\s*hidden/);
    }
    expect(decl('.ph-name')).toMatch(/-webkit-line-clamp:\s*3/);
    expect(decl('.ph-subtitle')).toMatch(/-webkit-line-clamp:\s*2/);
    expect(decl('.ph-pill-text')).toMatch(/text-overflow:\s*ellipsis/);
    expect(decl('.ph-pill-text')).toMatch(/min-width:\s*0/);
    expect(decl('.ph-sticker-name')).toMatch(/text-overflow:\s*ellipsis/);
    expect(decl('.ph-sticker')).toMatch(/max-width:\s*100%/);
  });

  it('lets every part shrink inside the card, so nothing pushes the page sideways', () => {
    for (const selector of ['.ph-identity', '.ph-contacts', '.ph-stickers', '.ph-sticker']) expect(decl(selector), selector).toMatch(/min-width:\s*0/);
    expect(decl('.ph-card')).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/);
    expect(decl('.ph-pill')).toMatch(/max-width:\s*100%/);
    expect(css).not.toMatch(/overflow-x:\s*scroll|overflow:\s*scroll/);
  });

  it('stacks the title over the organization on a phone, and puts them on one line with a dot where there is room', () => {
    expect(decl('.ph-subtitle-part')).toMatch(/display:\s*block/);
    expect(decl('.ph-sep')).toMatch(/display:\s*none/);
    expect(container('min-width: 540px')).toMatch(/\.ph-subtitle-part\s*\{\s*display:\s*inline/);
    expect(container('min-width: 540px')).toMatch(/\.ph-sep\s*\{\s*display:\s*inline/);
  });

  it('keeps text left-aligned whatever its direction, so a right-to-left name sits with the rest of the card', () => {
    for (const selector of ['.ph-name', '.ph-subtitle', '.ph-location-text']) expect(decl(selector), selector).toMatch(/text-align:\s*left/);
  });

  it('is a card: rounded, bordered and softly lifted', () => {
    expect(decl('.ph-card')).toMatch(/border-radius:\s*22px/);
    expect(container('min-width: 820px')).toMatch(/border-radius:\s*24px/);
    expect(decl('.ph-card')).toMatch(/box-shadow/);
  });
});
