/**
 * S7 on the real People page: the Stickers view toggle (AT-7-01) and a tile
 * opening the list filtered by its sticker (AT-7-03). Same fakes as
 * peopleStickersPage.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakeStickers, sticker, config, stickerError } from './helpers/stickersUi';

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
  updateSticker: (...a) => fake.current.services.updateSticker(...a),
  archiveSticker: (...a) => fake.current.services.archiveSticker(...a),
  restoreSticker: (...a) => fake.current.services.restoreSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
  addStickerToContacts: (...a) => fake.current.services.addStickerToContacts(...a),
}));

import AllLeads from '../pages/Scout/AllLeads';

const BOARD = sticker('Board', { color: 'blue' });
const GALA = sticker('Gala', { color: 'green' });
const person = (id, name, extra = {}) => ({ id, name, email: `${id}@x.test`, is_archived: false, tags: [], addedAt: '2026-10-02T00:00:00Z', ...extra });

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD, GALA];
  contactsData.list = [
    person('p1', 'Ana Board', { sticker_ids: [BOARD.id] }),
    person('p2', 'Ben Gala', { sticker_ids: [GALA.id] }),
    person('p3', 'Cy Nobody'),
  ];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

function renderPeople(url = '/command-center?tab=people') {
  window.history.replaceState(null, '', url);
  return render(<MemoryRouter><AllLeads mode="people" /></MemoryRouter>);
}
const listed = () => ['Ana Board', 'Ben Gala', 'Cy Nobody'].filter((n) => screen.queryAllByText(n).length > 0);

describe('People Stickers view (S7)', { timeout: 30000 }, () => {
  it('AT-7-01: no Stickers toggle while stickers are unavailable', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    renderPeople();
    await screen.findByText('Cy Nobody');
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(screen.getByRole('button', { name: /Cards/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stickers/ })).toBeNull();
  });

  it('AT-7-02 / AT-7-03: the toggle shows the wall; a tile goes back to Cards filtered by it', async () => {
    const user = userEvent.setup();
    renderPeople();
    await user.click(await screen.findByRole('button', { name: /◈ Stickers/ }));
    const wall = await screen.findByTestId('stickers-wall');
    expect(within(wall).getByRole('button', { name: 'Board, 1 person' })).toBeInTheDocument();
    await user.click(within(wall).getByRole('button', { name: 'Gala, 1 person' }));
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
    expect(screen.getByRole('button', { name: /Cards/ })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe(`?tab=people&sticker=${GALA.id}`);
    await waitFor(() => expect(listed()).toEqual(['Ben Gala']));
  });

  it('AT-7-03: a tile goes back to List when List was the last list view', async () => {
    const user = userEvent.setup();
    renderPeople();
    await user.click(await screen.findByRole('button', { name: /List/ }));
    await user.click(screen.getByRole('button', { name: /◈ Stickers/ }));
    await user.click(within(await screen.findByTestId('stickers-wall')).getByRole('button', { name: 'Board, 1 person' }));
    expect(screen.getByRole('button', { name: /List/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('AT-7-01: when access goes away while the wall is open, People falls back to Cards', async () => {
    const user = userEvent.setup();
    fake.current.state.impl.archive = async () => { throw stickerError('permission_denied', 'write_denied'); };
    renderPeople();
    await user.click(await screen.findByRole('button', { name: /◈ Stickers/ }));
    const wall = await screen.findByTestId('stickers-wall');
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await user.click(within(wall).getByRole('button', { name: 'Board options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByTestId('stickers-wall')).toBeNull());
    expect(screen.getByRole('button', { name: /Cards/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /◈ Stickers/ })).toBeNull();
    expect(listed()).toEqual(['Ana Board', 'Ben Gala', 'Cy Nobody']);
  });
});
