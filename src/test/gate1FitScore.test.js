/**
 * GATE 1 (G1-06) — fit-score honesty.
 * Core requirement: a score must never imply evaluation of a dimension that was
 * not actually evaluated.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateICPScore, getScoreBreakdown, computeCoverage, validateWeights, DEFAULT_WEIGHTS,
} from '../utils/icpScoring.js';

const ICP = {
  industries: ['Computer Software'],
  locations: ['Utah'],
  companySizes: ['51-100'],
  revenueRanges: ['$10M-$20M'],
  isNationwide: false,
};

// exactly what saveCompaniesToFirestore() persists
const DISCOVERED = { industry: 'Computer Software', revenue: '$13.4M', founded_year: 2015 };
const COMPLETE = { industry: 'Computer Software', location: 'Utah', employee_count: 75, revenue: '$15M' };

describe('unknown dimensions are excluded, not scored', () => {
  it('does not count a dimension the company has no data for', () => {
    const b = getScoreBreakdown(DISCOVERED, ICP);
    expect(b.location.state).toBe('unknown');
    expect(b.employeeSize.state).toBe('unknown');
    expect(b.location.contribution).toBeNull();
    expect(b.evaluatedWeight).toBeLessThan(b.totalConfiguredWeight);
  });

  it('distinguishes unknown from a real miss', () => {
    const miss = getScoreBreakdown({ ...COMPLETE, industry: 'Restaurants' }, ICP);
    expect(miss.industry.state).toBe('missed');
    expect(miss.industry.unknown).toBe(false);
    expect(getScoreBreakdown(DISCOVERED, ICP).employeeSize.unknown).toBe(true);
  });

  it('reports coverage so the score cannot overstate its basis', () => {
    expect(getScoreBreakdown(COMPLETE, ICP).confidence).toBe(100);
    expect(getScoreBreakdown(DISCOVERED, ICP).confidence).toBeLessThan(100);
  });

  it('returns null — never 0 — when nothing is measurable', () => {
    expect(calculateICPScore({}, ICP)).toBeNull();
    expect(getScoreBreakdown({}, ICP).scored).toBe(false);
  });

  it('nationwide is an evaluation, not a gap', () => {
    const b = getScoreBreakdown({ industry: 'Computer Software' }, { ...ICP, isNationwide: true });
    expect(b.location.state).toBe('matched');
    expect(b.location.unknown).toBe(false);
  });
});

describe('breakdown and score cannot disagree', () => {
  it('breakdown total equals the score for many inputs', () => {
    const companies = [
      DISCOVERED, COMPLETE, {},
      { industry: 'Restaurants' },
      { industry: 'Computer Software', location: 'Texas' },
      { location: 'Utah', employee_count: 500 },
    ];
    for (const c of companies) {
      // null must propagate identically through both — coercing here would hide
      // exactly the "unscoreable renders as 0" bug this gate removes.
      expect(getScoreBreakdown(c, ICP).totalScore).toBe(calculateICPScore(c, ICP));
    }
  });
});

describe('existing contracts preserved', () => {
  it('weight validation still requires 100', () => {
    expect(validateWeights(DEFAULT_WEIGHTS)).toBe(true);
    expect(validateWeights({ industry: 10, location: 10, employeeSize: 10, revenue: 10 })).toBe(false);
  });

  it('computeCoverage agrees with the breakdown', () => {
    const cov = computeCoverage(DISCOVERED, ICP);
    const b = getScoreBreakdown(DISCOVERED, ICP);
    for (const k of cov.unknown) expect(b[k].unknown).toBe(true);
    for (const k of cov.observed) expect(b[k].unknown).toBe(false);
  });
});
