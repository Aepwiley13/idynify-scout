/**
 * Phone widths: nothing on the contact profile may make the page wider than
 * the screen. `.page-content` scrolls sideways when anything inside it is
 * wider, and the top bar widens the whole document, so each root cause found
 * at 375–430px is pinned here: the stage tabs wrap onto a second line, the top
 * bar's left side shrinks, the engagement header wraps, long values wrap, a
 * phone number is read whole, and a closed drawer is hidden. (jsdom does no layout: these pin the rules, and the
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
  it('the five stage tabs wrap onto a second line: none is hidden past the edge, and the page is not widened', () => {
    render(<StageTabBar contact={{ stage: 'scout' }} previewStage={null} onPreviewChange={() => {}} />);
    const bar = screen.getByTestId('stage-tab-bar');
    expect(bar.style.flexWrap).toBe('wrap');
    expect(bar.style.overflowX).toBe('');            // no scrolling row that hides "Reinforcements"
    expect(bar.style.minWidth).toBe('0px');
    const tabs = bar.querySelectorAll('button');
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(tab.style.whiteSpace).toBe('nowrap');   // a label is never split…
      expect(tab.style.minWidth).toBe('max-content'); // …or cut: the tab moves to the next line instead
    }
  });

  it('a phone number is read whole: its row wraps (badge above) instead of breaking inside the number', () => {
    const card = css('src/components/contacts/IdentityCard.css');
    expect(rule(card, '.idc-phone-entry')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(card, '.idc-field-entry.idc-phone-entry .idc-entry-val')).toMatch(/flex:\s*1 1 8\.5em/);
    const phones = readFileSync(resolve(repo, 'src/components/contacts/ContactPhones.jsx'), 'utf8');
    expect(phones).toContain('className="idc-field-entry idc-phone-entry"');
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
