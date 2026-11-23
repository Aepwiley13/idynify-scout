/**
 * #005.3 — Barry's colours are theme-aware and readable in all seven themes.
 *
 * The contrast check is computed, not asserted by hand: it parses every theme
 * block in src/index.css, resolves each BARRY_TEXT colour the way the browser
 * does (sRGB color-mix of the hue with that theme's --text-primary) and checks
 * it against the card, surface, page and secondary backgrounds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
import { BARRY_TEXT } from '../theme/barryColors';

const read = (p) => readFileSync(resolve(here, '..', p), 'utf8');

// ── theme parsing and WCAG maths ────────────────────────────────────────────
const themes = (() => {
  const out = {};
  for (const m of read('index.css').matchAll(/(:root|html\[data-theme="(\w+)"\])\s*\{([^}]*)\}/g)) {
    const name = m[2] || 'root';
    const toks = Object.fromEntries([...m[3].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()]));
    if (toks['--bg-card'] && !out[name]) out[name] = toks;
  }
  return out;
})();
const rgba = (v) => {
  if (v.startsWith('#')) {
    const h = v.slice(1);
    return { c: [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const p = v.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return { c: p.slice(0, 3), a: p[3] ?? 1 };
};
const tok = (t, k) => t[`--${k}`] ?? themes.root[`--${k}`];
const over = (fg, bg) => fg.c.map((x, i) => x * fg.a + bg[i] * (1 - fg.a));
const surface = (t, stack) => stack.slice(1).reduce((b, k) => over(rgba(tok(t, k)), b), rgba(tok(t, stack[0])).c);
const lum = (c) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const resolveMix = (value, t) => {
  const m = value.match(/color-mix\(in srgb, (#[0-9a-fA-F]{6}) (\d+)%, var\(--text-primary\)\)/);
  const hue = rgba(m[1]).c, text = rgba(tok(t, 'text-primary')).c, p = Number(m[2]) / 100;
  return hue.map((x, i) => x * p + text[i] * (1 - p));
};

const THEMES = Object.keys(themes).filter(n => n !== 'root');
const SURFACES = [['bg-card'], ['bg-card', 'surface'], ['bg-primary'], ['bg-secondary']];

describe('BARRY_TEXT contrast', () => {
  it('covers all seven themes', () => {
    expect(THEMES).toHaveLength(7);
  });
  it.each(Object.keys(BARRY_TEXT))('%s text is >= 4.5:1 on every surface of every theme', (hue) => {
    for (const name of THEMES) {
      for (const stack of SURFACES) {
        const r = ratio(resolveMix(BARRY_TEXT[hue], themes[name]), surface(themes[name], stack));
        expect(r, `${hue} on ${stack.join('+')} in ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('Barry components use theme-aware colour for text', () => {
  it.each([
    'components/barry/BarryResolutionPreview.jsx',
    'components/barry/BarryResultSet.jsx',
    'components/dashboard/BarryChatPanel.jsx',
    'components/recon/BarryReconCoach.jsx',
    'components/recon/BarryReconGuide.jsx',
  ])('%s: no raw brand hue as text colour', (file) => {
    expect(read(file)).not.toMatch(/(?<![a-zA-Z])color:\s*BRAND\.(pink|cyan|purple)\b/);
  });

  it('the recommendation card has no dark-only greys or -300 badge text', () => {
    const s = read('components/hunter/BarryRecommendationCard.jsx');
    expect(s).not.toMatch(/\btext-(gray-[2-6]00|(pink|purple|cyan|amber)-300)\b/);
    expect(s).not.toMatch(/\bbg-black\/90\b/);
  });

  it.each([
    'components/hunter/BarryReplyCard.css',
    'components/hunter/BarryInsightsCard.css',
    'components/barry/BarrySessionHistoryPanel.css',
  ])('%s: no light-only surfaces or grey text', (file) => {
    const s = read(file);
    expect(s).not.toMatch(/background:\s*#(ffffff|f9fafb|fdf2f8|f0fdf4|fef2f2|eff6ff|fffbeb)\b/i);
    expect(s).not.toMatch(/(?<![-\w])color:\s*#(374151|1f2937|4b5563|6b7280|9ca3af)\b/i);
  });

  it('the reply card primary button keeps white labels at >= 4.5:1 (rest and hover)', () => {
    const s = read('components/hunter/BarryReplyCard.css');
    expect(s).not.toMatch(/background:\s*#e8197d/i);
    for (const hex of ['#d1176f', '#be185d']) {
      expect(s).toContain(hex);
      expect(ratio([255, 255, 255], rgba(hex).c)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
