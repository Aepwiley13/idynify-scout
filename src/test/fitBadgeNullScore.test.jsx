/**
 * A guard a caller can defeat by pre-processing the value is not a guard.
 *
 * FitBadge always knew null meant "no Company × ICP judgment exists" and
 * rendered a dash with a "Match not scored" tooltip. But the company drawer in
 * MissionControlDashboardV2 rounded first:
 *
 *     const score = company.fit_score ?? null;        // line 103
 *     <FitBadge score={Math.round(score)} />          // line 190
 *
 * `Math.round(null)` is 0, so the badge received a number, concluded it was
 * scored, and rendered a confident grey "0" for a company nobody had evaluated
 * — with the tooltip suppressed, because as far as the badge could tell there
 * was a score. The sibling call site in the desktop table guarded correctly, so
 * the same page disagreed with itself about the same company.
 *
 * The industry fix stacked under this one makes null scores common rather than
 * rare, which is what turned a latent hazard into a live one.
 *
 * The badge now takes the RAW score and does its own rounding, and treats
 * anything non-finite as unscored — so a NaN can never reach the screen as the
 * literal text "NaN" either.
 *
 * These are render assertions. Every existing test of that page reads its
 * source with readFileSync, because importing it pulls 25 top-level modules —
 * and source shape cannot prove what a component draws.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FitBadge, { UNATTRIBUTED_TITLE, UNATTRIBUTED_MARK } from '../components/mission-control/FitBadge';
import { getFitTier } from '../utils/companyDisplay';

const rgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const styleOf = (score) => render(<FitBadge score={score} />)
  .container.querySelector('span').getAttribute('style') || '';

describe('an unscored company', () => {
  it('renders a dash for null, not a zero', () => {
    render(<FitBadge score={null} />);
    expect(screen.getByText(UNATTRIBUTED_MARK)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders a dash for undefined', () => {
    render(<FitBadge score={undefined} />);
    expect(screen.getByText(UNATTRIBUTED_MARK)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('keeps the "Match not scored" tooltip', () => {
    render(<FitBadge score={null} />);
    expect(screen.getByTitle(UNATTRIBUTED_TITLE)).toBeTruthy();
  });

  it('never renders the literal text NaN', () => {
    render(<FitBadge score={NaN} />);
    expect(screen.queryByText('NaN')).toBeNull();
    expect(screen.getByText(UNATTRIBUTED_MARK)).toBeTruthy();
  });

  it('treats Infinity as unscored rather than a perfect fit', () => {
    render(<FitBadge score={Infinity} />);
    expect(screen.getByText(UNATTRIBUTED_MARK)).toBeTruthy();
  });
});

describe('the drawer regression specifically', () => {
  // The exact expression the drawer used to pass. It must no longer be able to
  // turn an unscored company into a scored one.
  it('a pre-rounded null can no longer masquerade as a score', () => {
    const drawerScore = null;
    expect(Math.round(drawerScore)).toBe(0); // the coercion that caused this

    // What the drawer passes now: the raw value.
    render(<FitBadge score={drawerScore} />);
    expect(screen.getByText(UNATTRIBUTED_MARK)).toBeTruthy();
    expect(screen.getByTitle(UNATTRIBUTED_TITLE)).toBeTruthy();
  });

  it('a real 0 is still shown as 0, with no tooltip', () => {
    render(<FitBadge score={0} />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByTitle(UNATTRIBUTED_TITLE)).toBeNull();
  });

  it('0 and null do not render alike', () => {
    const zero = render(<FitBadge score={0} />).container.innerHTML;
    const unscored = render(<FitBadge score={null} />).container.innerHTML;
    expect(zero).not.toBe(unscored);
  });
});

describe('a scored company is unchanged', () => {
  it('rounds a fractional score, as the caller used to', () => {
    render(<FitBadge score={74.6} />);
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('keeps getFitTier thresholds exactly', () => {
    expect(styleOf(75)).toContain(rgb(getFitTier(75).color));
    expect(styleOf(74)).toContain(rgb(getFitTier(74).color));
    expect(styleOf(50)).toContain(rgb(getFitTier(50).color));
    expect(styleOf(49)).toContain(rgb(getFitTier(49).color));
  });

  it('a strong and a weak score are coloured differently', () => {
    expect(styleOf(90)).not.toBe(styleOf(10));
  });
});
