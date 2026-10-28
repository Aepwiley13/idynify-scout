/**
 * Phone widths: nothing on the contact profile may make the page wider than
 * the screen. `.page-content` scrolls sideways when anything inside it is
 * wider, and the top bar widens the whole document, so each root cause found
 * at 375–430px is pinned here: the stage row scrolls on its own, the top bar's
 * left side shrinks, the engagement header wraps, long values wrap, and a
 * closed drawer is hidden. (jsdom does no layout: these pin the rules, and the
 * PR records the measured widths.)
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';

vi.mock('../theme/ThemeContext', () => ({ useT: () => ({ surface: '#fafafa', border: '#ddd', textMuted: '#555' }) }));
const { default: StageTabBar } = await import('../components/contacts/StageTabBar');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const css = path => readFileSync(resolve(repo, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the first rule for `selector` inside `scope` (a file's text or one @media block). */
const rule = (text, selector) => {
  const at = text.indexOf(`${selector} {`);
  expect(at, `${selector} is defined`).toBeGreaterThanOrEqual(0);
  return text.slice(at, text.indexOf('}', at));
};
/** The bodies of every `@media (query)` block in a file, braces matched. */
const media = (text, query) => {
  const bodies = [];
  for (let at = text.indexOf(`@media (${query})`); at !== -1; at = text.indexOf(`@media (${query})`, at + 1)) {
    const open = text.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      if (text[i] === '}' && --depth === 0) { bodies.push(text.slice(open + 1, i)); break; }
    }
  }
  return bodies.join('\n');
};

describe('the contact profile fits a phone', () => {
  it('the five stage tabs scroll inside their own row instead of widening the page', () => {
    render(<StageTabBar contact={{ stage: 'scout' }} previewStage={null} onPreviewChange={() => {}} />);
    const tab = screen.getByRole('button', { name: /Reinforcements/ });
    expect(tab.parentElement.style.overflowX).toBe('auto');
    expect(tab.parentElement.style.minWidth).toBe('0px');
    expect(tab.style.whiteSpace).toBe('nowrap');
    expect(tab.style.minWidth).toBe('max-content');
  });

  it('the top bar\'s left side can shrink, so a long name never pushes its icons off the screen', () => {
    const shell = css('src/components/layout/MainLayout.css');
    expect(rule(shell, '.top-bar-left')).toMatch(/min-width:\s*0/);
    expect(rule(shell, '.top-bar-right')).toMatch(/flex-shrink:\s*0/);
  });

  it('the engagement header and its buttons wrap; on a phone the buttons share the card\'s width', () => {
    const ies = css('src/components/contacts/InlineEngagementSection.css');
    expect(rule(ies, '.ies-section-header')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(ies, '.ies-section-header-actions')).toMatch(/flex-wrap:\s*wrap/);
    const phone = media(ies, 'max-width: 480px');
    expect(rule(phone, '.ies-section-header-actions')).toMatch(/width:\s*100%/);
    expect(rule(phone, '.ies-section-header-actions .ies-start-btn')).toMatch(/white-space:\s*normal/);
  });

  it('a long email, number or profile wraps on a phone instead of being cut short', () => {
    const phone = media(css('src/components/contacts/IdentityCard.css'), 'max-width: 480px');
    const values = rule(phone, '.idc-entry-val,\n  .idc-detail-val');
    expect(values).toMatch(/white-space:\s*normal/);
    expect(values).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('a closed session-history drawer is hidden, so its shadow does not show along the page\'s edge', () => {
    const drawer = css('src/components/barry/BarrySessionHistoryPanel.css');
    expect(rule(drawer, '.bsh-drawer')).toMatch(/visibility:\s*hidden/);
    expect(rule(drawer, '.bsh-drawer.open')).toMatch(/visibility:\s*visible/);
  });
});
