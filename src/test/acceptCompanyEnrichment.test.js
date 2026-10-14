/**
 * Accepting a company enriches it once, company-only, without blocking the save.
 *
 * Discovery returns no industry, size or HQ, so an accepted company used to sit
 * in Saved Companies with unknowns until someone opened it. Accepting now
 * starts ONE Apollo organizations/enrich call — no people search, no person
 * matches — whose verified facts land on the same company document through
 * applyCompanyEnrichment. These tests pin the server mode, the cache and
 * duplicate guards, the failure path, the write-back, the score and Barry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── In-memory Firestore ─────────────────────────────────────────────────────
const STORE = new Map();
const pathOf = (first, rest) => (first && first.__path ? [first.__path, ...rest] : rest).join('/');
const snap = (ref) => {
  const data = STORE.get(ref.__path);
  return { exists: () => data !== undefined, data: () => data, id: ref.id, ref };
};

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => { const p = pathOf(first, rest); return { __path: p, id: p.split('/').pop() }; },
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: n }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  getDoc: async (ref) => snap(ref),
  getDocs: async (q) => {
    const prefix = q.ref.__path + '/';
    const wheres = q.clauses.filter(c => c.__where);
    const docs = [...STORE.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .filter(([, v]) => wheres.every(w => v[w.field] === w.value))
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: { __path: k } }));
    return { empty: docs.length === 0, docs };
  },
  setDoc: async (ref, data, opts) => {
    STORE.set(ref.__path, opts?.merge ? { ...(STORE.get(ref.__path) ?? {}), ...data } : data);
  },
  updateDoc: async (ref, data) => {
    await Promise.resolve();
    if (!STORE.has(ref.__path)) throw new Error(`no document: ${ref.__path}`);
    STORE.set(ref.__path, { ...STORE.get(ref.__path), ...data });
  },
  deleteDoc: async (ref) => { STORE.delete(ref.__path); },
  runTransaction: async (_db, fn) => fn({ get: async (ref) => snap(ref), set: (ref, data) => STORE.set(ref.__path, data) }),
}));
vi.mock('../firebase/config', () => ({
  db: { __db: true },
  auth: { currentUser: { uid: 'user-1', getIdToken: async () => 'tok' } },
}));
vi.mock('../services/contactWriteGuard', () => ({
  prepareContactWrite: async () => ({ action: 'create', fields: {} }),
  applyContactMerge: async () => {},
}));
vi.mock('../services/icpRelationshipService', () => ({
  recordDecision: async () => {}, recordSkip: async () => {}, recordPersonEncounter: async () => {},
}));
// The server function's own dependencies.
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../netlify/functions/utils/verifyAuthToken.js', () => ({ verifyAuthToken: vi.fn().mockResolvedValue({}) }));

const {
  enrichAcceptedCompany, resetEnrichmentGuards, isEnrichmentFresh, isFullEnrichmentFresh, isEnrichmentPending,
  ENRICHMENT_CACHE_MS, ENRICHMENT_PENDING_TTL_MS,
} = await import('../services/companyEnrichment.js');
const { approveCompany, resetDecisionGuards, DECISION_SURFACE } = await import('../services/companyDecision.js');
const { handler: enrichCompanyHandler } = await import('../../netlify/functions/enrichCompany.js');
const { VERIFICATION_NEEDED_MESSAGE } = await import('../../netlify/functions/utils/companyFacts.js');
const { calculateICPScore, computeCoverage, DEFAULT_WEIGHTS } = await import('../utils/icpScoring.js');

const UID = 'user-1';
const CID = 'org-acme';
const PATH = `users/${UID}/companies/${CID}`;
const ICP = { industries: ['Computer Software'], locations: ['Utah'], companySizes: ['21-50'] };

// What Apollo organizations/enrich returns for the company.
const APOLLO_ORG = {
  id: 'org-acme',
  name: 'Acme',
  industry: 'computer software',
  estimated_num_employees: 42,
  city: 'Lehi', state: 'Utah', country: 'United States',
  primary_domain: 'acme.example',
  website_url: 'http://www.acme.example',
  linkedin_url: 'http://www.linkedin.com/company/acme',
  logo_url: 'https://logo.example/acme.png',
  founded_year: 2012,
  annual_revenue_printed: '12.5M',
};

// A discovered, just-accepted company: what search-companies stores (#695).
const discovered = (extra = {}) => ({
  apollo_organization_id: CID,
  name: 'Acme',
  website_url: 'http://www.acme.example',
  status: 'accepted',
  icpId: 'icp-1',
  barry_intel: `Acme, founded in 2012 (14y old). ${VERIFICATION_NEEDED_MESSAGE}`,
  ...extra,
});

// fetch → the real enrichCompany handler, with Apollo mocked behind it.
let apolloCalls;
let apolloFails;
function installFetch() {
  apolloCalls = [];
  apolloFails = false;
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes('api.apollo.io')) {
      apolloCalls.push(u);
      if (apolloFails) return new Response('{}', { status: 500 });
      if (u.includes('organizations/enrich')) return new Response(JSON.stringify({ organization: APOLLO_ORG }), { status: 200 });
      if (u.includes('mixed_people')) return new Response(JSON.stringify({ people: [{ id: 'p1' }, { id: 'p2' }] }), { status: 200 });
      if (u.includes('people/match')) return new Response(JSON.stringify({ person: { id: 'p1', first_name: 'A' } }), { status: 200 });
      return new Response('{}', { status: 200 });
    }
    if (u.includes('/.netlify/functions/enrichCompany')) {
      const res = await enrichCompanyHandler({ httpMethod: 'POST', body: init.body });
      return new Response(res.body, { status: res.statusCode });
    }
    if (u.includes('/.netlify/functions/searchPeople')) return new Response(JSON.stringify({ success: true, people: [] }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  });
}

const enrichCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/.netlify/functions/enrichCompany'));

beforeEach(() => {
  STORE.clear();
  resetEnrichmentGuards();
  resetDecisionGuards();
  installFetch();
  process.env.APOLLO_API_KEY = 'test-key';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('enrichCompany company-only mode', () => {
  const call = (mode) => enrichCompanyHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: UID, authToken: 'tok', domain: 'acme.example', ...(mode ? { mode } : {}) }),
  });

  it('makes exactly one Apollo call: organizations/enrich, no people search, no person match', async () => {
    const res = await call('company');
    expect(res.statusCode).toBe(200);
    expect(apolloCalls).toHaveLength(1);
    expect(apolloCalls[0]).toContain('organizations/enrich');
    expect(apolloCalls.some(u => u.includes('mixed_people'))).toBe(false);
    expect(apolloCalls.some(u => u.includes('people/match'))).toBe(false);

    const { data } = JSON.parse(res.body);
    expect(data._raw.mode).toBe('company');
    expect(data.decisionMakers).toEqual([]);
  });

  it('returns the verified canonical fields and a factual Barry text', async () => {
    const { data } = JSON.parse((await call('company')).body);
    expect(data.canonical).toEqual({
      industry: 'computer software',
      employee_count: 42,
      state: 'Utah',
      hq_location: 'Lehi, Utah, United States',
      location: 'Lehi, Utah, United States',
      domain: 'acme.example',
      website_url: 'http://www.acme.example',
      linkedin_url: 'http://www.linkedin.com/company/acme',
      logo_url: 'https://logo.example/acme.png',
      founded_year: 2012,
      revenue: '12.5M',
    });
    expect(data.barry_intel).toMatch(/^Acme is a computer software company, about 42 employees, headquartered in Lehi, Utah, United States/);
    expect(data.barry_intel).not.toContain(VERIFICATION_NEEDED_MESSAGE);
    expect(data.barry_intel).not.toMatch(/matches your/i);
  });

  it('without the mode, still runs the full enrichment the detail views use', async () => {
    await call(undefined);
    expect(apolloCalls.some(u => u.includes('organizations/enrich'))).toBe(true);
    expect(apolloCalls.some(u => u.includes('mixed_people'))).toBe(true);
    expect(apolloCalls.some(u => u.includes('people/match'))).toBe(true);
  });
});

describe('accepting a company', () => {
  it('approveCompany triggers company-only enrichment without waiting on it', async () => {
    STORE.set(PATH, discovered({ status: 'pending' }));

    const result = await approveCompany({
      user: { uid: UID, getIdToken: async () => 'tok' }, company: { id: CID, ...discovered({ status: 'pending' }) },
      surface: DECISION_SURFACE.COMPANY_DETAIL,
    });

    // Saved the moment the decision committed, before enrichment has finished.
    expect(result.recorded).toBe(true);
    expect(STORE.get(PATH).status).toBe('accepted');
    expect(STORE.get(PATH).apolloEnrichment).toBeUndefined();

    await result.companyEnrichment;
    expect(enrichCalls()).toHaveLength(1);
    expect(JSON.parse(enrichCalls()[0][1].body).mode).toBe('company');
    expect(STORE.get(PATH).company_enrichment_status).toBe('done');
  });

  it('Daily Discoveries starts it after a recorded right swipe, independent of people discovery', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');
    const afterRecorded = src.slice(src.indexOf('if (!decision.recorded) return;'));
    const enrichAt = afterRecorded.indexOf("if (direction === 'right') enrichAcceptedCompany({ userId: user.uid, company });");
    expect(enrichAt).toBeGreaterThan(-1);
    // Before, and not inside, the people discovery call.
    expect(enrichAt).toBeLessThan(afterRecorded.indexOf('triggerPeopleDiscovery('));
    // Never awaited: the save must not wait on Apollo.
    expect(src).not.toMatch(/await\s+enrichAcceptedCompany/);
  });
});

describe('enrichAcceptedCompany', () => {
  it('writes verified data onto the same company document', async () => {
    STORE.set(PATH, discovered());

    expect(await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).toEqual({ action: 'enriched' });

    const doc = STORE.get(PATH);
    expect(STORE.size).toBe(1);
    expect(doc.status).toBe('accepted');
    expect(doc.apolloEnrichment._raw.mode).toBe('company');
    expect(typeof doc.apolloEnrichedAt).toBe('number');
    expect(doc).toMatchObject({
      industry: 'computer software', employee_count: 42, state: 'Utah',
      hq_location: 'Lehi, Utah, United States', location: 'Lehi, Utah, United States',
      domain: 'acme.example', linkedin_url: 'http://www.linkedin.com/company/acme',
      logo_url: 'https://logo.example/acme.png', founded_year: 2012, revenue: '12.5M',
      company_enrichment_status: 'done',
    });
  });

  it('repairs placeholders but never overwrites real existing values', async () => {
    STORE.set(PATH, discovered({
      industry: 'null', employee_count: 0, founded_year: 0, revenue: '', state: 'N/A',
      hq_location: 'Provo, Utah', linkedin_url: 'https://linkedin.com/company/acme-real',
    }));

    await enrichAcceptedCompany({ userId: UID, company: { id: CID } });

    const doc = STORE.get(PATH);
    expect(doc.industry).toBe('computer software');      // "null" repaired
    expect(doc.employee_count).toBe(42);                  // 0 repaired
    expect(doc.founded_year).toBe(2012);                  // 0 repaired
    expect(doc.revenue).toBe('12.5M');                    // '' repaired
    expect(doc.state).toBe('Utah');                       // "N/A" repaired
    expect(doc.hq_location).toBe('Provo, Utah');          // real value kept
    expect(doc.linkedin_url).toBe('https://linkedin.com/company/acme-real'); // real value kept
  });

  it('makes the ICP score measurable', async () => {
    STORE.set(PATH, discovered({ industry: 'null' }));
    expect(calculateICPScore(STORE.get(PATH), ICP, DEFAULT_WEIGHTS)).toBeNull();

    await enrichAcceptedCompany({ userId: UID, company: { id: CID } });

    expect(computeCoverage(STORE.get(PATH), ICP).complete).toBe(true);
    expect(calculateICPScore(STORE.get(PATH), ICP, DEFAULT_WEIGHTS)).toBe(100);
  });

  it('replaces the verification-needed Barry text with facts once data exists', async () => {
    STORE.set(PATH, discovered());
    await enrichAcceptedCompany({ userId: UID, company: { id: CID } });

    const intel = STORE.get(PATH).barry_intel;
    expect(intel).toMatch(/^Acme is a computer software company, about 42 employees/);
    expect(intel).not.toContain(VERIFICATION_NEEDED_MESSAGE);
  });

  it('keeps verification-needed Barry text when Apollo returns no company facts', async () => {
    const before = APOLLO_ORG.industry;
    Object.assign(APOLLO_ORG, { industry: null, estimated_num_employees: null, city: null, state: null, country: null });
    try {
      STORE.set(PATH, discovered());
      await enrichAcceptedCompany({ userId: UID, company: { id: CID } });
      expect(STORE.get(PATH).barry_intel).toContain(VERIFICATION_NEEDED_MESSAGE);
      expect(STORE.get(PATH).industry).toBeUndefined();
    } finally {
      Object.assign(APOLLO_ORG, { industry: before, estimated_num_employees: 42, city: 'Lehi', state: 'Utah', country: 'United States' });
    }
  });

  it('never replaces Barry text a richer source wrote', async () => {
    STORE.set(PATH, discovered({ barry_intel: 'Website analysis: Acme sells payroll software to restaurants.' }));
    await enrichAcceptedCompany({ userId: UID, company: { id: CID } });
    expect(STORE.get(PATH).barry_intel).toBe('Website analysis: Acme sells payroll software to restaurants.');
  });

  it('does not call Apollo again for a recently enriched company', async () => {
    STORE.set(PATH, discovered({ apolloEnrichment: { snapshot: {} }, apolloEnrichedAt: Date.now() - 60_000 }));

    expect(await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).toEqual({ action: 'skipped', reason: 'fresh' });
    expect(enrichCalls()).toHaveLength(0);
  });

  it('does enrich again once the 14-day cache has expired', async () => {
    STORE.set(PATH, discovered({ apolloEnrichment: { snapshot: {} }, apolloEnrichedAt: Date.now() - ENRICHMENT_CACHE_MS - 1 }));
    expect((await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).action).toBe('enriched');
    expect(enrichCalls()).toHaveLength(1);
  });

  it('collapses duplicate accept events into one enrichment call', async () => {
    STORE.set(PATH, discovered());

    const results = await Promise.all([
      enrichAcceptedCompany({ userId: UID, company: { id: CID } }),
      enrichAcceptedCompany({ userId: UID, company: { id: CID } }),
      enrichAcceptedCompany({ userId: UID, company: { id: CID } }),
    ]);

    expect(enrichCalls()).toHaveLength(1);
    expect(results.every(r => r.action === 'enriched')).toBe(true);
    // And a later accept finds it fresh.
    expect((await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).reason).toBe('fresh');
    expect(enrichCalls()).toHaveLength(1);
  });

  it('respects an enrichment already running in another tab, until it goes stale', async () => {
    STORE.set(PATH, discovered({ company_enrichment_status: 'pending', company_enrichment_requested_at: Date.now() - 5_000 }));
    expect(await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).toEqual({ action: 'skipped', reason: 'pending' });
    expect(enrichCalls()).toHaveLength(0);

    STORE.set(PATH, discovered({ company_enrichment_status: 'pending', company_enrichment_requested_at: Date.now() - ENRICHMENT_PENDING_TTL_MS - 1 }));
    expect((await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).action).toBe('enriched');
  });

  it('a failed enrichment leaves the company saved, never throws, and marks it failed', async () => {
    STORE.set(PATH, discovered());
    apolloFails = true;

    expect(await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).toEqual({ action: 'failed' });

    const doc = STORE.get(PATH);
    expect(doc.status).toBe('accepted');
    expect(doc.company_enrichment_status).toBe('failed');
    expect(doc.apolloEnrichment).toBeUndefined();
    expect(doc.industry).toBeUndefined();
    expect(isEnrichmentPending(doc)).toBe(false);
  });

  it('skips a company with no domain or Apollo id to look up', async () => {
    STORE.set(PATH, { name: 'Typed Co', status: 'accepted' });
    expect(await enrichAcceptedCompany({ userId: UID, company: { id: CID } })).toEqual({ action: 'skipped', reason: 'no-signal' });
    expect(enrichCalls()).toHaveLength(0);
  });
});

describe('cache semantics shared with the company detail views', () => {
  it('a company-only result is fresh for accept, but not a full cache for the detail views', () => {
    const companyOnly = { apolloEnrichment: { _raw: { mode: 'company' } }, apolloEnrichedAt: Date.now() };
    const full = { apolloEnrichment: { _raw: { mode: 'full' } }, apolloEnrichedAt: Date.now() };
    const legacyFull = { apolloEnrichment: { _raw: {} }, apolloEnrichedAt: Date.now() };

    expect(isEnrichmentFresh(companyOnly)).toBe(true);
    expect(isFullEnrichmentFresh(companyOnly)).toBe(false);
    expect(isFullEnrichmentFresh(full)).toBe(true);
    expect(isFullEnrichmentFresh(legacyFull)).toBe(true);
  });
});
