/**
 * Hunter → Missions (#003.3): the canonical mission list.
 *
 * Covers MissionsHost + the existing MissionsSection (loading, empty, error,
 * completed-only accounts, the effective user's path) and that every Missions
 * entry point — Hunter, Command Center, mobile, the legacy redirect, and the
 * mission pages' Back buttons — lands on /hunter?tab=missions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigateMock,
}));

const getDocsMock = vi.fn();
const collectionMock = vi.fn((...path) => ({ path: path.slice(1).join('/') }));
vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  query: (ref) => ref,
  orderBy: () => ({}),
  getDocs: (...args) => getDocsMock(...args),
}));

vi.mock('../firebase/config', () => ({ db: {} }));

let effectiveUser = { uid: 'user-a' };
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => effectiveUser,
}));

import MissionsHost from '../pages/Hunter/sections/MissionsHost';
import { MODULE_BOTTOM_NAV } from '../constants/mobileNavigation';

const snap = (docs) => ({ docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) });
const renderHost = () => render(<MemoryRouter><MissionsHost /></MemoryRouter>);

beforeEach(() => {
  navigateMock.mockReset();
  getDocsMock.mockReset();
  collectionMock.mockClear();
  effectiveUser = { uid: 'user-a' };
});

describe('Hunter → Missions list', () => {
  it('shows loading, then every mission with its status', async () => {
    getDocsMock.mockResolvedValue(snap([
      { id: 'm1', name: 'Q1 push', status: 'autopilot', contacts: [] },
      { id: 'm2', name: 'Paused one', status: 'paused', contacts: [] },
      { id: 'm3', name: 'Done one', status: 'completed', contacts: [] },
    ]));
    renderHost();

    expect(screen.getByText('Loading missions...')).toBeTruthy();
    expect(await screen.findByText('Q1 push')).toBeTruthy();
    expect(screen.getByText('Paused one')).toBeTruthy();
    expect(screen.getByText('Done one')).toBeTruthy();
    expect(screen.getByText('Missions')).toBeTruthy();
    expect(screen.getByText('3 missions · 1 active')).toBeTruthy();
  });

  it('a completed-only account sees its missions, not an empty prompt', async () => {
    getDocsMock.mockResolvedValue(snap([
      { id: 'm1', name: 'Finished A', status: 'completed', contacts: [] },
      { id: 'm2', name: 'Finished B', status: 'completed', contacts: [] },
    ]));
    renderHost();

    expect(await screen.findByText('Finished A')).toBeTruthy();
    expect(screen.getByText('Finished B')).toBeTruthy();
    expect(screen.getAllByText('Completed').length).toBe(2);
    expect(screen.getByText('2 missions · 0 active')).toBeTruthy();
    expect(screen.queryByText('No Missions Yet')).toBeNull();
  });

  it('empty account: the existing empty state, whose Create Mission opens the existing route', async () => {
    getDocsMock.mockResolvedValue(snap([]));
    renderHost();

    expect(await screen.findByText('No Missions Yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create Mission/ }));
    expect(navigateMock).toHaveBeenCalledWith('/hunter/create-mission');
  });

  it('a mission opens the existing detail route', async () => {
    getDocsMock.mockResolvedValue(snap([{ id: 'm7', name: 'Pilot', status: 'draft', contacts: [] }]));
    renderHost();

    fireEvent.click(await screen.findByText('Pilot'));
    expect(navigateMock).toHaveBeenCalledWith('/hunter/mission/m7');
  });

  it('error state with a working retry', async () => {
    getDocsMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    getDocsMock.mockResolvedValueOnce(snap([{ id: 'm1', name: 'Recovered', status: 'draft', contacts: [] }]));
    renderHost();

    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Recovered')).toBeTruthy();
  });

  it('no signed-in user: error state, no query', async () => {
    effectiveUser = null;
    renderHost();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('reads only users/{effective uid}/missions — the impersonated account when impersonating', async () => {
    effectiveUser = { uid: 'target-user', _isImpersonated: true };
    getDocsMock.mockResolvedValue(snap([]));
    renderHost();

    await screen.findByText('No Missions Yet');
    expect(collectionMock).toHaveBeenCalledTimes(1);
    expect(collectionMock.mock.calls[0].slice(1)).toEqual(['users', 'target-user', 'missions']);
  });
});

describe('every Missions entry point opens the Hunter list', () => {
  const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const all = (s) => [...(s.primary || []), ...(s.overflow || [])];

  it('mobile: Hunter and Command Center both go to /hunter?tab=missions', () => {
    expect(all(MODULE_BOTTOM_NAV.hunter).find(i => i.id === 'missions')?.to).toBe('/hunter?tab=missions');
    expect(all(MODULE_BOTTOM_NAV['command-center']).find(i => i.id === 'missions')?.to).toBe('/hunter?tab=missions');
  });

  it('desktop: Hunter has a Missions tab; Command Center links to it and keeps its active count', () => {
    const hunter = src('pages/Hunter/HunterMain.jsx');
    expect(hunter).toMatch(/id: 'missions',\s+label: 'Missions'/);
    expect(hunter).toMatch(/missions:\s+'missions'/);
    const cc = src('pages/Scout/PeopleMain.jsx');
    expect(cc).toMatch(/id: 'missions'.*route: '\/hunter\?tab=missions'/);
    expect(cc).toMatch(/it\.id === 'missions' && activeMissionsCount > 0/);
  });

  it('the legacy /hunter/missions address redirects to the Hunter list', () => {
    expect(src('App.jsx')).toMatch(/path="\/hunter\/missions"\s+element=\{<Navigate to="\/hunter\?tab=missions"/);
  });

  it('mission detail and create pages return to the list', () => {
    expect(src('pages/Hunter/MissionDetail.jsx')).not.toMatch(/navigate\('\/hunter'\)/);
    expect(src('pages/Hunter/CreateMission.jsx')).toMatch(/btn-back" onClick=\{\(\) => navigate\('\/hunter\?tab=missions'\)\}/);
  });
});
