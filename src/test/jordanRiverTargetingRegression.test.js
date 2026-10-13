/**
 * Jordan River regression — the actual production journey that opened this
 * investigation.
 *
 * User: recruiting companies for a Jordan River adoption partnership, no
 * saved targeting. Barry previously terminated with "go to /barry", "I can't
 * do it for you", or a competitor name after gathering the exact same
 * information now used to drive the handoff.
 *
 * IMPORTANT — test boundary: this is a deterministic contract/routing test
 * (the Anthropic client is stubbed with configured responses). It proves the
 * handler routes correctly end to end and that the shared persistence/search
 * sequence receives and stores the right data. It does NOT prove a live
 * model will correctly generalize "Salt Lake County" to "Utah", or that a
 * live conversation reaches this exact extraction shape — that requires
 * separate production verification with the real model. Do not report the
 * original behavioral bug closed on the strength of this test alone.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Part 1: the handler never produces the old terminal phrases, and reaches
//    a confirmable extraction. ────────────────────────────────────────────

const CALLS = [];
let classifierReply = { intent: 'UNCLEAR', confidence: 0, restatement: null, clarifyingQuestion: null, subject: null };
let extractionReply = null;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        create: vi.fn(async (req) => {
          CALLS.push(req);
          if (req.system && req.system.includes('You classify one sentence into exactly one of nine categories')) {
            return { content: [{ text: JSON.stringify(classifierReply) }] };
          }
          if (!req.system && req.messages?.[0]?.content?.includes('Ideal Customer Profile')) {
            return { content: [{ text: JSON.stringify(extractionReply) }] };
          }
          return {
            usage: null,
            content: [{
              text: JSON.stringify({
                intent: 'CUSTOM', barry_mode: 'GROWTH', step: 'execute',
                response_text: "I can't do it for you — go to /barry and set this up yourself.",
                contact_id: null, has_message_angles: false, angles: [], actions: [], clarifying_question: null,
              }),
            }],
          };
        }),
      };
    }
  },
}));

const EMPTY_SNAP = { exists: false, empty: true, size: 0, docs: [], forEach() {}, data: () => undefined };
function query() {
  const q = {
    collection: () => query(), doc: () => query(), where: () => q, orderBy: () => q, limit: () => q,
    get: async () => EMPTY_SNAP, set: async () => {}, update: async () => {}, add: async () => ({ id: 'x' }),
  };
  return q;
}
vi.mock('../../netlify/functions/firebase-admin.js', () => ({ db: { collection: () => query() }, admin: {} }));
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: async () => {} }));
globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) }));
globalThis.process.env.ANTHROPIC_API_KEY = 'test';
globalThis.process.env.FIREBASE_API_KEY = 'test';

const { handler } = await import('../../netlify/functions/barryMissionChat.js');

const FORBIDDEN = [
  /go to \/barry/i,
  /go to scout/i,
  /set this up yourself/i,
  /i can'?t do it for you/i,
  /paste this into \/barry/i,
];

async function send(body) {
  CALLS.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ userId: 'u1', authToken: 't', barryMode: 'GROWTH', ...body }),
  });
  return { res, data: JSON.parse(res.body) };
}

const NO_TARGETING = { contacts: [], missions: [], recon: {}, icpProfile: null };

describe('Jordan River — the gathering conversation reaches confirmation without the old terminal phrases', () => {
  it('turn 1: confident PROSPECTING enters extraction', async () => {
    classifierReply = {
      intent: 'PROSPECTING', confidence: 0.95,
      restatement: "You're looking for companies in Salt Lake County to reach out to about adopting a section of the Jordan River.",
      clarifyingQuestion: null, subject: null,
    };
    extractionReply = {
      understood: { industries: [], companySizes: [], locations: [], targetTitles: [], companyKeywords: [] },
      mappingExplanation: 'Got it — who should I be finding these companies for, in terms of size?',
      needsLookalike: false, lookalikeSuggestions: null, needsClarification: true,
      followUpQuestion: "Roughly how big are the companies you're hoping to reach?", followUpType: 'size',
      searchStrategy: 'industry_only', confidenceScore: 0.3, isAmbiguous: false, ambiguityDetails: null,
    };

    const { res, data } = await send({
      message: "I need to find companies in Salt Lake County who I can reach out to about adopting a section of the Jordan River. I don't know who I should target.",
      contextStack: NO_TARGETING,
    });

    expect(res.statusCode).toBe(200);
    expect(data.pendingICP).toBeTruthy();
    for (const pattern of FORBIDDEN) expect(data.response_text).not.toMatch(pattern);
  });

  it('turn 2: size and titles gathered, still no terminal phrase, not yet confirming', async () => {
    extractionReply = {
      understood: {
        industries: [], companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
        locations: ['Utah'], targetTitles: ['CEO', 'Founder', 'CMO'], companyKeywords: [],
      },
      mappingExplanation: 'Large companies in Utah, reaching CEOs, founders, and CMOs.',
      needsLookalike: false, lookalikeSuggestions: null, needsMoreInfo: true,
      followUpQuestion: 'Anyone else I should be reaching — community relations or CSR leadership?', followUpType: 'titles',
      searchStrategy: 'industry_only', confidenceScore: 0.7, readyToConfirm: false, isAmbiguous: false, ambiguityDetails: null,
    };

    const { data } = await send({
      message: '500 plus employees, and CEOs, founders, and CMOs',
      contextStack: NO_TARGETING,
      pendingICP: { locations: [], companySizes: [], targetTitles: [], industries: [], companyKeywords: [] },
      icpExtractionStep: 'clarifying',
    });

    expect(data.readyToConfirm).toBe(false);
    for (const pattern of FORBIDDEN) expect(data.response_text).not.toMatch(pattern);
  });

  it('turn 3: full targeting gathered, reaches confirmation, still no terminal phrase', async () => {
    extractionReply = {
      understood: {
        industries: [], companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
        locations: ['Utah'], targetTitles: ['CEO', 'Founder', 'CMO', 'CSR / Community Relations'], companyKeywords: [],
      },
      mappingExplanation: "Large companies in Utah — 500+ employees — reaching CEOs, founders, CMOs, and CSR/community relations leadership. Ready to search when you are.",
      needsLookalike: false, lookalikeSuggestions: null, needsMoreInfo: false,
      followUpQuestion: null, followUpType: null,
      searchStrategy: 'industry_only', confidenceScore: 0.95, readyToConfirm: true, isAmbiguous: false, ambiguityDetails: null,
    };

    const { data } = await send({
      message: 'Yes, also CSR and community relations leadership',
      contextStack: NO_TARGETING,
      pendingICP: { locations: ['Utah'], companySizes: ['501-1,000'], targetTitles: ['CEO', 'Founder', 'CMO'], industries: [], companyKeywords: [] },
      icpExtractionStep: 'clarifying',
    });

    expect(data.readyToConfirm).toBe(true);
    expect(data.pendingICP.locations).toEqual(['Utah']);
    expect(data.pendingICP.targetTitles).toEqual(['CEO', 'Founder', 'CMO', 'CSR / Community Relations']);
    // The extractor has no revenue field at all — "$50M+" was never captured
    // here, not merely excluded from search. Confirmed structurally, not
    // just "doesn't narrow retrieval."
    expect(data.pendingICP.revenueRanges).toBeUndefined();
    for (const pattern of FORBIDDEN) expect(data.response_text).not.toMatch(pattern);

    // Stash for part 2 — the exact object confirmation would hand to the
    // shared persistence/search function.
    globalThis.__jordanRiverPendingICP = data.pendingICP;
  });
});

// ── Part 2: confirming that exact ICP runs the real shared write/search
//    sequence and produces the effective, honest result. ───────────────────

describe('Jordan River — confirming the gathered targeting', () => {
  it('produces the exact effective ICP and the exact filters sent to discovery', async () => {
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

    const { confirmAndActivateIcp, effectiveTargeting, formatCompanySizeRange } = await import('../utils/confirmAndActivateIcp');

    let searchBody = null;
    const user = {
      uid: 'jordan_river_user',
      getIdToken: async () => 'tok',
    };
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url === '/.netlify/functions/search-companies') {
        searchBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ companiesAdded: 12 }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const pendingICP = globalThis.__jordanRiverPendingICP || {
      industries: [], companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
      locations: ['Utah'], targetTitles: ['CEO', 'Founder', 'CMO', 'CSR / Community Relations'], companyKeywords: [],
    };

    // What BarryChatPanel's targeting_confirm bubble would have displayed to
    // the user, computed from the exact same pendingICP object confirmation
    // hands to confirmAndActivateIcp below — the same function both read.
    const displayed = effectiveTargeting(pendingICP);
    expect(displayed.company.locations).toEqual(['Utah']);
    expect(displayed.company.isNationwide).toBe(false);
    expect(formatCompanySizeRange(displayed.company.companySizes)).toBe('501+ employees');
    expect(displayed.people.targetTitles).toEqual(['CEO', 'Founder', 'CMO', 'CSR / Community Relations']);
    // Neither county nor revenue appears anywhere in what would be displayed
    // — there is no field for either to hide in.
    expect(displayed.company.locations).not.toContain('Salt Lake County');
    expect(JSON.stringify(displayed)).not.toMatch(/revenue|50M/i);

    const { icpId, icpProfile, canSearch } = await confirmAndActivateIcp(user, pendingICP, 'mission_control');

    // Exact effective ICP produced.
    expect(icpProfile.locations).toEqual(['Utah']);
    expect(icpProfile.companySizes).toEqual(['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+']);
    expect(icpProfile.targetTitles).toEqual(['CEO', 'Founder', 'CMO', 'CSR / Community Relations']);
    expect(icpProfile.revenueRanges).toEqual([]);
    expect(icpProfile.skipRevenue).toBe(true);
    expect(icpProfile.source).toBe('mission_control');

    // It was actually persisted and activated.
    const stored = STORE.get(`users/jordan_river_user/icpProfiles/${icpId}`);
    expect(stored.isActive).toBe(true);
    expect(stored.status).toBe('active');
    expect(STORE.get('users/jordan_river_user/companyProfile/current').icpIdSource).toBe('mission_control_confirmed');

    // A search ran, since locations + companySizes are real retrieval
    // constraints, and it carries exactly the identity and profile just
    // written — titles and revenue are NOT filters Apollo receives.
    expect(canSearch).toBe(true);
    await new Promise(r => setTimeout(r, 0)); // let the fire-and-forget fetch resolve
    expect(searchBody.icpId).toBe(icpId);
    expect(searchBody.companyProfile.locations).toEqual(['Utah']);
    expect(searchBody.companyProfile.companySizes).toEqual(['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+']);
    // Confirms what Phase 6 established: titles and revenue travel with the
    // profile object (available to whatever reads it later) but are not
    // filters this call is asking Apollo to apply.
    expect(searchBody.companyProfile.targetTitles).toEqual(['CEO', 'Founder', 'CMO', 'CSR / Community Relations']);

    // The full chain: what was displayed to the user equals what was
    // persisted equals what was actually sent as search-companies
    // constraints. Not three independent implementations that happen to
    // agree today — displayed and persisted both came from the one call to
    // effectiveTargeting() above, so they cannot structurally drift apart.
    expect(displayed.company.locations).toEqual(icpProfile.locations);
    expect(displayed.company.locations).toEqual(searchBody.companyProfile.locations);
    expect(displayed.company.companySizes).toEqual(icpProfile.companySizes);
    expect(displayed.company.companySizes).toEqual(searchBody.companyProfile.companySizes);
    expect(displayed.people.targetTitles).toEqual(icpProfile.targetTitles);
    expect(displayed.people.targetTitles).toEqual(searchBody.companyProfile.targetTitles);
  });
});

// ── Part 3: a normal, simple ICP — the confirmation must stay simple, not
//    become a wall of text just because the machinery now supports more. ──

describe('Normal case — a simple ICP confirms without becoming a wall of text', () => {
  it('Utah SaaS companies, 51-200 employees, Founders and VP Sales', async () => {
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

    const { confirmAndActivateIcp, effectiveTargeting, formatCompanySizeRange } = await import('../utils/confirmAndActivateIcp');

    const user = { uid: 'normal_case_user', getIdToken: async () => 'tok' };
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ companiesAdded: 40 }) }));

    const pendingICP = {
      industries: ['SaaS'], companySizes: ['51-200'], locations: ['Utah'],
      targetTitles: ['Founder', 'VP Sales'], companyKeywords: [],
    };

    const displayed = effectiveTargeting(pendingICP);

    // Exactly one line of geography, one line of size, one line of titles —
    // a short confirmation, not an enumeration of every field the schema
    // could theoretically carry.
    expect(displayed.company.locations).toEqual(['Utah']);
    expect(formatCompanySizeRange(displayed.company.companySizes)).toBe('51-200 employees');
    expect(displayed.people.targetTitles).toEqual(['Founder', 'VP Sales']);

    const { icpProfile, canSearch } = await confirmAndActivateIcp(user, pendingICP, 'mission_control');
    expect(icpProfile.industries).toEqual(['SaaS']);
    expect(icpProfile.locations).toEqual(displayed.company.locations);
    expect(icpProfile.companySizes).toEqual(displayed.company.companySizes);
    expect(icpProfile.targetTitles).toEqual(displayed.people.targetTitles);
    expect(canSearch).toBe(true);
  });
});
