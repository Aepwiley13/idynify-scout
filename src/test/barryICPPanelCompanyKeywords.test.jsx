/**
 * BarryICPPanel — the fourth ICP writer, found during production tracing of
 * the Jordan River incident after #678/#679 had already shipped.
 *
 * Unlike updateIcpFromChat.js (#679) and barryICPConversation.js (#678),
 * BarryICPPanel.handleFindCompanies() both persists the ICP AND immediately
 * fires search-companies in the same synchronous sequence — matching the
 * production evidence of a ~3 second gap between the ICP's `updatedAt` and
 * the search-companies invocation. Its merge is a conditional spread:
 *
 *   ...(icpParams.companyKeywords?.length > 0 && { companyKeywords: ... })
 *
 * When the new value is empty, the key is omitted from the spread entirely,
 * so a stale invalid value already on resolution.profile (e.g.
 * ["headquarters"], written before any validation existed) passes through
 * completely untouched — not merged, just carried forward verbatim.
 *
 * These tests drive the real component end to end (mount, conversation,
 * "Find My Companies") against an in-memory Firestore and a mocked
 * barryMissionChat/search-companies network layer, and assert the one
 * invariant this fix establishes: the SAME sanitized companyKeywords value
 * reaches the icpProfiles write, the companyProfile/current bridge, and the
 * search-companies request body — because all three read the one
 * mergedProfile object, sanitized once before any of them.
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
vi.mock('../firebase/config', () => ({ db: {} }));

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
          updatedHistory: [],
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

async function renderPanelAndFindCompanies(icpParams) {
  mockFetchFor(icpParams);
  const { default: BarryICPPanel } = await import('../components/scout/BarryICPPanel');

  render(
    <BarryICPPanel
      userId="u1"
      icpProfile={null}
      onClose={() => {}}
      onSearchComplete={() => {}}
    />
  );

  await waitFor(() => expect(screen.queryByPlaceholderText(/Tell Barry who you're targeting/i)).toBeInTheDocument());

  const input = screen.getByPlaceholderText(/Tell Barry who you're targeting/i);
  fireEvent.change(input, { target: { value: 'find me more companies like this' } });
  const sendButtons = screen.getAllByRole('button');
  const sendButton = sendButtons[sendButtons.length - 1];
  await act(async () => { fireEvent.click(sendButton); });

  const findButton = await waitFor(() => screen.getByText('Find My Companies'));
  await act(async () => { fireEvent.click(findButton); });

  await waitFor(() => expect(STORE.get(`users/u1/icpProfiles/${ICP_ID}`).updatedAt).toBeTruthy());
}

beforeEach(() => {
  vi.resetModules();
});

describe('BarryICPPanel.handleFindCompanies — companyKeywords sanitized at the final effective-profile boundary', () => {
  it('reproduces the exact production state: a stale "headquarters" cannot survive even though the conditional merge would otherwise carry it forward untouched', async () => {
    await seedActiveIcp({
      companyKeywords: ['headquarters'],
      industries: ['Banking'],
      locations: ['Utah'],
      companySizes: ['501-1,000', '1,001-2,000', '2,001-5,000', '5,001-10,000', '10,001+'],
    });

    await renderPanelAndFindCompanies({ companyKeywords: [] });

    const persisted = STORE.get(`users/u1/icpProfiles/${ICP_ID}`);
    expect(persisted.companyKeywords).toEqual([]);
    expect(persisted.companyKeywords).not.toContain('headquarters');

    // Banking/industries is a separate, untouched question.
    expect(persisted.industries).toEqual(['Banking']);
  });

  it('persisted profile, bridge, and search request all carry the SAME sanitized value — not three independent copies', async () => {
    await seedActiveIcp({ companyKeywords: ['headquarters', 'saas'] });

    await renderPanelAndFindCompanies({ companyKeywords: [] });

    const persisted = STORE.get(`users/u1/icpProfiles/${ICP_ID}`);
    const bridge = STORE.get('users/u1/companyProfile/current');

    expect(persisted.companyKeywords).toEqual(['saas']);
    expect(bridge.companyKeywords).toEqual(['saas']);
    await waitFor(() => expect(searchRequestBody).not.toBeNull());
    expect(searchRequestBody.companyProfile.companyKeywords).toEqual(['saas']);

    // All three are the literal same value, not independently-derived copies
    // that happen to agree.
    expect(persisted.companyKeywords).toEqual(bridge.companyKeywords);
    expect(persisted.companyKeywords).toEqual(searchRequestBody.companyProfile.companyKeywords);
  });

  it('legitimate company-type keywords (including the #678/#679 edge cases) are preserved through this boundary', async () => {
    const cases = [
      { existing: [], incoming: ['saas'], expected: ['saas'] },
      { existing: [], incoming: ['fintech', 'saas'], expected: ['fintech', 'saas'] },
      { existing: [], incoming: ['local government'], expected: ['local government'] },
      { existing: [], incoming: ['city government'], expected: ['city government'] },
      { existing: [], incoming: ['county government'], expected: ['county government'] },
      { existing: [], incoming: ['county hospital'], expected: ['county hospital'] },
      { existing: [], incoming: ['metro transit'], expected: ['metro transit'] },
      { existing: ['headquarters'], incoming: ['saas'], expected: ['saas'] },
    ];

    for (const { existing, incoming, expected } of cases) {
      await seedActiveIcp({ companyKeywords: existing });
      await renderPanelAndFindCompanies({ companyKeywords: incoming });
      const persisted = STORE.get(`users/u1/icpProfiles/${ICP_ID}`);
      expect(persisted.companyKeywords).toEqual(expected);
    }
  });
});
