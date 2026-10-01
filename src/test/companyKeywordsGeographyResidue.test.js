/**
 * Jordan River production incident — companyKeywords geography residue.
 *
 * Production: a Mission Control confirmation for "companies headquartered in
 * Salt Lake County, 500+ employees, Utah, lookalike Zions Bank" persisted
 * companyKeywords: ["headquarters"]. search-companies sent that straight to
 * Apollo as q_organization_keyword_tags: ["headquarters"] and Apollo returned
 * zero organizations — confirmed from the actual production Netlify log,
 * before dedup, queueing, or Daily Discoveries ever ran.
 *
 * companyKeywords is documented to the model as "company type" signals
 * (saas, agency, startup) and has no field for sub-state geography once
 * locations is reduced to the state-level US_STATES whitelist. Unlike
 * industries/companySizes/locations, it previously had no validation at
 * all, so the model's attempt to preserve "headquartered in Salt Lake
 * County" landed as a nonsensical, zero-matching Apollo keyword filter
 * instead of being dropped.
 *
 * These tests assert the fix at the extraction boundary (barryICPConversation
 * .js's sanitizeCompanyKeywords, wired into all three extraction functions)
 * AND the final effective Apollo query shape produced from that extraction
 * — not just the sanitizer in isolation — per the exact Jordan River
 * production case, plus a legitimate company-type keyword that must
 * continue to survive and reach Apollo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../netlify/functions/firebase-admin.js', () => ({
  default: {}, db: {}, admin: {},
}));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));

// ── Part 1: the sanitizer itself — every example term the diagnosis named,
//    plus phrase form, must be stripped; legitimate type signals survive. ──

import { sanitizeCompanyKeywords } from '../../netlify/functions/barryICPConversation.js';

describe('sanitizeCompanyKeywords — geography/structural residue blocklist', () => {
  it('strips every geography/structural residue term named in the production diagnosis', () => {
    const residue = [
      'headquarters', 'headquartered', 'located', 'based',
      'county', 'city', 'metro', 'near', 'local',
    ];
    expect(sanitizeCompanyKeywords(residue)).toEqual([]);
  });

  it('strips a residue word embedded in a multi-word phrase', () => {
    expect(sanitizeCompanyKeywords(['headquartered in salt lake'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['based near downtown'])).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(sanitizeCompanyKeywords(['Headquarters', 'HEADQUARTERED'])).toEqual([]);
  });

  it('leaves legitimate company-type keywords untouched, including ones beyond SPECIFICITY_TRIGGERS', () => {
    const legit = ['saas', 'agency', 'startup', 'consultancy', 'platform', 'vendor', 'provider', 'boutique', 'enterprise', 'fintech', 'e-commerce'];
    expect(sanitizeCompanyKeywords(legit)).toEqual(legit);
  });

  it('drops only the residue entries out of a mixed array, keeping the rest', () => {
    expect(sanitizeCompanyKeywords(['saas', 'headquarters', 'agency'])).toEqual(['saas', 'agency']);
  });
});

// ── Part 1b: pre-merge correction — "based", "local" and "city" are also
//    legitimate company-type language, not exclusively geography. A flat
//    "any whole word" rule dropped "account-based marketing", "local
//    government" and "city government" along with real residue. The refined
//    rule must still catch every required Jordan River phrase while leaving
//    these alone. ────────────────────────────────────────────────────────────

describe('sanitizeCompanyKeywords — refined rule: phrase context, not blanket word rejection', () => {
  it('DROP — still catches every required Jordan River residue phrase', () => {
    expect(sanitizeCompanyKeywords(['headquarters'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['headquartered in salt lake'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['located in utah'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['based in salt lake city'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['salt lake county'])).toEqual([]);
  });

  it('PRESERVE — legitimate company-type phrases built from the same ambiguous words survive', () => {
    const legit = ['saas', 'fintech', 'e-commerce', 'account-based marketing', 'local government', 'city government'];
    expect(sanitizeCompanyKeywords(legit)).toEqual(legit);
  });

  it('a bare ambiguous word with nothing else is still residue, as before', () => {
    expect(sanitizeCompanyKeywords(['based'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['local'])).toEqual([]);
    expect(sanitizeCompanyKeywords(['city'])).toEqual([]);
  });

  it('"based"/"local" followed by a space instead of a hyphen is still preserved outside a location phrase', () => {
    expect(sanitizeCompanyKeywords(['account based marketing'])).toEqual(['account based marketing']);
    expect(sanitizeCompanyKeywords(['local news'])).toEqual(['local news']);
  });

  it('"local to Salt Lake" is still caught via the location-preposition check', () => {
    expect(sanitizeCompanyKeywords(['local to salt lake'])).toEqual([]);
  });
});

// ── Part 2: the exact Jordan River case, through extraction AND into the
//    final Apollo query shape. ──────────────────────────────────────────────

const CALLS = [];
let extractionReply = null;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: vi.fn(async (req) => {
          CALLS.push(req);
          return { content: [{ text: JSON.stringify(extractionReply) }] };
        }),
      };
    }
  },
}));

describe('Jordan River — companyKeywords no longer carries geography residue into the Apollo query', () => {
  it('extraction strips "headquarters" while preserving locations, sizes, titles, and the lookalike seed', async () => {
    const { processFollowup } = await import('../../netlify/functions/barryICPConversation.js');

    // The exact raw shape the model produced in production, before this fix:
    // "companies headquartered in Salt Lake County" with nowhere structured
    // to go, landing in the one unvalidated field.
    extractionReply = {
      understood: {
        industries: [],
        companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
        locations: ['Utah'],
        targetTitles: ['CEO', 'Founder', 'CMO', 'CSR / Community Relations'],
        companyKeywords: ['headquarters'],
        lookalikeSeed: { name: 'Zions Bank', domain: null },
        foundedAgeRange: null,
      },
      mappingExplanation: "I'll prioritize companies similar to Zions Bank in Utah.",
      needsMoreInfo: false,
      followUpQuestion: null,
      followUpType: null,
      searchStrategy: 'lookalike',
      confidenceScore: 0.95,
      readyToConfirm: true,
      isAmbiguous: false,
      ambiguityDetails: null,
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { barryResponse, step } = await processFollowup(
      new Anthropic(),
      'Zions Bank',
      'awaiting_example',
      [],
      { locations: ['Utah'], companySizes: ['501-1,000'], targetTitles: ['CEO', 'Founder', 'CMO'], industries: [], companyKeywords: [] },
    );

    expect(step).toBe('confirming');

    // The residue is gone...
    expect(barryResponse.understood.companyKeywords).toEqual([]);
    expect(barryResponse.understood.companyKeywords).not.toContain('headquarters');

    // ...and nothing else was touched.
    expect(barryResponse.understood.locations).toEqual(['Utah']);
    expect(barryResponse.understood.companySizes).toEqual(['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+']);
    expect(barryResponse.understood.targetTitles).toEqual(['CEO', 'Founder', 'CMO', 'CSR / Community Relations']);
    expect(barryResponse.understood.lookalikeSeed).toEqual({ name: 'Zions Bank', domain: null });

    globalThis.__sanitizedJordanRiverPendingICP = barryResponse.understood;
  });

  it('the resulting confirmation sends a valid Apollo query with no q_organization_keyword_tags at all', async () => {
    vi.resetModules();

    const STORE = new Map();
    const pathOf = (first, rest) => (first && first.__path ? [first.__path, ...rest] : rest).join('/');
    const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    function write(path, data, options) {
      STORE.set(path, options?.merge ? { ...(STORE.get(path) || {}), ...clone(data) } : clone(data));
    }
    vi.doMock('firebase/firestore', () => ({
      collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
      doc: (first, ...rest) => { const p = pathOf(first, rest); return { __path: p, id: p.split('/').pop() }; },
      getDoc: async ref => { const d = STORE.get(ref.__path); return { exists: () => d !== undefined, data: () => clone(d) }; },
      getDocs: async q => {
        const prefix = q.__path + '/';
        const docs = [...STORE.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => clone(v), ref: { __path: k, id: k.split('/').pop() } }));
        return { empty: docs.length === 0, docs };
      },
      setDoc: async (ref, data, options) => write(ref.__path, data, options),
      writeBatch: () => { const staged = []; return { set: (r, d, o) => staged.push([r.__path, d, o]), update: (r, d) => staged.push([r.__path, d, { merge: true }]), commit: async () => staged.forEach(([p, d, o]) => write(p, d, o)) }; },
      query: (q, ...rest) => ({ ...q, __constraints: rest }),
      orderBy: (...a) => ({ __orderBy: a }),
      limit: n => ({ __limit: n }),
    }));
    vi.doMock('../firebase/config', () => ({ db: {} }));
    vi.doMock('../../netlify/functions/firebase-admin.js', () => ({ default: {}, db: {}, admin: {} }));
    vi.doMock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../../netlify/functions/utils/verifyAuthToken.js', () => ({ verifyAuthToken: vi.fn().mockResolvedValue({ tokenUserId: 'jr_user' }) }));

    const { confirmAndActivateIcp } = await import('../utils/confirmAndActivateIcp');
    const { buildApolloQuery } = await import('../../netlify/functions/search-companies.js');

    const sanitizedPendingICP = globalThis.__sanitizedJordanRiverPendingICP || {
      industries: [], companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
      locations: ['Utah'], targetTitles: ['CEO', 'Founder', 'CMO', 'CSR / Community Relations'],
      companyKeywords: [], lookalikeSeed: { name: 'Zions Bank', domain: null },
    };

    let searchBody = null;
    const user = { uid: 'jr_user', getIdToken: async () => 'tok' };
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url === '/.netlify/functions/search-companies') {
        searchBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ companiesAdded: 0 }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { icpProfile, canSearch } = await confirmAndActivateIcp(user, sanitizedPendingICP, 'mission_control');

    expect(canSearch).toBe(true);
    expect(icpProfile.companyKeywords).toEqual([]);
    await new Promise(r => setTimeout(r, 0));
    expect(searchBody.companyProfile.companyKeywords).toEqual([]);

    // The final effective query shape — what actually reaches Apollo.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const apolloQuery = buildApolloQuery(searchBody.companyProfile);

    expect(apolloQuery.q_organization_keyword_tags).toBeUndefined();
    expect(apolloQuery.organization_locations).toEqual(['Utah, United States']);
    expect(apolloQuery.organization_num_employees_ranges).toEqual([
      '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,999999',
    ]);
  });
});

// ── Part 3: a legitimate company-type keyword must still reach Apollo. ─────

describe('Legitimate company-type keyword survives the same boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('"Utah SaaS companies with 500+ employees" keeps "saas" all the way to the Apollo query', async () => {
    vi.resetModules();
    extractionReply = {
      understood: {
        industries: ['Computer Software'],
        companySizes: ['501-1,000'],
        locations: ['Utah'],
        targetTitles: ['Founder', 'VP Sales'],
        companyKeywords: ['saas'],
        lookalikeSeed: null,
        foundedAgeRange: null,
      },
      mappingExplanation: 'Utah SaaS companies, 500+ employees.',
      needsMoreInfo: false, followUpQuestion: null, followUpType: null,
      searchStrategy: 'industry_only', confidenceScore: 0.95, readyToConfirm: true,
      isAmbiguous: false, ambiguityDetails: null,
    };

    const { processFollowup } = await import('../../netlify/functions/barryICPConversation.js');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { barryResponse } = await processFollowup(
      new Anthropic(), 'Utah SaaS companies with 500+ employees', 'clarifying', [],
      { locations: [], companySizes: [], targetTitles: [], industries: [], companyKeywords: [] },
    );

    expect(barryResponse.understood.companyKeywords).toEqual(['saas']);

    const { buildApolloQuery } = await import('../../netlify/functions/search-companies.js');
    const apolloQuery = buildApolloQuery({
      industries: barryResponse.understood.industries,
      companyKeywords: barryResponse.understood.companyKeywords,
      companySizes: barryResponse.understood.companySizes,
      locations: barryResponse.understood.locations,
    });

    expect(apolloQuery.q_organization_keyword_tags).toEqual(
      expect.arrayContaining(['computer software', 'saas']),
    );
  });
});
