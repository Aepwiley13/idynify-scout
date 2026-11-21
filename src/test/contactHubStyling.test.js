/* global process */
/**
 * Contact Hub's approved visual styling: the rules that are easy to undo by
 * accident and hard to notice when they are.
 *
 * jsdom has no layout or paint, so this holds the stylesheet rules in place.
 * They were checked in a browser at six screen sizes, in a light and a dark
 * theme, against the approved design.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bottomNavFor } from '../constants/mobileNavigation';
import { THEMES } from '../theme/tokens';

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (path) => strip(readFileSync(resolve(process.cwd(), path), 'utf8'));
const hubCss = read('src/pages/ContactHub/ContactHub.css');
const shellCss = read('src/components/layout/MainLayout.css');

/** The body of the first `@media (max-width: 768px)` block (phones). */
function phoneBlock() {
  const start = hubCss.indexOf('@media (max-width: 768px)');
  if (start < 0) return '';
  let depth = 0;
  for (let i = hubCss.indexOf('{', start); i < hubCss.length; i++) {
    if (hubCss[i] === '{') depth++;
    if (hubCss[i] === '}' && --depth === 0) return hubCss.slice(hubCss.indexOf('{', start) + 1, i);
  }
  return '';
}
const declarations = (block, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the room for the bottom bar on a phone', () => {
  // The shell keeps room for its bottom bar under every module. While Contact
  // Hub had no bar it took that room back with a negative margin. It has a bar
  // now, so the room is the bar's. The two must stay in step: a bar together
  // with that margin would cover the last rows of the list.
  const bar = bottomNavFor('contact-hub');
  const hasBar = Boolean(bar) && bar.hidden !== true && bar.primary.length > 0;
  const hub = declarations(phoneBlock(), '.hub');

  it('the shell still reserves 56px plus the home-indicator inset', () => {
    expect(shellCss).toMatch(/\.page-content\.page-content-full\s*\{\s*padding-bottom:\s*calc\(56px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });

  it('Contact Hub has a bottom bar', () => {
    expect(hasBar).toBe(true);
  });

  it('so Contact Hub does not take that room back: no negative margin anywhere in its stylesheet', () => {
    expect(hub).not.toMatch(/margin-bottom:\s*calc\(\s*-/);
    expect(hubCss).not.toMatch(/margin-bottom:\s*calc\(-56px/);
  });

  it('and the last row still has breathing space above the bar', () => {
    expect(hub).toMatch(/padding-bottom:\s*24px/);
  });
});

describe('on a phone the page is the app background and the list is the card', () => {
  const block = phoneBlock();

  it('paints the app background, from the shell\'s own theme variable', () => {
    expect(declarations(block, '.hub')).toMatch(/background:\s*var\(--bg-primary\)/);
  });

  it('keeps the page heading for screen readers without showing it twice', () => {
    const header = declarations(block, '.hub-header');
    expect(header).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(header).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  it('gives the list the card colours the component passes in', () => {
    const list = declarations(hubCss, '.hub-list');
    expect(list).toMatch(/background:\s*var\(--hub-card\)/);
    expect(list).toMatch(/border:\s*1px solid var\(--hub-border\)/);
  });
});

describe('the pink primary button stays readable', () => {
  const size = Number(declarations(hubCss, '.hub-primary-btn').match(/font-size:\s*(\d+)px/)?.[1]);
  const weight = Number(declarations(hubCss, '.hub-primary-btn').match(/font-weight:\s*(\d+)/)?.[1]);

  it('white on the brand pink passes only as large text', () => {
    const ratio = contrast('#ffffff', THEMES.workspace.accent);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
  });

  it('so its label is large text: bold and at least 19px', () => {
    expect(size).toBeGreaterThanOrEqual(19);
    expect(weight).toBeGreaterThanOrEqual(700);
  });
});

describe('text colours used on the list meet 4.5:1 in the light and dark themes', () => {
  // Dark-theme card and page colours are opaque; muted text is used for the
  // count, the subtitle, the date added and the search placeholder.
  it.each([
    ['workspace', 'cardBg'], ['workspace', 'appBg'], ['mission', 'cardBg'], ['mission', 'appBg'],
  ])('%s: text and muted text on %s', (themeId, surface) => {
    const T = THEMES[themeId];
    expect(contrast(T.text, T[surface])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(T.textMuted, T[surface])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('controls stay big enough to tap', () => {
  it.each([
    ['.hub-chip', /min-height:\s*44px/],
    ['.hub-primary-btn', /min-height:\s*48px/],
    ['.hub-icon-btn', /width:\s*44px;\s*height:\s*44px/],
    ['.hub-back', /min-height:\s*44px/],
  ])('%s', (selector, rule) => {
    expect(declarations(hubCss, selector)).toMatch(rule);
  });

  it('search is 52px on a phone and its text is 16px, so iOS does not zoom', () => {
    expect(declarations(hubCss, '.hub-search')).toMatch(/min-height:\s*52px/);
    expect(declarations(hubCss, '.hub-search input')).toMatch(/font-size:\s*16px/);
  });
});

describe('the desktop workspace', () => {
  it('the table and its rows set no overflow, so the sticker picker is never clipped', () => {
    for (const selector of ['.hub-table', '.hub-tr', '.hub-td']) {
      expect(declarations(hubCss, selector)).not.toMatch(/overflow(-x|-y)?\s*:/);
    }
  });

  it('a table row is positioned, so the name link can cover it and the picker can layer over later rows', () => {
    expect(declarations(hubCss, '.hub-tr')).toMatch(/position:\s*relative/);
    expect(hubCss).toMatch(/\.hub-row-stickers:has\(\.stk-picker--popover\)\s*\{\s*z-index:\s*2/);
  });

  it('the sticker column keeps its place in the table when a row has no sticker controls', () => {
    expect(declarations(hubCss, '.hub-table .hub-row-stickers:empty')).toMatch(/display:\s*block/);
    expect(declarations(hubCss, '.hub-table .hub-row-stickers')).toMatch(/grid-area:\s*auto/);
  });

  it('email and phone links sit above the row link, and long values wrap instead of being cut', () => {
    const link = declarations(hubCss, '.hub-td-link');
    expect(link).toMatch(/z-index:\s*1/);
    expect(link).toMatch(/overflow-wrap:\s*break-word/);
    expect(link).not.toMatch(/text-overflow|white-space:\s*nowrap/);
    // A long sticker name in the sidebar entries wraps too; it is not cut off.
    const stickerName = declarations(hubCss, '.hub-sidenav-name');
    expect(stickerName).toMatch(/overflow-wrap:\s*break-word/);
    expect(stickerName).not.toMatch(/text-overflow|white-space:\s*nowrap/);
  });

  it('the sidebar entries and the view buttons are comfortable targets', () => {
    // 36px, the height of the sidebar's own module items they sit under.
    expect(declarations(hubCss, '.hub-sidenav-item')).toMatch(/min-height:\s*36px/);
    expect(declarations(hubCss, '.hub-view-btn')).toMatch(/min-height:\s*44px/);
  });

  it('there is no inner panel left in the stylesheet', () => {
    expect(hubCss).not.toMatch(/\.hub-panel\b/);
    expect(hubCss).not.toMatch(/\.hub-workspace--panel\b/);
  });

  it('a long list of stickers in the sidebar scrolls on its own, so the modules below stay within reach', () => {
    const list = declarations(hubCss, '.hub-sidenav-list');
    expect(list).toMatch(/max-height:\s*min\(\s*38vh\s*,\s*300px\s*\)/);
    expect(list).toMatch(/overflow-y:\s*auto/);
    // Contact Hub's entries never position themselves: they sit in the sidebar's flow.
    expect(hubCss).not.toMatch(/\.hub-sidenav[^{]*\{[^}]*position:\s*(fixed|sticky|absolute)/);
  });
});
