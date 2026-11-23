/**
 * #006.8 — Simplify ICP Settings: one status explanation per profile, one
 * "Refine with Barry" entry, the targeting fields under "Who you're looking
 * for", and the #006.9 blocked-save message no longer follows the user to
 * another profile. Presentation only.
 *
 * Same in-memory Firestore harness as icpSaveFeedback.test.jsx.
 */
import { render, fireEvent, act, waitFor, screen, within } from '@testing-library/react';
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
// The real BarryICPPanel talks to Barry; a stand-in shows which profile it was opened with.
vi.mock('../components/scout/BarryICPPanel', () => ({
  default: ({ icpProfile, onClose }) => (
    <div data-testid="barry-icp-panel" data-icp-name={icpProfile?.name}>
      <button type="button" onClick={onClose}>Close Barry</button>
    </div>
  ),
  BarryAvatar: () => null,
}));
vi.mock('../components/icp/Section9MessagingFlow', () => ({ default: () => null }));

import ICPSettings from '../pages/Scout/ICPSettings.jsx';
import { describeIcpProfile, PROFILE_STATE, PROFILE_STATE_TEXT } from '../utils/icpProfileState';

// ── Fixtures ────────────────────────────────────────────────────────────────

const criteria = {
  industries: ['Construction'], companySizes: ['11-20'], locations: ['Texas'], isNationwide: false,
  targetTitles: ['VP Sales'], scoringWeights: { industry: 25, location: 25, employeeSize: 25, revenue: 25 },
  foundedAgeRange: null, notes: 'post-Series A', messaging: { one: 'a' }, messagingProgress: 100,
};
const path = id => `users/u1/icpProfiles/${id}`;

function seed({ a = {}, b = {}, c = null } = {}) {
  STORE.clear();
  STORE.set(path('icp_a'), { ...criteria, name: 'MANUFACTURING', isActive: true, status: 'active', createdAt: '2026-01-01T00:00:00.000Z', ...a });
  STORE.set(path('icp_b'), { ...criteria, name: 'NON PROFITS', isActive: false, status: 'inactive', createdAt: '2026-02-01T00:00:00.000Z', ...b });
  if (c) STORE.set(path('icp_c'), { ...criteria, name: 'DENTISTS', isActive: false, status: 'pending', messagingProgress: 40, createdAt: '2026-03-01T00:00:00.000Z', ...c });
  STORE.set('users/u1/companyProfile/current', {
    ...criteria, name: 'MANUFACTURING', icpId: 'icp_a', icpIdSource: 'active-selection', isActive: true, status: 'active',
  });
}

async function mountSettings() {
  const view = render(<MemoryRouter><ICPSettings /></MemoryRouter>);
  await screen.findByText('Save Changes');
  return view;
}
const click = async el => { await act(async () => { fireEvent.click(el); }); };
const openTab = name => click(screen.getByText(name, { selector: '.icp-tab-name' }));
const status = () => screen.getByTestId('icp-profile-status');
const statuses = () => screen.queryAllByTestId('icp-profile-status');
const toggle = () => screen.getByRole('button', { name: /Advanced: How Matches Are Scored/ });
const numberInput = label => screen.getByLabelText(label, { selector: 'input[type="number"]' });

beforeEach(() => {
  seed();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // searches stay in flight
});

describe('describeIcpProfile', () => {
  it('active, saved-but-inactive, setup and no-action states, each with one text', () => {
    expect(describeIcpProfile({ isActive: true, status: 'active' })).toMatchObject({
      state: PROFILE_STATE.ACTIVE, text: 'Barry is searching with this profile.', canActivate: false, canFinishSetup: false, managedText: null,
    });
    expect(describeIcpProfile({ isActive: false, status: 'inactive' })).toMatchObject({
      state: PROFILE_STATE.INACTIVE, text: 'This profile is saved but not active. Activate it to start searching.', canActivate: true,
    });
    expect(describeIcpProfile({ isActive: false, status: 'pending' })).toMatchObject({
      state: PROFILE_STATE.SETUP, canFinishSetup: true, canActivate: false,
    });
    // isActive without status 'active' is not "searching", and offers no button,
    // so it doesn't tell the user to press one.
    expect(describeIcpProfile({ isActive: true, status: undefined })).toMatchObject({
      state: PROFILE_STATE.INACTIVE, text: 'This profile is saved but not active.', canActivate: false,
    });
    expect(describeIcpProfile(null)).toBeNull();
  });

  it('managed by Barry adds one note to whichever state applies, never replaces it', () => {
    const managed = { managedByBarry: true };
    expect(describeIcpProfile({ isActive: true, status: 'active' }, managed)).toMatchObject({
      text: PROFILE_STATE_TEXT.active, managedText: 'Barry created this profile with you. Your edits here take priority.',
    });
    expect(describeIcpProfile({ status: 'inactive' }, managed).text).toBe(PROFILE_STATE_TEXT.inactive);
  });
});

describe('profile status on the page', () => {
  it('the active profile: says Barry is searching, offers no activation', async () => {
    await mountSettings();
    expect(statuses()).toHaveLength(1);
    expect(status().dataset.state).toBe('active');
    expect(status().textContent).toBe('Barry is searching with this profile.');
    expect(within(status()).queryByRole('button')).toBeNull();
  });

  it('a saved, inactive profile: says so beside Set as Active, which still activates it', async () => {
    await mountSettings();
    await openTab('NON PROFITS');
    expect(status().dataset.state).toBe('inactive');
    expect(status().textContent).toBe('This profile is saved but not active. Activate it to start searching.Set as Active');
    expect(within(status()).getByText('This profile is saved but not active. Activate it to start searching.')).toBeTruthy();

    await click(within(status()).getByRole('button', { name: /Set as Active/ }));
    await waitFor(() => expect(STORE.get(path('icp_b'))).toMatchObject({ isActive: true, status: 'active' }));
    expect(STORE.get(path('icp_a')).isActive).toBe(false);
    await waitFor(() => expect(status().dataset.state).toBe('active'));
    expect(status().textContent).toBe('Barry is searching with this profile.');
    expect(statuses()).toHaveLength(1);
  });

  it('a profile still in setup: one message, the progress, and Finish setup', async () => {
    seed({ c: {} });
    await mountSettings();
    await openTab('DENTISTS');
    expect(status().dataset.state).toBe('setup');
    expect(status().textContent).toMatch(/This profile is saved but not active\. Finish setup to start searching\. Messaging setup 40% complete\./);
    expect(within(status()).getByRole('button', { name: 'Finish setup' })).toBeTruthy();
    expect(within(status()).queryByRole('button', { name: /Set as Active/ })).toBeNull();
  });

  it('managed by Barry and active: one block, both sentences, no separate banner', async () => {
    seed({ a: { managedByBarry: true, lookalikeSeed: { name: 'Acme Builders' } } });
    await mountSettings();
    expect(statuses()).toHaveLength(1);
    expect(status().textContent).toBe(
      'Barry is searching with this profile. Barry created this profile with you. Your edits here take priority.',
    );
    expect(screen.queryByText('Managed by Barry')).toBeNull();
    expect(screen.queryByText(/Changes made here will override/)).toBeNull();
  });

  it('managed by Barry and inactive: the inactive message keeps its action', async () => {
    seed({ b: { managedByBarry: true } });
    await mountSettings();
    await openTab('NON PROFITS');
    expect(status().textContent).toMatch(/Activate it to start searching\. Barry created this profile with you/);
    expect(within(status()).getByRole('button', { name: /Set as Active/ })).toBeTruthy();
  });
});

describe('Refine with Barry', () => {
  it('is the only Barry entry, and opens the existing Barry ICP panel for this profile', async () => {
    await mountSettings();
    expect(screen.getAllByTestId('refine-with-barry')).toHaveLength(1);
    expect(screen.queryByText('Want Barry to help?')).toBeNull();
    expect(screen.queryByText('Edit with Barry')).toBeNull();
    const card = screen.getByTestId('refine-with-barry');
    expect(within(card).getByRole('heading', { level: 2, name: 'Refine with Barry' })).toBeTruthy();
    expect(card.textContent).toMatch(/Barry will help you define and refine who Scout looks for/);

    expect(screen.queryByTestId('barry-icp-panel')).toBeNull();
    const ask = within(card).getByRole('button', { name: 'Ask Barry' });
    expect(ask.getAttribute('aria-describedby')).toBe('refine-with-barry-title');
    await click(ask);
    expect(screen.getByTestId('barry-icp-panel').dataset.icpName).toBe('MANUFACTURING');
    await click(screen.getByText('Close Barry'));
    expect(screen.queryByTestId('barry-icp-panel')).toBeNull();
  });

  it('a profile Barry set up the same single entry, plus its search strategy', async () => {
    seed({ a: { managedByBarry: true, lookalikeSeed: { name: 'Acme Builders' } } });
    await mountSettings();
    expect(screen.getAllByTestId('refine-with-barry')).toHaveLength(1);
    expect(screen.getByTestId('refine-with-barry').textContent).toMatch(/Finding companies similar to Acme Builders/);
    await click(screen.getByRole('button', { name: 'Ask Barry' }));
    expect(screen.getByTestId('barry-icp-panel')).toBeTruthy();
  });
});

describe("Who you're looking for", () => {
  it('holds every targeting field with its saved value; Advanced and Notes sit after it', async () => {
    await mountSettings();
    const group = screen.getByRole('region', { name: "Who you're looking for" });
    const h3s = within(group).getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(h3s).toEqual(expect.arrayContaining(['Industries', 'Company Sizes', 'Target Locations', 'Target Contact Titles']));
    expect(within(group).getByText('Company Age')).toBeTruthy();
    expect(within(group).getByLabelText('11-20 employees').checked).toBe(true);
    expect(within(group).getAllByText('Texas').length).toBeGreaterThan(0);
    expect(within(group).getAllByText('VP Sales').length).toBeGreaterThan(0);
    expect(within(group).getAllByText('Construction').length).toBeGreaterThan(0);

    expect(group.contains(toggle())).toBe(false);
    expect(group.contains(screen.getByText('Notes'))).toBe(false);
    expect(screen.getByDisplayValue('post-Series A')).toBeTruthy();
  });

  it('page headings read in order: profile name, then the two h2 groups', async () => {
    await mountSettings();
    const headings = screen.getAllByRole('heading').filter(h => ['H1', 'H2'].includes(h.tagName)).map(h => `${h.tagName}:${h.textContent}`);
    expect(headings).toEqual(['H1:MANUFACTURING', 'H2:Refine with Barry', "H2:Who you're looking for"]);
  });

  it('editing a targeting field and saving keeps the #006.2 behaviour', async () => {
    await mountSettings();
    fireEvent.click(screen.getByLabelText('51-100 employees'));
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(document.querySelector('[data-save-outcome]')?.dataset.saveOutcome).toBe('search_started'));
    expect(STORE.get(path('icp_a')).companySizes).toEqual(['11-20', '51-100']);
    expect(STORE.get(path('icp_a')).isActive).toBe(true);
  });
});

describe('#006.9 edge case: a blocked save stays with its profile', () => {
  it('switching profiles clears "Not saved"; the next profile only shows its own total', async () => {
    seed({ b: { scoringWeights: { industry: 30, location: 30, employeeSize: 30, revenue: 30 } } });
    await mountSettings();
    await click(toggle());
    fireEvent.change(numberInput('Industry Match'), { target: { value: '50' } }); // 125
    await click(screen.getByText('Save Changes'));
    expect(screen.getByTestId('weights-total-error').textContent).toMatch(/^Not saved\./);

    // NON PROFITS has its own invalid saved total. Its message must not claim a save failed.
    await openTab('NON PROFITS');
    const error = screen.getByTestId('weights-total-error');
    expect(error.textContent).not.toMatch(/Not saved/);
    expect(error.textContent).toMatch(/Currently at 120%/);
    expect(error.getAttribute('role')).toBeNull();

    // A save on NON PROFITS is still blocked, announced and focused as in #006.9.
    await click(screen.getByText('Save Changes'));
    expect(screen.getByTestId('weights-total-error').textContent).toMatch(/^Not saved\. Total must equal 100%\. Currently at 120%/);
    expect(screen.getByTestId('weights-total-error').getAttribute('role')).toBe('alert');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('weights-total-error')));
    expect(STORE.get(path('icp_b')).scoringWeights.industry).toBe(30);
  });

  it('switching to a profile with a valid total shows no weights message at all', async () => {
    await mountSettings();
    await click(toggle());
    fireEvent.change(numberInput('Revenue Match'), { target: { value: '0' } }); // 75
    await click(screen.getByText('Save Changes'));
    expect(screen.getByTestId('weights-total-error')).toBeTruthy();
    await openTab('NON PROFITS');
    expect(screen.queryByTestId('weights-total-error')).toBeNull();
    expect(toggle().closest('.section-header').textContent).not.toMatch(/Weights must total/);
  });
});
