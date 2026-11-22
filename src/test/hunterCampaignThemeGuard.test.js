/**
 * Theme guard for the campaign workflow (#002.1 wizard, #002.2 detail).
 *
 * Both pages once hardcoded a light palette (bg-white, grey text, -400 tints),
 * which left dark themes with white pages and failed contrast in light ones.
 * They now use theme tokens: bg-[var(--…)], text-[color:var(--…)].
 *
 * Literal Tailwind colours are allowed only where they were checked:
 *   - the brand gradient pink-600 → purple-600, hover pink-700 → purple-700,
 *     and blue-600 / hover blue-700 — white labels are >= 4.5:1 at every stop;
 *   - translucent status tints (/20, /30) that sit under token-coloured text;
 *   - the dialog backdrop.
 * White labels are allowed only on those brand backgrounds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = ['pages/Hunter/CreateCampaign.jsx', 'pages/Hunter/CampaignDetail.jsx'];

const ALLOWED = new Set([
  'from-pink-600', 'to-purple-600', 'hover:from-pink-700', 'hover:to-purple-700',
  'bg-blue-600', 'hover:bg-blue-700',
  'text-white',
  'bg-black/50',
  'bg-green-500/20', 'border-green-500/30',
  'border-red-500/30', 'border-yellow-500/30',
]);

// A literal palette colour, or white/black/grey in any form.
const LITERAL = /(?:^|\s|['"`])((?:hover:|focus:|disabled:)?(?:bg|text|border|from|via|to|ring|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?)(?=\s|['"`]|$)/g;

const BRAND_BG = /from-pink-600|bg-blue-600/;

// Every string literal that looks like a class list (className="…", '…', `…`).
function classStrings(src) {
  const out = [];
  for (const m of src.matchAll(/className="([^"]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (/\b(?:bg|text|border|from|to)-/.test(s)) out.push(s);
  }
  return out;
}

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe.each(FILES)('%s stays on the theme', (file) => {
  const strings = classStrings(read(file));

  it('uses no unapproved literal colours', () => {
    const offenders = new Set();
    for (const s of strings) {
      for (const m of ` ${s} `.matchAll(LITERAL)) {
        if (!ALLOWED.has(m[1])) offenders.add(m[1]);
      }
    }
    expect([...offenders].sort()).toEqual([]);
  });

  it('puts white labels only on contrast-checked brand backgrounds', () => {
    const bad = strings.filter(s => /\btext-white\b/.test(s) && !BRAND_BG.test(s));
    expect(bad).toEqual([]);
  });

  it('does not use the old, low-contrast gradient or blue stops', () => {
    const src = read(file);
    expect(src).not.toMatch(/from-pink-500|hover:from-pink-600\b|bg-blue-500\b|hover:bg-blue-600\b/);
  });

  it('actually uses theme tokens for surfaces and text', () => {
    const src = read(file);
    expect(src).toMatch(/bg-\[var\(--bg-primary\)\]/);
    expect(src).toMatch(/text-\[color:var\(--text-primary\)\]/);
  });
});
