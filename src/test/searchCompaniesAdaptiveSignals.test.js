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
    expect(q.q_organization_keyword_tags).toEqual(
      expect.arrayContaining(['construction', 'real estate', 'contractor']),
    );
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
