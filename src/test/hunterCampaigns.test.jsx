/**
 * Hunter → Campaigns (#003.1 + #003.2): one canonical campaign list.
 *
 * Covers the list itself (states, status badges, links) and that every
 * Campaigns entry point — Hunter and Command Center, desktop and mobile —
 * opens it rather than the creation wizard.
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

import CampaignsSection from '../pages/Hunter/sections/CampaignsSection';
import { MODULE_BOTTOM_NAV } from '../constants/mobileNavigation';

const snap = (docs) => ({ docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) });

const renderList = () => render(<MemoryRouter><CampaignsSection /></MemoryRouter>);

beforeEach(() => {
  navigateMock.mockReset();
  getDocsMock.mockReset();
  collectionMock.mockClear();
  effectiveUser = { uid: 'user-a' };
});

describe('Hunter → Campaigns list', () => {
  it("lists the effective user's existing campaigns with their real status", async () => {
    getDocsMock.mockResolvedValue(snap([
      { id: 'c1', name: 'Q1 outreach', status: 'draft', contacts: [{}, {}] },
      { id: 'c2', name: 'Founders', status: 'in_progress', messages: [{}] },
      { id: 'c3', name: 'Renewals', status: 'completed', contacts: [{}] },
    ]));
    renderList();

    expect(await screen.findByText('Q1 outreach')).toBeTruthy();
    expect(screen.getByText('Founders')).toBeTruthy();
    expect(screen.getByText('Renewals')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('2 contacts')).toBeTruthy();
    // No linked missions, so no mission health and no mission counts.
    expect(screen.queryByText('On Track')).toBeNull();
    expect(screen.queryByText(/active$/)).toBeNull();
  });

  it('reads only users/{effective uid}/campaigns — the impersonated account when impersonating', async () => {
    effectiveUser = { uid: 'target-user', _isImpersonated: true };
    getDocsMock.mockResolvedValue(snap([]));
    renderList();

    await screen.findByText(/No campaigns yet/);
    expect(collectionMock).toHaveBeenCalledTimes(1);
    expect(collectionMock.mock.calls[0].slice(1)).toEqual(['users', 'target-user', 'campaigns']);
  });

  it('opens the existing detail route from a card, by click and by keyboard', async () => {
    getDocsMock.mockResolvedValue(snap([{ id: 'c9', name: 'Pilot', status: 'draft' }]));
    renderList();

    const card = await screen.findByRole('link', { name: /Open campaign Pilot/ });
    fireEvent.click(card);
    expect(navigateMock).toHaveBeenLastCalledWith('/hunter/campaign/c9');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledTimes(2);
  });

  it('empty state offers New Campaign, which opens the existing wizard', async () => {
    getDocsMock.mockResolvedValue(snap([]));
    renderList();

    await screen.findByText(/No campaigns yet/);
    const buttons = screen.getAllByRole('button', { name: /New Campaign/ });
    expect(buttons).toHaveLength(2); // header + empty state
    fireEvent.click(buttons[1]);
    expect(navigateMock).toHaveBeenCalledWith('/hunter/campaign/new');
  });

  it('shows loading, then an error with a working retry', async () => {
    getDocsMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    getDocsMock.mockResolvedValueOnce(snap([{ id: 'c1', name: 'Back again', status: 'draft' }]));
    renderList();

    expect(screen.getByText('Loading campaigns…')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Back again')).toBeTruthy();
  });

  it('shows the error state, not a crash, when there is no signed-in user', async () => {
    effectiveUser = null;
    renderList();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});

describe('every Campaigns entry point opens the list', () => {
  const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('mobile: Hunter and Command Center both go to /hunter?tab=campaigns', () => {
    const all = (s) => [...(s.primary || []), ...(s.overflow || [])];
    const hunter = all(MODULE_BOTTOM_NAV.hunter).find(i => i.id === 'campaigns');
    const cc = all(MODULE_BOTTOM_NAV['command-center']).find(i => i.id === 'campaigns');
    expect(hunter?.to).toBe('/hunter?tab=campaigns');
    expect(cc?.to).toBe('/hunter?tab=campaigns');
  });

  it('desktop: Hunter has a Campaigns tab and Command Center links to it', () => {
    const hunter = src('pages/Hunter/HunterMain.jsx');
    expect(hunter).toMatch(/id: 'campaigns',\s+label: 'Campaigns'/);
    expect(hunter).toMatch(/campaigns: 'campaigns'/);
    expect(src('pages/Scout/PeopleMain.jsx')).toMatch(/id: 'campaigns'.*route: '\/hunter\?tab=campaigns'/);
  });

  it('the wizard and detail pages return to the list', () => {
    for (const f of ['pages/Hunter/CreateCampaign.jsx', 'pages/Hunter/CampaignDetail.jsx']) {
      expect(src(f)).not.toMatch(/navigate\('\/hunter'\)/);
      expect(src(f)).toMatch(/navigate\('\/hunter\?tab=campaigns'\)/);
    }
  });
});
