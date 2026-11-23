/**
 * #003.4 — Mission Outcomes lives in Hunter; Sniper's reads "Sales Outcomes".
 *
 * OutcomesHost runs Command Center's two existing queries and renders the
 * existing OutcomesSection, so the calculations are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const getDocsMock = vi.fn();
const collectionMock = vi.fn((...path) => ({ name: path[path.length - 1], path: path.slice(1).join('/') }));
vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  query: (ref) => ref,
  orderBy: () => ({}),
  getDocs: (...args) => getDocsMock(...args),
}));
vi.mock('../firebase/config', () => ({ db: {} }));
let effectiveUser = { uid: 'user-a' };
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => effectiveUser }));

import OutcomesHost from '../pages/Hunter/sections/OutcomesHost';
import { MODULE_BOTTOM_NAV } from '../constants/mobileNavigation';

const snap = (docs) => ({ docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) });
const byCollection = (map) => (ref) => Promise.resolve(snap(map[ref.name] || []));
const renderHost = () => render(<MemoryRouter><OutcomesHost /></MemoryRouter>);

beforeEach(() => { getDocsMock.mockReset(); collectionMock.mockClear(); effectiveUser = { uid: 'user-a' }; });

describe('Hunter → Mission Outcomes', () => {
  it('loads missions and campaigns for the effective user, then shows the existing outcomes view', async () => {
    effectiveUser = { uid: 'target-user', _isImpersonated: true };
    getDocsMock.mockImplementation(byCollection({
      campaigns: [{ id: 'c1', name: 'Q1', contacts: [{ status: 'sent' }] }],
      missions: [],
    }));
    renderHost();

    expect(screen.getByText('Loading mission outcomes...')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Loading mission outcomes...')).toBeNull());
    expect(collectionMock.mock.calls.map(c => c.slice(1))).toEqual([
      ['users', 'target-user', 'missions'],
      ['users', 'target-user', 'campaigns'],
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an account with no data sees the existing empty state', async () => {
    getDocsMock.mockImplementation(byCollection({}));
    renderHost();
    expect(await screen.findByText('No Data Yet')).toBeTruthy();
  });

  it('error state with a working retry', async () => {
    // Both reads must return promises. A single mockRejectedValueOnce leaves
    // the second read undefined, throwing synchronously before Promise.all
    // attaches a rejection handler to the first promise.
    const denied = new Error('denied');
    getDocsMock
      .mockImplementationOnce(() => Promise.reject(denied))
      .mockImplementationOnce(() => Promise.resolve(snap([])));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderHost();
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(log).toHaveBeenCalledWith('[OutcomesHost] Failed to load outcomes:', denied);
      expect(getDocsMock).toHaveBeenCalledTimes(2);

      getDocsMock.mockImplementation(byCollection({}));
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
      expect(await screen.findByText('No Data Yet')).toBeTruthy();
      expect(getDocsMock).toHaveBeenCalledTimes(4);
    } finally {
      log.mockRestore();
    }
  });

  it('handles rejections from both concurrent reads', async () => {
    const denied = new Error('denied');
    getDocsMock.mockImplementation(() => Promise.reject(denied));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderHost();
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(getDocsMock).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('[OutcomesHost] Failed to load outcomes:', denied);
    } finally {
      log.mockRestore();
    }
  });

  it('ignores a late failure after unmounting without an unhandled rejection', async () => {
    let rejectMissions;
    let resolveCampaigns;
    const missions = new Promise((_, reject) => { rejectMissions = reject; });
    const campaigns = new Promise((resolve) => { resolveCampaigns = resolve; });
    getDocsMock.mockImplementation(ref => ref.name === 'missions' ? missions : campaigns);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = renderHost();
      expect(getDocsMock).toHaveBeenCalledTimes(2);
      unmount();
      await act(async () => {
        rejectMissions(new Error('denied'));
        resolveCampaigns(snap([]));
        await Promise.allSettled([missions, campaigns]);
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('no signed-in user: error, no query', async () => {
    effectiveUser = null;
    renderHost();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});

describe('entry points and labels', () => {
  const src = (p) => readFileSync(resolve(here, '..', p), 'utf8');
  const all = (s) => [...(s.primary || []), ...(s.overflow || [])];

  it('Hunter has the Mission Outcomes tab; Command Center links to it; /hunter/outcomes redirects there', () => {
    expect(src('pages/Hunter/HunterMain.jsx')).toMatch(/id: 'outcomes',\s+label: 'Mission Outcomes'/);
    expect(src('pages/Hunter/HunterMain.jsx')).toMatch(/outcomes:\s+'outcomes'/);
    expect(src('pages/Scout/PeopleMain.jsx')).toMatch(/id: 'outcomes',\s+label: 'Mission Outcomes'.*route: '\/hunter\?tab=outcomes'/);
    expect(src('App.jsx')).toMatch(/path="\/hunter\/outcomes"\s+element=\{<Navigate to="\/hunter\?tab=outcomes"/);
  });

  it('mobile: Hunter and Command Center open Mission Outcomes in Hunter; Sniper reads Sales Outcomes', () => {
    const h = all(MODULE_BOTTOM_NAV.hunter).find(i => i.id === 'outcomes');
    const cc = all(MODULE_BOTTOM_NAV['command-center']).find(i => i.id === 'outcomes');
    const sn = all(MODULE_BOTTOM_NAV.sniper).find(i => i.id === 'outcomes');
    expect([h?.label, h?.to]).toEqual(['Mission Outcomes', '/hunter?tab=outcomes']);
    expect([cc?.label, cc?.to]).toEqual(['Mission Outcomes', '/hunter?tab=outcomes']);
    expect([sn?.label, sn?.to]).toEqual(['Sales Outcomes', '/sniper?tab=outcomes']);
  });

  it('Sniper keeps its own outcomes view, relabelled only', () => {
    const s = src('pages/Sniper/SniperMain.jsx');
    expect(s).toMatch(/id: 'outcomes',\s+label: 'Sales Outcomes'/);
    expect(s).toMatch(/activeTab === 'outcomes'\s+&& <OutcomesSection \/>/);
  });
});
