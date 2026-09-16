/**
 * An absent industry is unmeasured, not a miss.
 *
 * Discovery used to stamp the string 'Unknown' onto any company Apollo returned
 * without industry data. That string is truthy, so the scorer treated it as a
 * real industry that happened to match nothing: a hard 0 on the industry
 * dimension rather than the `unknown: true` signal G1-06 defines for "we could
 * not evaluate this". validateCompanyData then dropped the company at the
 * `fit_score < 50` gate. An industry-poor Apollo batch therefore filtered itself
 * down to an empty queue — the zero-result P0 — caused entirely by a sentinel
 * the pipeline wrote onto its own data.
 *
 * The second half of the same defect lived in the gate. calculateICPScore
 * returns null for "configured, but nothing measurable", and `null < 50` is
 * TRUE in JavaScript because null coerces to 0. So even once 'Unknown' stopped
 * being written, a company whose only configured dimension was unmeasurable
 * was still rejected as if it had scored zero.
 *
 * G1-06 is unchanged here and deliberately so: an unmeasured dimension stays
 * out of both numerator and denominator. These tests assert that the placeholder
 * and the genuinely-absent field now reach that same path, and that the fit gate
 * stops conflating "not measurable" with "measured badly".
 */

import { describe, it, expect, vi } from 'vitest';

// search-companies.js reaches firebase-admin through logApiUsage at module load,
// which asserts on real credentials. validateCompanyData is a pure function and
// touches none of it; these stubs exist only so the module can be imported.
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  db: {}, admin: { auth: () => ({}) },
}));

import { calculateICPScore, getScoreBreakdown } from '../utils/icpScoring.js';
import { validateCompanyData } from '../../netlify/functions/search-companies.js';

const INDUSTRY_ONLY = { industries: ['Computer Software'] };
const INDUSTRY_PLUS_LOCATION = { industries: ['Computer Software'], locations: ['CA'] };

/** Mirrors the pipeline: score the company, then put it through the save gate. */
function scoreThenGate(company, icp) {
  const fit_score = calculateICPScore(company, icp);
  const passes = validateCompanyData({
    name: company.name || 'Acme Inc',
    ...company,
    fit_score,
  });
  return { fit_score, passes };
}

describe('industry placeholders resolve to absent, not to a miss', () => {
  it("'Unknown' scores as unmeasured and is no longer filtered", () => {
    const { fit_score, passes } = scoreThenGate(
      { name: 'Placeholder Co', industry: 'Unknown', headquarters_location: 'Reno, NV' },
      INDUSTRY_ONLY,
    );
    expect(fit_score).toBeNull();
    expect(passes).toBe(true);
  });

  it("'Unknown Industry' — the other spelling — resolves the same way", () => {
    const b = getScoreBreakdown(
      { industry: 'Unknown Industry', headquarters_location: 'Reno, NV' },
      INDUSTRY_ONLY,
    );
    expect(b.industry.unknown).toBe(true);
    expect(b.industry.state).toBe('unknown');
  });

  it('a genuinely absent industry behaves identically to the placeholder', () => {
    const placeholder = calculateICPScore({ industry: 'Unknown' }, INDUSTRY_ONLY);
    const absent = calculateICPScore({}, INDUSTRY_ONLY);
    expect(placeholder).toBe(absent);
    expect(placeholder).toBeNull();
  });

  it('an empty or whitespace industry is absent, not a miss', () => {
    for (const v of ['', '   ', '\t']) {
      expect(getScoreBreakdown({ industry: v }, INDUSTRY_ONLY).industry.unknown).toBe(true);
    }
  });

  it('a real industry that simply does not match is still a MISS, not unknown', () => {
    const b = getScoreBreakdown({ industry: 'Restaurants' }, INDUSTRY_ONLY);
    expect(b.industry.unknown).toBe(false);
    expect(b.industry.state).toBe('missed');
    expect(b.industry.match).toBe(0);
  });
});

describe('legacy field names still resolve', () => {
  it('reads primary_industry when industry is absent', () => {
    expect(calculateICPScore({ primary_industry: 'Computer Software' }, INDUSTRY_ONLY)).toBe(100);
  });

  it('reads company_industry when the other two are absent', () => {
    expect(calculateICPScore({ company_industry: 'Computer Software' }, INDUSTRY_ONLY)).toBe(100);
  });

  it("a legacy row carrying 'Unknown' in primary_industry is absent, not a miss", () => {
    const b = getScoreBreakdown({ primary_industry: 'Unknown' }, INDUSTRY_ONLY);
    expect(b.industry.unknown).toBe(true);
  });
});

describe('loose vocabulary still canonicalizes', () => {
  it("'nonprofit' matches an ICP written as 'Non-Profit Organization Management'", () => {
    const icp = { industries: ['Non-Profit Organization Management'] };
    expect(calculateICPScore({ industry: 'nonprofit' }, icp)).toBe(100);
  });

  it("'SaaS' matches an ICP written as 'Computer Software'", () => {
    expect(calculateICPScore({ industry: 'SaaS' }, INDUSTRY_ONLY)).toBe(100);
  });

  it('an unsupported but real industry is not discarded — it gets a raw comparison', () => {
    const icp = { industries: ['Artisanal Widgetry'] };
    expect(calculateICPScore({ industry: 'artisanal widgetry' }, icp)).toBe(100);
  });
});

describe('the fit gate distinguishes unmeasurable from badly scored', () => {
  it('a null fit_score passes — nothing was measured, so nothing was failed', () => {
    expect(validateCompanyData({ name: 'A', industry: 'Software', fit_score: null })).toBe(true);
  });

  it('an undefined fit_score passes for the same reason', () => {
    expect(validateCompanyData({ name: 'A', industry: 'Software' })).toBe(true);
  });

  it('a real score below the threshold is still filtered', () => {
    expect(validateCompanyData({ name: 'A', industry: 'Software', fit_score: 33 })).toBe(false);
    expect(validateCompanyData({ name: 'A', industry: 'Software', fit_score: 0 })).toBe(false);
  });

  it('exactly 50 passes, as before', () => {
    expect(validateCompanyData({ name: 'A', industry: 'Software', fit_score: 50 })).toBe(true);
  });

  it('a company with neither industry nor location is still rejected', () => {
    expect(validateCompanyData({ name: 'A', fit_score: null })).toBe(false);
  });
});

describe('location still carries the score when industry is unmeasured', () => {
  it('location match scores from location alone and passes', () => {
    const { fit_score, passes } = scoreThenGate(
      { name: 'LocHit', headquarters_location: 'San Francisco, CA' },
      INDUSTRY_PLUS_LOCATION,
    );
    expect(fit_score).toBe(100);
    expect(passes).toBe(true);
  });

  it('location mismatch scores low from location alone and is filtered', () => {
    const { fit_score, passes } = scoreThenGate(
      { name: 'LocMiss', headquarters_location: 'Albany, NY' },
      INDUSTRY_PLUS_LOCATION,
    );
    expect(fit_score).toBe(0);
    expect(passes).toBe(false);
  });
});

describe('the industry-poor batch that used to return zero', () => {
  // Ten companies as Apollo returns them when its industry coverage is thin:
  // a location, no industry. Previously each was stamped 'Unknown', scored 33
  // against this ICP, and was dropped at the gate — an empty Daily Discoveries
  // queue with no error anywhere to explain it.
  const BATCH = Array.from({ length: 10 }, (_, i) => ({
    name: `Industry-Poor Co ${i + 1}`,
    headquarters_location: 'San Francisco, CA',
  }));

  it('every company survives the gate instead of the batch filtering to empty', () => {
    const survivors = BATCH.filter((c) => scoreThenGate(c, INDUSTRY_PLUS_LOCATION).passes);
    expect(survivors).toHaveLength(10);
  });

  it('the old behaviour is what regressed: a stamped placeholder scored 33 and failed', () => {
    // Reproduces the pre-fix pipeline exactly — the sentinel the writer used to
    // apply — and asserts the gate would have rejected it.
    const stamped = { name: 'Old', industry: 'Unknown', headquarters_location: 'San Francisco, CA' };
    expect(validateCompanyData({ ...stamped, fit_score: 33 })).toBe(false);

    // Same company, scored by the current code, now clears the gate.
    expect(scoreThenGate(stamped, INDUSTRY_PLUS_LOCATION).passes).toBe(true);
  });

  it('a batch that genuinely mismatches on location still filters to empty', () => {
    const wrongCoast = BATCH.map((c) => ({ ...c, headquarters_location: 'Albany, NY' }));
    const survivors = wrongCoast.filter((c) => scoreThenGate(c, INDUSTRY_PLUS_LOCATION).passes);
    expect(survivors).toHaveLength(0);
  });
});

describe('G1-06 is preserved, not reversed', () => {
  it('an unmeasured dimension stays out of numerator and denominator', () => {
    const b = getScoreBreakdown({ headquarters_location: 'San Francisco, CA' }, INDUSTRY_PLUS_LOCATION);
    expect(b.industry.unknown).toBe(true);
    expect(b.industry.contribution).toBeNull();
    expect(b.evaluatedWeight).toBeLessThan(b.totalConfiguredWeight);
  });

  it('the unknown signal survives in the breakdown for a future UI or backfill', () => {
    const b = getScoreBreakdown({ industry: 'Unknown' }, INDUSTRY_ONLY);
    expect(b.industry).toMatchObject({ unknown: true, state: 'unknown', contribution: null });
  });

  it('still returns null — never 0 — when nothing is measurable', () => {
    expect(calculateICPScore({ industry: 'Unknown' }, INDUSTRY_ONLY)).toBeNull();
  });
});
