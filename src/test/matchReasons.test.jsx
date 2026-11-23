/**
 * #006.5 — why a company matches, in words, on the real card.
 *
 * Same mocks as dailyDiscoveryPhoneCard.test.jsx: a fixed score breakdown, so
 * every test says exactly which criteria matched, were close, missed, or had
 * no data. Scoring itself is not touched (getScoreBreakdown is the input).
 */
import { render, fireEvent, act, within, screen } from '@testing-library/react';
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

import { CompanySwipeCard } from '../pages/Scout/DailyLeads.jsx';
import { ThemeCtx } from '../theme/ThemeContext';
import { THEMES } from '../theme/tokens';
import { explainFactors, strongestReasons, summarizeFactors, stateOf, MATCH_STATE } from '../utils/matchReasons';

const row = (match, extra = {}) => ({ match, active: true, unknown: false, contribution: match, weight: 25, value: null, ...extra });
const NOT_MEASURED = { match: 0, active: true, unknown: true, contribution: null, weight: 10, value: null };

const COMPANY = {
  id: 'co1',
  name: 'Sokol Studio',
  industry: 'Information Technology & Services',
  headquarters_city: 'Salt Lake City',
  headquarters_state: 'Utah',
  employee_count: 1250,
  revenue: '$50M–$100M',
  founded_year: 2004,
  ceo_name: 'Dana Reyes',
  fit_score: 82,
  website_url: 'https://sokol.example',
  linkedin_url: 'https://www.linkedin.com/company/sokol-example',
  barry_intel: 'A long-established enterprise software consultancy with deep ties to regional healthcare systems.',
};
const ICP = { industries: ['Information Technology & Services'] };
const noop = () => {};
const ALL_FOUR = {
  industry: row(100),
  location: row(100, { value: 'Utah' }),
  employeeSize: row(50),
  revenue: NOT_MEASURED,
};
const renderCard = ({ fit = false, wide = !fit, theme = 'workspace', onAccept = noop, onReject = noop } = {}) => render(
  <ThemeCtx.Provider value={{ T: THEMES[theme], themeId: theme, setThemeId: noop }}>
    <CompanySwipeCard company={COMPANY} onAccept={onAccept} onReject={onReject} onSkip={noop} fit={fit} wide={wide} icpProfile={ICP} />
  </ThemeCtx.Provider>,
);
const lines = (scope) => [...scope.querySelectorAll('[data-reason]')];
const summary = (scope) => scope.querySelector('[data-testid="match-summary"]');

beforeEach(() => { breakdown.current = ALL_FOUR; });

describe('matchReasons: the four states, read from the existing breakdown', () => {
  it('100 → matches, 50 → close, 0 → doesn’t match, unknown → not available', () => {
    expect([row(100), row(50), row(0), NOT_MEASURED].map(stateOf))
      .toEqual([MATCH_STATE.MATCHED, MATCH_STATE.PARTIAL, MATCH_STATE.MISSED, MATCH_STATE.UNKNOWN]);
  });
  it('unknown is never a miss, even though its match value is 0', () => {
    expect(stateOf({ ...NOT_MEASURED, match: 0 })).toBe(MATCH_STATE.UNKNOWN);
  });
  it('criteria the ICP does not set are not listed', () => {
    const pills = [{ key: 'industry', data: row(100) }, { key: 'revenue', data: { active: false, match: 0 } }];
    expect(explainFactors(pills).map(r => r.key)).toEqual(['industry']);
  });
  it('the summary counts exactly what is listed, unknown separately', () => {
    const pills = Object.entries(ALL_FOUR).map(([key, data]) => ({ key, data }));
    expect(summarizeFactors(explainFactors(pills)).text).toBe('Matches 2 of 4 criteria · 1 close match · 1 unknown');
    const withMiss = [{ key: 'industry', data: row(0) }, { key: 'revenue', data: row(0) }];
    expect(summarizeFactors(explainFactors(withMiss)).text).toBe("Matches 0 of 2 criteria · 2 don't match");
    expect(summarizeFactors([])).toBeNull();
  });
  it('the phone card’s reasons still leave out what was never measured', () => {
    const pills = Object.entries(ALL_FOUR).map(([key, data]) => ({ key, data }));
    expect(strongestReasons(pills).map(r => r.kind)).toEqual(['matched', 'matched', 'partial']);
  });
});

describe('desktop card: every criterion, readable without hovering', () => {
  it('lists all four states, strongest first, with the summary', () => {
    const { container } = renderCard();
    expect(summary(container).textContent).toBe('Matches 2 of 4 criteria · 1 close match · 1 unknown');
    expect(lines(container).map(l => [l.dataset.reason, l.textContent])).toEqual([
      ['matched', '✓Matches: In your target industry'],
      ['matched', '✓Matches: In your target region: Utah'],
      ['partial', '≈Close match: Size near your range'],
      ['unknown', '?Not available: Revenue information not available'],
    ]);
  });
  it('a miss reads as one, distinct from missing data', () => {
    breakdown.current = { ...ALL_FOUR, employeeSize: row(0) };
    const { container } = renderCard();
    const kinds = lines(container).map(l => l.dataset.reason);
    expect(kinds).toContain('missed');
    expect(kinds).toContain('unknown');
    expect(summary(container).textContent).toBe("Matches 2 of 4 criteria · 1 doesn't match · 1 unknown");
  });
  it('nothing depends on a tooltip, and nothing is cut off', () => {
    const { container } = renderCard();
    for (const l of lines(container)) {
      expect(l.getAttribute('title')).toBeNull();
      for (const el of [l, ...l.querySelectorAll('*')]) {
        expect(el.style.textOverflow).not.toBe('ellipsis');
        expect(el.style.whiteSpace).not.toBe('nowrap');
      }
    }
    expect(within(container).getByRole('list', { name: /Why this company matches your ICP/ })).toBeTruthy();
  });
  it('the symbol is decorative; the state is in words', () => {
    const { container } = renderCard();
    for (const l of lines(container)) {
      expect(l.querySelector('[aria-hidden="true"]')).toBeTruthy();
      expect(l.querySelector('.sr-only')?.textContent).toMatch(/^(Matches|Close match|Doesn't match|Not available): $/);
    }
  });
});

describe('phone card and its Details sheet', () => {
  it('the face keeps its strongest reasons (never more than three) and shows the summary', () => {
    const { container } = renderCard({ fit: true });
    expect(lines(container).map(l => l.dataset.reason)).toEqual(['matched', 'matched', 'partial']);
    expect(summary(container).textContent).toBe('Matches 2 of 4 criteria · 1 close match · 1 unknown');
  });
  it('a short screen keeps its two reasons and leaves the summary to Details, so the card still fits', () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([{ contentRect: { height: 386 } }]); } disconnect() {} };
    try {
      const { container } = renderCard({ fit: true });
      expect(lines(container)).toHaveLength(2);
      expect(summary(container)).toBeNull();
    } finally { globalThis.ResizeObserver = original; }
  });
  it('Details lists every criterion, including the one with no data, and never as a red miss', () => {
    const { container } = renderCard({ fit: true });
    fireEvent.click(within(container).getByRole('button', { name: 'Details' }));
    const dialog = screen.getByRole('dialog');
    expect(lines(dialog).map(l => l.dataset.reason)).toEqual(['matched', 'matched', 'partial', 'unknown']);
    expect(dialog.textContent).toMatch(/Revenue information not available/);
    expect(dialog.textContent).toMatch(/not measured/);
    expect(dialog.textContent).not.toMatch(/Revenue.{0,3}✗/);
  });
  it('the decision buttons work as before', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderCard({ fit: true });
      expect(within(container).getByRole('button', { name: /^Match$/ })).toBeTruthy();
      fireEvent.click(within(container).getByRole('button', { name: /Not a Match/ }));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.textContent).toMatch(/Help Barry send better matches your way/);
    } finally { vi.useRealTimers(); }
  });
});

describe('desktop score breakdown: missing data and unset criteria are not misses', () => {
  const openBreakdown = (container) => fireEvent.click(within(container).getByText('ICP MATCH SCORE'));
  const breakdownRow = (container, label) =>
    [...container.querySelectorAll('div')].find(d => d.children.length === 3 && d.children[1]?.textContent === label);

  it('no data → "?" and "not measured"; not set by the ICP → "–" and "not in your ICP"; a real miss stays ✗', () => {
    breakdown.current = {
      industry: row(0), location: row(100, { value: 'Utah' }),
      employeeSize: NOT_MEASURED, revenue: { active: false, match: 0, contribution: 0, weight: 0 },
    };
    const { container } = renderCard();
    openBreakdown(container);
    const [ind, size, rev] = ['Industry', 'Size', 'Revenue'].map(l => breakdownRow(container, l));
    expect([ind.children[0].textContent, ind.children[2].textContent]).toEqual(['✗', '0pt']);
    expect([size.children[0].textContent, size.children[2].textContent]).toEqual(['?', 'not measured']);
    expect([rev.children[0].textContent, rev.children[2].textContent]).toEqual(['–', 'not in your ICP']);
  });
});

describe('readable in every theme', () => {
  const lum = (hex) => {
    const h = hex.replace('#', '').slice(0, 6);
    const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = (css) => {
    if (css.startsWith('#')) return css;
    const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
  };
  it.each(Object.keys(THEMES))('%s: reason text >= 4.5:1 and state symbols >= 3:1 on the card', (theme) => {
    breakdown.current = { ...ALL_FOUR, employeeSize: row(0), industry: row(50) };
    const { container } = renderCard({ theme });
    const bg = THEMES[theme].cardBg;
    for (const l of lines(container)) {
      expect(ratio(hex(l.style.color), bg), `${theme} text`).toBeGreaterThanOrEqual(4.5);
      const sym = l.querySelector('[aria-hidden="true"]');
      expect(ratio(hex(sym.style.color), bg), `${theme} ${l.dataset.reason} symbol`).toBeGreaterThanOrEqual(3);
    }
  });
});
