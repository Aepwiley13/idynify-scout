/**
 * Queue order: a known-good fit, then an unknown, then a known-poor fit.
 *
 * The old comparator was `(b.fit_score ?? 0) - (a.fit_score ?? 0)`, which ties
 * an unscored company with a measured 0 and interleaves the two at the bottom.
 * That is the ranking half of the null-is-not-zero conflation: a company we
 * never managed to evaluate is not the same as one we evaluated and rejected,
 * and it is strictly more promising — it may yet turn out to be excellent,
 * whereas the 0 has already been checked.
 *
 * TOP MATCH had a related defect. Its reduce compared `(c.fit_score || 0)`, so
 * on a queue where nothing was scored it awarded the badge to whichever company
 * happened to be first in the array. There is no best company in that queue,
 * and the honest answer is to show no badge at all.
 */

import { describe, it, expect } from 'vitest';
import {
  compareByFit, rankByFit, pickTopMatch, fitTier, TIER, QUALIFIED_MIN,
} from '../utils/fitRanking';

const at = (iso) => ({ found_at: iso });
const co = (name, fit_score, iso, extra = {}) => ({
  name, fit_score, ...(iso ? at(iso) : {}), ...extra,
});
const names = (list) => list.map((c) => c.name);

describe('fitTier', () => {
  it('puts a qualifying measured score in the top tier', () => {
    expect(fitTier(QUALIFIED_MIN)).toBe(TIER.QUALIFIED);
    expect(fitTier(100)).toBe(TIER.QUALIFIED);
  });

  it('puts an unscored company in the middle tier', () => {
    expect(fitTier(null)).toBe(TIER.UNSCORED);
    expect(fitTier(undefined)).toBe(TIER.UNSCORED);
  });

  it('puts a measured score below the bar in the bottom tier', () => {
    expect(fitTier(QUALIFIED_MIN - 1)).toBe(TIER.BELOW);
    expect(fitTier(0)).toBe(TIER.BELOW);
  });
});

describe('null ranks above a real 0', () => {
  it('orders unscored ahead of a measured zero', () => {
    const ordered = rankByFit([co('Zero', 0), co('Unscored', null)]);
    expect(names(ordered)).toEqual(['Unscored', 'Zero']);
  });

  it('orders unscored ahead of every measured score below the bar', () => {
    const ordered = rankByFit([co('Low-49', 49), co('Unscored', null), co('Zero', 0)]);
    expect(names(ordered)).toEqual(['Unscored', 'Low-49', 'Zero']);
  });

  it('still orders a qualifying match ahead of unscored', () => {
    const ordered = rankByFit([co('Unscored', null), co('Good-50', 50)]);
    expect(names(ordered)).toEqual(['Good-50', 'Unscored']);
  });
});

describe('a mixed list', () => {
  const MIXED = [
    co('Low-40', 40),
    co('Null-Old', null, '2026-01-01T00:00:00Z'),
    co('High-90', 90),
    co('Zero', 0),
    co('Null-New', null, '2026-09-01T00:00:00Z'),
    co('Mid-60', 60),
  ];

  it('orders qualifying desc, then unscored by recency, then below-bar desc', () => {
    expect(names(rankByFit(MIXED))).toEqual([
      'High-90', 'Mid-60',      // tier 0, descending
      'Null-New', 'Null-Old',   // tier 1, most recent first
      'Low-40', 'Zero',         // tier 2, descending
    ]);
  });

  it('does not mutate its input', () => {
    const before = names(MIXED);
    rankByFit(MIXED);
    expect(names(MIXED)).toEqual(before);
  });

  it('is a total order — reversing the input yields the same result', () => {
    expect(names(rankByFit([...MIXED].reverse()))).toEqual(names(rankByFit(MIXED)));
  });
});

describe('an all-null list', () => {
  const ALL_NULL = [
    co('Charlie', null, '2026-03-01T00:00:00Z'),
    co('Alpha', null, '2026-09-01T00:00:00Z'),
    co('Bravo', null, '2026-06-01T00:00:00Z'),
  ];

  it('orders by discovery recency, newest first', () => {
    expect(names(rankByFit(ALL_NULL))).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('falls back to name when recency is identical, so order is stable', () => {
    const sameDay = [
      co('Zulu', null, '2026-05-01T00:00:00Z'),
      co('Alpha', null, '2026-05-01T00:00:00Z'),
      co('Mike', null, '2026-05-01T00:00:00Z'),
    ];
    expect(names(rankByFit(sameDay))).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('is deterministic when no company carries a timestamp at all', () => {
    const undated = [co('Delta', null), co('Bravo', null), co('Alpha', null)];
    expect(names(rankByFit(undated))).toEqual(['Alpha', 'Bravo', 'Delta']);
  });

  it('awards no TOP MATCH', () => {
    expect(pickTopMatch(ALL_NULL)).toBeNull();
  });
});

describe('TOP MATCH is earned, not assigned', () => {
  it('goes to the highest qualifying score', () => {
    const top = pickTopMatch([co('Mid-60', 60), co('High-90', 90), co('Null', null)]);
    expect(top.name).toBe('High-90');
  });

  it('is withheld when every measured score is below the bar', () => {
    expect(pickTopMatch([co('Low-49', 49), co('Zero', 0)])).toBeNull();
  });

  it('is withheld on an empty queue', () => {
    expect(pickTopMatch([])).toBeNull();
    expect(pickTopMatch(null)).toBeNull();
  });

  it('is never awarded to an unscored company, even as the only candidate', () => {
    expect(pickTopMatch([co('Only', null)])).toBeNull();
  });

  it('accepts a score exactly at the bar', () => {
    expect(pickTopMatch([co('Exactly', QUALIFIED_MIN)]).name).toBe('Exactly');
  });
});

describe('the G1-06 confidence tie-break survives', () => {
  it('prefers the better-evidenced company at an equal qualifying score', () => {
    const ordered = rankByFit([
      co('Thin', 80, null, { fit_confidence: 25 }),
      co('Thorough', 80, null, { fit_confidence: 100 }),
    ]);
    expect(names(ordered)).toEqual(['Thorough', 'Thin']);
  });

  it('applies in the below-bar tier too', () => {
    const ordered = rankByFit([
      co('Thin', 20, null, { fit_confidence: 10 }),
      co('Thorough', 20, null, { fit_confidence: 90 }),
    ]);
    expect(names(ordered)).toEqual(['Thorough', 'Thin']);
  });

  it('does not let confidence promote a company across tiers', () => {
    const ordered = rankByFit([
      co('ConfidentlyBad', 10, null, { fit_confidence: 100 }),
      co('Unscored', null),
    ]);
    expect(names(ordered)).toEqual(['Unscored', 'ConfidentlyBad']);
  });
});

describe('comparator contract', () => {
  it('returns 0 for two indistinguishable rows', () => {
    expect(compareByFit(co('A', 70), co('A', 70))).toBe(0);
  });

  it('tolerates malformed rows without throwing', () => {
    expect(() => rankByFit([{}, { fit_score: 'nonsense' }, co('Ok', 70)])).not.toThrow();
  });
});
