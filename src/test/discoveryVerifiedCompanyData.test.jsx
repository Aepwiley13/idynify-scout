/**
 * Discovery stores only what Apollo returned, and nothing presents the ICP's
 * own criteria as a fact about the company.
 *
 * A company reaches Scout because it satisfied the search. That is not
 * evidence that it matches the ICP. Production showed the two conflated:
 *
 *   - a missing industry was written as String(null), so the card read
 *     `INDUSTRY: null`;
 *   - employee count and HQ were never stored, so the scorer had nothing to
 *     measure and the card printed `0/100` beside "Not enough data";
 *   - Barry Intel appended "Matches your ICP criteria: <ICP size> employees",
 *     built from the ICP's settings, not the company.
 *
 * These tests run the real search-companies handler against a routed fetch
 * mock and inspect the Firestore write, then render the real Scout card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({ default: {}, db: {}, admin: {} }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../netlify/functions/utils/icpRelationshipWriter.js', () => ({
  ensureCriteriaVersion: vi.fn().mockResolvedValue(null),
  recordDiscoveryEncounter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user', getIdToken: () => Promise.resolve('t') } },
  db: {},
}));
vi.mock('firebase/firestore', () => new Proxy({}, {
  get: (target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : vi.fn()),
}));
vi.mock('../components/scout/CompanyLogo', () => ({ default: () => <div data-testid="logo" /> }));
vi.mock('../components/scout/ContactTitleSetup', () => ({ default: () => null }));
vi.mock('../components/scout/BarryICPPanel', () => ({ default: () => null, BarryAvatar: () => null }));

const { handler, buildBarryIntel, extractVerifiedCompanyFields, VERIFICATION_NEEDED_MESSAGE } =
  await import('../../netlify/functions/search-companies.js');
const { CompanySwipeCard } = await import('../pages/Scout/DailyLeads.jsx');
const { calculateICPScore, computeCoverage, DEFAULT_WEIGHTS } = await import('../utils/icpScoring.js');
const { getDisplayBarryIntel, getDisplayIndustry } = await import('../utils/companyDisplay.js');

// The production ICP: software, Utah, a spread of sizes.
const ICP = {
  industries: ['Computer Software'],
  locations: ['Utah'],
  companySizes: ['11-20', '21-50', '51-100'],
  targetTitles: ['VP Sales'],
};

// What Apollo search returned for the production card: no industry, no size, no HQ.
const BARE_ORG = {
  id: 'org-bare',
  name: 'Bare Co',
  website_url: 'https://bare.example',
  primary_domain: 'bare.example',
  linkedin_url: null,
  logo_url: null,
  founded_year: 2015,
};

// An organization carrying everything the scorer and card can use.
const RICH_ORG = {
  id: 'org-rich',
  name: 'Rich Co',
  industry: 'Computer Software',
  estimated_num_employees: 35,
  city: 'Lehi',
  state: 'Utah',
  country: 'United States',
  website_url: 'https://rich.example',
  founded_year: 2012,
};

const LEGACY_BARRY_TEXT =
  'Old Co is a this sector company, founded in 2015 (11y old). Matches your ICP criteria: targeting VP Sales, 11-20 employees.';

/** Run the real handler with Apollo returning `orgs`; return what was PATCHed to each company doc. */
async function runDiscovery(orgs) {
  const writes = {};
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('identitytoolkit')) return json({ users: [{ localId: 'user-1' }] });
    if (u.includes('api.apollo.io')) return json({ organizations: orgs, pagination: { total_pages: 1 } });
    if (u.includes(':runQuery')) return json([]);
    if (init.method === 'PATCH' && u.includes('/companies/')) {
      const id = u.split('/companies/')[1].split('?')[0];
      writes[id] = { fields: JSON.parse(init.body).fields, mask: [...new URL(u).searchParams.getAll('updateMask.fieldPaths')] };
      return json({});
    }
    return json({});
  });

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'user-1', authToken: 'tok', companyProfile: ICP, icpId: 'icp-1' }),
  });
  expect(res.statusCode).toBe(200);
  return writes;
}

/** A Firestore REST field map → plain values, as the client reads the doc. */
function plain(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k,
    'stringValue' in v ? v.stringValue
      : 'integerValue' in v ? Number(v.integerValue)
      : 'timestampValue' in v ? v.timestampValue
      : v,
  ]));
}

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.APOLLO_API_KEY = 'test-key';
  process.env.FIREBASE_API_KEY = 'test-fb';
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe('a company Apollo returned with no industry, size or location', () => {
  it('is saved with no fake values: no "null" industry, no size, no HQ', async () => {
    const writes = await runDiscovery([BARE_ORG]);
    const doc = writes['org-bare'];

    expect(doc).toBeDefined();
    for (const field of ['industry', 'employee_count', 'state', 'hq_location']) {
      expect(doc.fields[field]).toBeUndefined();
      expect(doc.mask).not.toContain(field);
    }
    expect(JSON.stringify(doc.fields)).not.toContain('"null"');
  });

  it('gets Barry text that claims no match and says it needs verification', async () => {
    const writes = await runDiscovery([BARE_ORG]);
    const intel = writes['org-bare'].fields.barry_intel.stringValue;

    expect(intel).toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(intel).not.toMatch(/matches your/i);
    expect(intel).not.toContain('this sector');
    // The ICP's own settings must not appear as company facts.
    expect(intel).not.toContain('11-20');
    expect(intel).not.toContain('VP Sales');
  });

  it('scores as unmeasured, and the card shows — and "Not enough data", not 0/100', async () => {
    const writes = await runDiscovery([BARE_ORG]);
    const company = { id: 'org-bare', ...plain(writes['org-bare'].fields) };
    company.fit_score = calculateICPScore(company, ICP, DEFAULT_WEIGHTS);
    expect(company.fit_score).toBeNull();

    const { container } = render(<CompanySwipeCard company={company} icpProfile={ICP} onAccept={() => {}} onReject={() => {}} />);

    expect(screen.getByTestId('icp-match-score').textContent).toBe('—');
    expect(container.textContent).not.toContain('/100');
    expect(container.textContent).toContain('Not enough data');
    expect(container.textContent).not.toMatch(/INDUSTRY\s*null/i);
    expect(container.textContent).toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(container.textContent).not.toMatch(/matches your/i);
  });
});

describe('a company Apollo returned with industry, employee count and location', () => {
  it('is saved with those values in the fields the scorer and card read', async () => {
    const writes = await runDiscovery([RICH_ORG]);
    const doc = plain(writes['org-rich'].fields);

    expect(doc.industry).toBe('Computer Software');
    expect(doc.employee_count).toBe(35);
    expect(doc.state).toBe('Utah');
    expect(doc.hq_location).toBe('Lehi, Utah, United States');
  });

  it('is measured on all three dimensions and scores as a full match', async () => {
    const writes = await runDiscovery([RICH_ORG]);
    const company = plain(writes['org-rich'].fields);

    expect(computeCoverage(company, ICP).complete).toBe(true);
    expect(calculateICPScore(company, ICP, DEFAULT_WEIGHTS)).toBe(100);
  });

  it('displays its real industry, employee count and HQ, with a measured score', async () => {
    const writes = await runDiscovery([RICH_ORG]);
    const company = { id: 'org-rich', ...plain(writes['org-rich'].fields) };
    company.fit_score = calculateICPScore(company, ICP, DEFAULT_WEIGHTS);

    const { container } = render(<CompanySwipeCard company={company} icpProfile={ICP} onAccept={() => {}} onReject={() => {}} />);

    expect(container.textContent).toContain('Computer Software');
    expect(container.textContent).toContain('35');
    expect(container.textContent).toContain('Lehi, Utah, United States');
    expect(screen.getByTestId('icp-match-score').textContent).toBe('100');
    expect(container.textContent).toContain('/100');
  });

  it('gets Barry text built from its own facts, with no verification caveat', () => {
    const intel = buildBarryIntel(RICH_ORG);

    expect(intel).toBe('Rich Co is a Computer Software company, about 35 employees, headquartered in Lehi, Utah, United States, '
      + `founded in 2012 (${new Date().getFullYear() - 2012}y old).`);
    expect(intel).not.toContain(VERIFICATION_NEEDED_MESSAGE);
  });
});

describe('verified fields come only from Apollo, never from placeholders', () => {
  it('ignores placeholder strings and non-positive counts', () => {
    expect(extractVerifiedCompanyFields({
      industry: 'null', primary_industry: 'Unknown', estimated_num_employees: 0, city: 'N/A', state: '', country: null,
    })).toEqual({});
  });

  it('reads primary_location when the flat fields are absent', () => {
    expect(extractVerifiedCompanyFields({
      primary_industry: 'Internet',
      estimated_num_employees: '120',
      primary_location: { city: 'Provo', state: 'Utah', country: 'United States' },
    })).toEqual({
      industry: 'Internet', employee_count: 120, state: 'Utah', hq_location: 'Provo, Utah, United States',
    });
  });
});

describe('a card already in the queue with the old misleading Barry text', () => {
  const OLD_CARD = {
    id: 'old', name: 'Old Co', industry: 'null', founded_year: 2015, fit_score: null, barry_intel: LEGACY_BARRY_TEXT,
  };

  it('does not show the ICP-derived claim as evidence', () => {
    const { container } = render(<CompanySwipeCard company={OLD_CARD} icpProfile={ICP} onAccept={() => {}} onReject={() => {}} />);

    expect(container.textContent).not.toContain('Matches your ICP criteria');
    expect(container.textContent).not.toContain('this sector');
    expect(container.textContent).toContain('Old Co, founded in 2015 (11y old).');
    expect(container.textContent).toContain(VERIFICATION_NEEDED_MESSAGE);
  });

  it('shows no "null" industry and an unmeasured score as —', () => {
    const { container } = render(<CompanySwipeCard company={OLD_CARD} icpProfile={ICP} onAccept={() => {}} onReject={() => {}} />);

    expect(getDisplayIndustry(OLD_CARD)).toBe('N/A');
    expect(container.textContent).not.toMatch(/\bnull\b/);
    expect(screen.getByTestId('icp-match-score').textContent).toBe('—');
  });

  it('leaves current Barry text untouched', () => {
    const current = { barry_intel: buildBarryIntel(RICH_ORG) };
    expect(getDisplayBarryIntel(current)).toBe(current.barry_intel);
  });
});
