/**
 * Contact Hub scrolls inside the shell.
 *
 * For every module except Mission Control the shell fixes the content area to
 * the height of the screen and does not scroll it (.page-content-full: a flex
 * column with overflow hidden). Each module provides its own scroll area.
 * Contact Hub did not, so everything below the first screen was cut off: most
 * of a long My People list, and a person's notes with their Save and Cancel.
 *
 * jsdom has no layout, so this holds the rules in place. They were checked in
 * a browser with the shell's real classes, on a phone and five desktop sizes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const hubCss = strip(readFileSync(resolve(process.cwd(), 'src/pages/ContactHub/ContactHub.css'), 'utf8'));
const shellCss = strip(readFileSync(resolve(process.cwd(), 'src/components/layout/MainLayout.css'), 'utf8'));

/** Declarations of the first top-level `.hub { … }` rule. */
function hubRule() {
  const rule = hubCss.match(/(?:^|\})\s*\.hub\s*\{([^}]*)\}/);
  return Object.fromEntries((rule?.[1] ?? '').split(';').map((d) => d.split(':').map((p) => p.trim())).filter((d) => d.length === 2));
}

describe('the shell does not scroll module content', () => {
  it('is still a fixed-height flex column with overflow hidden', () => {
    const rule = shellCss.match(/\.page-content\.page-content-full\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(shellCss).toMatch(/\.shell-fixed-height\s+\.main-content\s*\{[^}]*height:\s*100vh/);
  });
});

describe('so Contact Hub is its own scroll area', () => {
  const rule = hubRule();

  it('fills the space the shell gives it and may be shorter than its content', () => {
    expect(rule.flex).toBe('1 1 auto');
    expect(rule['min-height']).toBe('0');
  });

  it('scrolls down, and never sideways', () => {
    expect(rule['overflow-y']).toBe('auto');
    expect(rule['overflow-x']).toBe('hidden');
  });

  it('no wider-screen rule turns the scrolling back off', () => {
    const later = [...hubCss.matchAll(/\.hub\s*\{([^}]*)\}/g)].slice(1).map((m) => m[1]).join(';');
    expect(later).not.toMatch(/overflow|min-height|flex\s*:/);
  });
});
