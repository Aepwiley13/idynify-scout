/**
 * Contact Hub, rendered: My People (list, search, sticker chips, the Stickers
 * view, Add Person) and one person's simple profile.
 *
 * The contacts and the sticker backend are fakes at the module boundary, the
 * same ones the People page tests use. The contact card, the notes and the
 * add form are stand-ins that record what they were given: what those
 * components do is their own tests' subject (identityCardSimpleVariant and
 * manualContactFormCopy), and what matters here is what Contact Hub asks of
 * them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, within, waitFor, configure, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { CONTACT_HUB_STICKERS_PATH, contactHubStickerPath } from '../constants/contactHub';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';
import { setViewportWidth } from './helpers/matchMedia';

const contactsData = vi.hoisted(() => ({ list: [], fail: false, loads: 0, paths: [] }));
const fake = vi.hoisted(() => ({ current: null }));
const seen = vi.hoisted(() => ({ card: null, notes: null, form: null }));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  collection: vi.fn((_db, ...path) => path.join('/')),
  getDocs: vi.fn(async (path) => {
    contactsData.loads += 1;
    contactsData.paths.push(String(path));
    if (contactsData.fail) throw Object.assign(new Error('nope'), { code: 'unavailable' });
    return { docs: contactsData.list.map((d) => ({ id: d.id, data: () => d })) };
  }),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'u1',
  getEffectiveUser: () => ({ uid: 'u1' }),
  useImpersonation: () => ({ isImpersonating: false, isReadOnly: false }),
}));
vi.mock('../theme/ThemeContext', () => ({ useT: () => new Proxy({}, { get: () => '#888' }) }));
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
}));
vi.mock('../components/contacts/IdentityCard', () => ({
  default: (props) => {
    seen.card = props;
    return (
      <div data-testid="identity-card" data-variant={props.variant}>
        {props.contact.name}
        <button type="button" onClick={() => props.onUpdate({ ...props.contact, name: 'Renamed Person' })}>rename</button>
      </div>
    );
  },
}));
vi.mock('../components/contacts/StickyNotes', () => ({
  default: (props) => { seen.notes = props; return <div data-testid="notes">{(props.contact.notes ?? []).length} notes</div>; },
}));
vi.mock('../components/scout/ManualContactForm', () => ({
  default: (props) => {
    seen.form = props;
    return (
      <div data-testid="manual-form">
        <input aria-label="Full Name" />
        <button type="button" onClick={() => props.onContactAdded([{ id: 'new1', name: 'Nova Added', addedAt: '2026-11-14T12:00:00Z' }])}>save</button>
        <button type="button" onClick={props.onCancel}>cancel</button>
      </div>
    );
  },
}));

import ContactHubMain from '../pages/ContactHub/ContactHubMain';
import HubPeople from '../pages/ContactHub/HubPeople';
import HubPerson from '../pages/ContactHub/HubPerson';

// These render whole screens and type into them. On a loaded machine that can
// pass the 5s default without anything being wrong (the suite's other
// full-page tests allow 20s for the same reason).
vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 5000 });

const VIP = sticker('VIP', { color: 'amber' });
const PARTNER = sticker('Partner', { color: 'purple' });
const FRIEND = sticker('Friend', { color: 'green' });
const person = (id, name, extra = {}) => ({ id, name, addedAt: '2026-11-01T12:00:00Z', ...extra });

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [VIP, PARTNER];
  contactsData.fail = false;
  contactsData.loads = 0;
  contactsData.paths = [];
  contactsData.list = [
    person('p1', 'Nakaiya Wiley', { title: 'Community Leader', email: 'nakaiya@x.test', phone_mobile: '+1 555 010 0001', addedAt: '2026-11-12T12:00:00Z', sticker_ids: [VIP.id] }),
    person('p2', 'Wes Clark', { title: 'Program Director', company_name: 'UAC', email: 'wes@uac.test', addedAt: '2026-11-10T12:00:00Z', sticker_ids: [PARTNER.id] }),
    person('p3', 'Tom Green', { company_name: 'Field Committee', addedAt: '2026-11-05T12:00:00Z' }),
    person('p4', 'Old Archived', { is_archived: true, addedAt: '2026-11-13T12:00:00Z', sticker_ids: [VIP.id] }),
    person('p5', 'Hunter Stage', { hunter_status: 'active_mission', stage: 'hunter', addedAt: '2026-11-02T12:00:00Z' }),
  ];
  seen.card = null; seen.notes = null; seen.form = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { setViewportWidth(1024); vi.restoreAllMocks(); });

// The address the app is at, and its history, as a test can see and drive them.
const router = { at: '', navigate: null };
function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    router.at = location.pathname + location.search;
    router.navigate = navigate;
  }, [location, navigate]);
  return null;
}
const goBack = () => act(() => { router.navigate(-1); });
const goForward = () => act(() => { router.navigate(1); });

function renderHub(url = '/contact-hub') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RouterProbe />
      <Routes>
        <Route path="/contact-hub" element={<ContactHubMain />}>
          <Route index element={<HubPeople />} />
          <Route path="stickers" element={<HubPeople />} />
          <Route path="person/:contactId" element={<HubPerson />} />
        </Route>
        <Route path="/contact/:contactId" element={<div data-testid="full-profile" />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The person links only: a row's call and email buttons are links too.
const names = () => [...screen.getByRole('list', { name: 'My People' }).querySelectorAll('a.hub-row-link')].map((a) => a.textContent);

describe('My People', () => {
  it('reads the existing contacts collection, once, and nothing else', async () => {
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(contactsData.paths).toEqual(['users/u1/contacts']);
  });

  it('shows the heading, search, Add Person and a clean list, newest first', async () => {
    renderHub();
    expect(screen.getByRole('heading', { level: 1, name: 'Contact Hub' })).toBeInTheDocument();
    await screen.findByRole('list', { name: 'My People' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('My People (4)');
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    expect(names()).toEqual(['Nakaiya Wiley', 'Wes Clark', 'Tom Green', 'Hunter Stage']);
  });

  it('leaves archived people out, and lists people whatever their pipeline stage', async () => {
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(screen.queryByText('Old Archived')).toBeNull();
    expect(screen.getByText('Hunter Stage')).toBeInTheDocument();
  });

  it('a row shows title and company, the added date, and call and email only when there is something to use', async () => {
    renderHub();
    const list = await screen.findByRole('list', { name: 'My People' });
    const rows = within(list).getAllByRole('listitem').filter((li) => li.classList.contains('hub-row'));
    const nakaiya = rows[0];
    expect(within(nakaiya).getByText('Community Leader')).toBeInTheDocument();
    expect(within(nakaiya).getByText('Added Nov 12')).toBeInTheDocument();
    expect(within(nakaiya).getByRole('link', { name: 'Call Nakaiya Wiley' })).toHaveAttribute('href', 'tel:+1 555 010 0001');
    expect(within(nakaiya).getByRole('link', { name: 'Email Nakaiya Wiley' })).toHaveAttribute('href', 'mailto:nakaiya@x.test');
    const wes = rows[1];
    expect(within(wes).getByText('Program Director, UAC')).toBeInTheDocument();
    expect(within(wes).queryByRole('link', { name: /^Call/ })).toBeNull();
    const tom = rows[2];
    expect(within(tom).queryByRole('link', { name: /^Email/ })).toBeNull();
  });

  it('shows nothing from the sales product: no stages, engagement, missions, enrichment or credits', async () => {
    const { container } = renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(container.textContent).not.toMatch(/scout|hunter stage badge|sniper|mission|brigade|enrich|credit|pipeline|engage|cadence|barry/i);
  });

  it('search narrows the list as you type, and says so when no one matches', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'uac');
    expect(names()).toEqual(['Wes Clark']);
    await user.clear(screen.getByRole('searchbox', { name: 'Search people' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'zzz');
    expect(screen.getByText('No one matches.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(names()).toHaveLength(4);
  });

  it('search also matches a sticker name', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'partner');
    expect(names()).toEqual(['Wes Clark']);
  });
});

describe('sticker filters', () => {
  it('shows All and one chip per active sticker, counting listed people only', async () => {
    renderHub();
    const group = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    // The archived person also holds VIP and is not counted.
    expect(within(group).getByRole('button', { name: 'VIP, 1 person' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Partner, 1 person' })).toBeInTheDocument();
  });

  it('a chip filters to that sticker; pressing it again, or All, clears it', async () => {
    const user = userEvent.setup();
    renderHub();
    const group = await screen.findByRole('group', { name: 'Filter by sticker' });
    const vip = within(group).getByRole('button', { name: 'VIP, 1 person' });
    await user.click(vip);
    expect(vip).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['Nakaiya Wiley']);
    await user.click(vip);
    expect(names()).toHaveLength(4);
    await user.click(within(group).getByRole('button', { name: 'Partner, 1 person' }));
    expect(names()).toEqual(['Wes Clark']);
    await user.click(within(group).getByRole('button', { name: 'All' }));
    expect(names()).toHaveLength(4);
  });

  it('the Sticker Wall chip opens the existing Stickers view, and a tile returns to the list filtered by it', async () => {
    const user = userEvent.setup();
    renderHub();
    const group = await screen.findByRole('group', { name: 'Filter by sticker' });
    await user.click(within(group).getByRole('button', { name: 'Sticker Wall' }));
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    const wall = await screen.findByTestId('stickers-wall');
    await user.click(within(wall).getByRole('button', { name: 'Partner, 1 person' }));
    expect(names()).toEqual(['Wes Clark']);
  });

  it('rows carry the existing interactive sticker chips; removing one updates the row and the count', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    await user.click(screen.getByRole('button', { name: 'Remove sticker VIP' }));
    await waitFor(() => expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'p1', VIP.id]]));
    await screen.findByRole('button', { name: 'VIP, 0 people' });
  });

  it('with stickers unavailable for the account: no chips, no sticker controls, the list still works', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
    expect(names()).toHaveLength(4);
  });

  it('stickers are optional: with none yet there is only the quiet Sticker Wall chip', async () => {
    fake.current.state.registry = [];
    renderHub();
    const group = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sticker Wall']);
  });
});

describe('Add Person', () => {
  it('opens the existing manual form in a dialog, with Contact Hub wording and no referral field', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(screen.getByRole('button', { name: 'Add Person' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Person' });
    expect(within(dialog).getByTestId('manual-form')).toBeInTheDocument();
    expect(seen.form.copy.submit).toBe('Add Person');
    expect(seen.form.copy.showReferral).toBe(false);
    // Name, Email and Phone first; everything else behind "More details".
    expect(seen.form.copy.moreDetails).toBe(true);
    const words = `${seen.form.copy.hint} ${seen.form.copy.duplicate('Ana')} ${seen.form.copy.submit}`;
    expect(words).not.toMatch(/enrich|pipeline|scout|credit/i);
    expect(seen.form.copy.duplicate('Ana')).toContain('Ana is already in My People');
  });

  it('a saved person appears at the top, the dialog closes, and the count goes up', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(screen.getByRole('button', { name: 'Add Person' }));
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(names()[0]).toBe('Nova Added');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('My People (5)');
    expect(screen.getByText('Nova Added was added to My People.')).toHaveAttribute('role', 'status');
    // No reload: the list was updated from what the form returned.
    expect(contactsData.loads).toBe(1);
  });

  it('Cancel and Escape close it without adding anyone', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(screen.getByRole('button', { name: 'Add Person' }));
    await user.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Person' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(names()).toHaveLength(4);
  });

});

describe('no one in My People yet', () => {
  beforeEach(() => { contactsData.list = []; });

  it('shows a friendly message and exactly one action', async () => {
    renderHub();
    expect(await screen.findByText('Start with one person')).toBeInTheDocument();
    expect(screen.getByText(/All you need is their name\./)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Add Your First Person']);
  });

  it('draws nothing to search, filter, count or manage', async () => {
    renderHub();
    await screen.findByText('Start with one person');
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^My People$/);
    expect(screen.queryByText('No one matches.')).toBeNull();
  });

  it('archived people do not count: someone with only archived contacts sees the same invitation', async () => {
    contactsData.list = [person('p4', 'Old Archived', { is_archived: true })];
    renderHub();
    expect(await screen.findByText('Start with one person')).toBeInTheDocument();
  });

  it('the action opens Add Person, and the first person replaces the invitation with the list', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(await screen.findByRole('button', { name: 'Add Your First Person' }));
    expect(screen.getByRole('dialog', { name: 'Add Person' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(screen.queryByText('Start with one person')).toBeNull();
    expect(names()).toEqual(['Nova Added']);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('My People (1)');
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
  });

  it('is not shown while loading, or when the load failed', async () => {
    contactsData.fail = true;
    renderHub();
    expect(await screen.findByText('Your people could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Start with one person')).toBeNull();
  });
});

describe('stickers on a phone-sized list', () => {
  beforeEach(() => {
    contactsData.list = [
      person('m1', 'Three Stickers', { sticker_ids: [VIP.id, PARTNER.id, FRIEND.id] }),
      person('m2', 'Two Stickers', { addedAt: '2026-10-30T12:00:00Z', sticker_ids: [VIP.id, PARTNER.id] }),
      person('m3', 'No Stickers', { addedAt: '2026-10-29T12:00:00Z' }),
    ];
    fake.current.state.registry = [VIP, PARTNER, FRIEND];
    setViewportWidth(390);
  });

  const row = (name) => screen.getByRole('link', { name }).closest('li');

  it('shows at most two compact chips, then +N', async () => {
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    const three = row('Three Stickers');
    expect(three.querySelectorAll('.hub-row-stickers .stk-chip')).toHaveLength(2);
    expect(three.querySelectorAll('.hub-row-stickers .stk-chip--compact')).toHaveLength(2);
    expect(within(three).getByLabelText('1 more sticker')).toHaveTextContent('+1');
    const two = row('Two Stickers');
    expect(two.querySelectorAll('.hub-row-stickers .stk-chip')).toHaveLength(2);
    expect(two.querySelector('.stk-card-more')).toBeNull();
    expect(row('No Stickers').querySelectorAll('.stk-chip')).toHaveLength(0);
  });

  it('the chips are labels, not controls: no add and no remove on the list', async () => {
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    const list = screen.getByRole('list', { name: 'My People' });
    expect(within(list).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove sticker|Add sticker/ })).toBeNull();
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    expect(fake.current.callsOf('removeSticker')).toEqual([]);
  });

  it('the sticker filter chips above the list still work', async () => {
    const user = userEvent.setup();
    renderHub();
    const group = await screen.findByRole('group', { name: 'Filter by sticker' });
    await user.click(within(group).getByRole('button', { name: 'Friend, 1 person' }));
    expect(names()).toEqual(['Three Stickers']);
  });

  it('a wide screen keeps in-place add and remove, with the same two-chip limit', async () => {
    setViewportWidth(1280);
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    const three = row('Three Stickers');
    expect(three.querySelectorAll('.hub-row-stickers .stk-chip')).toHaveLength(2);
    expect(within(three).getByLabelText('1 more sticker')).toBeInTheDocument();
    expect(within(three).getByRole('button', { name: 'Add sticker to Three Stickers' })).toBeInTheDocument();
    expect(within(three).getAllByRole('button', { name: /^Remove sticker/ })).toHaveLength(2);
  });
});

describe('the add button and search at each width', () => {
  beforeEach(() => { contactsData.list = [person('w1', 'Someone Here')]; });

  it('a phone shows "Add", still named Add Person, before search; it opens the same dialog', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    renderHub();
    const add = await screen.findByRole('button', { name: 'Add Person' });
    expect(add).toHaveTextContent(/^Add$/);
    const search = screen.getByRole('searchbox', { name: 'Search people' });
    expect(add.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(add);
    expect(screen.getByRole('dialog', { name: 'Add Person' })).toBeInTheDocument();
  });

  it('a wide screen shows "Add Person" beside the heading, with search across the row below', async () => {
    setViewportWidth(1280);
    renderHub();
    const add = await screen.findByRole('button', { name: 'Add Person' });
    expect(add).toHaveTextContent(/^Add Person$/);
    const search = screen.getByRole('searchbox', { name: 'Search people' });
    // The same order at every width: heading, Add Person, then search.
    expect(add.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.closest('.hub-tools')).not.toBeNull();
  });

  it('what is typed in search survives the layout changing width', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    renderHub();
    const search = await screen.findByRole('searchbox', { name: 'Search people' });
    await user.type(search, 'some');
    setViewportWidth(390);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Person' })).toHaveTextContent(/^Add$/));
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('some');
  });
});

describe('loading and failure', () => {
  it('a failed load says so and Try again loads again', async () => {
    contactsData.fail = true;
    const user = userEvent.setup();
    renderHub();
    expect(await screen.findByText('Your people could not be loaded.')).toBeInTheDocument();
    contactsData.fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list', { name: 'My People' });
    expect(contactsData.loads).toBe(2);
  });
});

describe('the simple profile', () => {
  it('a row opens the person inside Contact Hub, not the full profile', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    const link = screen.getByRole('link', { name: 'Wes Clark' });
    expect(link).toHaveAttribute('href', '/contact-hub/person/p2');
    await user.click(link);
    expect(screen.getByTestId('identity-card')).toHaveTextContent('Wes Clark');
    expect(screen.queryByTestId('full-profile')).toBeNull();
  });

  it('asks for the simple card, gives it no photo lookup, and shows notes; nothing else', async () => {
    renderHub('/contact-hub/person/p2');
    const card = await screen.findByTestId('identity-card');
    expect(card).toHaveAttribute('data-variant', 'simple');
    expect(seen.card.onRefreshPhoto).toBeUndefined();
    expect(seen.card.contact.id).toBe('p2');
    expect(screen.getByTestId('notes')).toBeInTheDocument();
    expect(seen.notes.contact.id).toBe('p2');
    // No link out to the advanced profile, and no second load for the person.
    expect(screen.queryByRole('link', { name: /full profile|open in/i })).toBeNull();
    expect(contactsData.loads).toBe(1);
  });

  it('an edit on the card shows in the list when you go back, with the search kept', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'e');
    await user.click(screen.getByRole('link', { name: 'Wes Clark' }));
    await user.click(screen.getByRole('button', { name: 'rename' }));
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('e');
    expect(screen.getByRole('link', { name: 'Renamed Person' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Wes Clark' })).toBeNull();
    expect(contactsData.loads).toBe(1);
  });

  it('someone who is archived, or does not exist, is "not in My People" with a way back', async () => {
    renderHub('/contact-hub/person/p4');
    expect(await screen.findByText('This person is not in My People.')).toBeInTheDocument();
    expect(screen.queryByTestId('identity-card')).toBeNull();
    expect(screen.getByRole('link', { name: 'My People' })).toHaveAttribute('href', '/contact-hub');
  });

  it('an unknown id gets the same answer', async () => {
    renderHub('/contact-hub/person/nope');
    expect(await screen.findByText('This person is not in My People.')).toBeInTheDocument();
  });
});

describe('addresses: the Sticker Wall and a sticker filter each have one', () => {
  const chips = () => screen.findByRole('group', { name: 'Filter by sticker' });

  it('the helpers build the addresses the routes answer to', () => {
    expect(CONTACT_HUB_STICKERS_PATH).toBe('/contact-hub/stickers');
    expect(contactHubStickerPath(null)).toBe('/contact-hub');
    expect(contactHubStickerPath('abc')).toBe('/contact-hub?sticker=abc');
    expect(contactHubStickerPath('a b&c')).toBe('/contact-hub?sticker=a%20b%26c');
  });

  it('choosing a sticker puts it in the address; Back and Forward step through it', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(within(await chips()).getByRole('button', { name: 'Partner, 1 person' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
    await user.click(within(await chips()).getByRole('button', { name: 'VIP, 1 person' }));
    expect(router.at).toBe(`/contact-hub?sticker=${VIP.id}`);
    expect(names()).toEqual(['Nakaiya Wiley']);

    await goBack();
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
    await goBack();
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
    await goForward();
    expect(names()).toEqual(['Wes Clark']);
    expect(within(await chips()).getByRole('button', { name: 'Partner, 1 person' })).toHaveAttribute('aria-pressed', 'true');
    // Everyone was loaded once: a filter reads nothing.
    expect(contactsData.loads).toBe(1);
  });

  it('pressing the chosen sticker again, or All, clears it from the address', async () => {
    const user = userEvent.setup();
    renderHub(`/contact-hub?sticker=${PARTNER.id}`);
    await user.click(within(await chips()).getByRole('button', { name: 'Partner, 1 person' }));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('an address with a sticker opens My People already filtered', async () => {
    renderHub(`/contact-hub?sticker=${VIP.id}`);
    expect(within(await chips()).getByRole('button', { name: 'VIP, 1 person' })).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['Nakaiya Wiley']);
  });

  it('an address naming a sticker that does not exist shows everyone', async () => {
    renderHub('/contact-hub?sticker=NoSuchSticker00000000');
    await chips();
    expect(names()).toHaveLength(4);
  });

  it('/contact-hub/stickers opens the Sticker Wall directly', async () => {
    renderHub('/contact-hub/stickers');
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    expect(within(await chips()).getByRole('button', { name: 'Sticker Wall' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opening the wall is a step in history: Back returns to My People', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(within(await chips()).getByRole('button', { name: 'Sticker Wall' }));
    expect(router.at).toBe('/contact-hub/stickers');
    await screen.findByTestId('stickers-wall');
    await goBack();
    expect(router.at).toBe('/contact-hub');
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('closing the wall returns to My People as it was, sticker filter included', async () => {
    const user = userEvent.setup();
    renderHub(`/contact-hub?sticker=${PARTNER.id}`);
    await user.click(within(await chips()).getByRole('button', { name: 'Sticker Wall' }));
    await screen.findByTestId('stickers-wall');
    await user.click(within(await chips()).getByRole('button', { name: 'Sticker Wall' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
  });

  it('a tile on the wall goes to My People filtered by that sticker', async () => {
    const user = userEvent.setup();
    renderHub('/contact-hub/stickers');
    const wall = await screen.findByTestId('stickers-wall');
    await user.click(within(wall).getByRole('button', { name: 'Partner, 1 person' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
  });

  it('what is typed in search is kept across the wall and a filter, and is never in the address', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'e');
    await user.click(within(await chips()).getByRole('button', { name: 'Sticker Wall' }));
    await screen.findByTestId('stickers-wall');
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('e');
    await user.click(within(await chips()).getByRole('button', { name: 'Partner, 1 person' }));
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('e');
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
    expect(contactsData.loads).toBe(1);
  });

  it('the way back from a person is My People as it was left, filter and search included', async () => {
    const user = userEvent.setup();
    renderHub(`/contact-hub?sticker=${PARTNER.id}`);
    await chips();
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'wes');
    await user.click(screen.getByRole('link', { name: 'Wes Clark' }));
    expect(router.at).toBe('/contact-hub/person/p2');
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('wes');
    expect(names()).toEqual(['Wes Clark']);
  });

  it('a person opened cold still has a way back to My People', async () => {
    const user = userEvent.setup();
    renderHub('/contact-hub/person/p2');
    // Once the person has loaded: the link shown while loading is replaced.
    await screen.findByTestId('notes');
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('with stickers unavailable, the wall address shows My People and nothing about stickers', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    renderHub('/contact-hub/stickers');
    await screen.findByRole('list', { name: 'My People' });
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('on a phone the same addresses work', async () => {
    setViewportWidth(375);
    const user = userEvent.setup();
    renderHub(`/contact-hub?sticker=${VIP.id}`);
    expect(within(await chips()).getByRole('button', { name: 'VIP, 1 person' })).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['Nakaiya Wiley']);
    await user.click(within(await chips()).getByRole('button', { name: 'Sticker Wall' }));
    expect(router.at).toBe('/contact-hub/stickers');
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
  });
});
