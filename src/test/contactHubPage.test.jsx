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
import { ShellProvider, useShell } from '../context/ShellContext';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';
import { setViewportWidth } from './helpers/matchMedia';

const contactsData = vi.hoisted(() => ({ list: [], fail: false, loads: 0, paths: [], writes: [] }));
const fake = vi.hoisted(() => ({ current: null }));
const seen = vi.hoisted(() => ({ card: null, notes: null, form: null }));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  collection: vi.fn((_db, ...path) => path.join('/')),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  query: (ref) => ref,
  onSnapshot: (_ref, next) => { next({ docs: [] }); return () => {}; },
  // The header's own saves (name, title, organization, photo): recorded, and they succeed.
  updateDoc: vi.fn(async (ref, data) => { contactsData.writes.push({ path: ref.path, data }); }),
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
  contactsData.writes = [];
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
/** Go to an address, as a tap on the shell's bottom bar does on a phone. */
const goTo = (to) => act(() => { router.navigate(to); });

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

  // Owner decision (billing W2): two actions on the first-run screen, adding a person or
  // importing existing contacts, so nobody has to add someone by hand before importing.
  it('shows a friendly message and two actions: add a person, or import contacts', async () => {
    renderHub();
    expect(await screen.findByText('Start with one person')).toBeInTheDocument();
    expect(screen.getByText(/All you need is their name\./)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Add Your First Person', 'Import Contacts']);
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
    expect(screen.getByRole('tab', { name: 'Action Center', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByTestId('identity-card')).toHaveTextContent('Wes Clark');
    expect(screen.queryByTestId('full-profile')).toBeNull();
  });

  it('keeps the redesigned header and puts the contact information in Details', async () => {
    renderHub('/contact-hub/person/p2');
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Details' }));
    const card = await screen.findByTestId('identity-card');
    // The existing card is now the DETAILS card: email, phones and social profiles only; the header above it draws the rest.
    expect(card).toHaveAttribute('data-variant', 'details');
    expect(seen.card.onRefreshPhoto).toBeUndefined();
    expect(seen.card.contact.id).toBe('p2');
    expect(screen.getByRole('article', { name: 'Contact: Wes Clark' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Wes Clark' })).toBeInTheDocument();
    expect(screen.queryByTestId('notes')).toBeNull();
    // No link out to the advanced profile, and no second load for the person.
    expect(screen.queryByRole('link', { name: /full profile|open in/i })).toBeNull();
    expect(contactsData.loads).toBe(1);
  });

  it('the header edits the person: a save goes to that contact\'s own document, and the list shows it when you go back; nobody else changes', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(screen.getByRole('link', { name: 'Wes Clark' }));
    await user.click(await screen.findByRole('button', { name: 'Edit name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Jr.{Enter}');
    await waitFor(() => expect(contactsData.writes).toHaveLength(1));
    expect(contactsData.writes[0].path).toBe('users/u1/contacts/p2');
    expect(Object.keys(contactsData.writes[0].data).sort()).toEqual(['name', 'updated_at']);
    expect(contactsData.writes[0].data.name).toBe('Wes Clark Jr.');
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(screen.getByRole('link', { name: 'Wes Clark Jr.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nakaiya Wiley' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tom Green' })).toBeInTheDocument();
  });

  it('a change to the title shows in the header at once and leaves the name, the organization and the stickers as they were', async () => {
    const user = userEvent.setup();
    renderHub('/contact-hub/person/p2');
    await user.click(await screen.findByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Chief of Staff{Enter}');
    expect(await screen.findByText('Chief of Staff')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Wes Clark' })).toBeInTheDocument();
    expect(screen.getByText('UAC')).toBeInTheDocument();
    expect(await screen.findByText('Partner', { selector: '.ph-sticker-name' })).toBeInTheDocument();
  });

  it('a sticker that finishes saving after you left the person is on them when you come back, by id, without a reload', async () => {
    const user = userEvent.setup();
    renderHub('/contact-hub/person/p2');
    let finish;
    fake.current.state.impl.add = () => new Promise((r) => { finish = r; });
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'VIP' }));
    await user.click(screen.getByRole('link', { name: 'My People' }));
    await user.click(await screen.findByRole('link', { name: 'Tom Green' }));
    await screen.findByRole('heading', { level: 1, name: 'Tom Green' });
    await act(async () => finish({ status: 'added' }));
    await user.click(screen.getByRole('link', { name: 'My People' }));
    await user.click(await screen.findByRole('link', { name: 'Wes Clark' }));
    await waitFor(() => expect([...document.querySelectorAll('.ph-sticker-name')].map((n) => n.textContent).sort()).toEqual(['Partner', 'VIP']));
    expect(contactsData.loads).toBe(1);
  });

  it('moving to another person shows that person, with the first person\'s header gone and nothing carried over', async () => {
    const user = userEvent.setup();
    renderHub('/contact-hub/person/p2');
    await user.click(await screen.findByRole('button', { name: 'Edit name' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('link', { name: 'My People' }));
    await user.click(await screen.findByRole('link', { name: 'Tom Green' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tom Green' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(contactsData.writes).toEqual([]);
  });

  it('an edit on the card shows in the list when you go back, with the search kept', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'e');
    await user.click(screen.getByRole('link', { name: 'Wes Clark' }));
    await user.click(screen.getByRole('tab', { name: 'Details' }));
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
    // The wall has no people to search, so the box is not shown there; what
    // was typed is still there when My People comes back.
    expect(screen.queryByRole('searchbox', { name: 'Search people' })).toBeNull();
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
    await screen.findByRole('tab', { name: 'Details' });
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('with stickers unavailable, the wall address says so plainly and leads back to My People', async () => {
    const user = userEvent.setup();
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    renderHub('/contact-hub/stickers');
    expect(await screen.findByText('Stickers are not available for this account yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    // Not My People under another name, and nothing that would write a sticker.
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);

    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('on a phone the same addresses work; the chips are filters only, the wall is reached from the bottom bar', async () => {
    setViewportWidth(375);
    renderHub(`/contact-hub?sticker=${VIP.id}`);
    expect(within(await chips()).getByRole('button', { name: 'VIP, 1 person' })).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['Nakaiya Wiley']);
    // No Sticker Wall chip on a phone: the shell's bottom bar carries it.
    expect(within(await chips()).queryByRole('button', { name: 'Sticker Wall' })).toBeNull();
    expect(within(await chips()).getAllByRole('button').map((b) => b.textContent.replace(/\d+$/, ''))).toEqual(['All', 'Partner', 'VIP']);
    await goTo('/contact-hub/stickers');
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
    // The filters are still there on the wall, and one still leads to its people.
    expect(within(await chips()).queryByRole('button', { name: 'Sticker Wall' })).toBeNull();
  });

  it('a desktop without the sidebar entries keeps the Sticker Wall chip', async () => {
    setViewportWidth(1024);
    renderHub();
    expect(within(await chips()).getByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
  });

  it('on a phone with no stickers yet there is no empty chip row; the wall is where one is made', async () => {
    setViewportWidth(375);
    fake.current.state.registry = [];
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    await goTo('/contact-hub/stickers');
    const wall = await screen.findByTestId('stickers-wall');
    expect(within(wall).getByRole('button', { name: /New sticker/ })).toBeInTheDocument();
  });
});

// The person page tells the shell who is open, the way every other profile
// does, so the top bar names the person. These run inside the REAL shell
// provider and read back what it holds, so the hook's own set and clear are
// what is being tested, not a stand-in.
describe('the shell is told who is open', () => {
  const shellSeen = { context: null };
  function ShellProbe() {
    const { navigationContext } = useShell();
    useEffect(() => { shellSeen.context = navigationContext; }, [navigationContext]);
    return null;
  }
  /** What the shell currently holds about the open record. */
  const open = () => ({
    type: shellSeen.context.current_entity_type,
    id: shellSeen.context.current_entity_id,
    label: shellSeen.context.entity_label,
    stage: shellSeen.context.current_pipeline_stage,
  });
  const NOBODY = { type: null, id: null, label: null, stage: null };

  function renderHubInShell(url, shellUser = { id: 'u1' }) {
    shellSeen.context = null;
    return render(
      <MemoryRouter initialEntries={[url]}>
        <RouterProbe />
        <ShellProvider user={shellUser} userData={{}}>
          <ShellProbe />
          <Routes>
            <Route path="/contact-hub" element={<ContactHubMain />}>
              <Route index element={<HubPeople />} />
              <Route path="stickers" element={<HubPeople />} />
              <Route path="person/:contactId" element={<HubPerson />} />
            </Route>
          </Routes>
        </ShellProvider>
      </MemoryRouter>,
    );
  }

  it.each([
    [{ id: 'u1', hasCompletedPayment: false }, false],
    [{ id: 'u1', hasCompletedPayment: true }, true],
    [{ id: 'other', hasCompletedPayment: true }, false],
  ])('gates Emails and Barry to the entitled profile account (%j)', async (shellUser, allowed) => {
    renderHubInShell('/contact-hub/person/p2', shellUser);
    await screen.findByRole('tab', { name: 'Action Center' });
    expect(Boolean(screen.queryByRole('tab', { name: 'Emails' }))).toBe(allowed);
    expect(Boolean(screen.queryByRole('button', { name: 'Open Barry' }))).toBe(allowed);
  });

  it('opening a person reports their name and id, and no pipeline stage', async () => {
    renderHubInShell('/contact-hub/person/p2');
    await screen.findByRole('tab', { name: 'Action Center' });
    await waitFor(() => expect(open()).toEqual({ type: 'contact', id: 'p2', label: 'Wes Clark', stage: null }));
  });

  it('a person in a sales stage is reported the same way: Contact Hub passes no stage', async () => {
    renderHubInShell('/contact-hub/person/p5');
    await screen.findByRole('tab', { name: 'Action Center' });
    await waitFor(() => expect(open()).toEqual({ type: 'contact', id: 'p5', label: 'Hunter Stage', stage: null }));
  });

  it('nothing is reported while the people are still loading', async () => {
    let finish;
    const { getDocs } = await import('firebase/firestore');
    getDocs.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderHubInShell('/contact-hub/person/p2');
    await screen.findByText('Loading…');
    expect(open()).toEqual(NOBODY);
    finish({ docs: contactsData.list.map((d) => ({ id: d.id, data: () => d })) });
    await waitFor(() => expect(open().id).toBe('p2'));
  });

  it('renaming the person updates what the shell holds, for the same id', async () => {
    const user = userEvent.setup();
    renderHubInShell('/contact-hub/person/p2');
    await screen.findByRole('tab', { name: 'Action Center' });
    await waitFor(() => expect(open().label).toBe('Wes Clark'));
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    await user.click(screen.getByRole('button', { name: 'rename' }));
    await waitFor(() => expect(open()).toEqual({ type: 'contact', id: 'p2', label: 'Renamed Person', stage: null }));
  });

  it.each([
    ['archived', '/contact-hub/person/p4'],
    ['unknown', '/contact-hub/person/nobody'],
  ])('an %s person is not reported as open', async (_label, url) => {
    renderHubInShell(url);
    await screen.findByText('This person is not in My People.');
    expect(open()).toEqual(NOBODY);
  });

  it('when the people cannot be loaded, nobody is reported as open', async () => {
    contactsData.fail = true;
    renderHubInShell('/contact-hub/person/p2');
    await screen.findByText('This person could not be loaded.');
    expect(open()).toEqual(NOBODY);
  });

  it('returning to My People clears the person; opening another reports the new one', async () => {
    const user = userEvent.setup();
    renderHubInShell('/contact-hub/person/p2');
    await screen.findByRole('tab', { name: 'Action Center' });
    await waitFor(() => expect(open().id).toBe('p2'));

    await user.click(screen.getByRole('link', { name: 'My People' }));
    await screen.findByRole('list', { name: 'My People' });
    await waitFor(() => expect(open()).toEqual(NOBODY));

    await user.click(screen.getByRole('link', { name: 'Nakaiya Wiley' }));
    await waitFor(() => expect(open()).toEqual({ type: 'contact', id: 'p1', label: 'Nakaiya Wiley', stage: null }));

    // The browser's Back button leaves the person the same way.
    await goBack();
    await waitFor(() => expect(open()).toEqual(NOBODY));
  });

  it('My People and the Sticker Wall report nobody', async () => {
    renderHubInShell('/contact-hub');
    await screen.findByRole('list', { name: 'My People' });
    expect(open()).toEqual(NOBODY);
  });
});

describe('the Sticker Wall has its own name and a visible way back', () => {
  it.each([[1024], [375]])('at %ipx it is headed "Sticker Wall", not "My People", with a link back', async (width) => {
    setViewportWidth(width);
    renderHub('/contact-hub/stickers');
    await screen.findByTestId('stickers-wall');
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /My People/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'My People' })).toHaveAttribute('href', '/contact-hub');
  });

  it('adding and searching people are not offered on the wall, and come back with My People', async () => {
    const user = userEvent.setup();
    renderHub('/contact-hub/stickers');
    await screen.findByTestId('stickers-wall');
    expect(screen.queryByRole('button', { name: 'Add Person' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search people' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();

    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(router.at).toBe('/contact-hub');
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(4)');
    expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('the way back returns to My People as it was left, sticker filter included', async () => {
    const user = userEvent.setup();
    setViewportWidth(375);
    renderHub(`/contact-hub?sticker=${PARTNER.id}`);
    await screen.findByRole('group', { name: 'Filter by sticker' });
    await goTo('/contact-hub/stickers');
    await screen.findByTestId('stickers-wall');
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
  });

  it('Back and Forward step between My People and the wall, and the heading follows', async () => {
    const user = userEvent.setup();
    renderHub();
    const group = await screen.findByRole('group', { name: 'Filter by sticker' });
    await user.click(within(group).getByRole('button', { name: 'Sticker Wall' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    await goBack();
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toBeInTheDocument();
    await goForward();
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
  });

  it('while stickers are still being checked the wall says it is loading, never My People, then draws', async () => {
    let answer;
    fake.current.services.fetchStickersConfig = () => new Promise((resolve) => { answer = resolve; });
    renderHub('/contact-hub/stickers');
    expect(await screen.findByText('Loading your stickers…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    expect(screen.queryByText(/not available|could not be loaded/i)).toBeNull();
    answer(config());
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
    expect(screen.queryByText('Loading your stickers…')).toBeNull();
  });

  it('when the sticker list fails to load, the wall says that, once, and not "not available"', async () => {
    fake.current.services.subscribeStickers = (_uid, _onNext, onError) => {
      fake.current.state.subscriptions += 1;
      Promise.resolve().then(() => onError(Object.assign(new Error('unavailable'), { code: 'unavailable' })));
      return () => {};
    };
    renderHub('/contact-hub/stickers');
    expect(await screen.findByText(/Your stickers could not be loaded\. They have not been changed\./)).toBeInTheDocument();
    expect(screen.getAllByText(/Your stickers could not be loaded/)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    expect(screen.queryByText(/not available|Loading your stickers/i)).toBeNull();
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
  });

  it('with nobody in My People yet the wall is still the wall, so a sticker can be made first', async () => {
    const user = userEvent.setup();
    contactsData.list = [];
    renderHub('/contact-hub/stickers');
    const wall = await screen.findByTestId('stickers-wall');
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    expect(within(wall).getByRole('button', { name: /New sticker/ })).toBeInTheDocument();
    expect(screen.queryByText('Start with one person')).toBeNull();
    // The invitation is My People's, and is there when you go back.
    await user.click(screen.getByRole('link', { name: 'My People' }));
    expect(await screen.findByText('Start with one person')).toBeInTheDocument();
  });
});

describe('on a phone, a filtered list says which sticker and how many', () => {
  beforeEach(() => { setViewportWidth(375); });

  it('names the sticker and the number listed, and Show everyone clears it', async () => {
    const user = userEvent.setup();
    renderHub(`/contact-hub?sticker=${VIP.id}`);
    await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.getByText('1 person with the VIP sticker')).toBeInTheDocument();
    expect(names()).toEqual(['Nakaiya Wiley']);

    await user.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(router.at).toBe('/contact-hub');
    expect(screen.queryByText(/with the VIP sticker/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show everyone' })).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('counts what is listed: several people, and fewer when a search narrows them', async () => {
    const user = userEvent.setup();
    contactsData.list.push(person('p9', 'Zed Young', { sticker_ids: [VIP.id] }));
    renderHub(`/contact-hub?sticker=${VIP.id}`);
    await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.getByText('2 people with the VIP sticker')).toBeInTheDocument();
    // The archived person also holds VIP and is not counted.
    expect(names()).toHaveLength(2);
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'zed');
    expect(screen.getByText('1 person with the VIP sticker')).toBeInTheDocument();
    // Show everyone removes the sticker and keeps what was typed.
    await user.click(screen.getByRole('button', { name: 'Show everyone' }));
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('zed');
    expect(names()).toEqual(['Zed Young']);
  });

  it('says nothing with no sticker selected, and nothing on the wall', async () => {
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.queryByRole('button', { name: 'Show everyone' })).toBeNull();
    await goTo('/contact-hub/stickers');
    await screen.findByTestId('stickers-wall');
    expect(screen.queryByRole('button', { name: 'Show everyone' })).toBeNull();
  });

  it('a sticker in the address that does not exist filters nothing and says nothing', async () => {
    renderHub('/contact-hub?sticker=NoSuchSticker00000000');
    await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.queryByRole('button', { name: 'Show everyone' })).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('a desktop keeps its own line and has no second one', async () => {
    setViewportWidth(1024);
    renderHub(`/contact-hub?sticker=${VIP.id}`);
    await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.getByText('People with the VIP sticker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show everyone' })).toBeNull();
  });
});
