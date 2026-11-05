/**
 * Regression: a sticker change saved in People's side-panel Contact Profile
 * shows on that person's People card right away, with no reload and no extra
 * Firestore listener. The profile reports the update (onContactChange) and
 * People merges it into the list it already holds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakeStickers, sticker } from './helpers/stickersUi';

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
// The panel profile, reduced to what this test needs: it reports a saved
// update the way the real one does (contactProfileReportsUpdates.test.jsx).
const panel = vi.hoisted(() => ({ props: null }));
vi.mock('../pages/Scout/ContactProfile', () => ({
  default: (props) => {
    panel.props = props;
    return <div data-testid="panel-profile">{props.contactId}</div>;
  },
}));
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

configure({ asyncUtilTimeout: 5000 });

const BOARD = sticker('Board', { color: 'blue' });
const GALA = sticker('Gala', { color: 'green' });
const person = (id, name, extra = {}) => ({ id, name, email: `${id}@x.test`, is_archived: false, tags: ['vip'], addedAt: '2026-10-02T00:00:00Z', ...extra });

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD, GALA];
  contactsData.list = [person('p1', 'Ana Board', { sticker_ids: [BOARD.id] }), person('p2', 'Ben Plain')];
  panel.props = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

/** A person's People card: the nearest ancestor of their name that holds their Engage button. */
function card(name) {
  let el = screen.getByText(name);
  while (el && !within(el).queryByRole('button', { name: /^Engage$/ })) el = el.parentElement;
  return el;
}


describe('People card after a change in the side-panel profile', { timeout: 30000 }, () => {
  it('shows a sticker added in the panel without a reload or a listener', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/command-center?tab=people');
    render(<MemoryRouter><AllLeads mode="people" /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Filter by sticker' });
    const subscriptions = fake.current.state.subscriptions;

    // Open Ben's profile in the side panel.
    const benCard = card('Ben Plain');
    await user.click(within(benCard).getByRole('button', { name: /^Engage$/ }));
    await screen.findByTestId('panel-profile');
    expect(panel.props.contactId).toBe('p2');
    expect(typeof panel.props.onContactChange).toBe('function');
    expect(within(benCard).queryByTestId('card-stickers')).toBeNull();

    // The profile saves a sticker and reports the contact as it now is.
    act(() => panel.props.onContactChange({ ...contactsData.list[1], sticker_ids: [GALA.id] }));

    await waitFor(() => expect(within(benCard).getByTestId('card-stickers')).toHaveTextContent('Gala'));
    // Ana's card is untouched, tags are kept, and nothing new subscribed.
    expect(within(card('Ana Board')).getByTestId('card-stickers')).toHaveTextContent('Board');
    expect(within(benCard).getByText('vip')).toBeInTheDocument();
    expect(fake.current.state.subscriptions).toBe(subscriptions);
  });

  it('removing a sticker in the panel removes it from the card', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/command-center?tab=people');
    render(<MemoryRouter><AllLeads mode="people" /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Filter by sticker' });
    const anaCard = card('Ana Board');
    await user.click(within(anaCard).getByRole('button', { name: /^Engage$/ }));
    await screen.findByTestId('panel-profile');
    act(() => panel.props.onContactChange({ ...contactsData.list[0], sticker_ids: [] }));
    await waitFor(() => expect(within(anaCard).queryByTestId('card-stickers')).toBeNull());
  });

  it('an update without an id changes nothing', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/command-center?tab=people');
    render(<MemoryRouter><AllLeads mode="people" /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Filter by sticker' });
    const anaCard = card('Ana Board');
    await user.click(within(anaCard).getByRole('button', { name: /^Engage$/ }));
    await screen.findByTestId('panel-profile');
    act(() => panel.props.onContactChange({ sticker_ids: [GALA.id] }));
    expect(within(anaCard).getByTestId('card-stickers')).toHaveTextContent('Board');
    expect(within(anaCard).getByTestId('card-stickers')).not.toHaveTextContent('Gala');
  });
});
