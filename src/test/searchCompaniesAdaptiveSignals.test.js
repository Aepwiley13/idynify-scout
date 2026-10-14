/**
 * Adaptive signals reaching Apollo's ORGANISATION search — #564.
 *
 * `savedIndustries` is a real signal: it is prepended to the keyword tags so
 * Apollo weights it ahead of the user's declared industries. `savedTitles` was
 * collected client-side, sent, and only logged — it never reached the query,
 * because this endpoint is mixed_companies/search and person titles belong to
 * mixed_people/api_search.
 *
 * The fix removed the collection rather than wiring titles in, so these tests
 * pin both halves: the industry signal must still work, and a title signal must
 * never leak into an organisation query even if a caller sends one. Folding
 * titles into q_organization_keyword_tags would match companies whose keywords
 * read like job titles rather than companies employing those people.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// search-companies imports the admin SDK transitively, which initialises at
// module load and needs real service-account credentials. buildApolloQuery is
// pure, so the surrounding infrastructure is stubbed rather than configured.
vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  default: {},
  db: {},
  admin: {},
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({
  verifyAuthToken: vi.fn().mockResolvedValue({ tokenUserId: 'user-1' }),
}));

const { buildApolloQuery } = await import('../../netlify/functions/search-companies.js');
const { COMPANY_SIZE_OPTIONS } = await import('../constants/targetingCanon.js');

const PROFILE = {
  industries: ['Construction', 'Real Estate'],
  companyKeywords: ['contractor'],
  companySizes: ['11-20'],
  locations: ['Texas'],
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('buildApolloQuery — adaptive industry signal', () => {
  it('prepends saved industries so Apollo weights them first', () => {
    const q = buildApolloQuery(PROFILE, { savedIndustries: ['Roofing'] });

    expect(q.q_organization_keyword_tags[0]).toBe('roofing');
    expect(q.q_organization_keyword_tags).toEqual(['roofing', 'construction', 'real estate', 'contractor']);
    expect(q.organization_industry_tag_ids).toBeUndefined();
  });

  it('does not duplicate an industry the profile already declares', () => {
    const q = buildApolloQuery(PROFILE, { savedIndustries: ['Construction'] });
    const occurrences = q.q_organization_keyword_tags.filter(t => t === 'construction');

    expect(occurrences).toHaveLength(1);
  });

  it('builds the same query when no adaptive signals are supplied', () => {
    const without = buildApolloQuery(PROFILE, undefined);
    const empty = buildApolloQuery(PROFILE, { savedIndustries: [] });

    expect(empty).toEqual(without);
  });
});

describe('buildApolloQuery — person titles never reach an organisation query', () => {
  const TITLES = ['VP of Sales', 'Head of Operations', 'Chief Revenue Officer'];

  it('ignores savedTitles entirely', () => {
    const withTitles = buildApolloQuery(PROFILE, { savedTitles: TITLES });
    const without = buildApolloQuery(PROFILE, {});

    expect(withTitles).toEqual(without);
  });

  it('never leaks a title into the keyword tags', () => {
    const q = buildApolloQuery(PROFILE, {
      savedIndustries: ['Roofing'],
      savedTitles: TITLES,
    });

    for (const title of TITLES) {
      expect(q.q_organization_keyword_tags).not.toContain(title);
      expect(q.q_organization_keyword_tags).not.toContain(title.toLowerCase());
    }
  });

  it('emits no person-title parameter of any kind', () => {
    const q = buildApolloQuery(PROFILE, { savedTitles: TITLES });
    const keys = Object.keys(q).join(' ').toLowerCase();

    expect(keys).not.toContain('title');
    expect(q.person_titles).toBeUndefined();
  });
});

/**
 * Industries reach Apollo as lowercased keyword tags, never as
 * organization_industry_tag_ids.
 *
 * Production A/B against mixed_companies/search (Utah, every size, Computer
 * Software), run in the deployed runtime:
 *   Utah only                        73,240
 *   tag ID only                           0
 *   keyword "computer software"   2,093,188
 *   production query with tag ID          0
 *   same, no industry                59,872
 *   same, keyword instead of tag ID   5,693
 * The APOLLO_INDUSTRIES tag IDs match nothing, so every search carrying one
 * returned zero. Tag IDs were removed for the same reason in Dec 2025 and
 * re-introduced Sep 15 2026.
 */
describe('buildApolloQuery — industries are keyword tags, never tag IDs', () => {
  it('Utah + every company size + Computer Software builds exactly the query verified in production', () => {
    const q = buildApolloQuery({
      industries: ['Computer Software'],
      companySizes: COMPANY_SIZE_OPTIONS,
      locations: ['Utah'],
    });

    // Arm RK of the production A/B: 5,693 results. The same query with
    // organization_industry_tag_ids instead of the keyword returned 0.
    expect(q).toEqual({
      page: 1,
      per_page: 50,
      q_organization_keyword_tags: ['computer software'],
      organization_num_employees_ranges: [
        '1,10', '11,20', '21,50', '51,100', '101,200', '201,500',
        '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,999999',
      ],
      organization_locations: ['Utah, United States'],
    });
  });

  it('a mapped industry is sent as a keyword, with no tag ID', () => {
    const q = buildApolloQuery({ industries: ['Computer Software'], locations: ['Utah'] });

    expect(q.q_organization_keyword_tags).toEqual(['computer software']);
    expect(q.organization_industry_tag_ids).toBeUndefined();
  });

  it('an alias is sent as the industry the user chose, lowercased, not its canonical name', () => {
    const q = buildApolloQuery({ industries: ['SaaS'] });

    expect(q.q_organization_keyword_tags).toEqual(['saas']);
    expect(q.organization_industry_tag_ids).toBeUndefined();
  });

  it('an unmapped industry is sent the same way', () => {
    const q = buildApolloQuery({ industries: ['Not A Real Industry'], locations: ['Utah'] });

    expect(q.q_organization_keyword_tags).toEqual(['not a real industry']);
    expect(q.organization_industry_tag_ids).toBeUndefined();
  });

  it('industries come before explicit companyKeywords in the keyword tags', () => {
    const q = buildApolloQuery({
      industries: ['Computer Software'],
      locations: ['Utah'],
      companyKeywords: ['B2B'],
    });

    expect(q.q_organization_keyword_tags).toEqual(['computer software', 'b2b']);
    expect(q.organization_locations).toEqual(['Utah, United States']);
  });

  it('location behavior is unchanged', () => {
    const multiState = buildApolloQuery({ locations: ['Utah', 'Idaho'] });
    expect(multiState.organization_locations).toEqual(['Utah, United States', 'Idaho, United States']);

    const nationwide = buildApolloQuery({ isNationwide: true });
    expect(nationwide.organization_locations).toEqual(['United States']);
  });

  it('company-size behavior is unchanged', () => {
    const q = buildApolloQuery({
      locations: ['Utah'],
      companySizes: ['51-100', '101-200'],
    });

    expect(q.organization_num_employees_ranges).toEqual(['51,100', '101,200']);
  });

  it('explicit companyKeywords remain supported with no industries set', () => {
    const q = buildApolloQuery({
      locations: ['Utah'],
      companyKeywords: ['agency', 'startup'],
    });

    expect(q.organization_industry_tag_ids).toBeUndefined();
    expect(q.q_organization_keyword_tags).toEqual(['agency', 'startup']);
  });
});
