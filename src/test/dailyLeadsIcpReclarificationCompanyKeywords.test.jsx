/**
 * DailyLeads.jsx's IcpReclarificationModal — the fifth ICP writer found
 * during production tracing of the Jordan River incident, after #678, #679,
 * and #680 had already fixed their respective paths.
 *
 * It independently duplicates BarryICPPanel.handleFindCompanies's exact
 * pattern (resolveActiveIcp → merge existing profile + icpParams →
 * icpProfiles write → companyProfile/current bridge → search-companies),
 * including the same vulnerable conditional companyKeywords spread:
 *
 *   ...(icpParams.companyKeywords?.length > 0 && { companyKeywords: ... })
 *
 * When the incoming value is empty, the key is omitted from the spread
 * entirely, so a stale invalid value already on the resolved profile (e.g.
 * ["headquarters"], written before any validation existed) passes through
 * completely untouched.
 *
 * These tests mirror src/test/barryICPPanelCompanyKeywords.test.jsx exactly,
 * against this component instead, and assert the same invariant: the one
 * sanitized mergedProfile.companyKeywords feeds the icpProfiles write, the
 * companyProfile/current bridge, and the search-companies request body —
 * not three independent copies that happen to agree.
 */
import { render, fireEvent, act, waitFor, screen } from '@testing-library/react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// ── In-memory Firestore ─────────────────────────────────────────────────────
const STORE = new Map();
const pathOf = (first, rest) => (first && first.__path ? [first.__path, ...rest] : rest).join('/');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function write(path, data, options) {
  STORE.set(path, options?.merge ? { ...(STORE.get(path) || {}), ...clone(data) } : clone(data));
}

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => { const p = pathOf(first, rest); return { __path: p, id: p.split('/').pop() }; },
  getDoc: async ref => { const d = STORE.get(ref.__path); return { exists: () => d !== undefined, data: () => clone(d), id: ref.id }; },
  getDocs: async q => {
    const prefix = q.__path + '/';
    const docs = [...STORE.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => clone(v), ref: { __path: k, id: k.split('/').pop() } }));
    return { empty: docs.length === 0, docs };
  },
  setDoc: async (ref, data, options) => write(ref.__path, data, options),
  updateDoc: async (ref, data) => write(ref.__path, data, { merge: true }),
  deleteDoc: async ref => { STORE.delete(ref.__path); },
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: {} }));

vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: async () => 'tok' }),
}));
vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({
    cardBg: '#000', border: '#111', border2: '#222', text: '#fff',
    textFaint: '#999', textMuted: '#aaa', surface: '#333',
  }),
}));
vi.mock('../utils/barryCanonical', () => ({
  loadOrSeedRecentTurns: vi.fn().mockResolvedValue([]),
  appendTurn: vi.fn().mockResolvedValue(undefined),
}));

const ICP_ID = 'icp_1790783912079';
let searchRequestBody = null;

function mockFetchFor(icpParams) {
  searchRequestBody = null;
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (url === '/.netlify/functions/barryMissionChat') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          response_text: "Here's what I've got — ready to search.",
          has_enough_context: true,
          icp_params: icpParams,
        }),
      };
    }
    if (url === '/.netlify/functions/search-companies') {
      searchRequestBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ companiesAdded: 0 }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

async function seedActiveIcp(authoritative) {
  STORE.clear();
  STORE.set(`users/u1/icpProfiles/${ICP_ID}`, {
    ...authoritative,
    isActive: true,
    status: 'active',
    createdAt: '2026-09-30T15:58:32.079Z',
  });
}

async function renderModalAndFindCompanies(icpParams) {
  mockFetchFor(icpParams);
  const { IcpReclarificationModal } = await import('../pages/Scout/DailyLeads');

  render(
    <IcpReclarificationModal
      userId="u1"
      icpId={ICP_ID}
      onClose={() => {}}
      onSearchComplete={() => {}}
      reconConfidence={0}
    />
  );

  // The modal opens straight into a Barry reclarification turn on mount —
  // no user input needed before "Find My Companies" can appear.
  const findButton = await waitFor(() => screen.getByText('Find My Companies'));
  await act(async () => { fireEvent.click(findButton); });

  await waitFor(() => expect(STORE.get(`users/u1/icpProfiles/${ICP_ID}`).updatedAt).toBeTruthy());
}

beforeEach(() => {
  vi.resetModules();
});

describe('DailyLeads.IcpReclarificationModal — companyKeywords sanitized at the final effective-profile boundary', () => {
  it('reproduces the exact production state: a stale "headquarters" cannot survive even though the conditional merge would otherwise carry it forward untouched', async () => {
    await seedActiveIcp({
      companyKeywords: ['headquarters'],
      industries: ['Banking'],
      locations: ['Utah'],
      companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
    });

    await renderModalAndFindCompanies({ companyKeywords: [] });

    const persisted = STORE.get(`users/u1/icpProfiles/${ICP_ID}`);
    expect(persisted.companyKeywords).toEqual([]);
    expect(persisted.companyKeywords).not.toContain('headquarters');
    expect(persisted.industries).toEqual(['Banking']);
  });

  it('persisted profile, bridge, and search request all carry the SAME sanitized value', async () => {
    await seedActiveIcp({ companyKeywords: ['headquarters'] });

    await renderModalAndFindCompanies({ companyKeywords: ['saas'] });

    const persisted = STORE.get(`users/u1/icpProfiles/${ICP_ID}`);
    const bridge = STORE.get('users/u1/companyProfile/current');

    expect(persisted.companyKeywords).toEqual(['saas']);
    expect(bridge.companyKeywords).toEqual(['saas']);
    await waitFor(() => expect(searchRequestBody).not.toBeNull());
    expect(searchRequestBody.companyProfile.companyKeywords).toEqual(['saas']);

    expect(persisted.companyKeywords).toEqual(bridge.companyKeywords);
    expect(persisted.companyKeywords).toEqual(searchRequestBody.companyProfile.companyKeywords);
  });

  it.each([
    { existing: [], incoming: ['saas'], expected: ['saas'] },
    { existing: [], incoming: ['fintech', 'saas'], expected: ['fintech', 'saas'] },
    { existing: [], incoming: ['local government'], expected: ['local government'] },
    { existing: [], incoming: ['city government'], expected: ['city government'] },
    { existing: [], incoming: ['county government'], expected: ['county government'] },
    { existing: [], incoming: ['county hospital'], expected: ['county hospital'] },
    { existing: [], incoming: ['metro transit'], expected: ['metro transit'] },
    { existing: ['headquarters'], incoming: ['saas'], expected: ['saas'] },
  ])('legitimate company-type keywords are preserved: existing=$existing incoming=$incoming → $expected', async ({ existing, incoming, expected }) => {
    await seedActiveIcp({ companyKeywords: existing });
    await renderModalAndFindCompanies({ companyKeywords: incoming });
    const persisted = STORE.get(`users/u1/icpProfiles/${ICP_ID}`);
    expect(persisted.companyKeywords).toEqual(expected);
  });
});
