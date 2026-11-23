/**
 * #006.2 — rendered: what ICP Settings says after Save, and no duplicate searches.
 *
 * Same in-memory Firestore harness as icpSaveDoesNotDeactivate.test.jsx. Every
 * search-companies request is held open so each stage can be observed.
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
  searches.length = 0;
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (!String(url).includes('search-companies')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    let settle;
    const p = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    searches.push(settle);
    return p;
  }));
});


/** Search requests the screen has made, each waiting to be settled by the test. */
const searches = [];
const searchCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes('search-companies')).length;
const message = () => document.querySelector('[data-save-outcome]');
const refreshBtns = () => screen.getAllByRole('button', { name: /Refresh Results|Searching/ });

describe('saving the active ICP with changed targeting', () => {
  it('says Barry started, blocks a second search, then says it finished', async () => {
    await mountSettings();
    fireEvent.click(screen.getByLabelText('51-100 employees'));
    await click(screen.getByText('Save Changes'));

    await waitFor(() => expect(message()?.dataset.saveOutcome).toBe('search_started'));
    expect(message().textContent).toMatch(/Barry has started finding companies/);
    expect(message().textContent).not.toMatch(/Refresh Results/);
    expect(searchCalls()).toBe(1);

    // No duplicate while it runs: both Refresh Results buttons (header and footer)
    // are disabled, and clicking them does nothing.
    expect(refreshBtns()).toHaveLength(2);
    for (const b of refreshBtns()) { expect(b.disabled).toBe(true); await click(b); }
    expect(searchCalls()).toBe(1);

    await act(async () => { searches[0].resolve({ ok: true, json: () => Promise.resolve({ success: true }) }); });
    await waitFor(() => expect(message().dataset.saveOutcome).toBe('search_finished'));
    for (const b of refreshBtns()) expect(b.disabled).toBe(false);
  });

  it('a failed search is an alert, and Refresh Results retries it', async () => {
    await mountSettings();
    fireEvent.click(screen.getByLabelText('51-100 employees'));
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(searchCalls()).toBe(1));

    await act(async () => { searches[0].resolve({ ok: false, json: () => Promise.resolve({ error: 'boom' }) }); });
    await waitFor(() => expect(message().dataset.saveOutcome).toBe('search_failed'));
    expect(message().getAttribute('role')).toBe('alert');
    expect(message().textContent).toMatch(/couldn't complete the search/);

    await click(refreshBtns()[1]);
    expect(searchCalls()).toBe(2);
  });

  it('a network error is reported the same way', async () => {
    await mountSettings();
    fireEvent.click(screen.getByLabelText('51-100 employees'));
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(searchCalls()).toBe(1));
    await act(async () => { searches[0].reject(new TypeError('Failed to fetch')); });
    await waitFor(() => expect(message().dataset.saveOutcome).toBe('search_failed'));
  });
});

describe('saves that do not search', () => {
  it('active ICP, nothing about targeting changed: says so, and no request', async () => {
    await mountSettings();
    fireEvent.change(screen.getByPlaceholderText(/Focus on post-Series A/), { target: { value: 'Notes only.' } });
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(message()?.dataset.saveOutcome).toBe('no_targeting_change'));
    expect(message().textContent).toMatch(/didn’t start a new search/);
    expect(searchCalls()).toBe(0);
  });

  it('a profile that is not active: says Barry won’t search with it, and no request', async () => {
    await mountSettings();
    await click(screen.getByText('NON PROFITS'));
    fireEvent.click(await screen.findByLabelText('51-100 employees'));
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(message()?.dataset.saveOutcome).toBe('profile_not_active'));
    expect(message().textContent).toMatch(/isn’t active/);
    expect(searchCalls()).toBe(0);
  });
});
