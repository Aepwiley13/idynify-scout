/**
 * Regression: introducing effectiveTargeting() as a shared helper inside
 * confirmAndActivateIcp() must not turn the canonical ICP into merely the
 * subset of fields the confirmation UI displays (locations, companySizes,
 * targetTitles). confirmAndActivateIcp persists a much richer canonical
 * profile — industries, companyKeywords, foundedAgeRange, searchStrategy,
 * lookalikeSeed, scoringWeights, barryConfidenceScore, managedByBarry,
 * source, revenueRanges/skipRevenue — and effectiveTargeting's four fields
 * (companySizes, locations, isNationwide, targetTitles) must land in the
 * persisted profile with the exact same values they always did.
 *
 * This is a regression test for the shared helper, not a new feature: it
 * proves confirmAndActivateIcp still persists the same canonical profile
 * the pre-effectiveTargeting version did, using a rich ICP that goes well
 * beyond the Jordan River fixture's fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeStore() {
  const STORE = new Map();
  const pathOf = (first, rest) => (first && first.__path ? [first.__path, ...rest] : rest).join('/');
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function write(path, data, options) {
    STORE.set(path, options?.merge ? { ...(STORE.get(path) || {}), ...clone(data) } : clone(data));
  }
  return { STORE, pathOf, clone, write };
}

beforeEach(() => {
  vi.resetModules();
});

describe('confirmAndActivateIcp preserves the full canonical ICP, not just the displayed subset', () => {
  it('a rich extracted ICP with every field set lands in the persisted profile unchanged', async () => {
    const { STORE, pathOf, clone, write } = makeStore();

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

    const { confirmAndActivateIcp, DEFAULT_SCORING_WEIGHTS } = await import('../utils/confirmAndActivateIcp');

    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ companiesAdded: 7 }) }));
    const user = { uid: 'rich_icp_user', getIdToken: async () => 'tok' };

    const richICP = {
      industries: ['SaaS', 'Fintech'],
      companySizes: ['51-200', '201-500'],
      locations: ['Utah', 'Colorado'],
      targetTitles: ['CEO', 'VP Sales'],
      companyKeywords: ['B2B', 'enterprise software'],
      foundedAgeRange: '5-10',
      searchStrategy: 'lookalike',
      lookalikeSeed: 'Acme Corp',
      confidenceScore: 0.92,
    };

    const { icpProfile } = await confirmAndActivateIcp(user, richICP, 'mission_control');

    // Fields effectiveTargeting computes — same values it always produced.
    expect(icpProfile.companySizes).toEqual(['51-200', '201-500']);
    expect(icpProfile.locations).toEqual(['Utah', 'Colorado']);
    expect(icpProfile.isNationwide).toBe(false);
    expect(icpProfile.targetTitles).toEqual(['CEO', 'VP Sales']);

    // Fields that never pass through effectiveTargeting at all — untouched
    // by this round's refactor, read straight from extractedICP as before.
    expect(icpProfile.industries).toEqual(['SaaS', 'Fintech']);
    expect(icpProfile.companyKeywords).toEqual(['B2B', 'enterprise software']);
    expect(icpProfile.foundedAgeRange).toBe('5-10');
    expect(icpProfile.searchStrategy).toBe('lookalike');
    expect(icpProfile.lookalikeSeed).toBe('Acme Corp');
    expect(icpProfile.barryConfidenceScore).toBe(0.92);
    expect(icpProfile.scoringWeights).toEqual(DEFAULT_SCORING_WEIGHTS);
    expect(icpProfile.source).toBe('mission_control');
    expect(icpProfile.managedByBarry).toBe(true);
    expect(icpProfile.revenueRanges).toEqual([]);
    expect(icpProfile.skipRevenue).toBe(true);
    expect(typeof icpProfile.updatedAt).toBe('string');
  });

  it('nationwide targeting still collapses locations to [] and sets isNationwide, exactly as before', async () => {
    const { STORE, pathOf, clone, write } = makeStore();

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

    const { confirmAndActivateIcp } = await import('../utils/confirmAndActivateIcp');
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ companiesAdded: 100 }) }));
    const user = { uid: 'nationwide_user', getIdToken: async () => 'tok' };

    const { icpProfile } = await confirmAndActivateIcp(
      user,
      { industries: ['Retail'], companySizes: ['1-10'], locations: 'nationwide', targetTitles: [] },
      'mission_control'
    );

    expect(icpProfile.locations).toEqual([]);
    expect(icpProfile.isNationwide).toBe(true);
  });
});
