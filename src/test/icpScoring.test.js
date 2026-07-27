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

  it('scores a partial match (industry only, size/location unknown) in the 60-80 band', () => {
    const company = { industry: 'Credit Unions' }; // no size/location/revenue data
    const score = calculateICPScore(company, FULL_ICP);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(80);
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
    const scores = companies.map((c) => calculateICPScore(c, FULL_ICP));
    const unique = new Set(scores);
    expect(unique.size).toBeGreaterThanOrEqual(4); // clearly differentiated
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

  it('treats a configured-but-missing dimension as neutral, not a hard miss', () => {
    // Industry matches; size configured but company has no size data → 50 neutral.
    const icp = { industries: ['SaaS'], companySizes: ['51-100'] };
    const score = calculateICPScore({ industry: 'SaaS' }, icp);
    // industry(100)*50 + size(50)*15, normalized over 65 weight → ~88.5 → not 100, not 50.
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
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
    expect(reason).toContain('your target industry (Credit Unions)'); // uses ICP casing
    expect(reason).toContain('company size (101-200)');
    expect(reason).toContain('location (TX)');
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
    expect(reason).toMatch(/partial ICP fit/i);
  });

  it('falls back gracefully with no ICP', () => {
    expect(generateMatchReason({ industry: 'X' }, null)).toMatch(/no ICP/i);
  });
});

describe('scoreCompany', () => {
  it('returns score, reason, and breakdown together', () => {
    const result = scoreCompany(
      { industry: 'Credit Unions', employee_count: 150, state: 'TX', revenue_range: '$5M-$10M' },
      FULL_ICP
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.reason).toContain('Credit Unions');
    expect(result.breakdown.totalScore).toBe(result.score);
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
