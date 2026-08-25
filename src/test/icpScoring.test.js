/**
 * ICP Scoring — Unit Tests
 *
 * Guards the fix for the "every company scores 0 or 50 with a generic reason"
 * bug: field-name resolution, numeric employee-size handling, differentiated
 * scoring (90+/60-80/<50), and specific per-company match reasons.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateICPScore,
  generateMatchReason,
  generateMatchReasons,
  scoreCompany,
  getScoreBreakdown,
  extractStateFromLocation,
  DEFAULT_WEIGHTS,
} from '../utils/icpScoring.js';

// A fully-configured ICP: industry, size, location, revenue all set.
const FULL_ICP = {
  industries: ['Credit Unions'],
  companySizes: ['51-100', '101-200'],
  locations: ['TX', 'CA'],
  revenueRanges: ['$5M-$10M', '$10M-$20M'],
  isNationwide: false,
};

describe('calculateICPScore — differentiation (the core bug)', () => {
  it('scores an exact industry + size + location match 90+', () => {
    const company = {
      industry: 'Credit Unions',
      employee_count: 150, // numeric — the previous bug never matched this
      headquarters_location: 'Austin, TX',
      revenue_range: '$5M-$10M',
    };
    expect(calculateICPScore(company, FULL_ICP)).toBeGreaterThanOrEqual(90);
  });

  // UPDATED BY GATE 1 (G1-06). Previously asserted a 60-80 band, which existed
  // only because unknown dimensions scored a neutral 50 and dragged the total
  // down. That blend is exactly what Gate 1 forbids: it let the number imply a
  // partial evaluation of dimensions that were never evaluated. The honest
  // model is "100 of what we could measure, and we measured half of it" —
  // differentiation moves from the score into the score/confidence pair.
  it('scores industry-only as a full match of what was measurable, with reduced confidence', () => {
    const company = { industry: 'Credit Unions' }; // no size/location/revenue data
    const b = getScoreBreakdown(company, FULL_ICP);
    expect(b.totalScore).toBe(100);
    expect(b.confidence).toBeLessThan(100);
    expect(b.employeeSize.state).toBe('unknown');
    expect(b.location.state).toBe('unknown');
  });

  it('scores a weak match (wrong industry) below 50', () => {
    const company = { industry: 'Fast Food', employee_count: 5000 };
    expect(calculateICPScore(company, FULL_ICP)).toBeLessThan(50);
  });

  it('produces a spread of DIFFERENT scores, not just 0 and 50', () => {
    const companies = [
      { industry: 'Credit Unions', employee_count: 150, state: 'TX', revenue_range: '$5M-$10M' },
      { industry: 'Credit Unions', employee_count: 150 },
      { industry: 'Credit Unions' },
      { industry: 'Banking & Credit Unions' }, // partial industry
      { industry: 'Fast Food' },
    ];
    // UPDATED BY GATE 1 (G1-06): differentiation is now carried by the
    // (score, confidence) pair — confidence is what separates a fully-evaluated
    // match from a half-evaluated one, and it is what the queue sorts on as a
    // tie-break. The original intent (no collapse to a two-value score) is kept.
    const pairs = companies.map((c) => {
      const b = getScoreBreakdown(c, FULL_ICP);
      return `${b.totalScore}/${b.confidence}`;
    });
    expect(new Set(pairs).size).toBeGreaterThanOrEqual(4); // clearly differentiated
    const scores = companies.map((c) => calculateICPScore(c, FULL_ICP));
    expect(scores.every((s) => s === 0 || s === 50)).toBe(false); // not the old bug
  });
});

describe('calculateICPScore — field-name resolution', () => {
  it('matches size whether given as a number or a range string', () => {
    const icp = { companySizes: ['101-200'] };
    const numeric = { industry: null, employee_count: 150 };
    const rangeStr = { company_size: '101-200 employees' };
    // Only size configured → a size match should score 100.
    expect(calculateICPScore(numeric, icp)).toBe(100);
    expect(calculateICPScore(rangeStr, icp)).toBe(100);
  });

  it('reads location from headquarters_location, location, or state', () => {
    const icp = { locations: ['TX'] };
    expect(calculateICPScore({ headquarters_location: 'Austin, TX' }, icp)).toBe(100);
    expect(calculateICPScore({ location: 'Dallas, TX' }, icp)).toBe(100);
    expect(calculateICPScore({ state: 'TX' }, icp)).toBe(100);
    expect(calculateICPScore({ state: 'NY' }, icp)).toBe(0);
  });

  // REPLACED BY GATE 1 (G1-06). The old rule ("missing → neutral 50") is the
  // precise behaviour the gate removes: a score must never imply evaluation of a
  // dimension that was not evaluated. Missing data is now excluded from the
  // score entirely and reported as `unknown` — neither a miss nor a half-match.
  it('excludes a configured-but-missing dimension instead of scoring it', () => {
    const icp = { industries: ['SaaS'], companySizes: ['51-100'] };
    const b = getScoreBreakdown({ industry: 'SaaS' }, icp);
    expect(b.employeeSize.state).toBe('unknown');
    expect(b.employeeSize.unknown).toBe(true);
    expect(b.employeeSize.contribution).toBeNull();   // contributes nothing
    expect(b.evaluatedWeight).toBeLessThan(b.totalConfiguredWeight);
    expect(b.totalScore).toBe(100);                   // 100% of what was measured
  });
});

describe('calculateICPScore — graceful with missing fields (DECISION 2)', () => {
  it('scores an industry-only company (no size/location/revenue) at the Good Fit threshold', () => {
    // Current data is often industry-only; such a company should still count as
    // a Good Fit (>= 75) rather than being penalized to a broken-looking score.
    const score = calculateICPScore({ industry: 'Credit Unions' }, FULL_ICP);
    expect(score).toBeGreaterThanOrEqual(75);
  });

  // UPDATED BY GATE 1 (G1-06): a company with nothing measurable is now
  // explicitly unscoreable (null) rather than a finite number. Returning 0 would
  // render as "Low Fit" — a claim about a company we know nothing about.
  it('returns null, not a number, for a company with no usable fields', () => {
    expect(() => calculateICPScore({ name: 'Mystery Co' }, FULL_ICP)).not.toThrow();
    expect(calculateICPScore({ name: 'Mystery Co' }, FULL_ICP)).toBeNull();
    expect(getScoreBreakdown({ name: 'Mystery Co' }, FULL_ICP).scored).toBe(false);
  });

  it('keeps an out-of-industry company below the Good Fit threshold even with missing data', () => {
    expect(calculateICPScore({ industry: 'Fast Food' }, FULL_ICP)).toBeLessThan(75);
  });
});

describe('calculateICPScore — edge cases', () => {
  it('returns 0 when company or ICP is missing', () => {
    expect(calculateICPScore(null, FULL_ICP)).toBe(0);
    expect(calculateICPScore({ industry: 'X' }, null)).toBe(0);
  });

  it('returns a neutral 50 when the ICP configures nothing', () => {
    expect(calculateICPScore({ industry: 'Credit Unions' }, {})).toBe(50);
  });

  it('nationwide ICP counts location as a full match for any company', () => {
    const icp = { industries: ['Credit Unions'], isNationwide: true };
    const score = calculateICPScore({ industry: 'Credit Unions' }, icp);
    expect(score).toBe(100); // both configured dims match
  });
});

describe('generateMatchReason — specific per company', () => {
  it('names the exact criteria matched', () => {
    const company = {
      industry: 'credit unions', // lowercase in data
      employee_count: 150,
      headquarters_location: 'Austin, TX',
    };
    const reason = generateMatchReason(company, FULL_ICP);
    expect(reason).toContain('Matches your target industry: Credit Unions'); // uses ICP casing
    expect(reason).toContain('Company size aligns with your ICP: 101-200');
    expect(reason).toContain('Located in your target region: TX');
    expect(reason).not.toMatch(/company matching your ICP/i); // not the generic string
  });

  it('is different for two differently-matching companies', () => {
    const a = generateMatchReason({ industry: 'Credit Unions', employee_count: 150 }, FULL_ICP);
    const b = generateMatchReason({ industry: 'Fast Food' }, FULL_ICP);
    expect(a).not.toBe(b);
  });

  it('describes a weak fit for a wrong-industry company', () => {
    const reason = generateMatchReason({ industry: 'Fast Food' }, FULL_ICP);
    expect(reason).toMatch(/outside your target industries/i);
    expect(reason).toContain('Fast Food');
  });

  it('describes a partial fit when only a related industry matches', () => {
    const reason = generateMatchReason({ industry: 'Banking & Credit Unions' }, FULL_ICP);
    expect(reason).toMatch(/related to your target industry/i);
  });

  it('falls back gracefully with no ICP', () => {
    expect(generateMatchReason({ industry: 'X' }, null)).toMatch(/no ICP/i);
  });
});

describe('generateMatchReasons — array for the Mission Control table', () => {
  it('returns an array of specific reasons, strongest first', () => {
    const reasons = generateMatchReasons(
      { industry: 'credit unions', employee_count: 150, headquarters_location: 'Austin, TX' },
      FULL_ICP
    );
    expect(Array.isArray(reasons)).toBe(true);
    expect(reasons[0]).toContain('Credit Unions'); // industry is the strongest signal, first
    expect(reasons.some((r) => /company size aligns with your ICP: 101-200/i.test(r))).toBe(true);
    expect(reasons.some((r) => /located in your target region: TX/i.test(r))).toBe(true);
  });

  it('returns a single "outside your industries" reason for a weak match', () => {
    const reasons = generateMatchReasons({ industry: 'Fast Food' }, FULL_ICP);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/outside your target industries/i);
  });

  it('first 1-2 reasons form the Mission Control display text', () => {
    const reasons = generateMatchReasons(
      { industry: 'Credit Unions', employee_count: 150, headquarters_location: 'Austin, TX', revenue_range: '$5M-$10M' },
      FULL_ICP
    );
    const display = reasons.slice(0, 2).join(' · ');
    expect(display).toContain('Credit Unions');
    expect(display.split(' · ')).toHaveLength(2);
  });
});

describe('scoreCompany', () => {
  it('returns score, reasons array, reason string, and breakdown together', () => {
    const result = scoreCompany(
      { industry: 'Credit Unions', employee_count: 150, state: 'TX', revenue_range: '$5M-$10M' },
      FULL_ICP
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons[0]).toContain('Credit Unions');
    expect(result.reason).toContain('Credit Unions');
    expect(result.breakdown.totalScore).toBe(result.score);
  });

  it('differentiates high-fit from out-of-ICP companies', () => {
    const good = scoreCompany({ industry: 'Credit Unions', employee_count: 150, state: 'TX', revenue_range: '$5M-$10M' }, FULL_ICP);
    const bad = scoreCompany({ industry: 'Fast Food' }, FULL_ICP);
    expect(good.score).toBeGreaterThan(bad.score + 40); // clearly separated
  });
});

describe('getScoreBreakdown — display contract preserved', () => {
  it('keeps per-dimension match values in {0, 50, 100}', () => {
    const breakdown = getScoreBreakdown(
      { industry: 'Credit Unions', employee_count: 150 },
      FULL_ICP
    );
    for (const dim of ['industry', 'location', 'employeeSize', 'revenue']) {
      expect([0, 50, 100]).toContain(breakdown[dim].match);
    }
    expect(breakdown.industry.match).toBe(100); // exact industry
    expect(breakdown.employeeSize.match).toBe(100); // numeric size in range
  });

  it('totalScore equals calculateICPScore', () => {
    const company = { industry: 'Credit Unions', state: 'CA' };
    expect(getScoreBreakdown(company, FULL_ICP).totalScore).toBe(
      calculateICPScore(company, FULL_ICP)
    );
  });
});

describe('extractStateFromLocation', () => {
  it('pulls the state from common formats', () => {
    expect(extractStateFromLocation('Austin, TX')).toBe('TX');
    expect(extractStateFromLocation('TX, USA')).toBe('TX');
    expect(extractStateFromLocation('California')).toBe('California');
    expect(extractStateFromLocation({ state: 'NY' })).toBe('NY');
    expect(extractStateFromLocation(null)).toBeNull();
  });
});

describe('DEFAULT_WEIGHTS', () => {
  it('totals 100', () => {
    const { industry, location, employeeSize, revenue } = DEFAULT_WEIGHTS;
    expect(industry + location + employeeSize + revenue).toBe(100);
  });
});
