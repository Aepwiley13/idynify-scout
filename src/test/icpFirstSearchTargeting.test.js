/**
 * D7 — first-search targeting sufficiency, per confirmed-onboarding case.
 *
 * A search may be called ICP-targeted only when at least one retrieval
 * constraint derived from the intended ICP demonstrably narrows the result set.
 * BarryOnboarding gates its first search on `hasRetrievalConstraint`; this test
 * evaluates that predicate as written in the source against the five cases,
 * so the gate cannot drift from the fields Apollo actually constrains on.
 *
 * `buildApolloQuery` (search-companies.js) is the authority for which fields
 * become retrieval constraints:
 *   industries      → q_organization_keyword_tags
 *   companyKeywords → q_organization_keyword_tags
 *   lookalikeSeed   → q_organization_keyword_tags
 *   companySizes    → organization_num_employees_ranges
 *   locations       → organization_locations
 *   foundedAgeRange → post-fetch passesAgeFilter
 * targetTitles constrain a PEOPLE search, not a company search, and
 * revenueRanges are commented out of the query.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const onboarding = readFileSync(resolve(here, '../pages/Onboarding/BarryOnboarding.jsx'), 'utf8');
const searchFn = readFileSync(resolve(here, '../../netlify/functions/search-companies.js'), 'utf8');

/** Lift the predicate out of the source and make it callable. */
function hasRetrievalConstraint(icpProfile) {
  const at = onboarding.indexOf('const hasRetrievalConstraint =');
  if (at === -1) throw new Error('hasRetrievalConstraint gate not found in BarryOnboarding');
  const expr = onboarding.slice(at + 'const hasRetrievalConstraint ='.length);
  const body = expr.slice(0, expr.indexOf(';'));
  return new Function('icpProfile', `return (${body});`)(icpProfile);
}

const BASE = { targetTitles: ['VP Sales'], revenueRanges: ['$1M-$2M'], scoringWeights: {} };

describe('D7 — which confirmed definitions may start a search', () => {
  it.each([
    ['industry present', { ...BASE, industries: ['Dental'] }],
    ['location present', { ...BASE, locations: ['Texas'] }],
    ['company size present', { ...BASE, companySizes: ['11-20'] }],
    ['company keywords present', { ...BASE, companyKeywords: ['orthodontics'] }],
    ['lookalike seed present', { ...BASE, lookalikeSeed: { name: 'Acme' } }],
    ['founded age range present', { ...BASE, foundedAgeRange: { minAge: 0, maxAge: 5 } }],
  ])('%s → search runs', (_label, profile) => {
    expect(hasRetrievalConstraint(profile)).toBe(true);
  });

  it('only unsupported/non-retrieval fields → no unfiltered Apollo search', () => {
    // Titles do not constrain a company search; revenue is not sent to Apollo.
    expect(hasRetrievalConstraint(BASE)).toBe(false);
  });

  it('empty confirmed definition → no search', () => {
    expect(hasRetrievalConstraint({})).toBe(false);
  });

  it('empty arrays do not count as constraints', () => {
    expect(hasRetrievalConstraint({ industries: [], locations: [], companySizes: [] })).toBe(false);
  });
});

describe('D7 — the gate matches what buildApolloQuery actually constrains on', () => {
  it.each([
    ['industries', /companyProfile\.industries[\s\S]{0,200}keywordTags\.push/],
    ['companyKeywords', /companyProfile\.companyKeywords[\s\S]{0,200}keywordTags\.push/],
    ['companySizes', /organization_num_employees_ranges = companyProfile\.companySizes/],
    ['locations', /query\.organization_locations = formatStatesForApollo/],
    ['lookalikeSeed', /companyProfile\.lookalikeSeed\?\.name/],
  ])('%s reaches the Apollo query', (_field, pattern) => {
    expect(searchFn).toMatch(pattern);
  });

  it('revenue ranges are still commented out, so they cannot narrow a query', () => {
    expect(searchFn).toMatch(/\/\/\s*if \(companyProfile\.revenueRanges/);
  });

  it('targetTitles never becomes a company-search constraint', () => {
    const at = searchFn.indexOf('export function buildApolloQuery');
    const fnBody = searchFn.slice(at, at + 3000);
    expect(fnBody).not.toMatch(/targetTitles/);
  });
});

describe('D7 — the confirmed identity is what reaches the search', () => {
  it('zero ICP cannot reach search-companies from onboarding at all', () => {
    // The ICP is created inside handleConfirm before the search block, so the
    // "zero ICP" case cannot coexist with a search from this path.
    const confirmAt = onboarding.indexOf('async function handleConfirm()');
    const icpWriteAt = onboarding.indexOf("'icpProfiles'", confirmAt);
    const searchAt = onboarding.indexOf("'/.netlify/functions/search-companies'", confirmAt);

    expect(icpWriteAt).toBeGreaterThan(confirmAt);
    expect(searchAt).toBeGreaterThan(icpWriteAt);
  });

  it('the search body carries the created icpId, not a profile-shaped guess', () => {
    const searchAt = onboarding.indexOf("'/.netlify/functions/search-companies'");
    expect(onboarding.slice(searchAt, searchAt + 400)).toMatch(/\bicpId\b/);
  });

  it('search-companies rejects the request if that identity is ever missing', () => {
    expect(searchFn).toMatch(/if \(!icpId\)[\s\S]{0,400}statusCode: 400/);
  });
});
