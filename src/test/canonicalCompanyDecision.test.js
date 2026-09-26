/**
 * One canonical company decision path.
 *
 * Every surface where a user approves or skips a company — Daily Discoveries,
 * the /barry results card, Mission Control, Company Detail — decides through
 * services/companyDecision.js. Asserted three ways:
 *
 *   1. each surface routes through the shared module, and none keeps a
 *      decision write of its own;
 *   2. the same decision made from any surface leaves the same canonical state;
 *   3. the reconciler treats a decision made after the canonical deploy with no
 *      ICP stamp as a real gap, and reports historical bypass decisions apart.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── In-memory Firestore ─────────────────────────────────────────────────────

const STORE = new Map();
const SERVER_TS = { __serverTimestamp: true };

const pathOf = (first, rest) =>
  (first && first.__path ? [first.__path, ...rest] : rest).join('/');

const snap = (ref) => {
  const data = STORE.get(ref.__path);
  return { exists: () => data !== undefined, data: () => data, id: ref.id, ref };
};

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => {
    const p = pathOf(first, rest);
    return { __path: p, id: p.split('/').pop() };
  },
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: n }),
  serverTimestamp: () => SERVER_TS,
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
    // Yield first, as the network does — this is the window a double-tap lands in.
    await Promise.resolve();
    if (!STORE.has(ref.__path)) throw new Error(`no document: ${ref.__path}`);
    STORE.set(ref.__path, { ...STORE.get(ref.__path), ...data });
  },
  deleteDoc: async (ref) => { STORE.delete(ref.__path); },
  runTransaction: async (_db, fn) => {
    const staged = [];
    const tx = {
      get: async (ref) => snap(ref),
      set: (ref, data, opts) => { staged.push([ref.__path, data, opts]); },
    };
    const result = await fn(tx);
    for (const [p, data, opts] of staged) {
      STORE.set(p, opts?.merge ? { ...(STORE.get(p) ?? {}), ...data } : data);
    }
    return result;
  },
}));

vi.mock('../firebase/config', () => ({ db: { __db: true }, auth: { currentUser: null } }));
vi.mock('../services/contactWriteGuard', () => ({
  prepareContactWrite: async () => ({ action: 'create', fields: {} }),
  applyContactMerge: async () => {},
}));

const {
  DECISION_SURFACE, DECISION_ICP_BASIS, resolveDecisionIcp,
  recordCompanyDecision, approveCompany, skipCompany, resetDecisionGuards,
  undoCompanyDecision,
} = await import('../services/companyDecision');
const { setShadowWritesEnabled } = await import('../services/icpRelationshipService');
const { classifyCompany, summarize, RECONCILE } = await import('../utils/icpReconcile');

const UID = 'u1';
const ICP = 'icp_A';
const USER = { uid: UID, getIdToken: async () => 'token' };

const companyPath = (id) => `users/${UID}/companies/${id}`;
const events = () => [...STORE.keys()].filter(k => k.startsWith(`users/${UID}/lineageEvents/`));
const relationship = (icpId, id) =>
  [...STORE.entries()].find(([k]) => k.startsWith(`users/${UID}/icpRelationships/`) && k.includes(icpId) && k.includes(id))?.[1];

function seedCompany(id, extra = {}) {
  const company = { name: `Co ${id}`, status: 'pending', icpId: ICP, apollo_organization_id: `org_${id}`, source: 'apollo_api', ...extra };
  STORE.set(companyPath(id), company);
  return { id, ...company };
}

beforeEach(() => {
  STORE.clear();
  resetDecisionGuards();
  setShadowWritesEnabled(true);
  STORE.set(`users/${UID}/icpProfiles/${ICP}`, { name: 'Nonprofits', industries: ['non-profit organization management'], targetTitles: ['Executive Director', 'CFO'] });
  STORE.set(`users/${UID}/scoutProgress/swipes`, { currentCycleId: 'run_7' });
  globalThis.fetch = vi.fn(async () => ({ json: async () => ({ success: true, people: [] }) }));
});

// ── 1. every surface routes through the shared module ───────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const code = (rel) => readFileSync(resolve(here, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SURFACES = [
  ['Daily Discoveries', '../pages/Scout/DailyLeads.jsx', 'DAILY_DISCOVERIES', /recordCompanyDecision\(\{/],
  ['/barry results card', '../components/onboarding/CompanyResultsCard.jsx', 'BARRY_FIRST_VALUE', /approveCompany\(\{/],
  ['Mission Control', '../pages/Scout/MissionControlDashboardV2.jsx', 'MISSION_CONTROL', /approveCompany\(\{/],
  ['Company Detail', '../pages/Scout/CompanyDetail.jsx', 'COMPANY_DETAIL', /approveCompany\(\{/],
];

describe('each decision surface routes through the canonical path', () => {
  it.each(SURFACES)('%s imports the shared module and decides through it', (_name, path, surface, call) => {
    const src = code(path);
    expect(src).toMatch(/from '\.\.\/\.\.\/services\/companyDecision'/);
    expect(src).toMatch(call);
    expect(src).toMatch(new RegExp(`surface: DECISION_SURFACE\\.${surface}`));
  });

  it.each(SURFACES)('%s keeps no company decision write of its own', (_name, path) => {
    const src = code(path);
    const writes = [...src.matchAll(/status: 'accepted',\s*(swipedAt|approvedAt)[^}]*\}/g)].map(m => m[0]);
    // The one exception is named, not hidden: People mode accepts a pending
    // company as a side effect of saving a PERSON there. Person decisions are
    // outside this step; the reconciler reports it as a bypass.
    expect(writes.filter(w => !/swipe_source: 'people_mode'/.test(w)), 'a surface still writes a decision status itself')
      .toEqual([]);
    expect(src).not.toMatch(/recordDecision\(|recordSkip\(/);
  });

  it('skip on both surfaces that offer it goes through the canonical skip', () => {
    expect(code('../pages/Scout/DailyLeads.jsx')).toMatch(/await skipCompany\(\{/);
    expect(code('../components/onboarding/CompanyResultsCard.jsx')).toMatch(/skipCompany\(\{/);
  });

  it('each surface passes the ICP it operates under, never a guessed one', () => {
    expect(code('../pages/Scout/DailyLeads.jsx')).toMatch(/surfaceIcpId: activeICPId/);
    expect(code('../components/onboarding/CompanyResultsCard.jsx')).toMatch(/surfaceIcpId: icpId/);
    expect(code('../pages/Scout/MissionControlDashboardV2.jsx')).toMatch(/surfaceIcpId: activeIcpProfile\?\.id \?\? null/);
    expect(code('../pages/Scout/CompanyDetail.jsx')).toMatch(/surfaceIcpId: matchIcp\?\.id \?\? null/);
    expect(code('../pages/Barry/BarryWorkspace.jsx'))
      .toMatch(/setResultsIcpId\(isResolved\(icpResolution\) \? icpResolution\.icpId : null\)/);
  });

  it('Daily Discoveries still owns its persona resolution and passes the titles in', () => {
    expect(code('../pages/Scout/DailyLeads.jsx'))
      .toMatch(/await triggerPeopleDiscovery\(\{ user, company, icpTitles, activeICPId, causeId: swipedAt \}\)/);
  });
});

// ── 2. same decision, same canonical state, whatever the surface ────────────

/** The fields that make up the canonical decision, with volatile values normalised. */
function canonical(doc) {
  return {
    status: doc.status,
    swipedAt: typeof doc.swipedAt === 'string' && !Number.isNaN(Date.parse(doc.swipedAt)) ? 'ISO' : doc.swipedAt,
    swipeDirection: doc.swipeDirection,
    swipe_gesture: doc.swipe_gesture,
    swipedForICPId: doc.swipedForICPId,
    decision_icp_id: doc.decision_icp_id,
    decision_icp_basis: doc.decision_icp_basis,
    titles_source: doc.titles_source,
    selected_titles: doc.selected_titles,
  };
}

const ALL = Object.values(DECISION_SURFACE);

describe('every surface leaves the same canonical state for an approve', () => {
  async function approveFrom(surface, id) {
    const company = seedCompany(id);
    if (surface === DECISION_SURFACE.DAILY_DISCOVERIES) {
      // Daily Discoveries composes the same two steps itself, to keep its own
      // write order around its counters.
      const r = await recordCompanyDecision({ userId: UID, company, direction: 'right', surface, surfaceIcpId: ICP, gesture: 'button' });
      const { triggerPeopleDiscovery } = await import('../services/companyDecision');
      await triggerPeopleDiscovery({ user: USER, company, icpTitles: ['Executive Director', 'CFO'], activeICPId: ICP, causeId: r.swipedAt });
      return r;
    }
    const r = await approveCompany({ user: USER, company, surface, surfaceIcpId: ICP });
    await r.peopleDiscovery;
    return r;
  }

  it('the canonical fields are identical across all four surfaces', async () => {
    const states = [];
    for (const [i, surface] of ALL.entries()) {
      await approveFrom(surface, `co_${i}`);
      states.push(canonical(STORE.get(companyPath(`co_${i}`))));
    }
    expect(states[0]).toEqual({
      status: 'accepted', swipedAt: 'ISO', swipeDirection: 'right', swipe_gesture: 'button',
      swipedForICPId: ICP, decision_icp_id: ICP, decision_icp_basis: DECISION_ICP_BASIS.SURFACE,
      titles_source: 'icp_auto',
      selected_titles: [
        { title: 'Executive Director', rank: 1, score: 100 },
        { title: 'CFO', rank: 2, score: 90 },
      ],
    });
    for (const s of states) expect(s).toEqual(states[0]);
  });

  it('each writes exactly one lineage event and an accepted relationship under the surface ICP', async () => {
    for (const [i, surface] of ALL.entries()) {
      const before = events().length;
      await approveFrom(surface, `co_${i}`);
      expect(events().length - before, surface).toBe(1);
      expect(relationship(ICP, `co_${i}`)?.state, surface).toBe('accepted');
    }
  });

  it('each triggers persona people discovery on approve', async () => {
    for (const [i, surface] of ALL.entries()) {
      globalThis.fetch.mockClear();
      await approveFrom(surface, `co_${i}`);
      expect(globalThis.fetch, surface).toHaveBeenCalledTimes(1);
      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(body).toMatchObject({ organizationId: `org_co_${i}`, titles: ['Executive Director', 'CFO'], maxResults: 3 });
    }
  });

  it('keeps each surface\'s legacy fields alongside the canonical ones', async () => {
    const ids = {};
    for (const [i, surface] of ALL.entries()) { await approveFrom(surface, `co_${i}`); ids[surface] = STORE.get(companyPath(`co_${i}`)); }
    expect(ids[DECISION_SURFACE.BARRY_FIRST_VALUE].swipe_source).toBe('barry_first_value');
    expect(ids[DECISION_SURFACE.MISSION_CONTROL].approvedAt).toBe(SERVER_TS);
    expect(ids[DECISION_SURFACE.COMPANY_DETAIL].approved_from).toBe('company_detail_preview');
    expect(ids[DECISION_SURFACE.COMPANY_DETAIL].approvedAt).toBe(ids[DECISION_SURFACE.COMPANY_DETAIL].swipedAt);
    for (const surface of ALL) expect(ids[surface].swipe_source).toBe(surface);
  });

  it('a double-tap from any surface yields one decision and one lineage event', async () => {
    for (const [i, surface] of ALL.entries()) {
      const company = seedCompany(`dbl_${i}`);
      const before = events().length;
      const [a, b] = await Promise.all([
        approveCompany({ user: USER, company, surface, surfaceIcpId: ICP }),
        approveCompany({ user: USER, company, surface, surfaceIcpId: ICP }),
      ]);
      expect([a.recorded, b.recorded].filter(Boolean), surface).toHaveLength(1);
      // A late second delivery of the same decision is dropped too.
      expect((await approveCompany({ user: USER, company, surface, surfaceIcpId: ICP })).recorded).toBe(false);
      expect(events().length - before, surface).toBe(1);
    }
  });

  it('undo makes the same company decidable again', async () => {
    const company = seedCompany('undo_1');
    await recordCompanyDecision({ userId: UID, company, direction: 'right', surface: DECISION_SURFACE.DAILY_DISCOVERIES, surfaceIcpId: ICP, gesture: 'drag' });
    await undoCompanyDecision({ userId: UID, companyId: 'undo_1' });
    expect(STORE.get(companyPath('undo_1'))).toMatchObject({ status: 'pending', swipedAt: null, swipeDirection: null, swipe_gesture: null });
    const again = await recordCompanyDecision({ userId: UID, company, direction: 'right', surface: DECISION_SURFACE.DAILY_DISCOVERIES, surfaceIcpId: ICP, gesture: 'drag' });
    expect(again.recorded).toBe(true);
  });
});

describe('every surface leaves the same canonical state for a skip', () => {
  it('skip is not a decision, whichever surface it came from', async () => {
    const states = [];
    // Daily Discoveries passes the cycle it holds; the results card does not
    // track one, so the path reads it from the same place.
    await skipCompany({ userId: UID, company: seedCompany('s_dd'), surfaceIcpId: ICP, currentCycleId: 'run_7' });
    await skipCompany({ userId: UID, company: seedCompany('s_barry'), surfaceIcpId: ICP });
    for (const id of ['s_dd', 's_barry']) {
      const d = STORE.get(companyPath(id));
      states.push({ status: d.status, skippedInCycle: d.skippedInCycle, hasSkippedAt: !!d.skippedAt,
        decisionFields: ['swipedAt', 'swipeDirection', 'swipedForICPId', 'swipe_gesture', 'decision_icp_basis'].filter(f => f in d) });
      expect(relationship(ICP, id)?.state).toBe('skipped');
      expect(relationship(ICP, id)?.skippedInCycle).toBe('run_7');
    }
    expect(states[0]).toEqual({ status: 'pending', skippedInCycle: 'run_7', hasSkippedAt: true, decisionFields: [] });
    expect(states[1]).toEqual(states[0]);
    // Not an exclusion.
    expect([...STORE.keys()].some(k => k.includes('/exclusions/'))).toBe(false);
  });
});

describe('the deciding ICP: surface wins, discovery is provenance only, never a guess', () => {
  it('an explicit surface ICP wins over the discovery stamp', () => {
    expect(resolveDecisionIcp({ surfaceIcpId: 'icp_B', company: { icpId: ICP } }))
      .toEqual({ activeICPId: 'icp_B', decisionIcpId: 'icp_B', basis: DECISION_ICP_BASIS.SURFACE });
  });

  it('with no surface ICP the discovery icpId is recorded as fallback provenance — not stamped, not shadowed', async () => {
    const company = seedCompany('fb_1');
    await approveCompany({ user: USER, company, surface: DECISION_SURFACE.MISSION_CONTROL, surfaceIcpId: null }).then(r => r.peopleDiscovery);
    const d = STORE.get(companyPath('fb_1'));
    expect(d.decision_icp_id).toBe(ICP);
    expect(d.decision_icp_basis).toBe(DECISION_ICP_BASIS.DISCOVERY_FALLBACK);
    expect('swipedForICPId' in d).toBe(false);
    expect(events()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();   // fail closed: no persona
  });

  it('with neither, the decision is recorded as unattributed', async () => {
    for (const icpId of [undefined, 'default']) {
      const id = `un_${icpId}`;
      const company = seedCompany(id, { icpId });
      await recordCompanyDecision({ userId: UID, company, direction: 'right', surface: DECISION_SURFACE.COMPANY_DETAIL, gesture: 'button' });
      const d = STORE.get(companyPath(id));
      expect(d.decision_icp_id).toBe(null);
      expect(d.decision_icp_basis).toBe(DECISION_ICP_BASIS.UNATTRIBUTED);
      expect('swipedForICPId' in d).toBe(false);
    }
  });
});

// ── 3. the reconciler's post-deploy rule ────────────────────────────────────

describe('reconciler — the canonical decision deploy', () => {
  const CUTOVER = '2026-09-16T07:00:00.000Z';
  const DECISION_CUTOVER = '2026-09-27T00:00:00.000Z';
  const before = '2026-09-20T00:00:00.000Z';
  const after = '2026-09-28T00:00:00.000Z';
  const classify = (company, relationships = []) =>
    classifyCompany({ company, relationships, cutoverAt: CUTOVER, decisionCutoverAt: DECISION_CUTOVER });

  it.each([
    ['fallback provenance', { decision_icp_basis: 'discovery_fallback', decision_icp_id: ICP }, 'discovery_fallback'],
    ['unattributed', { decision_icp_basis: 'unattributed', decision_icp_id: null }, 'unattributed'],
    ['a path that still bypasses it', { swipe_source: 'people_mode' }, 'no-canonical-stamp'],
  ])('a decision after the deploy with no ICP stamp is a REAL gap — %s', (_l, extra, basis) => {
    const r = classify({ status: 'accepted', icpId: ICP, swipedAt: after, ...extra });
    expect(r.status).toBe(RECONCILE.DIVERGENCE);
    expect(r.reason).toBe(`decided-after-canonical-path-without-icp-stamp:${basis}`);
  });

  it('a stamped decision after the deploy is judged against shadow as before', () => {
    const company = { status: 'accepted', swipedForICPId: ICP, decision_icp_basis: 'surface', swipedAt: after };
    expect(classify(company, [{ icpId: ICP, state: 'accepted' }]).status).toBe(RECONCILE.AGREED);
    expect(classify(company, []).status).toBe(RECONCILE.DIVERGENCE);
  });

  it.each([
    ['the /barry results card', { swipe_source: 'barry_first_value', swipedAt: before }, 'bypass:barry_first_value'],
    ['Mission Control', { approvedAt: { _seconds: Date.parse(before) / 1000 } }, 'bypass:mission_control'],
    ['Company Detail', { approvedAt: before, approved_from: 'company_detail_preview' }, 'bypass:company_detail_preview'],
    ['People mode', { swipe_source: 'people_mode', swipedAt: before }, 'bypass:people_mode'],
  ])('a historical bypass decision from %s goes in its own bucket', (_l, extra, reason) => {
    const r = classify({ status: 'accepted', icpId: ICP, found_at: '2026-09-01T00:00:00Z', ...extra });
    expect(r.status).toBe(RECONCILE.HISTORICAL_BYPASS);
    expect(r.reason).toBe(reason);
  });

  it('historical bypass is reported in full and never blocks', () => {
    const s = summarize([
      { status: RECONCILE.AGREED },
      { status: RECONCILE.HISTORICAL_BYPASS, reason: 'bypass:mission_control' },
    ]);
    expect(s.clean).toBe(true);
    expect(s.counts[RECONCILE.HISTORICAL_BYPASS]).toBe(1);
    expect(s.historicalBypass).toHaveLength(1);
  });

  it('a pre-deploy Daily Discoveries no-ICP swipe keeps its existing classification', () => {
    const r = classify({ status: 'accepted', icpId: ICP, swipedAt: before });
    expect(r.status).toBe(RECONCILE.EXPECTED_GAP);
    expect(r.reason).toBe('decided-with-no-active-icp');
  });

  it('an undone decision is not a decision', () => {
    const r = classify({ status: 'pending', swipedForICPId: ICP, swipedAt: null, found_at: after }, [{ icpId: ICP, state: 'accepted' }]);
    expect(r.status).toBe(RECONCILE.UNDO_GAP);
  });

  it('the runner requires the decision cutover and passes it to the engine', () => {
    const runner = code('../../scripts/reconcile/run.mjs');
    expect(runner).toMatch(/if \(!args\['decision-cutover'\]\)/);
    expect(runner).toMatch(/decisionCutoverAt,\s*\}\);/);
  });
});
