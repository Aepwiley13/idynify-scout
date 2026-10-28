/**
 * Phones (375–430px): the styles behind the horizontal-overflow fix on
 * Scan Business Card and the Contact Profile.
 *
 *   1. The stage tab bar (Scout … Reinforcements) is wider than a 375px
 *      screen. It scrolls on its own, and its tabs keep their width, so it no
 *      longer pushes the whole profile one or two pixels wider than the screen.
 *   2. iOS Safari zooms in on any form field under 16px when it is tapped and
 *      keeps the zoom, after which the page slides sideways. Every field on
 *      Capture review and on the profile is 16px on a phone.
 *
 * jsdom has no layout, so these pin the styles. The measurements at 375, 390,
 * 414 and 430px in a real browser are in the PR.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';

const T = { cardBg: '#fff', surface: '#fafafa', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888', input: '#fff', isDark: false };
vi.mock('../theme/ThemeContext', () => ({ useT: () => T }));

const { default: StageTabBar } = await import('../components/contacts/StageTabBar.jsx');
const { default: CaptureReview } = await import('../components/capture/CaptureReview.jsx');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const css = path => readFileSync(resolve(repo, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations a phone-width block gives `root`'s input, select and textarea. */
function phoneFieldRule(source, root) {
  const blocks = [...source.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?\}\s*)\}/g)]
    .filter(([, width]) => Number(width) >= 430);
  for (const [, , body] of blocks) {
    for (const [, selectors, declarations] of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const list = selectors.split(',').map(s => s.trim());
      const covers = tag => list.some(s => s.startsWith(`${root} ${tag}`));
      if (covers('input') && covers('select') && covers('textarea')) return declarations;
    }
  }
  return null;
}

describe('the stage tab bar scrolls on its own on a phone', () => {
  it('the row scrolls sideways; each tab keeps its label on one line at full width', () => {
    render(<StageTabBar contact={{ stage: 'scout' }} previewStage="reinforcements" onPreviewChange={() => {}} />);
    const bar = screen.getByTestId('stage-tab-bar');
    expect(bar.style.overflowX).toBe('auto');
    expect(bar.style.minWidth).toBe('0px');
    const tabs = bar.querySelectorAll('button');
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(tab.style.flex).toBe('1 0 auto');
      expect(tab.style.whiteSpace).toBe('nowrap');
    }
  });
});

describe('form fields are 16px on a phone (iOS zooms in on smaller ones)', () => {
  it('the Contact Profile: every field on the page', () => {
    const rule = phoneFieldRule(css('src/pages/Scout/ContactProfile.css'), '.contact-profile-page');
    expect(rule).toMatch(/font-size:\s*16px/);
  });

  it('Capture review: the CSS for its shared phone editor, and its own fields', () => {
    const rule = phoneFieldRule(css('src/components/capture/CaptureReview.css'), '.capture-review');
    expect(rule).toMatch(/font-size:\s*16px/);

    const person = {
      key: 'person-1', name: 'Kristin Sokol', title: 'Founder', company: 'Bright Path', email: 'k@example.com', otherEmails: [],
      linkedinUrl: '', website: '', phones: [], toCheck: [],
      socials: [{ id: 'social-1', platform: null, text: '@KRISTINSOKOL', observed: '@KRISTINSOKOL', fromCard: true, confirmed: false, unsure: false }],
    };
    const { container } = render(<CaptureReview people={[person]} T={T} onChange={() => {}} />);
    const fields = container.querySelectorAll('input:not([type="file"]), select, textarea');
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields) {
      if (field.style.fontSize) expect(parseFloat(field.style.fontSize), field.id || field.name).toBeGreaterThanOrEqual(16);
    }
  });
});
