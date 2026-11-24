/**
 * #006.6 — the desktop company card in two columns (≥1100px, `split`).
 *
 * Left, "Company overview": who the company is, its score and summary, and the
 * decision. Right, "Why this company": the #006.5 reasons, Barry Intel, the
 * facts and the links. Every section is the one the single-column card renders,
 * moved — each appears exactly once. Decisions, Skip and the drag gesture are
 * the card's own, unchanged. Phones (`fit`) and the person card never split.
 *
 * Same mocks as matchReasons.test.jsx (fixed score breakdown). jsdom lays
 * nothing out: heights, the fold and overflow were measured in Chromium (see
 * HANDOFF / COMPANY_STAGE_MIN_H).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { render, fireEvent, act, within } from '@testing-library/react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('t') } },
  db: {},
}));
vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/ContactTitleSetup', () => ({ default: () => null }));
vi.mock('../components/scout/BarryICPPanel', () => ({
  default: () => null,
  BarryAvatar: () => null,
}));
// The card's reasons come from the ICP breakdown. A fixed one lets these tests
// say exactly which reasons show, in what order.
const breakdown = vi.hoisted(() => ({ current: null }));
vi.mock('../utils/icpScoring', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getScoreBreakdown: (...args) => breakdown.current ?? actual.getScoreBreakdown(...args) };
});

import { CompanySwipeCard, PersonSwipeCard } from '../pages/Scout/DailyLeads.jsx';
import { ThemeCtx } from '../theme/ThemeContext';
import { THEMES } from '../theme/tokens';

const row = (match, extra = {}) => ({ match, active: true, unknown: false, contribution: match, weight: 25, value: null, ...extra });
const NOT_MEASURED = { match: 0, active: true, unknown: true, contribution: null, weight: 10, value: null };
const COMPANY = {
  id: 'co1',
  name: 'Wasatch Precision Manufacturing & Engineering Group',
  industry: 'Construction',
  headquarters_city: 'Salt Lake City', headquarters_state: 'Utah',
  employee_count: 220, revenue: '$10M-$50M', founded_year: 1998,
  ceo_name: 'Alexandra Montgomery-Whitfield', fit_score: 82,
  website_url: 'https://wasatch.example', linkedin_url: 'https://www.linkedin.com/company/wasatch-example',
  barry_intel: 'Builds precision hydraulic presses and custom fabrication lines for regional construction firms.',
};
const ICP = { industries: ['Construction'] };
const noop = () => {};
const renderCard = (props = {}) => render(
  <ThemeCtx.Provider value={{ T: THEMES.workspace, themeId: 'workspace', setThemeId: noop }}>
    <CompanySwipeCard company={COMPANY} onAccept={noop} onReject={noop} onSkip={noop} wide split icpProfile={ICP} {...props} />
  </ThemeCtx.Provider>,
);
const overview = c => c.querySelector('section[aria-label="Company overview"]');
const why = c => c.querySelector('[data-testid="why-this-company"]');
const intelCount = c => [...c.querySelectorAll('span')].filter(s => s.textContent === 'BARRY INTEL').length;
const statLabels = ['INDUSTRY', 'EMPLOYEES', 'REVENUE', 'FOUNDED', 'HQ', 'CEO'];

beforeEach(() => {
  breakdown.current = { industry: row(100), location: row(100, { value: 'Utah' }), employeeSize: row(50), revenue: NOT_MEASURED };
});

describe('split card: two columns, each section once', () => {
  it('renders the overview and a labelled "Why this company" region', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="company-card-split"]')).toBeTruthy();
    expect(overview(container)).toBeTruthy();
    const region = why(container);
    const heading = region.querySelector('h3');
    expect(heading.textContent).toBe('Why this company');
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('left column: identity, score, summary and the decision — nothing from the right', () => {
    const left = overview(renderCard().container);
    expect(left.textContent).toContain(COMPANY.name);
    expect(left.textContent).toContain('High confidence');
    expect(left.textContent).toMatch(/Salt Lake City, Utah/);
    expect(left.querySelector('[data-testid="icp-match-score"]').textContent).toBe('82');
    expect(left.querySelector('[data-testid="match-summary"]').textContent)
      .toBe('Matches 2 of 4 criteria · 1 close match · 1 unknown');
    for (const name of [/Not a Match/, /This is a Match/, /Skip for now/]) {
      expect(within(left).getByRole('button', { name })).toBeTruthy();
    }
    expect(left.querySelector('[data-testid="match-explanation"]')).toBeNull();
    expect(intelCount(left)).toBe(0);
    expect(within(left).queryByText('Website')).toBeNull();
  });

  it('right column: the reasons, Barry Intel, the six facts and both links', () => {
    const right = why(renderCard().container);
    const list = within(right).getByRole('list', { name: 'Why this company matches your ICP' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(intelCount(right)).toBe(1);
    expect(right.textContent).toContain(COMPANY.barry_intel);
    for (const l of statLabels) expect(within(right).getByText(l)).toBeTruthy();
    expect(right.textContent).toContain(COMPANY.ceo_name);
    expect(within(right).getByText('Website').closest('a').getAttribute('href')).toBe(COMPANY.website_url);
    expect(within(right).getByText('LinkedIn').closest('a').getAttribute('href')).toBe(COMPANY.linkedin_url);
  });

  it('nothing is rendered twice', () => {
    const { container } = renderCard();
    expect(container.querySelectorAll('[data-testid="match-explanation"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="match-summary"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="icp-match-score"]')).toHaveLength(1);
    expect(intelCount(container)).toBe(1);
    expect(within(container).getAllByText('Website')).toHaveLength(1);
    expect(within(container).getAllByText('LinkedIn')).toHaveLength(1);
    expect(within(container).getAllByText(COMPANY.name)).toHaveLength(1);
    for (const l of statLabels) expect(within(container).getAllByText(l)).toHaveLength(1);
  });

  it('the single-column desktop card carries the same sections, once each', () => {
    const { container } = renderCard({ split: false });
    expect(container.querySelector('[data-testid="company-card-split"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="match-explanation"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="match-summary"]')).toHaveLength(1);
    expect(intelCount(container)).toBe(1);
  });
});

describe('split card: readable, and no inner scrolling', () => {
  it('the company name, industry and HQ wrap rather than being cut', () => {
    const left = overview(renderCard().container);
    const name = within(left).getByText(COMPANY.name);
    expect(name.style.whiteSpace).toBe('');
    expect(name.style.textOverflow).toBe('');
    expect(name.style.overflowWrap).toBe('anywhere');
  });

  it('in the narrower right column a fact wraps instead of ellipsizing; the single column is unchanged', () => {
    const ceo = within(why(renderCard().container)).getByText(COMPANY.ceo_name);
    expect(ceo.style.whiteSpace).toBe('normal');
    expect(ceo.style.overflowWrap).toBe('anywhere');
    const { container } = renderCard({ split: false });
    expect(within(container).getAllByText(COMPANY.ceo_name).at(-1).style.whiteSpace).toBe('nowrap');
  });

  it('the card is content-sized and scrolls nowhere; it is 960px wide at most', () => {
    const { container } = renderCard();
    const root = container.firstElementChild;
    expect(root.style.maxWidth).toBe('960px');
    expect(root.style.height).toBe('');
    expect(root.style.touchAction).toBe('pan-y');
    for (const el of container.querySelectorAll('*')) {
      expect(['auto', 'scroll'], `${el.tagName} scrolls`).not.toContain(el.style.overflowY);
      expect(['auto', 'scroll']).not.toContain(el.style.overflow);
    }
  });

  it('the columns may shrink below their content', () => {
    const grid = renderCard().container.querySelector('[data-testid="company-card-split"]');
    expect(grid.style.gridTemplateColumns).toBe('minmax(0, 1fr) minmax(0, 1.15fr)');
    expect(overview(grid).style.minWidth).toBe('0px');
    expect(why(grid).style.minWidth).toBe('0px');
  });
});

describe('split card: decisions work as before', () => {
  it('This is a Match opens the match feedback face', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderCard();
      fireEvent.click(within(overview(container)).getByRole('button', { name: /This is a Match/ }));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.textContent).toContain('Great catch!');
    } finally { vi.useRealTimers(); }
  });

  it('Not a Match opens the rejection feedback face', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderCard();
      fireEvent.click(within(overview(container)).getByRole('button', { name: /Not a Match/ }));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.textContent).toContain("What didn't fit?");
    } finally { vi.useRealTimers(); }
  });

  it('Skip for now skips once', () => {
    const onSkip = vi.fn();
    const { container } = renderCard({ onSkip });
    const skip = within(overview(container)).getByRole('button', { name: /Skip for now/ });
    fireEvent.click(skip);
    fireEvent.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith('co1');
  });

  it('dragging the card right still accepts it, once', () => {
    vi.useFakeTimers();
    try {
      const onAccept = vi.fn();
      const { container } = renderCard({ onAccept });
      const root = container.firstElementChild;
      fireEvent.mouseDown(root, { clientX: 0, clientY: 0 });
      fireEvent.mouseMove(root, { clientX: 160, clientY: 0 });
      fireEvent.mouseUp(root, { clientX: 160, clientY: 0 });
      act(() => { vi.advanceTimersByTime(400); });
      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onAccept).toHaveBeenCalledWith(null, 'drag', 'co1');
    } finally { vi.useRealTimers(); }
  });

  it('the score details still open from the score row', () => {
    const { container } = renderCard();
    const left = overview(container);
    expect(within(left).queryByText('not measured')).toBeNull();
    fireEvent.click(within(left).getByText('ICP MATCH SCORE'));
    expect(within(left).getByText('not measured')).toBeTruthy();
  });
});

describe('only the desktop company card splits', () => {
  it('a phone card ignores split', () => {
    const { container } = renderCard({ fit: true, wide: false, split: true });
    expect(container.querySelector('[data-testid="company-card-split"]')).toBeNull();
    expect(container.querySelector('[data-testid="icp-match-chip"]')).toBeTruthy();
  });

  it('the person card has no split face', () => {
    const { container } = render(
      <ThemeCtx.Provider value={{ T: THEMES.workspace, themeId: 'workspace', setThemeId: noop }}>
        <PersonSwipeCard person={{ id: 'p1', name: 'Dana Reyes', title: 'VP Sales' }} company={COMPANY} onAccept={noop} onReject={noop} onSkip={noop} wide split />
      </ThemeCtx.Provider>,
    );
    expect(container.querySelector('[data-testid="company-card-split"]')).toBeNull();
  });

  it('the page splits at 1100px, on the company card only, and only on desktop', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');
    expect(src).toMatch(/const SPLIT_MIN_VW = 1100;/);
    expect(src).toMatch(/const \[isSplit, setIsSplit\] = useState\(\(\) => window\.innerWidth >= SPLIT_MIN_VW\);/);
    expect(src).toMatch(/setIsSplit\(window\.innerWidth >= SPLIT_MIN_VW\);/);
    expect(src.match(/split=\{isDesktop && isSplit\}/g)).toHaveLength(1);
    const company = src.slice(src.indexOf('<CompanySwipeCard'), src.indexOf('/>', src.indexOf('<CompanySwipeCard')));
    expect(company).toContain('split={isDesktop && isSplit}');
    const person = src.slice(src.indexOf('<PersonSwipeCard'), src.indexOf('/>', src.indexOf('<PersonSwipeCard')));
    expect(person).not.toContain('split');
  });
});

describe('split card: readable in every theme', () => {
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [id, T] of Object.entries(THEMES)) {
    it(`${id}: name, heading and facts on their backgrounds`, () => {
      const hex = v => (/^#[0-9a-f]{6}$/i.test(v) ? v : null);
      // Name on the identity block (cardBg2); "Why this company" and the facts on the card (cardBg).
      for (const [fg, bg, min] of [[T.text, T.cardBg2, 4.5], [T.textMuted, T.cardBg, 4.5], [T.textMuted, T.cardBg2, 4.5]]) {
        if (!hex(fg) || !hex(bg)) continue;
        expect(ratio(fg, bg), `${id} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
      }
    });
  }
});
