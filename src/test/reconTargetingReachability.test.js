/**
 * Tier 3 — does Scout actually search using the targeting intelligence
 * associated with that ICP?
 *
 * The governing path is acquisition → authoritative ICP → projection → Scout
 * targeting. RECON is an acquisition method, not a second source of truth, so
 * these tests assert what RECON §3 does and does NOT reach, and that the only
 * things called "ICP-targeted" are constraints Apollo actually receives.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// search-companies pulls in the admin SDK transitively, which initialises at
// module load and needs real credentials. buildApolloQuery is pure, so the
// surrounding infrastructure is stubbed — same approach as
// searchCompaniesAdaptiveSignals.test.
vi.mock('../../netlify/functions/firebase-admin.js', () => ({ default: {}, db: {}, admin: {} }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));

const { buildApolloQuery } = await import('../../netlify/functions/search-companies.js');

const here = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(here, rel), 'utf8');
const searchFn = read('../../netlify/functions/search-companies.js');

describe('Which ICP fields become real Apollo constraints', () => {
  it.each([
    ['industries', { industries: ['Accounting'] }, 'q_organization_keyword_tags'],
    ['companyKeywords', { companyKeywords: ['saas'] }, 'q_organization_keyword_tags'],
    ['companySizes', { companySizes: ['11-20'] }, 'organization_num_employees_ranges'],
    ['locations', { locations: ['Texas'] }, 'organization_locations'],
    ['isNationwide', { isNationwide: true }, 'organization_locations'],
  ])('%s narrows the query via %s', (_field, profile, param) => {
    const query = buildApolloQuery(profile, null);

    expect(query[param]).toBeDefined();
    expect(query[param].length).toBeGreaterThan(0);
  });

  it('an empty profile produces no constraint at all — an unfiltered global query', () => {
    const query = buildApolloQuery({}, null);

    expect(query.q_organization_keyword_tags).toBeUndefined();
    expect(query.organization_num_employees_ranges).toBeUndefined();
    expect(query.organization_locations).toBeUndefined();
    expect(Object.keys(query).sort()).toEqual(['page', 'per_page']);
  });

  it('lookalikeSeed produces NO constraint — it is logged, never sent', () => {
    const seeded = buildApolloQuery({ lookalikeSeed: { name: 'Acme Corp' } }, null);
    const bare = buildApolloQuery({}, null);

    expect(seeded).toEqual(bare);
  });

  it('targetTitles produce no company-search constraint', () => {
    const withTitles = buildApolloQuery({ targetTitles: ['VP Sales'] }, null);

    expect(withTitles).toEqual(buildApolloQuery({}, null));
  });

  it('revenueRanges produce no constraint — the parameter is disabled', () => {
    const withRevenue = buildApolloQuery({ revenueRanges: ['$1M-$2M'], skipRevenue: false }, null);

    expect(withRevenue.revenue_range).toBeUndefined();
    expect(withRevenue).toEqual(buildApolloQuery({}, null));
  });

  it('structured industry IDs are not sent — the free-text path is the live one', () => {
    const query = buildApolloQuery({ industries: ['Accounting'] }, null);

    expect(query.organization_industry_tag_ids).toBeUndefined();
    expect(query.q_organization_keyword_tags).toEqual(['accounting']);
  });

  it('avoidIndustries reaches nothing — it is not even read here', () => {
    const query = buildApolloQuery({ industries: ['Accounting'], avoidIndustries: 'Government' }, null);

    expect(JSON.stringify(query)).not.toMatch(/government/i);
  });
});

describe('D7 — the first-search gate matches the real constraint set', () => {
  const onboarding = read('../pages/Onboarding/BarryOnboarding.jsx');

  // B5 moved the rule out of the component and into targetingProposal.js, so
  // the proposal Barry makes and the gate the search runs behind are the same
  // rule rather than two copies of it. These read it where it now lives.
  const gateModule = read('../utils/targetingProposal.js');

  it('the gate counts only fields that produce a constraint', () => {
    const at = gateModule.indexOf('export function retrievalConstraints');
    const gate = gateModule.slice(at, gateModule.indexOf('\n}', at));

    for (const field of ['industries', 'companyKeywords', 'companySizes', 'locations', 'isNationwide', 'foundedAgeRange']) {
      expect(gate, `gate omits ${field}`).toMatch(new RegExp(field));
    }
  });

  it('the gate no longer counts lookalikeSeed', () => {
    const at = gateModule.indexOf('export function retrievalConstraints');
    const gate = gateModule.slice(at, gateModule.indexOf('\n}', at));

    expect(gate).not.toMatch(/lookalikeSeed/);
  });

  it('and the component is wired to it rather than carrying its own', () => {
    expect(onboarding).toMatch(/const canSearch = hasRetrievalConstraint\(icpProfile\)/);
    expect(onboarding).not.toMatch(/const hasRetrievalConstraint =/);
  });
});

describe('RECON §3 does not reach the query — it is not a second source of truth', () => {
  it('buildApolloQuery reads no RECON field name', () => {
    const at = searchFn.indexOf('export function buildApolloQuery');
    const body = searchFn.slice(at, at + 3000);

    for (const reconField of ['targetIndustries', 'avoidIndustries', 'geography', 'revenueRange', 'growthStage', 'companyType', 'marketSize']) {
      expect(body, `buildApolloQuery reads RECON's ${reconField}`).not.toMatch(new RegExp(reconField));
    }
  });

  it('search-companies never reads the RECON dashboard document', () => {
    expect(searchFn).not.toMatch(/dashboards/);
    expect(searchFn).not.toMatch(/modules\[/);
  });

  it('RECON §3 reaches Barry as prompt context only', () => {
    const compiler = read('../../netlify/functions/utils/reconCompiler.js');

    expect(compiler).toMatch(/Section 3: Target Market/);
    expect(compiler).toMatch(/parts\.push\('TARGET MARKET:'\)/);
  });
});

describe('Eligibility stays distinct from Match', () => {
  it('passesAgeFilter is the live server-side gate', () => {
    expect(searchFn).toMatch(/function passesAgeFilter/);
    expect(searchFn).toMatch(/passesAgeFilter\(company, foundedAgeRange\)/);
  });

  it('it excludes rather than scores — a gate, not a ranking signal', () => {
    const at = searchFn.indexOf('function passesAgeFilter');
    const body = searchFn.slice(at, searchFn.indexOf('\n}', at));

    expect(body).toMatch(/return (true|false)/);
    expect(body).not.toMatch(/score|weight|match/i);
  });

  it('unknown founded_year passes rather than being silently excluded', () => {
    const at = searchFn.indexOf('function passesAgeFilter');
    const body = searchFn.slice(at, searchFn.indexOf('\n}', at));

    expect(body).toMatch(/founded === null\) return true/);
  });

  it('no Eligibility rule is derived from a Match score', () => {
    const at = searchFn.indexOf('function passesAgeFilter');
    const body = searchFn.slice(at, searchFn.indexOf('\n}', at));

    expect(body).not.toMatch(/fit_score/);
  });
});

describe('The questionnaire cannot mis-attribute a search', () => {
  const questionnaire = read('../components/scout/CompanyQuestionnaire.jsx');

  it('no longer calls search-companies at all', () => {
    expect(questionnaire).not.toMatch(/'\/\.netlify\/functions\/search-companies'/);
  });

  it('leaves no unreachable request-building code behind', () => {
    expect(questionnaire).not.toMatch(/companyProfile: formData/);
    expect(questionnaire).not.toMatch(/no-unreachable/);
  });

  it('still saves the answers it collected', () => {
    expect(questionnaire).toMatch(/setDoc\(profileRef/);
  });
});
