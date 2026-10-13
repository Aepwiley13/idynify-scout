/**
 * Production evidence, second occurrence — the Jordan River incident
 * resurfaced AFTER #678 shipped, through a different door.
 *
 * #678 sanitized companyKeywords at the from-scratch targeting-extraction
 * boundary (barryICPConversation.js). Production then showed a second,
 * independent path reaching the same ICP: Mission Control's "create another
 * ICP" request, routed by BarryChatPanel's ICP-intent detection to
 * updateIcpFromChat.js instead, because the account already had an active
 * ICP. That path:
 *
 *   1. extracts icpDelta via a THIRD, unrelated prompt
 *      (barryMissionChat.js's buildIcpReclarificationPrompt) that never
 *      called sanitizeCompanyKeywords,
 *   2. and even if it had, action:'add' unions the incoming value onto
 *      whatever companyKeywords the existing ICP document already carried
 *      — so a clean new delta is not sufficient on its own, because a union
 *      never subtracts the old poisoned entry.
 *
 * The production ICP (icp_1790783912079) already carried
 * companyKeywords: ["headquarters"] from before #678 existed. These tests
 * reproduce that exact state and prove updateIcpFromChat now sanitizes BOTH
 * sides of the merge — using the one shared implementation in
 * src/utils/companyKeywordsResidue.js, not a second copy of the rule.
 */
import { describe, it, expect, vi } from 'vitest';

const USER_ID = 'u1';
const ICP_ID = 'icp_1790783912079';

/**
 * Runs updateIcpFromChat against a fresh, isolated Firestore double seeded
 * with the given authoritative (already-persisted) profile, and returns
 * both the function's return value and what actually landed in the
 * icpProfiles document — not just what the function claims it did.
 */
async function runUpdate({ authoritative, icpDelta, action, existingProfile = null }) {
  vi.resetModules();
  const STORE = new Map();
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const pathOf = (first, rest) => (first && first.__path ? [first.__path, ...rest] : rest).join('/');

  vi.doMock('firebase/firestore', () => ({
    collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
    doc: (first, ...rest) => { const p = pathOf(first, rest); return { __path: p, id: p.split('/').pop() }; },
    getDocs: async q => {
      const prefix = q.__path + '/';
      const docs = [...STORE.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => clone(v) }));
      return { docs };
    },
    setDoc: async (ref, data) => { STORE.set(ref.__path, clone(data)); },
    Timestamp: { now: () => 'MOCK_TIMESTAMP' },
  }));
  vi.doMock('../firebase/config', () => ({ db: {} }));
  // Only needed by the Apollo-query-shape test below, which also imports
  // search-companies.js in the same module-reset cycle; harmless otherwise.
  vi.doMock('../../netlify/functions/firebase-admin.js', () => ({ default: {}, db: {}, admin: {} }));
  vi.doMock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn().mockResolvedValue(undefined) }));

  STORE.set(`users/${USER_ID}/icpProfiles/${ICP_ID}`, {
    ...authoritative,
    isActive: true,
    status: 'active',
    createdAt: '2026-09-30T15:58:32.079Z',
  });

  const { updateIcpFromChat } = await import('../utils/updateIcpFromChat');
  const result = await updateIcpFromChat(USER_ID, icpDelta, action, existingProfile);
  const persisted = STORE.get(`users/${USER_ID}/icpProfiles/${ICP_ID}`);
  return { result, persisted };
}

describe('updateIcpFromChat — companyKeywords sanitized at the existing-ICP update boundary', () => {
  it('ADD — reproduces the exact production state: stale "headquarters" cannot survive even when the incoming delta has nothing new', async () => {
    const { persisted } = await runUpdate({
      authoritative: {
        companyKeywords: ['headquarters'],
        industries: ['Banking'],
        locations: ['Utah'],
        companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
      },
      icpDelta: { companyKeywords: [] },
      action: 'add',
    });

    expect(persisted.companyKeywords).toEqual([]);
    expect(persisted.companyKeywords).not.toContain('headquarters');

    // Banking is a separate, untouched question — the industries merge path
    // is not part of this fix and must produce the same result as before.
    expect(persisted.industries).toEqual(['Banking']);
    expect(persisted.locations).toEqual(['Utah']);
    expect(persisted.companySizes).toEqual(['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+']);
  });

  it('ADD — legitimate merge semantics are preserved: existing + new company-type keywords combine', async () => {
    const { persisted } = await runUpdate({
      authoritative: { companyKeywords: ['saas'] },
      icpDelta: { companyKeywords: ['fintech'] },
      action: 'add',
    });

    expect(persisted.companyKeywords).toEqual(['saas', 'fintech']);
  });

  it('ADD — a stale value on either side of the merge is stripped, not just the incoming one', async () => {
    const { persisted } = await runUpdate({
      authoritative: { companyKeywords: ['headquarters', 'saas'] },
      icpDelta: { companyKeywords: ['local government', 'salt lake county'] },
      action: 'add',
    });

    expect(persisted.companyKeywords).toEqual(['saas', 'local government']);
  });

  it('REPLACE — an explicit [] clears a stale value, exactly as a non-empty replace would', async () => {
    const { persisted } = await runUpdate({
      authoritative: { companyKeywords: ['headquarters'] },
      icpDelta: { companyKeywords: [] },
      action: 'replace',
    });

    expect(persisted.companyKeywords).toEqual([]);
  });

  it('REPLACE — a new value truly replaces, it does not merge with the old one (not silently turned into add)', async () => {
    const { persisted } = await runUpdate({
      authoritative: { companyKeywords: ['headquarters', 'saas'] },
      icpDelta: { companyKeywords: ['fintech'] },
      action: 'replace',
    });

    expect(persisted.companyKeywords).toEqual(['fintech']);
    expect(persisted.companyKeywords).not.toContain('saas');
  });

  it('REPLACE — an omitted companyKeywords field still falls back to the old value, but that carried-forward value is sanitized too', async () => {
    const { persisted } = await runUpdate({
      authoritative: { companyKeywords: ['headquarters', 'saas'] },
      icpDelta: { industries: ['Banking'] }, // companyKeywords key not present at all
      action: 'replace',
    });

    // Replace's field-selection rule is unchanged — the field was omitted,
    // so the old value is still what's kept, not the new delta's. Only the
    // *sanitization* of whichever value is kept is new.
    expect(persisted.companyKeywords).toEqual(['saas']);
  });

  it('the production fix holds through to the actual Apollo query: "headquarters" cannot appear, Banking is untouched', async () => {
    const { persisted } = await runUpdate({
      authoritative: {
        companyKeywords: ['headquarters'],
        industries: ['Banking'],
        locations: ['Utah'],
        companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
      },
      icpDelta: { companyKeywords: [] },
      action: 'add',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { buildApolloQuery } = await import('../../netlify/functions/search-companies.js');
    const apolloQuery = buildApolloQuery(persisted);

    // "Banking" resolves to an Apollo industry tag ID, so it is represented
    // structurally via organization_industry_tag_ids and is no longer also
    // folded into q_organization_keyword_tags (Wave 2C) — that duplication
    // is what zeroed out production results when an industry filter was
    // combined with a location filter. companyKeywords sanitization (this
    // fix) is orthogonal and still holds: "headquarters" cannot appear.
    expect(apolloQuery.organization_industry_tag_ids).toEqual(['5567cd4773696439b10b000a']);
    expect(apolloQuery.q_organization_keyword_tags).toBeUndefined();
    expect(apolloQuery.organization_locations).toEqual(['Utah, United States']);
  });
});
