/**
 * A null fit score must never render as 0, or as "Low Fit".
 *
 * calculateICPScore returns null for "the ICP configures criteria, but nothing
 * on this company was measurable" (G1-06). Daily Discoveries had the honest
 * verdict available and threw it away at the boundary: every ScorePip call site
 * passed `co.fit_score || co.score || 0`, so null was coerced to 0 before the
 * component could tell the two apart, and an unevaluated company rendered as a
 * red "0" — a confident claim of the worst possible fit, made about a company
 * nobody had assessed.
 *
 * The swipe card in the same file already got this right (`?? ... ?? null`,
 * labelled "Not enough data"), as do MobileCompanyCard and the desktop
 * FitBadge. This aligns the queue panels with the three surfaces that were
 * already honest.
 *
 * ScorePip was a closure inside DailyLeads, so it could not be rendered without
 * mounting the whole Scout queue. It now lives in its own module and these are
 * real render assertions rather than source-shape inference.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScorePip from '../components/scout/ScorePip';
import { isScored, UNSCORED_TITLE } from '../utils/scoreDisplay';
import { STATUS } from '../theme/tokens';

// jsdom serializes colours as `rgb(r, g, b)`, so the hex tokens have to be
// converted before they can be compared against a rendered style attribute.
const rgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const styleOf = (score) => render(<ScorePip score={score} />)
  .container.querySelector('span').getAttribute('style') || '';

describe('isScored', () => {
  it('treats null and undefined as unscored', () => {
    expect(isScored(null)).toBe(false);
    expect(isScored(undefined)).toBe(false);
  });

  it('treats 0 as scored — it is a measured verdict, not an absence', () => {
    expect(isScored(0)).toBe(true);
  });

  it('treats real scores as scored', () => {
    for (const s of [1, 33, 50, 75, 90, 100]) expect(isScored(s)).toBe(true);
  });
});

describe('an unscored company', () => {
  it('renders an em dash, not a number', () => {
    render(<ScorePip score={null} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders the same way for undefined', () => {
    render(<ScorePip score={undefined} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('carries "Not enough data" as its accessible title', () => {
    render(<ScorePip score={null} />);
    expect(screen.getByTitle(UNSCORED_TITLE)).toBeTruthy();
    expect(UNSCORED_TITLE).toMatch(/not enough data/i);
  });

  it('is not coloured as a low fit', () => {
    expect(styleOf(null)).not.toContain(rgb(STATUS.red));
  });
});

describe('a scored company is unaffected', () => {
  it('renders 0 as a real, red zero — measured and poor', () => {
    expect(styleOf(0)).toContain(rgb(STATUS.red));
    render(<ScorePip score={0} />);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('renders a strong score in green', () => {
    expect(styleOf(90)).toContain(rgb(STATUS.green));
    render(<ScorePip score={90} />);
    expect(screen.getAllByText('90').length).toBeGreaterThan(0);
  });

  it('renders a mid score in amber', () => {
    expect(styleOf(60)).toContain(rgb(STATUS.amber));
    render(<ScorePip score={60} />);
    expect(screen.getAllByText('60').length).toBeGreaterThan(0);
  });

  it('keeps the existing thresholds exactly', () => {
    expect(styleOf(75)).toContain(rgb(STATUS.green));
    expect(styleOf(74)).toContain(rgb(STATUS.amber));
    expect(styleOf(50)).toContain(rgb(STATUS.amber));
    expect(styleOf(49)).toContain(rgb(STATUS.red));
  });

  it('0 and null do not render alike', () => {
    const zero = render(<ScorePip score={0} />).container.innerHTML;
    const unscored = render(<ScorePip score={null} />).container.innerHTML;
    expect(zero).not.toBe(unscored);
  });
});
