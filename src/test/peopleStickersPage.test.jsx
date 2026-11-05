/**
 * S6 on the real People page (AllLeads, mode "people"): AT-6-01 … AT-6-10.
 * Firestore reads are faked as in peopleImportGroupArchived.test.jsx; the
 * sticker services and stickersConfig are fakes (helpers/stickersUi.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';

const contactsData = vi.hoisted(() => ({ list: [] }));
const fake = vi.hoisted(() => ({ current: null }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...path) => path.join('/')),
  getDocs: vi.fn(async (path) => ({
    docs: String(path).endsWith('/contacts') ? contactsData.list.map((d) => ({ id: d.id, data: () => d })) : [],
  })),
  doc: vi.fn(() => ({})),
  updateDoc: vi.fn(async () => {}),
  arrayUnion: vi.fn((...v) => v),
  addDoc: vi.fn(async () => ({ id: 'x' })),
  serverTimestamp: vi.fn(() => ({})),
}));
vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: (cb) => { cb({ uid: 'u1' }); return () => {}; } },
}));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'u1',
  useImpersonation: () => ({ isImpersonating: false, isReadOnly: false }),
  getEffectiveUser: () => ({ uid: 'u1' }),
}));
vi.mock('../theme/ThemeContext', () => ({ useT: () => new Proxy({}, { get: () => '#888' }) }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ isProTier: true, loading: false }) }));
vi.mock('../pages/Scout/ContactProfile', () => ({ default: () => null }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => null }));
vi.mock('../components/firstTouch/FirstTouchModal', () => ({ default: () => null }));
vi.mock('../components/scout/BulkComposeModal', () => ({ default: () => null }));
vi.mock('../services/peopleService', () => ({ archivePerson: vi.fn() }));
vi.mock('../services/sniperWriteGuard', () => ({ createSniperRecord: vi.fn() }));
vi.mock('../utils/loadIntoHunter', () => ({ loadIntoHunter: vi.fn() }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
  addStickerToContacts: (...a) => fake.current.services.addStickerToContacts(...a),
}));

import AllLeads from '../pages/Scout/AllLeads';

// The whole People page loads here; give slow CI machines room rather than
// racing the 1s default.
configure({ asyncUtilTimeout: 5000 });

const BOARD = sticker('Board', { color: 'blue' });
const DONOR = sticker('Donor', { color: 'amber', status: 'archived' });
const GALA = sticker('Gala', { color: 'green' });

const person = (id, name, extra = {}) => ({ id, name, email: `${id}@x.test`, is_archived: false, tags: [], addedAt: '2026-10-02T00:00:00Z', ...extra });

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD, DONOR, GALA];
  contactsData.list = [
    person('p1', 'Ana Board', { sticker_ids: [BOARD.id], tags: ['vip'] }),
    person('p2', 'Ben Board', { sticker_ids: [BOARD.id, DONOR.id] }),
    person('p3', 'Cy Archived Co', { sticker_ids: [BOARD.id], company_archived: true }),
    person('p4', 'Dee Nobody', { tags: ['vip'] }),
  ];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

function renderPeople(url = '/command-center?tab=people', mode = 'people') {
  window.history.replaceState(null, '', url);
  return render(<MemoryRouter><AllLeads mode={mode} /></MemoryRouter>);
}
const listed = () => ['Ana Board', 'Ben Board', 'Cy Archived Co', 'Dee Nobody'].filter((n) => screen.queryAllByText(n).length > 0);

describe('People with stickers (S6)', { timeout: 30000 }, () => {
  it('AT-6-01: unavailable — no filter, no chips, no bulk action, and ?sticker= is ignored', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    renderPeople(`/command-center?tab=people&sticker=${BOARD.id}`);
    await screen.findByText('Dee Nobody');
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(screen.queryByRole('button', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.queryAllByTestId('card-stickers')).toHaveLength(0);
    expect(listed()).toEqual(['Ana Board', 'Ben Board', 'Dee Nobody']);
    expect(screen.queryByText('That sticker is archived or no longer exists.')).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('only the People page gets stickers: Hunter mode never asks the server', async () => {
    renderPeople('/hunter', 'hunter');
    await waitFor(() => expect(screen.queryByText('Loading your pipeline...')).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.current.state.configFetches).toBe(0);
    expect(fake.current.state.subscriptions).toBe(0);
    expect(screen.queryByRole('button', { name: 'Filter by sticker' })).toBeNull();
  });

  it('AT-6-02: the count leaves out a contact People hides (archived company)', async () => {
    const user = userEvent.setup();
    renderPeople();
    await user.click(await screen.findByRole('button', { name: 'Filter by sticker' }));
    expect(screen.getByRole('button', { name: 'Board, 2 people' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Donor/ })).toBeNull();
  });

  it('AT-6-03: choosing sets ?sticker= without navigating; clearing removes it', async () => {
    const user = userEvent.setup();
    renderPeople('/command-center?tab=people');
    await user.click(await screen.findByRole('button', { name: 'Filter by sticker' }));
    await user.click(screen.getByRole('button', { name: /^Board/ }));
    expect(window.location.pathname).toBe('/command-center');
    expect(window.location.search).toBe(`?tab=people&sticker=${BOARD.id}`);
    await waitFor(() => expect(listed()).toEqual(['Ana Board', 'Ben Board']));
    await user.click(screen.getByRole('button', { name: 'Clear sticker filter' }));
    expect(window.location.search).toBe('?tab=people');
    await waitFor(() => expect(listed()).toEqual(['Ana Board', 'Ben Board', 'Dee Nobody']));
  });

  it('AT-6-03: opening People with ?sticker= applies it', async () => {
    renderPeople(`/command-center?tab=people&sticker=${BOARD.id}`);
    await screen.findByRole('button', { name: 'Sticker filter: Board' });
    expect(listed()).toEqual(['Ana Board', 'Ben Board']);
  });

  it('AT-6-04: the sticker filter ANDs with the tag filter', async () => {
    renderPeople(`/command-center?tab=people&tag=vip&sticker=${BOARD.id}`);
    await screen.findByRole('button', { name: 'Sticker filter: Board' });
    expect(listed()).toEqual(['Ana Board']);
  });

  it('AT-6-05: an archived or unknown sticker id shows everyone and a notice; "Show everyone" clears it', async () => {
    const user = userEvent.setup();
    renderPeople(`/command-center?tab=people&sticker=${DONOR.id}`);
    const notice = await screen.findByText('That sticker is archived or no longer exists.');
    expect(listed()).toEqual(['Ana Board', 'Ben Board', 'Dee Nobody']);
    await user.click(within(notice).getByRole('button', { name: 'Show everyone' }));
    expect(window.location.search).toBe('?tab=people');
    expect(screen.queryByText('That sticker is archived or no longer exists.')).toBeNull();
  });

  it('AT-6-06: search matches active sticker names, never archived ones', async () => {
    const user = userEvent.setup();
    renderPeople();
    await screen.findByRole('button', { name: 'Filter by sticker' });
    const search = screen.getByPlaceholderText(/search/i);
    await user.type(search, 'donor');
    await waitFor(() => expect(listed()).toEqual([]));
    await user.clear(search);
    await user.type(search, 'boar');
    await waitFor(() => expect(listed()).toEqual(['Ana Board', 'Ben Board']));
  });

  it('cards show active stickers only, before tags', async () => {
    renderPeople();
    await screen.findByRole('button', { name: 'Filter by sticker' });
    await waitFor(() => expect(screen.getAllByTestId('card-stickers').length).toBe(2));
    const ben = screen.getByText('Ben Board').closest('div[style*="border-radius: 14px"]') ?? document.body;
    expect(within(ben).queryByText('Donor')).toBeNull();
  });

  it('AT-6-07 / AT-6-10: bulk add from the bar updates the cards, narrows the selection to failures, and leaves tags alone', async () => {
    const user = userEvent.setup();
    fake.current.state.impl.bulk = async (_uid, ids) => ({
      added: ids.filter((id) => id !== 'p4'), already: [], failed: ids.includes('p4') ? [{ contactId: 'p4', code: 'limit_reached', reason: null }] : [],
    });
    renderPeople();
    await screen.findByRole('button', { name: 'Filter by sticker' });
    await user.click(screen.getByRole('button', { name: /Start Cadence/ }));
    await user.click(screen.getByText('Ana Board'));
    await user.click(screen.getByText('Dee Nobody'));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Gala' }));
    const region = await screen.findByRole('region', { name: 'Sticker results' });
    expect(region).toHaveTextContent('Gala: Added to 1 · 1 not changed');
    const [uid, ids, id] = fake.current.callsOf('addStickerToContacts')[0];
    expect([uid, [...ids].sort(), id]).toEqual(['u1', ['p1', 'p4'], GALA.id]);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Details' }));
    expect(region).toHaveTextContent('Dee Nobody — This contact has 50 stickers. Remove one to add another.');
    // Ana's card now shows Gala next to Board; tags untouched everywhere.
    await waitFor(() => expect(screen.getAllByTestId('card-stickers').some((row) => /Board.*Gala|Gala.*Board/.test(row.textContent))).toBe(true));
    expect(contactsData.list.find((c) => c.id === 'p1').tags).toEqual(['vip']);
  });
});
