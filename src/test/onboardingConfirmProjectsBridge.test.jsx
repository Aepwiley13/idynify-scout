/**
 * Confirming Barry's targeting proposal must leave the bridge resolvable.
 *
 * `companyProfile/current` is a projection of the active ICP. Two writers reach
 * it during one confirmation: setActiveIcpProfile, which projects the profile
 * together with the lifecycle pair `isActive: true, status: 'active'`, and
 * onboarding itself, which stamps the attribution `barry_onboarding_confirmed`.
 *
 * The second of those used to be a non-merging setDoc of the proposal object:
 *
 *   await setDoc(
 *     doc(db, 'users', user.uid, 'companyProfile', 'current'),
 *     { ...icpProfile, icpId, icpIdSource: 'barry_onboarding_confirmed' }
 *   );
 *
 * `icpProfile` is built from the extracted targeting fields and carries no
 * isActive and no status, so it erased the lifecycle written milliseconds
 * earlier. That is the state loadICPProfiles in ICP Settings describes — a
 * bridge held "with no isActive and no status" — and the shape of the same
 * defect ICP Settings' own save had: a screen replaying its in-memory snapshot
 * over fields it does not own.
 *
 * On the write-through branch it was worse still. setActiveIcpProfile was never
 * called there, so the bridge was never re-projected; a merge alone would have
 * left it carrying whatever the previous ICP's criteria had been, under the new
 * ICP's id.
 *
 * These tests drive the real screen against an in-memory Firestore and read the
 * store back: confirm, then ask what `companyProfile/current` actually holds.
 */

import { render, fireEvent, act, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// ── In-memory Firestore ─────────────────────────────────────────────────────

const STORE = new Map();

const pathOf = (first, rest) =>
  (first && first.__path ? [first.__path, ...rest] : rest).join('/');

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Firestore merge semantics, flat — no nested field paths are used here. */
function write(path, data, options) {
  const next = options?.merge ? { ...(STORE.get(path) || {}), ...clone(data) } : clone(data);
  STORE.set(path, next);
}

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => {
    const p = pathOf(first, rest);
    return { __path: p, id: p.split('/').pop() };
  },
  getDoc: async ref => {
    const data = STORE.get(ref.__path);
    return { exists: () => data !== undefined, data: () => clone(data), id: ref.id };
  },
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
  addDoc: async (q, data) => {
    const id = `gen_${STORE.size}`;
    write(`${q.__path}/${id}`, data);
    return { id };
  },
  writeBatch: () => {
    const staged = [];
    return {
      set: (ref, data, options) => staged.push([ref.__path, data, options]),
      update: (ref, data) => staged.push([ref.__path, data, { merge: true }]),
      commit: async () => staged.forEach(([p, d, o]) => write(p, d, o)),
    };
  },
  runTransaction: async (_db, fn) => fn({
    get: async ref => {
      const data = STORE.get(ref.__path);
      return { exists: () => data !== undefined, data: () => clone(data) };
    },
    set: (ref, data, options) => write(ref.__path, data, options),
    update: (ref, data) => write(ref.__path, data, { merge: true }),
  }),
  query: (q, ...rest) => ({ ...q, __constraints: rest }),
  orderBy: (...a) => ({ __orderBy: a }),
  limit: n => ({ __limit: n }),
  serverTimestamp: () => '__serverTimestamp',
}));

// vi.mock factories are hoisted above every top-level binding, so the test user
// is built inside each one rather than shared from a const.
vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', getIdToken: () => Promise.resolve('token') } },
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: () => Promise.resolve('token') }),
  getActiveUserId: () => 'u1',
}));

// Analytics writes its own collection and is not part of this contract.
vi.mock('../services/analytics', () => ({
  logEvent: vi.fn(),
  EVENTS: new Proxy({}, { get: (_t, k) => String(k) }),
}));

import BarryOnboarding from '../pages/Onboarding/BarryOnboarding.jsx';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CONFIRMED = {
  industries: ['Roofing'],
  companySizes: ['11-50'],
  locations: ['Texas'],
  targetTitles: ['Owner'],
  searchStrategy: 'industry_only',
};

const profilePath = id => `users/u1/icpProfiles/${id}`;
const BRIDGE = 'users/u1/companyProfile/current';

/** Resume the conversation directly at the proposal, with ambiguity resolved. */
function seedConversation(icp = CONFIRMED) {
  STORE.set('users/u1/barryConversations/icp', {
    status: 'in_progress',
    isAmbiguous: false,
    currentStep: 'confirming',
    followUpCount: 1,
    extractedICP: icp,
    messages: [{ role: 'user', content: 'Roofing companies in Texas', timestamp: '2026-09-01T00:00:00.000Z' }],
  });
}

async function confirmProposal() {
  render(<MemoryRouter><BarryOnboarding /></MemoryRouter>);
  const go = await screen.findByText(/go find them/);
  await act(async () => { fireEvent.click(go); });
  await waitFor(() => expect(STORE.get(BRIDGE)?.icpIdSource).toBe('barry_onboarding_confirmed'));
}

/** The pair resolveActiveIcp requires before it will call an ICP active. */
const lifecycleOf = doc => ({ isActive: doc?.isActive, status: doc?.status });

beforeEach(() => {
  STORE.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ companiesAdded: 3 }) })));
});

// ── The regression: a brand-new ICP ─────────────────────────────────────────

describe('confirming with no existing ICP', () => {
  beforeEach(() => seedConversation());

  it('leaves the bridge carrying the lifecycle the resolver reads', async () => {
    await confirmProposal();

    const bridge = STORE.get(BRIDGE);

    // The invariant the non-merging write destroyed.
    expect(lifecycleOf(bridge)).toEqual({ isActive: true, status: 'active' });

    // Attribution is still onboarding's, not the projection's.
    expect(bridge.icpIdSource).toBe('barry_onboarding_confirmed');

    // And it names the ICP that was actually created.
    const created = [...STORE.keys()].filter(k => k.startsWith('users/u1/icpProfiles/'));
    expect(created).toHaveLength(1);
    expect(bridge.icpId).toBe(created[0].split('/').pop());
  });

  it('agrees with the authoritative profile it projects', async () => {
    await confirmProposal();

    const bridge = STORE.get(BRIDGE);
    const profile = STORE.get(profilePath(bridge.icpId));

    expect(lifecycleOf(profile)).toEqual({ isActive: true, status: 'active' });
    expect(bridge.industries).toEqual(['Roofing']);
    expect(bridge.companySizes).toEqual(['11-50']);
    expect(bridge.locations).toEqual(['Texas']);
    expect(bridge.name).toBe(profile.name);
  });
});

// ── The write-through branch ────────────────────────────────────────────────

describe('confirming when an ICP is already active', () => {
  beforeEach(() => {
    STORE.set(profilePath('icp_existing'), {
      name: 'Old Target',
      industries: ['Plumbing'],
      companySizes: ['1-10'],
      locations: ['Ohio'],
      messaging: { one: 'a' },
      messagingProgress: 100,
      isActive: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // A bridge in the shape the old code left behind: no lifecycle at all.
    STORE.set(BRIDGE, {
      name: 'Old Target',
      industries: ['Plumbing'],
      companySizes: ['1-10'],
      locations: ['Ohio'],
      revenueRanges: ['$1M-$5M'],
      icpId: 'icp_existing',
      icpIdSource: 'icp-settings-save',
    });
    seedConversation();
  });

  it('writes through rather than creating a second ICP', async () => {
    await confirmProposal();

    const ids = [...STORE.keys()]
      .filter(k => k.startsWith('users/u1/icpProfiles/'))
      .map(k => k.split('/').pop());
    expect(ids).toEqual(['icp_existing']);
    expect(STORE.get(BRIDGE).icpId).toBe('icp_existing');
  });

  it('repairs a bridge that arrived with no isActive and no status', async () => {
    expect(lifecycleOf(STORE.get(BRIDGE))).toEqual({ isActive: undefined, status: undefined });

    await confirmProposal();

    expect(lifecycleOf(STORE.get(BRIDGE))).toEqual({ isActive: true, status: 'active' });
    expect(lifecycleOf(STORE.get(profilePath('icp_existing')))).toEqual({ isActive: true, status: 'active' });
  });

  it('projects the confirmed criteria, not a blend with the ICP it replaced', async () => {
    await confirmProposal();

    const bridge = STORE.get(BRIDGE);
    expect(bridge.industries).toEqual(['Roofing']);
    expect(bridge.locations).toEqual(['Texas']);

    // `revenueRanges: ['$1M-$5M']` belonged to the bridge's previous contents.
    // A merged attribution stamp on top of a stale document would keep it; a
    // re-projection replaces the document, and the confirmed ICP skips revenue.
    expect(bridge.revenueRanges).toEqual([]);
    expect(bridge.skipRevenue).toBe(true);
  });

  it('preserves fields onboarding does not own', async () => {
    await confirmProposal();

    // Written by the messaging flow, absent from the proposal object. The
    // write-through is merged, so it survives — and reaches the projection.
    expect(STORE.get(profilePath('icp_existing')).messaging).toEqual({ one: 'a' });
    expect(STORE.get(BRIDGE).messagingProgress).toBe(100);
  });
});

// ── A second active profile must not survive the confirmation ───────────────

describe('confirming with more than one profile flagged active', () => {
  it('leaves exactly one, so the selection stays unambiguous', async () => {
    for (const id of ['icp_a', 'icp_b']) {
      STORE.set(profilePath(id), {
        name: id, industries: ['Plumbing'], isActive: true, status: 'active',
        createdAt: id === 'icp_a' ? '2026-01-01T00:00:00.000Z' : '2026-02-01T00:00:00.000Z',
      });
    }
    seedConversation();

    await confirmProposal();

    const active = [...STORE.entries()]
      .filter(([k, v]) => k.startsWith('users/u1/icpProfiles/') && v.isActive === true)
      .map(([k]) => k.split('/').pop());

    expect(active).toEqual([STORE.get(BRIDGE).icpId]);
  });
});

// ── Source guard ────────────────────────────────────────────────────────────
//
// The behavioural tests cover the path as it exists. This covers the way it
// decays: the bridge write reverting to a whole-document stamp of the proposal.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../pages/Onboarding/BarryOnboarding.jsx'),
  'utf8'
);
const confirmHandler = src.slice(
  src.indexOf('async function handleConfirm()'),
  src.indexOf('function handleRefine()')
);

describe("handleConfirm's bridge write", () => {
  it('merges — a whole-document write erases the lifecycle just projected', () => {
    const at = confirmHandler.indexOf("'companyProfile', 'current'");
    expect(at).toBeGreaterThan(-1);
    expect(confirmHandler.slice(at, at + 200)).toMatch(/\{ merge: true \}/);
  });

  it('names no lifecycle field — setActiveIcpProfile owns those', () => {
    const at = confirmHandler.indexOf("'companyProfile', 'current'");
    const call = confirmHandler.slice(at, confirmHandler.indexOf(');', at));
    for (const field of ['isActive', 'status']) {
      expect(call, `the bridge write assigns "${field}"`).not.toMatch(new RegExp(`${field}\\s*:`));
    }
  });

  it('does not replay the proposal object over the projection', () => {
    const at = confirmHandler.indexOf("'companyProfile', 'current'");
    expect(confirmHandler.slice(at, at + 200)).not.toMatch(/\.\.\.icpProfile/);
  });

  it('activates on both branches, before the attribution stamp', () => {
    const calls = [...confirmHandler.matchAll(/^(\s*)await setActiveIcpProfile\(user\.uid, icpId\);$/gm)];
    expect(calls).toHaveLength(1);

    // One call, at the handler's own indentation. Inside the create/write-through
    // branches it sits two levels deeper — which is where it used to be, leaving
    // the write-through branch with a bridge nobody re-projected.
    expect(calls[0][1], 'setActiveIcpProfile is nested inside a branch').toBe('      ');

    expect(calls[0].index).toBeLessThan(confirmHandler.indexOf("'companyProfile', 'current'"));
  });
});
