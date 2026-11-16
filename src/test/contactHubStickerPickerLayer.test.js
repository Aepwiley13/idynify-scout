/**
 * Contact Hub: the sticker picker opened from a list row must sit above the
 * rows below it.
 *
 * Every row's sticker cell and call/email cell is its own layer (z-index 1),
 * so they stay clickable above the link stretched over the row. Rows further
 * down are painted later, so without a rule raising the cell whose picker is
 * open, their chips and buttons showed through the picker and took its
 * clicks, including the "remove" on another person's sticker.
 *
 * Layering cannot be measured in jsdom (no layout, no paint order), so this
 * holds the rule in place. It was checked in a real browser at 1440, 1024 and
 * 800 wide on a top, middle and bottom row: nothing over the picker, every
 * option clickable across its full width.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ContactHub/ContactHub.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const shared = readFileSync(resolve(process.cwd(), 'src/components/stickers/stickers.css'), 'utf8');

function zIndexOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`(?:^|[},])\\s*(?:[^{}]*,\\s*)?${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`));
  const value = rule?.[1].match(/z-index:\s*(\d+)/);
  return value ? Number(value[1]) : null;
}

describe('sticker picker layering in the My People list', () => {
  it('the row cells are layered, which is what makes the rule necessary', () => {
    expect(zIndexOf('.hub-row-stickers')).toBe(1);
    expect(zIndexOf('.hub-row-actions')).toBe(1);
  });

  it('the cell whose picker is open is above every other row cell', () => {
    const raised = zIndexOf('.hub-row-stickers:has(.stk-picker--popover)');
    expect(raised).not.toBeNull();
    expect(raised).toBeGreaterThan(zIndexOf('.hub-row-stickers'));
    expect(raised).toBeGreaterThan(zIndexOf('.hub-row-actions'));
  });

  it('stays below the page-level layers: the Add Person dialog and its backdrop', () => {
    const raised = zIndexOf('.hub-row-stickers:has(.stk-picker--popover)');
    expect(raised).toBeLessThan(zIndexOf('.hub-dialog-backdrop'));
    expect(raised).toBeLessThan(zIndexOf('.hub-dialog'));
  });

  it('names the class the shared picker really uses', () => {
    expect(shared).toMatch(/\.stk-picker--popover\s*\{/);
  });
});
