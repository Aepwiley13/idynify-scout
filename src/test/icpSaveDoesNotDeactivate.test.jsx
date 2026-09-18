/**
 * ICP Settings save must not deactivate the ICP it is saving.
 *
 * Production, workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2, read 2026-09-17:
 *
 *   companyProfile/current       icpId=icp_1786493824113
 *                                icpIdSource='icp-settings-save'
 *                                isActive=false  status='inactive'
 *                                updatedAt=2026-09-07T20:15:14.957Z
 *   icpProfiles/icp_1786493824113  isActive=false  status='inactive'
 *                                updatedAt=2026-09-07T20:15:14.957Z   ← same write
 *
 * The bridge was asserting that a profile was current while carrying a snapshot
 * that said it was inactive, and both docs came from one Save. All six profiles
 * in that workspace ended up inactive, so resolveActiveIcp returned
 * 'none-active' and Daily Discoveries attributed no decisions at all — a
 * workspace swiping normally and writing zero lineage events.
 *
 * Mechanism: handleSaveChanges wrote the whole in-memory `profile` with a
 * non-merging setDoc. `profile` is a spread of the ICP as it was when the
 * screen mounted, and handleSetActive updated only `icpList`. So activating an
 * ICP and then saving it replayed the pre-activation isActive/status over the
 * activation that had just been committed.
 *
 * These tests drive the real screen against an in-memory Firestore: activate,
 * edit, save, and read back what is actually stored. The invariant under test
 * is the one that failed in production — after a save, the ICP is still active
 * and the bridge agrees with it.
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
  writeBatch: () => {
    const staged = [];
    return {
      set: (ref, data, options) => staged.push([ref.__path, data, options]),
      update: (ref, data) => staged.push([ref.__path, data, { merge: true }]),
      commit: async () => staged.forEach(([p, d, o]) => write(p, d, o)),
    };
  },
}));

// vi.mock factories are hoisted above every top-level binding, so the test
// user is built inside each one rather than shared from a const.
vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', getIdToken: () => Promise.resolve('token') } },
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: () => Promise.resolve('token') }),
}));

// Leaf panels reach for their own data and are not part of this contract.
vi.mock('../components/scout/BarryICPPanel', () => ({ default: () => null, BarryAvatar: () => null }));
vi.mock('../components/icp/Section9MessagingFlow', () => ({ default: () => null }));

import ICPSettings from '../pages/Scout/ICPSettings.jsx';
import { setActiveIcpProfile } from '../utils/setActiveIcpProfile.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const criteria = {
  industries: ['Construction'],
  companySizes: ['11-20'],
  locations: ['Texas'],
  isNationwide: false,
  targetTitles: ['VP Sales'],
  scoringWeights: { industry: 25, location: 25, employeeSize: 25, revenue: 25 },
  foundedAgeRange: null,
  notes: '',
  messaging: { one: 'a' },
  messagingProgress: 100,
};

const profilePath = id => `users/u1/icpProfiles/${id}`;
const BRIDGE = 'users/u1/companyProfile/current';

function seed() {
  STORE.clear();
  STORE.set(profilePath('icp_a'), {
    ...criteria, name: 'MANUFACTURING',
    isActive: true, status: 'active', createdAt: '2026-01-01T00:00:00.000Z',
  });
  STORE.set(profilePath('icp_b'), {
    ...criteria, name: 'NON PROFITS',
    isActive: false, status: 'inactive', createdAt: '2026-02-01T00:00:00.000Z',
  });
  STORE.set(BRIDGE, {
    ...criteria, name: 'MANUFACTURING', icpId: 'icp_a', icpIdSource: 'active-selection',
    isActive: true, status: 'active',
  });
}

async function mountSettings() {
  const view = render(<MemoryRouter><ICPSettings /></MemoryRouter>);
  await screen.findByText('Save Changes');
  return view;
}

const click = async el => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  seed();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
});

// ── The regression ──────────────────────────────────────────────────────────

describe('activate, then save without remounting', () => {
  it('leaves the activated ICP active, and the bridge agreeing with it', async () => {
    await mountSettings();

    // Select the inactive profile and activate it — no reload in between.
    await click(screen.getByText('NON PROFITS'));
    await click(await screen.findByText('Set as Active'));

    await waitFor(() => expect(STORE.get(profilePath('icp_b')).isActive).toBe(true));

    // Edit something this screen owns, then save.
    fireEvent.change(screen.getByPlaceholderText(/Focus on post-Series A/), {
      target: { value: 'Board-led intros only.' },
    });
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(STORE.get(profilePath('icp_b')).notes).toBe('Board-led intros only.'));

    const saved = STORE.get(profilePath('icp_b'));
    const bridge = STORE.get(BRIDGE);

    // The invariant that failed in production.
    expect(saved.isActive).toBe(true);
    expect(saved.status).toBe('active');

    expect(bridge.icpId).toBe('icp_b');
    expect(bridge.isActive).toBe(true);
    expect(bridge.status).toBe('active');
    expect(bridge.notes).toBe('Board-led intros only.');

    // The previously active profile is not resurrected by the save.
    expect(STORE.get(profilePath('icp_a')).isActive).toBe(false);
  });

  it('saving the already-active ICP does not deactivate it either', async () => {
    await mountSettings();

    fireEvent.change(screen.getByPlaceholderText(/Focus on post-Series A/), {
      target: { value: 'Steady state.' },
    });
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(STORE.get(profilePath('icp_a')).notes).toBe('Steady state.'));

    expect(STORE.get(profilePath('icp_a')).isActive).toBe(true);
    expect(STORE.get(profilePath('icp_a')).status).toBe('active');
    expect(STORE.get(BRIDGE).isActive).toBe(true);
    expect(STORE.get(BRIDGE).icpIdSource).toBe('icp-settings-save');
  });

  it('a save preserves fields the screen does not edit', async () => {
    await mountSettings();

    // A field only the messaging flow owns. A whole-document write from this
    // screen's stale snapshot is how such a field silently reverts.
    STORE.set(profilePath('icp_a'), { ...STORE.get(profilePath('icp_a')), messagingProgress: 42 });

    fireEvent.change(screen.getByPlaceholderText(/Focus on post-Series A/), {
      target: { value: 'Elsewhere-edited.' },
    });
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(STORE.get(profilePath('icp_a')).notes).toBe('Elsewhere-edited.'));

    expect(STORE.get(profilePath('icp_a')).messagingProgress).toBe(42);
    expect(STORE.get(profilePath('icp_a')).messaging).toEqual({ one: 'a' });
  });
});

// ── setActiveIcpProfile: an unknown target must not empty the workspace ─────

describe('setActiveIcpProfile with a target that does not exist', () => {
  it('refuses, leaving the existing selection intact', async () => {
    await expect(setActiveIcpProfile('u1', 'icp_missing')).rejects.toThrow(/not found/);

    expect(STORE.get(profilePath('icp_a')).isActive).toBe(true);
    expect(STORE.get(profilePath('icp_b')).isActive).toBe(false);
    expect(STORE.get(BRIDGE).icpId).toBe('icp_a');
  });

  it('re-reads Firestore when a caller’s pre-loaded list is stale', async () => {
    // icp_b exists in Firestore but is missing from the list handed in.
    const stale = [{ id: 'icp_a', ...STORE.get(profilePath('icp_a')) }];
    await setActiveIcpProfile('u1', 'icp_b', {}, stale);

    expect(STORE.get(profilePath('icp_b')).isActive).toBe(true);
    expect(STORE.get(profilePath('icp_a')).isActive).toBe(false);
    expect(STORE.get(BRIDGE).icpId).toBe('icp_b');
  });

  it('refuses when neither the list nor Firestore has the target', async () => {
    await expect(
      setActiveIcpProfile('u1', 'icp_ghost', {}, [{ id: 'icp_a', ...STORE.get(profilePath('icp_a')) }])
    ).rejects.toThrow(/refusing to deactivate every profile/);

    const stillActive = [...STORE.values()].filter(v => v.isActive === true);
    expect(stillActive.length).toBeGreaterThan(0);
  });
});

// ── Source guards ───────────────────────────────────────────────────────────
//
// The behavioural tests above cover the save path as it exists. These cover the
// way it decays: one new editor added to the screen without a matching entry in
// the allowlist, or one new whole-document write.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ICP_CRITERIA_FIELDS, ICP_LIFECYCLE_FIELDS, ICP_IDENTITY_FIELDS } from '../utils/icpProfileWrite.js';

const here = dirname(fileURLToPath(import.meta.url));
const icpSettings = readFileSync(resolve(here, '../pages/Scout/ICPSettings.jsx'), 'utf8');
const saveHandler = icpSettings.slice(
  icpSettings.indexOf('async function handleSaveChanges'),
  icpSettings.indexOf('recalculateAllScores was removed')
);

describe('the criteria allowlist', () => {
  it('contains no lifecycle or identity field', () => {
    for (const field of [...ICP_LIFECYCLE_FIELDS, ...ICP_IDENTITY_FIELDS]) {
      expect(ICP_CRITERIA_FIELDS, `${field} is not this screen's to write`).not.toContain(field);
    }
  });

  it('covers every field ICP Settings actually edits', () => {
    // Top-level keys assigned inside a `setProfile(prev => ({ ...prev, X: ... }))`
    // updater — i.e. everything the screen's own controls change.
    const edited = new Set();
    for (const block of icpSettings.matchAll(/setProfile\(prev => \(\{([\s\S]*?)\}\)\)/g)) {
      for (const key of block[1].matchAll(/^\s{2,}(\w+):/gm)) edited.add(key[1]);
    }

    expect(edited.size).toBeGreaterThan(0);
    for (const field of edited) {
      expect(
        ICP_CRITERIA_FIELDS,
        `ICP Settings edits "${field}" but the save allowlist omits it, so the edit is never persisted`
      ).toContain(field);
    }
  });
});

/** Every `setDoc(...)` call in a block of source, paren-matched. */
function setDocCallsIn(src) {
  const calls = [];
  const needle = 'setDoc(';
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    let depth = 0;
    for (let j = i + needle.length - 1; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) { calls.push(src.slice(i, j + 1)); break; }
    }
  }
  return calls;
}

const setDocCalls = setDocCallsIn(saveHandler);

describe('handleSaveChanges writes', () => {
  it('merges — a whole-document write replays a stale snapshot', () => {
    expect(setDocCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of setDocCalls) {
      expect(call, `a setDoc in handleSaveChanges is missing { merge: true }:\n${call}`)
        .toMatch(/\{ merge: true \}/);
    }
  });

  it('sends the allowlisted payload to both the profile and the bridge', () => {
    expect(saveHandler).toMatch(/buildIcpCriteriaWrite\(updatedProfile\)/);
    expect(saveHandler).toMatch(/'icpProfiles', selectedICPId\),\s*\n\s*criteriaWrite,/);
    expect(saveHandler).toMatch(/\{ \.\.\.criteriaWrite, icpId: selectedICPId, icpIdSource: 'icp-settings-save' \}/);
  });

  it('never names a lifecycle field', () => {
    for (const field of ICP_LIFECYCLE_FIELDS) {
      expect(
        saveHandler.replace(/isActiveProfile/g, ''),
        `handleSaveChanges assigns "${field}"; only setActiveIcpProfile may`
      ).not.toMatch(new RegExp(`${field}\\s*:`));
    }
  });
});

describe('local state after an activation', () => {
  it('updates icpList and profile from the same rule', () => {
    expect(icpSettings).toMatch(/function applyActivationToState/);
    const helper = icpSettings.slice(
      icpSettings.indexOf('function applyActivationToState'),
      icpSettings.indexOf('async function handleSetActive')
    );
    expect(helper).toMatch(/setIcpList\([\s\S]*nextLifecycleState/);
    expect(helper).toMatch(/setProfile\([\s\S]*nextLifecycleState/);
  });

  it('has no hand-rolled lifecycle transition left in the screen', () => {
    // `status: i.id === icpId ? 'active' : ...` — the copy that drifted.
    expect(icpSettings).not.toMatch(/status:\s*\w+\.id === \w+ \? 'active'/);
  });
});
