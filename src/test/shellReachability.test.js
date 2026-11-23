/**
 * #004.1 — every action reachable inside the fixed-height shell.
 *
 * Module routes render into a fixed-height shell: `.shell-fixed-height` pins
 * `.main-content` to 100vh and `.page-content-full` is `overflow: hidden`, so a
 * page must scroll itself. #831 fixed the campaign pages, #832 the mission
 * pages; this covers Total Market, Scout Game and the Cadences list/detail.
 *
 *   - Total Market, Scout Game: centred max-width roots, wrapped in a full-width
 *     scroll container (widths unchanged). Their CSS fills that area with
 *     min-height: 100% instead of 100vh, which was taller than the area and
 *     made every visit scroll by the top bar's height.
 *   - Cadences list/detail: already `flex: 1; overflow-y: auto`, but
 *     `minHeight: 100dvh` made them taller than the area, so the bottom
 *     49–80px was clipped. Now `minHeight: 0`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const WRAP = '<div className="flex-1 min-h-0 overflow-y-auto">';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe.each([
  ['pages/Scout/TotalMarket.jsx', ['total-market-loading', 'total-market']],
  ['pages/Scout/ScoutGame.jsx', ['scout-game-page', 'scout-game-page']],
])('%s: page roots sit inside a scroll container', (file, roots) => {
  it('wraps every top-level page root', () => {
    const s = src(file);
    for (const root of new Set(roots)) {
      const all = s.match(new RegExp(`<div className="${root}">`, 'g')) || [];
      const wrapped = s.match(new RegExp(`${esc(WRAP)}\\s*<div className="${root}">`, 'g')) || [];
      expect(all.length).toBe(roots.filter(r => r === root).length);
      expect(wrapped.length).toBe(all.length);
    }
  });
});

describe.each([
  ['pages/Scout/TotalMarket.css', '.total-market {'],
  ['pages/Scout/ScoutGame.css', '.scout-game-page {'],
])('%s fills the scroll area instead of the viewport', (file, selector) => {
  it('uses min-height: 100%, not 100vh', () => {
    const s = src(file);
    const block = s.slice(s.indexOf(selector), s.indexOf('}', s.indexOf(selector)));
    expect(block).toMatch(/min-height:\s*100%/);
    expect(block).not.toMatch(/min-height:\s*100(vh|dvh)/);
  });
});

describe.each(['pages/Scout/CadencesList.jsx', 'pages/Scout/CadenceDetail.jsx'])(
  '%s is not taller than the shell', (file) => {
    it('has no viewport-height minimums on its roots', () => {
      expect(src(file)).not.toMatch(/minHeight:\s*'100(vh|dvh)'/);
    });
    it('main view still scrolls itself', () => {
      expect(src(file)).toMatch(/flex: 1,[^}]*minHeight: 0, overflowY: 'auto'/s);
    });
  }
);
